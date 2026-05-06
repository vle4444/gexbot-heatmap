#!/usr/bin/env node
// =============================================================================
// analyze-recording.js
// =============================================================================
// Forensic + automated-sweep signal analyzer for saved gexbot-heatmap sessions.
// Reads one or more SAVE-button-format JSONs, merges them, runs every available
// MaxCh-derived signal on the timeline, and produces:
//
//   * Forensic report — for each user-supplied event (timestamp), lists which
//     signals fired in the lookback window and how many seconds in advance.
//
//   * Sweep — auto-detects candidate pumps/dumps from spot returns, runs each
//     signal across all candidates, aggregates hit-rate / mean-lead / etc.
//
// Usage:
//   node analyze-recording.js [files...]                 # sweep only
//   node analyze-recording.js --events events.json [files...]
//
// Where `events.json` is:
//   [
//     { "label": "dump",       "tsLocal": "2026-05-05T21:50:00", "tz": "+02:00", "type": "dump" },
//     { "label": "bounce 7255", "tsLocal": "2026-05-05T19:10:00", "tz": "+02:00", "type": "bounce" },
//     ...
//   ]
//
// All thresholds are tuned conservatively. Edit the CONFIG block to taste.
// Vanilla Node (Node 18+); no dependencies.
// =============================================================================
'use strict';

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG — tweak as needed.
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  // Forensic lookback per user event (seconds == snapshots @ 1Hz)
  lookbackSec: 300,                     // 5 min before each event
  // "Tight" lookback: how recently did the signal fire? <60s = signal ran HOT
  // right before the event, vs firing once 5 minutes ago and then going quiet.
  tightLookbackSec: 60,
  // Auto-detect sweep — candidate event criteria
  // Tuned for low-vol regimes (this day had ~30pt total range on SPX)
  sweepWindowSec: 300,                  // window over which to compute spot return
  sweepMinReturnPct: 0.08,              // |Δspot|/spot > 0.08% within window  → candidate
  sweepMergeGapSec: 300,                // merge candidates within 5 min of each other
  // Pulse presets (mirror of delta.html v0.7.2)
  pulsePresets: {
    pulse_fast:   { ema: 10, zFire: 1.5, zKeep: 0.5, hold: 3, minSigmaPct: 0.02, minSamples: 4 },
    pulse_normal: { ema: 20, zFire: 2.0, zKeep: 0.7, hold: 5, minSigmaPct: 0.02, minSamples: 5 },
    pulse_strict: { ema: 30, zFire: 3.0, zKeep: 1.0, hold: 8, minSigmaPct: 0.03, minSamples: 8 },
  },
  // CUSUM presets (mirror of delta.html)
  cusumPresets: {
    cusum_loose:   { k: 1.5, hHigh: 4,  hLow: 2  },
    cusum_normal:  { k: 1.5, hHigh: 6,  hLow: 3  },
    cusum_strict:  { k: 1.5, hHigh: 10, hLow: 5  },
    cusum_tight:   { k: 1.5, hHigh: 15, hLow: 8  },
    cusum_severe:  { k: 2.0, hHigh: 22, hLow: 11 },
    cusum_extreme: { k: 2.5, hHigh: 35, hLow: 18 },
  },
  // Spot velocity z-score windows (seconds)
  spotVelWindowsSec: [60, 180, 300],    // 1m, 3m, 5m
  spotVelZFire: 2.5,
};

// ─────────────────────────────────────────────────────────────────────────────
// IO + MERGE
// ─────────────────────────────────────────────────────────────────────────────
function loadFile(p) {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!j.snapshots) throw new Error(`${p}: no snapshots`);
  return j;
}

function mergeSnapshots(files) {
  const all = [];
  for (const f of files) all.push(...f.snapshots);
  all.sort((a, b) => a.ts - b.ts);
  // Dedupe by ts (overlapping saves)
  const out = [];
  let lastTs = -Infinity;
  for (const s of all) {
    if (s.ts <= lastTs) continue;
    out.push(s);
    lastTs = s.ts;
  }
  return out;
}

// Bucket aggregation — mirrors delta.html's aggSnapBuckets()
function aggSnapBuckets(mp) {
  const fired = new Map();
  if (!mp) return fired;
  for (let b = 0; b < 6; b++) {
    const e = mp[b];
    if (!e) continue;
    const strike = parseFloat(e[0]);
    const raw    = parseFloat(e[1]);
    if (!isFinite(strike) || !isFinite(raw) || strike <= 0 || raw === 0) continue;
    const dir = -raw;  // sign convention per CLAUDE.md
    let cur = fired.get(strike);
    if (!cur) {
      cur = { count: 0, posVotes: 0, negVotes: 0, absSum: 0, dirSum: 0, maxAbs: 0, tieBreak: 0 };
      fired.set(strike, cur);
    }
    cur.count++;
    cur.absSum += Math.abs(dir);
    cur.dirSum += dir;
    if (dir >= 0) cur.posVotes++; else cur.negVotes++;
    const mag = Math.abs(dir);
    if (mag > cur.maxAbs) {
      cur.maxAbs   = mag;
      cur.tieBreak = dir >= 0 ? 1 : -1;
    }
  }
  return fired;
}

function sessionMaxAbs(snaps) {
  let m = 0;
  for (const s of snaps) {
    const mp = s.meta.maxPriors;
    if (!mp) continue;
    for (let b = 0; b < 6; b++) {
      const e = mp[b];
      if (!e) continue;
      const a = Math.abs(parseFloat(e[1]));
      if (a > m) m = a;
    }
  }
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL: PULSE
// ─────────────────────────────────────────────────────────────────────────────
// For each preset, returns Array<Array<{strike, state, mag}>> per snapshot
// (only snapshots where at least one strike is in ON state).
function computePulse(snaps, preset) {
  const { ema, zFire, zKeep, hold, minSigmaPct, minSamples } = preset;
  const alpha = 2 / (ema + 1);
  const sMaxAbs  = sessionMaxAbs(snaps);
  const sigmaFloor = Math.max(1e-9, sMaxAbs * minSigmaPct);

  const tracker = new Map();
  const fires = new Array(snaps.length);  // null if no fire, else array of {strike,state,mag}

  for (let ci = 0; ci < snaps.length; ci++) {
    const fired = aggSnapBuckets(snaps[ci].meta.maxPriors);

    // Update / compute z for tracked strikes
    for (const cs of tracker.values()) {
      const info = fired.get(cs.strike);
      const m = info ? info.absSum : 0;
      const dir = info ? (info.dirSum >= 0 ? 1 : -1) : 0;
      const sigma = Math.max(Math.sqrt(cs.s2), sigmaFloor);
      cs.lastZ   = (cs.n >= minSamples) ? (m - cs.mu) / sigma : 0;
      cs.lastM   = m;
      cs.lastDir = dir;
      cs.zeroStreak = (m === 0) ? cs.zeroStreak + 1 : 0;
      const delta = m - cs.mu;
      cs.mu += alpha * delta;
      cs.s2  = (1 - alpha) * (cs.s2 + alpha * delta * delta);
      cs.n  += 1;
    }
    // Register first appearances
    for (const [strike, info] of fired) {
      if (!tracker.has(strike)) {
        tracker.set(strike, {
          strike,
          mu: info.absSum * 0.5,
          s2: Math.max(info.absSum * info.absSum * 0.25, sigmaFloor * sigmaFloor),
          n: 1, state: 0, hold: 0, peakMag: 0,
          lastZ: 0, lastM: info.absSum,
          lastDir: info.dirSum >= 0 ? 1 : -1,
          zeroStreak: 0,
        });
      }
    }
    // State machine
    for (const cs of tracker.values()) {
      if (cs.state === 0) {
        if (cs.lastZ >= zFire && cs.lastM > 0) {
          cs.state   = cs.lastDir || 1;
          cs.hold    = hold;
          cs.peakMag = cs.lastM;
        }
      } else {
        if (cs.lastM > cs.peakMag) cs.peakMag = cs.lastM;
        if (cs.lastZ >= zKeep && cs.lastM > 0) {
          cs.hold = hold;
          if (cs.lastDir !== 0) cs.state = cs.lastDir;
        } else {
          cs.hold -= 1;
          if (cs.hold <= 0) { cs.state = 0; cs.peakMag = 0; }
        }
      }
    }
    // Capture
    const list = [];
    for (const cs of tracker.values()) {
      if (cs.state !== 0 && cs.peakMag > 0) {
        list.push({ strike: cs.strike, state: cs.state, mag: cs.peakMag });
      }
    }
    fires[ci] = list.length ? list : null;

    // Cleanup
    const drainAge = ema * 5;
    for (const [strike, cs] of tracker) {
      if (cs.state === 0 && cs.zeroStreak > drainAge && cs.mu < sigmaFloor) {
        tracker.delete(strike);
      }
    }
  }
  return fires;
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL: CUSUM
// ─────────────────────────────────────────────────────────────────────────────
function computeCusum(snaps, preset) {
  const { k, hHigh, hLow } = preset;
  const cusum = new Map();
  const fires = new Array(snaps.length);
  for (let ci = 0; ci < snaps.length; ci++) {
    const fired = aggSnapBuckets(snaps[ci].meta.maxPriors);
    for (const cs of cusum.values()) {
      cs.sPos = Math.max(0, cs.sPos - k);
      cs.sNeg = Math.max(0, cs.sNeg - k);
    }
    for (const [strike, info] of fired) {
      const sign = info.posVotes > info.negVotes ?  1
                 : info.negVotes > info.posVotes ? -1
                 : info.tieBreak;
      let cs = cusum.get(strike);
      if (!cs) { cs = { sPos: 0, sNeg: 0, state: 0, lastMag: 0 }; cusum.set(strike, cs); }
      if (sign > 0) cs.sPos += info.count; else cs.sNeg += info.count;
      cs.lastMag = info.maxAbs;
    }
    for (const cs of cusum.values()) {
      if (cs.state === 0) {
        if      (cs.sPos >= hHigh) cs.state = +1;
        else if (cs.sNeg >= hHigh) cs.state = -1;
      } else if (cs.state === +1 && cs.sPos < hLow) cs.state = 0;
      else if   (cs.state === -1 && cs.sNeg < hLow) cs.state = 0;
    }
    const list = [];
    for (const [strike, cs] of cusum) {
      if (cs.state !== 0 && cs.lastMag > 0) list.push({ strike, state: cs.state, mag: cs.lastMag });
    }
    fires[ci] = list.length ? list : null;
    for (const [strike, cs] of cusum) {
      if (cs.sPos === 0 && cs.sNeg === 0 && cs.state === 0) cusum.delete(strike);
    }
  }
  return fires;
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL: BURST / SWARM / PUMP
// ─────────────────────────────────────────────────────────────────────────────
function computeBurst(snaps) {
  const HISTORY = 60, MIN_HIST = 15, Z_FIRE = 2.5, CONTRIB_PCT = 0.15;
  const hist = [];
  const fires = new Array(snaps.length);
  for (let ci = 0; ci < snaps.length; ci++) {
    const fired = aggSnapBuckets(snaps[ci].meta.maxPriors);
    let total = 0;
    for (const info of fired.values()) total += info.absSum;
    hist.push(total);
    if (hist.length > HISTORY) hist.shift();
    if (hist.length >= MIN_HIST) {
      let sum = 0, sq = 0;
      for (const t of hist) { sum += t; sq += t * t; }
      const mean = sum / hist.length;
      const sigma = Math.max(1e-9, Math.sqrt(Math.max(0, (sq / hist.length) - mean * mean)));
      const z = (total - mean) / sigma;
      if (z >= Z_FIRE && total > 0) {
        const thresh = total * CONTRIB_PCT;
        const list = [];
        for (const [strike, info] of fired) {
          if (info.absSum >= thresh) {
            list.push({ strike, state: info.dirSum >= 0 ? 1 : -1, mag: info.absSum });
          }
        }
        if (list.length) fires[ci] = list;
      }
    }
  }
  return fires;
}

function computeSwarm(snaps) {
  const SIZE = 2, RANGE = 5, MIN_PCT = 0.05;
  const sMax = sessionMaxAbs(snaps);
  const minMag = sMax * MIN_PCT;
  const fires = new Array(snaps.length);
  for (let ci = 0; ci < snaps.length; ci++) {
    const fired = aggSnapBuckets(snaps[ci].meta.maxPriors);
    if (fired.size < SIZE) continue;
    const items = [];
    for (const [strike, info] of fired) {
      if (info.absSum >= minMag) {
        items.push({ strike, sign: info.dirSum >= 0 ? 1 : -1, mag: info.absSum });
      }
    }
    if (items.length < SIZE) continue;
    items.sort((a, b) => a.strike - b.strike);
    const clusters = [];
    let cur = null;
    for (const it of items) {
      if (cur && cur.sign === it.sign && (it.strike - cur.lastStrike) <= RANGE) {
        cur.members.push(it); cur.lastStrike = it.strike;
      } else {
        cur = { sign: it.sign, lastStrike: it.strike, members: [it] };
        clusters.push(cur);
      }
    }
    const list = [];
    for (const c of clusters) {
      if (c.members.length >= SIZE) {
        for (const m of c.members) list.push({ strike: m.strike, state: c.sign, mag: m.mag });
      }
    }
    if (list.length) fires[ci] = list;
  }
  return fires;
}

function computePump(snaps, burstFires, swarmFires) {
  const NEAR_PCT = 0.005;
  const fires = new Array(snaps.length);
  for (let ci = 0; ci < snaps.length; ci++) {
    if (!burstFires[ci] || !swarmFires[ci]) continue;
    const spot = snaps[ci].meta.spot || 0;
    if (!(spot > 0)) continue;
    const span = spot * NEAR_PCT;
    const burstStrikes = new Set(burstFires[ci].map(e => e.strike));
    const merged = [];
    for (const e of swarmFires[ci]) {
      if (!burstStrikes.has(e.strike)) continue;
      if (Math.abs(e.strike - spot) > span) continue;
      merged.push(e);
    }
    if (merged.length) fires[ci] = merged;
  }
  return fires;
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL: SPOT VELOCITY (z-score over sliding window)
// ─────────────────────────────────────────────────────────────────────────────
function computeSpotVelocity(snaps, windowSec, zFire) {
  // Compute |Δspot| / spot over `windowSec` seconds; track its trailing
  // mean/σ over a longer baseline (windowSec × 5); fire when current z ≥ zFire.
  const baseSec = windowSec * 5;
  const fires = new Array(snaps.length);
  // ts → ci index for fast window lookup
  const tsArr = snaps.map(s => s.ts);
  // Per-ci computed return %
  const ret = new Array(snaps.length).fill(0);
  for (let ci = 0; ci < snaps.length; ci++) {
    const sp = snaps[ci].meta.spot;
    if (!(sp > 0)) continue;
    const tCutoff = snaps[ci].ts - windowSec * 1000;
    let bi = ci;
    while (bi > 0 && tsArr[bi - 1] >= tCutoff) bi--;
    const sp0 = snaps[bi].meta.spot;
    if (!(sp0 > 0)) continue;
    ret[ci] = (sp - sp0) / sp0 * 100;  // signed % return
  }
  // Now sliding mean / σ of |ret|
  for (let ci = 0; ci < snaps.length; ci++) {
    const tCutoff = snaps[ci].ts - baseSec * 1000;
    let bi = ci;
    while (bi > 0 && tsArr[bi - 1] >= tCutoff) bi--;
    const n = ci - bi + 1;
    if (n < 30) continue;
    let sum = 0, sq = 0;
    for (let j = bi; j <= ci; j++) { const a = Math.abs(ret[j]); sum += a; sq += a * a; }
    const mean = sum / n;
    const sigma = Math.max(1e-9, Math.sqrt(Math.max(0, (sq / n) - mean * mean)));
    const cur = Math.abs(ret[ci]);
    const z = (cur - mean) / sigma;
    if (z >= zFire) {
      fires[ci] = [{ strike: snaps[ci].meta.spot, state: ret[ci] >= 0 ? 1 : -1, mag: cur }];
    }
  }
  return fires;
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL: WALL MIGRATION (M+ or M− jumping strikes)
// ─────────────────────────────────────────────────────────────────────────────
function computeWallMigration(snaps) {
  // Fires when M+ or M− changes strike compared to the previous snapshot.
  // Magnitude = |delta strike|, direction = +1 if M+ moved up or M− moved up,
  // -1 if either moved down. Useful for catching wall transitions.
  const fires = new Array(snaps.length);
  for (let ci = 1; ci < snaps.length; ci++) {
    const a = snaps[ci - 1].meta;
    const b = snaps[ci    ].meta;
    const list = [];
    if (typeof a.majPos === 'number' && typeof b.majPos === 'number' && a.majPos !== b.majPos) {
      const delta = b.majPos - a.majPos;
      list.push({ strike: b.majPos, state: delta >= 0 ? 1 : -1, mag: Math.abs(delta), kind: 'M+' });
    }
    if (typeof a.majNeg === 'number' && typeof b.majNeg === 'number' && a.majNeg !== b.majNeg) {
      const delta = b.majNeg - a.majNeg;
      list.push({ strike: b.majNeg, state: delta >= 0 ? 1 : -1, mag: Math.abs(delta), kind: 'M−' });
    }
    if (list.length) fires[ci] = list;
  }
  return fires;
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL: WALL PROXIMITY COLLAPSE (spot rapidly approaching M+ or M−)
// ─────────────────────────────────────────────────────────────────────────────
function computeWallProximity(snaps, windowSec = 60) {
  // Distance from spot to nearest of (M+, M−) — when this drops by >50% over
  // the window relative to its own session-max distance, fire.
  const fires = new Array(snaps.length);
  const tsArr = snaps.map(s => s.ts);
  const dists = new Array(snaps.length).fill(NaN);
  for (let ci = 0; ci < snaps.length; ci++) {
    const m = snaps[ci].meta;
    const sp = m.spot;
    if (!(sp > 0)) continue;
    const dPos = (typeof m.majPos === 'number') ? Math.abs(m.majPos - sp) : Infinity;
    const dNeg = (typeof m.majNeg === 'number') ? Math.abs(m.majNeg - sp) : Infinity;
    dists[ci] = Math.min(dPos, dNeg);
  }
  for (let ci = 0; ci < snaps.length; ci++) {
    if (!isFinite(dists[ci])) continue;
    const tCutoff = snaps[ci].ts - windowSec * 1000;
    let bi = ci;
    while (bi > 0 && tsArr[bi - 1] >= tCutoff) bi--;
    if (!isFinite(dists[bi])) continue;
    const dropPct = (dists[bi] - dists[ci]) / Math.max(0.5, dists[bi]);
    if (dropPct >= 0.5 && dists[ci] < dists[bi]) {
      const m = snaps[ci].meta;
      const sp = m.spot;
      const nearStrike = (Math.abs(m.majPos - sp) < Math.abs(m.majNeg - sp)) ? m.majPos : m.majNeg;
      // state sign = +1 if approaching upper wall (M+), -1 if approaching lower wall (M−)
      const state = nearStrike >= sp ? 1 : -1;
      fires[ci] = [{ strike: nearStrike, state, mag: dists[bi] - dists[ci] }];
    }
  }
  return fires;
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP COMPOSER (port of v0.8.0 LIVE_SIGNALS) — replays the buffer through
// the level tracker + Pulse live state + setup composer to produce the same
// rejection / breakout fires the dashboard would have generated, had AUTO ★
// existed when the buffer was being recorded. Output: chronological array of
// fires with type / strike / spot / regime / confidence / hold-time / vel.
// ─────────────────────────────────────────────────────────────────────────────
// v0.8.1: cooldowns bumped (high 180→360, med 240→600, low 360→900) after the
// 2026-05-05 retrospective showed too many repeat fires on a single wall test.
const SETUP_SENSITIVITY = {
  high: { nearPct: 0.0010, pulseWithinSec: 60, velWindowSec: 30, velMinPct: 0.005, cooldownSec: 360 },
  med:  { nearPct: 0.0006, pulseWithinSec: 45, velWindowSec: 30, velMinPct: 0.010, cooldownSec: 600 },
  low:  { nearPct: 0.0004, pulseWithinSec: 30, velWindowSec: 30, velMinPct: 0.020, cooldownSec: 900 },
};
const SETUP_PULSE_CFG = { ema: 20, zFire: 2.0, zKeep: 0.7, hold: 5, minSigmaPct: 0.02, minSamples: 5 };

function runSetupComposer(snaps, sensName) {
  const sens = SETUP_SENSITIVITY[sensName] || SETUP_SENSITIVITY.med;
  const cfg  = SETUP_PULSE_CFG;
  const alpha = 2 / (cfg.ema + 1);

  // Level tracker
  const levelMap = new Map();
  const levelGet = (strike) => {
    let cs = levelMap.get(strike);
    if (!cs) { cs = { strike, holdSnaps: 0, flowScore: 0, lastSeenCi: -1 }; levelMap.set(strike, cs); }
    return cs;
  };

  // Pulse live state
  const pulseTracker = new Map();
  let pulseSessionMaxAbs = 0;

  // Cooldown + output
  const cooldown = new Map();
  const fires = [];

  for (let ci = 0; ci < snaps.length; ci++) {
    const snap = snaps[ci];
    const m = snap.meta;

    // ── 1. Update level tracker (M+/M− + maxchange leadership) ──────────
    if (typeof m.majPos === 'number' && m.majPos > 0) {
      const cs = levelGet(m.majPos); cs.holdSnaps++; cs.lastSeenCi = ci;
    }
    if (typeof m.majNeg === 'number' && m.majNeg > 0) {
      const cs = levelGet(m.majNeg); cs.holdSnaps++; cs.lastSeenCi = ci;
    }
    if (m.maxPriors) {
      const counts = new Map();
      for (let b = 0; b < 6; b++) {
        const e = m.maxPriors[b];
        if (!e) continue;
        const k = parseFloat(e[0]);
        if (!isFinite(k) || k <= 0) continue;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      for (const [k, c] of counts) {
        const cs = levelGet(k); cs.flowScore += c / 6; cs.lastSeenCi = ci;
      }
    }

    // ── 2. Update Pulse live state ───────────────────────────────────────
    const fired = aggSnapBuckets(m.maxPriors);
    if (m.maxPriors) {
      for (let b = 0; b < 6; b++) {
        const e = m.maxPriors[b];
        if (!e) continue;
        const a = Math.abs(parseFloat(e[1]));
        if (a > pulseSessionMaxAbs) pulseSessionMaxAbs = a;
      }
    }
    const sigmaFloor = Math.max(1e-9, pulseSessionMaxAbs * cfg.minSigmaPct);

    for (const cs of pulseTracker.values()) {
      const info = fired.get(cs.strike);
      const mag = info ? info.absSum : 0;
      const dir = info ? (info.dirSum >= 0 ? 1 : -1) : 0;
      const sigma = Math.max(Math.sqrt(cs.s2), sigmaFloor);
      cs.lastZ = (cs.n >= cfg.minSamples) ? (mag - cs.mu) / sigma : 0;
      cs.lastM = mag; cs.lastDir = dir;
      cs.zeroStreak = (mag === 0) ? cs.zeroStreak + 1 : 0;
      const delta = mag - cs.mu;
      cs.mu += alpha * delta;
      cs.s2  = (1 - alpha) * (cs.s2 + alpha * delta * delta);
      cs.n  += 1;
    }
    for (const [strike, info] of fired) {
      if (!pulseTracker.has(strike)) {
        pulseTracker.set(strike, {
          strike,
          mu: info.absSum * 0.5,
          s2: Math.max(info.absSum * info.absSum * 0.25, sigmaFloor * sigmaFloor),
          n: 1, state: 0, hold: 0, peakMag: 0,
          lastFireCi: -1,
          lastZ: 0, lastM: info.absSum,
          lastDir: info.dirSum >= 0 ? 1 : -1,
          zeroStreak: 0,
        });
      }
    }
    for (const cs of pulseTracker.values()) {
      if (cs.state === 0) {
        if (cs.lastZ >= cfg.zFire && cs.lastM > 0) {
          cs.state = cs.lastDir || 1;
          cs.hold  = cfg.hold;
          cs.peakMag = cs.lastM;
          cs.lastFireCi = ci;
        }
      } else {
        if (cs.lastM > cs.peakMag) cs.peakMag = cs.lastM;
        if (cs.lastZ >= cfg.zKeep && cs.lastM > 0) {
          cs.hold = cfg.hold;
          if (cs.lastDir !== 0) cs.state = cs.lastDir;
        } else {
          cs.hold -= 1;
          if (cs.hold <= 0) { cs.state = 0; cs.peakMag = 0; }
        }
      }
    }

    // ── 3. Evaluate setups (warmup gate + sticky levels + regime) ────────
    if (ci < 30) continue;
    const sp = +m.spot;
    if (!(sp > 0)) continue;

    const minHold = 60;
    const candidates = [];
    for (const cs of levelMap.values()) {
      if (cs.holdSnaps < minHold) continue;
      cs.score = cs.holdSnaps + cs.flowScore * 0.5;
      candidates.push(cs);
    }
    candidates.sort((a, b) => b.score - a.score);
    const levels = candidates.slice(0, 8);
    if (!levels.length) continue;

    // Regime
    const zg = +m.zeroG;
    let regime = 'unknown';
    if (sp > 0 && isFinite(zg) && zg !== 0) {
      const distPct = Math.abs(sp - zg) / sp;
      if (distPct < 0.0005) regime = 'flip';
      else regime = sp > zg ? 'long_g' : 'short_g';
    }

    // Spot velocity
    const targetTs = snap.ts - sens.velWindowSec * 1000;
    let bi = ci;
    while (bi > 0 && snaps[bi - 1].ts >= targetTs) bi--;
    const sp0 = snaps[bi].meta.spot;
    const vel = (sp0 > 0) ? (sp - sp0) / sp0 * 100 : 0;

    // Recent Pulse fires
    const recent = [];
    for (const cs of pulseTracker.values()) {
      if (cs.lastFireCi < 0) continue;
      if (ci - cs.lastFireCi <= sens.pulseWithinSec) {
        recent.push({ strike: cs.strike, ci: cs.lastFireCi, dir: cs.lastDir, mag: cs.peakMag });
      }
    }

    const prevSp = (ci > 0) ? snaps[ci - 1].meta.spot : sp;

    for (const lv of levels) {
      const wall = lv.strike;
      const distPct = Math.abs(sp - wall) / sp;
      const stars = lv.holdSnaps >= 1800 ? 3 : lv.holdSnaps >= 900 ? 2 : 1;

      let nearPulse = null;
      for (const f of recent) {
        if (Math.abs(f.strike - wall) <= 5) {
          if (!nearPulse || f.mag > nearPulse.mag) nearPulse = f;
        }
      }

      // Rejection
      if (distPct <= sens.nearPct &&
          nearPulse &&
          (regime === 'long_g' || regime === 'unknown' || regime === 'flip')) {
        const approach = Math.sign(wall - sp) === Math.sign(vel);
        if (approach || Math.abs(vel) < sens.velMinPct) {
          const key = `rejection@${wall}`;
          if (!cooldown.has(key) || ci > cooldown.get(key)) {
            fires.push({
              type: 'rejection', strike: wall, ci, ts: snap.ts,
              spot: sp, confidence: stars, regime,
              pulseDir: nearPulse.dir, pulseMag: nearPulse.mag, vel,
              holdMin: lv.holdSnaps / 60,
            });
            cooldown.set(key, ci + sens.cooldownSec);
          }
        }
      }

      // Breakout
      const crossed = Math.sign(prevSp - wall) !== Math.sign(sp - wall) &&
                      prevSp !== wall && sp !== wall;
      if (crossed && nearPulse) {
        const breakDir = Math.sign(sp - wall);
        const sustained = Math.sign(vel) === breakDir && Math.abs(vel) >= sens.velMinPct;
        if (sustained && (regime === 'short_g' || regime === 'unknown' || regime === 'flip')) {
          const key = `breakout@${wall}`;
          if (!cooldown.has(key) || ci > cooldown.get(key)) {
            fires.push({
              type: 'breakout', strike: wall, ci, ts: snap.ts,
              spot: sp, confidence: stars, regime,
              dir: breakDir, pulseDir: nearPulse.dir, pulseMag: nearPulse.mag, vel,
              holdMin: lv.holdSnaps / 60,
            });
            cooldown.set(key, ci + sens.cooldownSec);
          }
        }
      }
    }
  }

  return fires;
}

// ─────────────────────────────────────────────────────────────────────────────
// HARNESS — run all signals, find first-fire-in-window per event, aggregate.
// ─────────────────────────────────────────────────────────────────────────────
function buildAllSignals(snaps) {
  const out = {};
  console.error('  computing pulse_fast…');
  out['pulse_fast']    = computePulse(snaps, CONFIG.pulsePresets.pulse_fast);
  console.error('  computing pulse_normal…');
  out['pulse_normal']  = computePulse(snaps, CONFIG.pulsePresets.pulse_normal);
  console.error('  computing pulse_strict…');
  out['pulse_strict']  = computePulse(snaps, CONFIG.pulsePresets.pulse_strict);
  console.error('  computing CUSUM presets…');
  for (const [name, p] of Object.entries(CONFIG.cusumPresets)) {
    out[name] = computeCusum(snaps, p);
  }
  console.error('  computing burst / swarm / pump…');
  out['burst'] = computeBurst(snaps);
  out['swarm'] = computeSwarm(snaps);
  out['pump']  = computePump(snaps, out['burst'], out['swarm']);
  console.error('  computing spot velocity z…');
  for (const w of CONFIG.spotVelWindowsSec) {
    out[`spot_vel_${w}s`] = computeSpotVelocity(snaps, w, CONFIG.spotVelZFire);
  }
  console.error('  computing wall migration / proximity…');
  out['wall_migrate']      = computeWallMigration(snaps);
  out['wall_prox_60s']     = computeWallProximity(snaps, 60);
  out['wall_prox_180s']    = computeWallProximity(snaps, 180);
  return out;
}

function findFirstFireInWindow(signal, eventCi, lookbackSnaps) {
  // Find first ci in [eventCi - lookbackSnaps, eventCi] where signal[ci] != null
  const start = Math.max(0, eventCi - lookbackSnaps);
  for (let i = start; i <= eventCi; i++) {
    if (signal[i] && signal[i].length) return i;
  }
  return -1;
}

// Density: fraction of snapshots in [start, end] where signal fires.
// Used to compute base rate (whole session) vs per-event-window rate.
function fireDensity(signal, start, end) {
  let on = 0, total = 0;
  for (let i = Math.max(0, start); i <= Math.min(signal.length - 1, end); i++) {
    total++;
    if (signal[i] && signal[i].length) on++;
  }
  return total ? on / total : 0;
}

function fmtUtc(ts)   { return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + 'Z'; }
function fmtCest(ts)  {
  // CEST = UTC+2 in May
  const d = new Date(ts + 2 * 3600 * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' (CEST)';
}

// ─────────────────────────────────────────────────────────────────────────────
// SWEEP — auto-detect spot moves
// ─────────────────────────────────────────────────────────────────────────────
function detectCandidates(snaps) {
  const W = CONFIG.sweepWindowSec;
  const minPct = CONFIG.sweepMinReturnPct;
  const tsArr = snaps.map(s => s.ts);
  const candidates = [];
  let lastEventCi = -Infinity;
  const mergeGap = CONFIG.sweepMergeGapSec;

  for (let ci = 0; ci < snaps.length; ci++) {
    const sp = snaps[ci].meta.spot;
    if (!(sp > 0)) continue;
    const tCutoff = snaps[ci].ts - W * 1000;
    let bi = ci;
    while (bi > 0 && tsArr[bi - 1] >= tCutoff) bi--;
    const sp0 = snaps[bi].meta.spot;
    if (!(sp0 > 0)) continue;
    const ret = (sp - sp0) / sp0 * 100;  // signed %
    if (Math.abs(ret) >= minPct) {
      // Merge into prior candidate if within mergeGap
      const tsSec = snaps[ci].ts / 1000;
      if (candidates.length && tsSec - candidates[candidates.length - 1].peakTsSec < mergeGap) {
        const prev = candidates[candidates.length - 1];
        if (Math.abs(ret) > Math.abs(prev.ret)) {
          prev.peakCi = ci; prev.peakTsSec = tsSec; prev.ret = ret; prev.endSpot = sp;
        }
      } else {
        candidates.push({
          peakCi: ci, peakTsSec: tsSec, ret, startSpot: sp0, endSpot: sp,
          windowSec: W,
        });
      }
    }
  }
  return candidates;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { events: null, files: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--events' && argv[i + 1]) { out.events = argv[++i]; }
    else if (argv[i] === '--out' && argv[i + 1]) { out.outPath = argv[++i]; }
    else { out.files.push(argv[i]); }
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (!args.files.length) {
    console.error('Usage: node analyze-recording.js [--events events.json] [--out report.md] file1.json [file2.json ...]');
    process.exit(2);
  }

  console.error(`loading ${args.files.length} file(s)…`);
  const loaded = args.files.map(loadFile);
  const snaps = mergeSnapshots(loaded);
  console.error(`merged: ${snaps.length} unique snapshots`);
  console.error(`range:  ${fmtUtc(snaps[0].ts)} → ${fmtUtc(snaps[snaps.length - 1].ts)}`);
  console.error(`        ${fmtCest(snaps[0].ts)} → ${fmtCest(snaps[snaps.length - 1].ts)}`);

  console.error('\nbuilding signals…');
  const signals = buildAllSignals(snaps);

  // Lookup helper: find ci closest to a given UTC ts
  function findCi(ts) {
    let lo = 0, hi = snaps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (snaps[mid].ts < ts) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  const lines = [];
  lines.push(`# Signal analysis — ${args.files.map(f => path.basename(f)).join(', ')}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`**Snapshots:** ${snaps.length}  `);
  lines.push(`**UTC range:** ${fmtUtc(snaps[0].ts)} → ${fmtUtc(snaps[snaps.length - 1].ts)}  `);
  lines.push(`**CEST range:** ${fmtCest(snaps[0].ts)} → ${fmtCest(snaps[snaps.length - 1].ts)}  `);
  // Compute true min/max spot across whole session
  let spMin = Infinity, spMax = -Infinity;
  for (const s of snaps) { const v = s.meta.spot; if (v > 0) { if (v < spMin) spMin = v; if (v > spMax) spMax = v; } }
  lines.push(`**Spot range (session min/max):** ${spMin.toFixed(2)} … ${spMax.toFixed(2)}  (${(spMax - spMin).toFixed(2)} pts, ${((spMax - spMin) / spMin * 100).toFixed(2)}%)`);
  lines.push('');

  // ── Compute base rate (fire density across the entire session) for each
  // signal. This is the denominator for "lift" calculations — a signal
  // that fires 90% of the time looks falsely predictive without it.
  const baseRate = {};
  for (const [name, sig] of Object.entries(signals)) {
    baseRate[name] = fireDensity(sig, 0, snaps.length - 1);
  }

  // ── Forensic mode (if --events file passed) ────────────────────────────
  if (args.events) {
    const events = JSON.parse(fs.readFileSync(args.events, 'utf8'));
    lines.push('## Forensic — user-supplied events');
    lines.push('');
    lines.push(`Lookback window: **${CONFIG.lookbackSec}s** before each event. ` +
               `Tight window: **${CONFIG.tightLookbackSec}s**. ` +
               `"lead" = seconds between first signal fire and event time. ` +
               `**Lift** = pre-event fire density / overall session fire density. Lift > 1 means the signal fires more often before events than at random; lift = 1 is the "always-on" baseline.`);
    lines.push('');

    const aggregateLead = {};   // signal → [lead times]
    const aggregateHits = {};   // signal → hit count (any fire in lookback)
    const aggregateTightHits = {}; // signal → hit count in tight window
    const aggregatePreDensity = {}; // signal → [pre-event fire density per event]
    const eventsHandled = events.length;

    for (const ev of events) {
      const tsLocal = ev.tsLocal;
      const tz = ev.tz || '+02:00';
      const evTs = new Date(`${tsLocal}${tz}`).getTime();
      const evCi = findCi(evTs);
      lines.push(`### ${ev.label} (${ev.type || 'event'}) — ${tsLocal} ${tz}`);
      lines.push('');
      lines.push(`Event ts UTC: ${fmtUtc(evTs)}  `);
      lines.push(`Closest snapshot: ci=${evCi}, ts=${fmtUtc(snaps[evCi].ts)}, spot=${snaps[evCi].meta.spot.toFixed(2)}`);
      lines.push('');

      // Spot context: show ±60s spot trace as ascii sparkline
      const ctxStart = Math.max(0, evCi - 60);
      const ctxEnd   = Math.min(snaps.length - 1, evCi + 30);
      const spots = [];
      for (let i = ctxStart; i <= ctxEnd; i++) spots.push(snaps[i].meta.spot);
      const spMin = Math.min(...spots), spMax = Math.max(...spots);
      const range = Math.max(0.01, spMax - spMin);
      const bars = '▁▂▃▄▅▆▇█';
      const spark = spots.map(v => bars[Math.floor((v - spMin) / range * 7.99)]).join('');
      lines.push(`Spot ${spMin.toFixed(2)}…${spMax.toFixed(2)} over [evCi-60 .. evCi+30]:`);
      lines.push('```');
      lines.push(spark);
      lines.push(' '.repeat(60) + '↑ event');
      lines.push('```');
      lines.push('');

      lines.push('| signal | first fire (ci) | lead s | tight (≤60s)? | pre density | lift | dir |');
      lines.push('|---|---|---|---|---|---|---|');
      for (const [name, sig] of Object.entries(signals)) {
        const lookback = CONFIG.lookbackSec;
        const firstCi = findFirstFireInWindow(sig, evCi, lookback);
        const preDensity = fireDensity(sig, evCi - lookback, evCi);
        const lift = baseRate[name] > 1e-9 ? preDensity / baseRate[name] : 0;
        if (!aggregateLead[name])         aggregateLead[name] = [];
        if (!aggregateHits[name])         aggregateHits[name] = 0;
        if (!aggregateTightHits[name])    aggregateTightHits[name] = 0;
        if (!aggregatePreDensity[name])   aggregatePreDensity[name] = [];
        aggregatePreDensity[name].push(preDensity);
        if (firstCi < 0) {
          lines.push(`| \`${name}\` | — | — | — | ${(preDensity * 100).toFixed(0)}% | ${lift.toFixed(2)} | — |`);
          continue;
        }
        const lead = Math.round((snaps[evCi].ts - snaps[firstCi].ts) / 1000);
        const tightHit = lead <= CONFIG.tightLookbackSec;
        const fire = sig[firstCi][0];
        const dirStr = fire.state > 0 ? '+' : '−';
        lines.push(`| \`${name}\` | ${firstCi} | **${lead}** | ${tightHit ? '✓' : '·'} | ${(preDensity * 100).toFixed(0)}% | **${lift.toFixed(2)}** | ${dirStr} |`);
        aggregateLead[name].push(lead);
        aggregateHits[name]++;
        if (tightHit) aggregateTightHits[name]++;
      }
      lines.push('');
    }

    // Aggregate
    lines.push('### Forensic aggregate (ranked by lift)');
    lines.push('');
    lines.push(`Across **${eventsHandled}** events. **Lift** is the headline number — it tells you whether the signal is actually elevated before events, controlling for how often it fires in general.`);
    lines.push('');
    lines.push('| signal | base rate | mean pre-density | **mean lift** | ≤60s hits | hit/N | mean lead s |');
    lines.push('|---|---|---|---|---|---|---|');
    const ranked = Object.entries(aggregateLead).map(([name, leads]) => {
      const sorted = [...leads].sort((a, b) => a - b);
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
      const mean = leads.length ? leads.reduce((a, b) => a + b, 0) / leads.length : 0;
      const meanPreDens = aggregatePreDensity[name].reduce((a, b) => a + b, 0) / aggregatePreDensity[name].length;
      const meanLift = baseRate[name] > 1e-9 ? meanPreDens / baseRate[name] : 0;
      return {
        name, hits: aggregateHits[name],
        tightHits: aggregateTightHits[name] || 0,
        hitRate: aggregateHits[name] / eventsHandled,
        mean, median,
        baseRate: baseRate[name],
        meanPreDens, meanLift,
      };
    });
    // Rank: lift first, then tight-window hits, then mean lead time
    ranked.sort((a, b) => b.meanLift - a.meanLift || b.tightHits - a.tightHits || a.mean - b.mean);
    for (const r of ranked) {
      lines.push(`| \`${r.name}\` | ${(r.baseRate * 100).toFixed(1)}% | ${(r.meanPreDens * 100).toFixed(0)}% | **${r.meanLift.toFixed(2)}** | ${r.tightHits}/${eventsHandled} | ${r.hits}/${eventsHandled} | ${r.mean.toFixed(0)} |`);
    }
    lines.push('');
    lines.push('Reading guide:');
    lines.push('- **Lift > 2** = signal fires ≥2× more often before events than baseline → genuinely predictive.');
    lines.push('- **Lift ≈ 1** = signal fires at roughly the same rate before events as elsewhere → "always on", no signal.');
    lines.push('- **Lift < 1** = signal fires *less* before events → counter-indicator (rare but interesting).');
    lines.push('- **≤60s hits** = how many events had the signal fire within the last minute, vs just somewhere in the 5-min window. Higher tight-hit count = signal is freshly active right before the event.');
    lines.push('');
  }

  // ── Sweep ──────────────────────────────────────────────────────────────
  console.error('detecting candidates…');
  const candidates = detectCandidates(snaps);
  lines.push('## Sweep — auto-detected spot moves');
  lines.push('');
  lines.push(`Detection: |Δspot|/spot ≥ **${CONFIG.sweepMinReturnPct}%** within a ${CONFIG.sweepWindowSec}s rolling window. Candidates within ${CONFIG.sweepMergeGapSec}s of each other are merged.`);
  lines.push('');
  lines.push(`Detected: **${candidates.length}** candidates.`);
  lines.push('');

  // Candidate listing
  lines.push('| # | ci | UTC | CEST | Δspot | start → end |');
  lines.push('|---|---|---|---|---|---|');
  candidates.forEach((c, i) => {
    const ts = snaps[c.peakCi].ts;
    lines.push(`| ${i + 1} | ${c.peakCi} | ${fmtUtc(ts).slice(11, 19)} | ${fmtCest(ts).slice(11, 19)} | ${c.ret >= 0 ? '+' : ''}${c.ret.toFixed(3)}% | ${c.startSpot.toFixed(2)} → ${c.endSpot.toFixed(2)} |`);
  });
  lines.push('');

  // Per-signal aggregate across all candidates — with lift
  if (candidates.length) {
    const sweepHits = {};
    const sweepTightHits = {};
    const sweepLeads = {};
    const sweepPreDens = {};
    for (const c of candidates) {
      for (const [name, sig] of Object.entries(signals)) {
        const preDens = fireDensity(sig, c.peakCi - CONFIG.lookbackSec, c.peakCi);
        if (!sweepPreDens[name]) sweepPreDens[name] = [];
        sweepPreDens[name].push(preDens);
        const firstCi = findFirstFireInWindow(sig, c.peakCi, CONFIG.lookbackSec);
        if (firstCi >= 0) {
          if (!sweepLeads[name]) { sweepLeads[name] = []; sweepHits[name] = 0; sweepTightHits[name] = 0; }
          sweepHits[name]++;
          const lead = Math.round((snaps[c.peakCi].ts - snaps[firstCi].ts) / 1000);
          if (lead <= CONFIG.tightLookbackSec) sweepTightHits[name]++;
          sweepLeads[name].push(lead);
        }
      }
    }

    lines.push('### Sweep aggregate (ranked by lift)');
    lines.push('');
    lines.push(`N = **${candidates.length}** auto-detected candidate events. ` +
               `Threshold: |Δspot|/spot ≥ ${CONFIG.sweepMinReturnPct}% in ${CONFIG.sweepWindowSec}s window.`);
    lines.push('');
    lines.push('| signal | base rate | mean pre-density | **mean lift** | ≤60s hits | hit/N | mean lead s |');
    lines.push('|---|---|---|---|---|---|---|');
    const ranked = Object.entries(sweepPreDens).map(([name, preDensList]) => {
      const meanPreDens = preDensList.reduce((a, b) => a + b, 0) / preDensList.length;
      const meanLift    = baseRate[name] > 1e-9 ? meanPreDens / baseRate[name] : 0;
      const leads = sweepLeads[name] || [];
      const mean  = leads.length ? leads.reduce((a, b) => a + b, 0) / leads.length : 0;
      return {
        name,
        hits: sweepHits[name] || 0,
        tightHits: sweepTightHits[name] || 0,
        baseRate: baseRate[name],
        meanPreDens, meanLift, mean,
      };
    });
    ranked.sort((a, b) => b.meanLift - a.meanLift || b.tightHits - a.tightHits || a.mean - b.mean);
    for (const r of ranked) {
      lines.push(`| \`${r.name}\` | ${(r.baseRate * 100).toFixed(1)}% | ${(r.meanPreDens * 100).toFixed(0)}% | **${r.meanLift.toFixed(2)}** | ${r.tightHits}/${candidates.length} | ${r.hits}/${candidates.length} | ${r.mean.toFixed(0)} |`);
    }
    lines.push('');
  }

  // ── Setup composer (v0.8.0 LIVE_SIGNALS replay) ───────────────────────
  console.error('replaying buffer through setup composer (high / med / low)…');
  const eventCis = args.events
    ? JSON.parse(fs.readFileSync(args.events, 'utf8')).map(ev => {
        const tz = ev.tz || '+02:00';
        return { label: ev.label, ts: new Date(`${ev.tsLocal}${tz}`).getTime(), ci: findCi(new Date(`${ev.tsLocal}${tz}`).getTime()) };
      })
    : [];
  const sweepEventCis = candidates.map(c => ({ label: `sweep@${(c.ret>=0?'+':'')}${c.ret.toFixed(2)}%`, ts: snaps[c.peakCi].ts, ci: c.peakCi }));

  function leadToNext(fireCi, eventList) {
    let best = null;
    for (const ev of eventList) {
      if (ev.ci > fireCi) {
        const lead = (snaps[ev.ci].ts - snaps[fireCi].ts) / 1000;
        if (!best || lead < best.lead) best = { lead, label: ev.label };
      }
    }
    return best;
  }

  for (const sensName of ['high', 'med', 'low']) {
    const fires = runSetupComposer(snaps, sensName);
    lines.push(`## Setup composer fires — sensitivity: \`${sensName}\``);
    lines.push('');
    if (!fires.length) {
      lines.push('_No setups fired at this sensitivity._');
      lines.push('');
      continue;
    }
    lines.push(`Replaying yesterday's buffer through the v0.8.0 LIVE_SIGNALS composer with sensitivity = \`${sensName}\`. **${fires.length}** setups fired.`);
    lines.push('');
    lines.push('| # | CEST | type | strike | ★ | spot | regime | dir | vel% | hold (min) | Pulse mag | next user event (s) | next sweep (s) |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    fires.forEach((f, i) => {
      const cest = fmtCest(f.ts).slice(11, 19);
      const stars = '★'.repeat(f.confidence) + '☆'.repeat(3 - f.confidence);
      const dir = f.type === 'breakout' ? (f.dir > 0 ? '↑' : '↓') : (f.pulseDir > 0 ? '+' : '−');
      const nextUser = leadToNext(f.ci, eventCis);
      const nextSweep = leadToNext(f.ci, sweepEventCis);
      const userStr = nextUser ? `**${Math.round(nextUser.lead)}** (${nextUser.label})` : '—';
      const sweepStr = nextSweep ? `${Math.round(nextSweep.lead)} (${nextSweep.label})` : '—';
      lines.push(`| ${i+1} | ${cest} | ${f.type} | ${f.strike} | ${stars} | ${f.spot.toFixed(2)} | ${f.regime} | ${dir} | ${(f.vel>=0?'+':'')}${f.vel.toFixed(3)} | ${f.holdMin.toFixed(0)} | ${f.pulseMag.toFixed(0)} | ${userStr} | ${sweepStr} |`);
    });
    lines.push('');

    // Per-setup-type summary
    const byType = { rejection: 0, breakout: 0 };
    const byStrike = new Map();
    let leadingUserCount = 0, leadingUserLeads = [];
    for (const f of fires) {
      byType[f.type]++;
      byStrike.set(f.strike, (byStrike.get(f.strike) || 0) + 1);
      const nu = leadToNext(f.ci, eventCis);
      if (nu && nu.lead <= 600) {     // within 10 minutes of a known event
        leadingUserCount++;
        leadingUserLeads.push(nu.lead);
      }
    }
    lines.push(`**Breakdown:** ${byType.rejection} rejection, ${byType.breakout} breakout. ` +
               `${leadingUserCount}/${fires.length} fires had a user event within 10 min of firing. ` +
               (leadingUserLeads.length ? `Median lead: ${leadingUserLeads.sort((a,b)=>a-b)[Math.floor(leadingUserLeads.length/2)]}s.` : ''));
    lines.push('');
    const strikeList = [...byStrike.entries()].sort((a, b) => b[1] - a[1]);
    lines.push(`**Most-fired strikes:** ${strikeList.slice(0, 6).map(([k, n]) => `${k} (${n})`).join(', ')}`);
    lines.push('');

    // ★ tier projection — what the AUTO ★ tier filter would show at each setting.
    // Mirrors the dashboard's autoMinTier dropdown (1, 2, 3).
    const sessionHours = (snaps[snaps.length - 1].ts - snaps[0].ts) / 1000 / 3600;
    let t1 = 0, t2 = 0, t3 = 0;
    let t1Hits = 0, t2Hits = 0, t3Hits = 0;
    for (const f of fires) {
      if (f.confidence >= 1) t1++;
      if (f.confidence >= 2) t2++;
      if (f.confidence >= 3) t3++;
      const nu = leadToNext(f.ci, eventCis);
      if (nu && nu.lead <= 600) {
        if (f.confidence >= 1) t1Hits++;
        if (f.confidence >= 2) t2Hits++;
        if (f.confidence >= 3) t3Hits++;
      }
    }
    lines.push('| ★ tier filter | fires | per hour | within 10m of user event |');
    lines.push('|---|---|---|---|');
    lines.push(`| ★+ (all) | ${t1} | ${(t1 / sessionHours).toFixed(1)} | ${t1Hits}/${t1} |`);
    lines.push(`| ★★+ | ${t2} | ${(t2 / sessionHours).toFixed(1)} | ${t2Hits}/${t2} |`);
    lines.push(`| ★★★ <span style="color:#9aa">— v0.8.1 default</span> | ${t3} | ${(t3 / sessionHours).toFixed(1)} | ${t3Hits}/${t3} |`);
    lines.push('');
  }

  // ── Notes ──
  lines.push('## Notes & caveats');
  lines.push('');
  lines.push('- Single trading day (n=1 session). Numbers below should be treated as hypothesis-generating, not statistically significant.');
  lines.push('- "Hit rate" = signal fired *somewhere* in the 5-min lookback window. A high hit-rate signal that also fires constantly outside event windows isn\'t actually predictive — needs a separate "false positive" study (next iteration).');
  lines.push('- Sign convention: `dir = -raw` per CLAUDE.md (open verify TODO). Affects glyph color, not magnitude-based fires.');
  lines.push('- Wall migration / proximity signals depend on `meta.majPos` / `meta.majNeg` being numeric (not `—`). They are in the gamma overlay; check coverage if running on other overlays.');
  lines.push('- Net GEX / Zero γ signals not implemented here because the recorded files use the gamma overlay where those fields are `—`. To enable, re-record in GEX overlay (`Greek = none`).');

  const outPath = args.outPath || 'analysis-report.md';
  fs.writeFileSync(outPath, lines.join('\n'));
  console.error(`\nwrote ${outPath} (${lines.length} lines)`);
}

main();
