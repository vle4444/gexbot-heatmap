// recorder.js — records live GexBot State-tier data to disk as JSONL.
//
// Captures everything the State subscription exposes, for every ticker you
// care about, independently on its own polling loop. Requests are staggered
// at startup so they don't leave the box in one 121-packet burst.
//
// Layout on disk (one file per ticker × endpoint × local day):
//   data/YYYY-MM-DD/TICKER/endpoint.jsonl
//
// Each line is a self-contained record:
//   {"recorded_at":"2026-04-20T14:30:00.123Z",
//    "recorded_ms":1745123400123,
//    "ticker":"SPX",
//    "endpoint":"state_zero",
//    "data": { ...raw API response... }}
//
// Run:   node recorder.js
// Stop:  Ctrl+C    (streams are flushed cleanly on SIGINT)
//
// Reading back for a backtest — nothing clever required:
//   const fs = require('fs');
//   const lines = fs.readFileSync('data/2026-04-20/SPX/state_zero.jsonl','utf8')
//                   .split('\n').filter(Boolean).map(JSON.parse);
//   // lines[i].data.strikes, lines[i].data.spot, lines[i].recorded_ms, ...
//
// Notes:
//   * Safe to run alongside server.js — this process only does outbound
//     HTTPS and file writes, no port is bound.
//   * Do NOT run two recorder instances against the same data/ dir; line
//     appends are atomic per-write but the interleaving is ugly.
//   * Endpoints your tier doesn't cover will 403/404 once and then be
//     permanently skipped (logged at startup).

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ═══════════════════════════════════════════════════════════
//  CONFIG — edit these to taste
// ═══════════════════════════════════════════════════════════

// Minimal .env loader (same as server.js, no dependency on dotenv).
(function () {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
})();

const API_KEY  = process.env.GEXBOT_API_KEY || '';
if (!API_KEY) {
  console.error('✗ GEXBOT_API_KEY not set. Create a .env file or export the variable.');
  process.exit(1);
}

const HOST     = 'api.gexbot.com';
const DATA_DIR = path.join(__dirname, 'data');

// Trim to only the symbols you want to record.
const TICKERS = [
  'SPX', 'NDX', 'VIX',
  'SPY', 'QQQ', 'TLT',
  'AAPL', 'AMZN', 'BABA', 'GME', 'NVDA',
];

// Short-name → URL suffix (after /{TICKER}/state/).
// 0DTE-only: the classified-orderflow GEX profile plus all four Greek
// imbalances for the nearest expiry. /majors and /maxchange are omitted
// on purpose — they're strict subsets of state_zero's payload (which
// already carries zero_gamma, major_pos_vol, major_neg_vol, max_priors).
const ENDPOINTS = {
  state_zero:  'zero',         // classified-orderflow GEX profile, 0DTE
  gamma_zero:  'gamma_zero',   // per-strike gamma imbalance
  delta_zero:  'delta_zero',   // per-strike delta imbalance (DEX)
  charm_zero:  'charm_zero',   // per-strike charm imbalance
  vanna_zero:  'vanna_zero',   // per-strike vanna imbalance
};

// How often each individual poller fires (not total RPS).
// Matches your dashboard's live refresh. With 11 tickers × 5 endpoints
// that's ~55 req/s average, comfortably within any reasonable limit.
const POLL_INTERVAL_MS = 1000;

// Stagger between kicking off pollers at boot. At ~18ms × 55 pollers
// the whole fleet spreads across ~990ms, so requests are evenly
// distributed across each 1s cycle rather than bunched at the start.
const STAGGER_MS = 18;

// Per-request HTTP timeout.
const REQUEST_TIMEOUT_MS = 10000;

// ═══════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════
const streams = new Map();  // key "YYYY-MM-DD|TICKER|endpoint" -> WriteStream
const stats   = new Map();  // key "TICKER/endpoint" -> { ok, errs, bytes, disabled, lastErr }
let currentDay = localDay();

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════
function localDay() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rotateIfNewDay() {
  const d = localDay();
  if (d === currentDay) return;
  // Close every open stream from the previous day.
  for (const s of streams.values()) s.end();
  streams.clear();
  currentDay = d;
  console.log(`[${new Date().toLocaleTimeString()}] Day rolled to ${d}. Opening new files.`);
}

function getStream(ticker, endpointName) {
  rotateIfNewDay();
  const key = `${currentDay}|${ticker}|${endpointName}`;
  const hit = streams.get(key);
  if (hit) return hit;
  const dir = path.join(DATA_DIR, currentDay, ticker);
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${endpointName}.jsonl`);
  const s = fs.createWriteStream(fp, { flags: 'a' });
  streams.set(key, s);
  return s;
}

function fetchJson(urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: HOST,
      path: urlPath,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/json',
        'User-Agent': 'GexBotRecorder/1.0',
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), {
            status: res.statusCode,
            body: body.slice(0, 200),
          }));
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('JSON parse: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.end();
  });
}

function statFor(ticker, endpointName) {
  const k = `${ticker}/${endpointName}`;
  let s = stats.get(k);
  if (!s) { s = { ok: 0, errs: 0, bytes: 0, disabled: false, lastErr: null }; stats.set(k, s); }
  return s;
}

// ═══════════════════════════════════════════════════════════
//  POLLER
// ═══════════════════════════════════════════════════════════
async function pollOne(ticker, endpointName, urlSuffix) {
  const s = statFor(ticker, endpointName);
  if (s.disabled) return;

  try {
    const data = await fetchJson(`/${ticker}/state/${urlSuffix}`);
    const now = Date.now();
    const line = JSON.stringify({
      recorded_at: new Date(now).toISOString(),
      recorded_ms: now,
      ticker,
      endpoint: endpointName,
      data,
    }) + '\n';
    getStream(ticker, endpointName).write(line);
    s.ok++;
    s.bytes += line.length;
    s.lastErr = null;
  } catch (e) {
    s.errs++;
    s.lastErr = e.message;
    if (e.status === 401) {
      console.error(`✗ ${ticker}/${endpointName}: 401 — auth rejected. Disabling.`);
      s.disabled = true;
    } else if (e.status === 403) {
      console.error(`✗ ${ticker}/${endpointName}: 403 — not available on this subscription. Disabling.`);
      s.disabled = true;
    } else if (e.status === 404) {
      console.error(`✗ ${ticker}/${endpointName}: 404 — endpoint/ticker combination not found. Disabling.`);
      s.disabled = true;
    }
    // transient errors (network, 5xx, timeout) just increment errs and retry next tick
  }
}

function startPoller(ticker, endpointName, urlSuffix, initialDelay) {
  setTimeout(() => {
    pollOne(ticker, endpointName, urlSuffix);
    setInterval(() => pollOne(ticker, endpointName, urlSuffix), POLL_INTERVAL_MS);
  }, initialDelay);
}

// ═══════════════════════════════════════════════════════════
//  STARTUP
// ═══════════════════════════════════════════════════════════
async function validateTickers() {
  try {
    const data = await fetchJson('/tickers');
    const all = new Set([
      ...(data.stocks  || []),
      ...(data.indexes || []),
      ...(data.futures || []),
    ]);
    const valid   = TICKERS.filter(t => all.has(t));
    const missing = TICKERS.filter(t => !all.has(t));
    if (missing.length) {
      console.log(`⚠ Tickers missing from /tickers (will still try): ${missing.join(', ')}`);
    }
    return valid.length ? valid : TICKERS;
  } catch (e) {
    console.log(`⚠ /tickers check failed (${e.message}). Proceeding with all configured tickers.`);
    return TICKERS;
  }
}

(async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const endpointNames = Object.keys(ENDPOINTS);
  const liveTickers   = await validateTickers();
  const totalPollers  = liveTickers.length * endpointNames.length;
  const rps           = totalPollers / (POLL_INTERVAL_MS / 1000);

  console.log(`╔════════════════════════════════════════════════════════╗`);
  console.log(`║  GexBot State Recorder                                 ║`);
  console.log(`╠════════════════════════════════════════════════════════╣`);
  console.log(`║  Tickers:       ${String(liveTickers.length).padEnd(40)}║`);
  console.log(`║  Endpoints:     ${String(endpointNames.length).padEnd(40)}║`);
  console.log(`║  Pollers:       ${String(totalPollers).padEnd(40)}║`);
  console.log(`║  Interval:      ${(POLL_INTERVAL_MS / 1000 + 's per endpoint').padEnd(40)}║`);
  console.log(`║  Avg RPS:       ${rps.toFixed(1).padEnd(40)}║`);
  console.log(`║  Output root:   ${DATA_DIR.slice(-40).padEnd(40)}║`);
  console.log(`║  Day partition: ${currentDay.padEnd(40)}║`);
  console.log(`╚════════════════════════════════════════════════════════╝`);
  console.log(`Stagger window: ${(totalPollers * STAGGER_MS / 1000).toFixed(1)}s. Recording starts immediately.`);
  console.log();

  let delay = 0;
  for (const ticker of liveTickers) {
    for (const [name, suffix] of Object.entries(ENDPOINTS)) {
      startPoller(ticker, name, suffix, delay);
      delay += STAGGER_MS;
    }
  }

  // Periodic status line every 30s.
  setInterval(() => {
    rotateIfNewDay();
    let okT = 0, errT = 0, bytesT = 0, disabledN = 0;
    for (const s of stats.values()) {
      okT += s.ok; errT += s.errs; bytesT += s.bytes;
      if (s.disabled) disabledN++;
    }
    const mb = (bytesT / 1024 / 1024).toFixed(1);
    console.log(
      `[${new Date().toLocaleTimeString()}]  ` +
      `ok=${okT}  err=${errT}  disabled=${disabledN}/${stats.size}  written=${mb}MB`
    );
  }, 30000);
})();

// ═══════════════════════════════════════════════════════════
//  CLEAN SHUTDOWN — flush write streams on Ctrl+C
// ═══════════════════════════════════════════════════════════
function shutdown() {
  console.log('\nFlushing streams...');
  const pending = [...streams.values()];
  let left = pending.length;
  if (!left) process.exit(0);
  for (const s of pending) {
    s.end(() => { if (--left === 0) process.exit(0); });
  }
  // hard-exit safety net
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
