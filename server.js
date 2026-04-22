// GexBot Heatmap — all-in-one server.
//   • Serves static HTML (/, /delta.html)
//   • Proxies the live API (/api/* → api.gexbot.com)
//   • Proxies the historical API (/histapi/* → api.gex.bot)  [Quant tier]
//   • Proxies presigned S3 URLs returned by the historical API (/fetch?url=…)
//   • Injects the Authorization header server-side so the API key never
//     reaches the browser.
//
// Run:  GEXBOT_API_KEY=gexbot_custom_xxx node server.js
//       or create a .env file (see .env.example) and run: node server.js
// Open: http://localhost:3001

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

// ── Minimal .env loader (no dotenv dependency) ───────────────
(function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
})();

const PORT    = parseInt(process.env.PORT || '3001', 10);
const API_KEY = process.env.GEXBOT_API_KEY || '';

if (!API_KEY) {
  console.error('\n⚠  GEXBOT_API_KEY is not set.');
  console.error('   Set it in your shell (export GEXBOT_API_KEY=gexbot_custom_...)');
  console.error('   or create a .env file with that line. See .env.example.\n');
  console.error('   Continuing anyway — API requests will return 401.\n');
}

// ── Upstream hosts ───────────────────────────────────────────
const LIVE_HOST = 'api.gexbot.com';    // live /state, /classic endpoints
const HIST_HOST = 'api.gex.bot';       // historical /v2/hist endpoint (Quant tier)

function pipeProxy(upstreamUrl, clientReq, clientRes, injectAuth) {
  const headers = {
    'User-Agent':      'GexBotHeatmap/1.0',
    'Accept':          'application/json',
    'Accept-Encoding': 'gzip',
  };
  if (injectAuth && API_KEY) headers['Authorization'] = 'Bearer ' + API_KEY;

  console.log(`→ ${upstreamUrl}`);

  https.get(upstreamUrl, { headers }, up => {
    console.log(`  ← ${up.statusCode}`);
    const respHeaders = { 'Access-Control-Allow-Origin': '*' };
    for (const h of ['content-type', 'content-encoding', 'content-length', 'location']) {
      if (up.headers[h]) respHeaders[h] = up.headers[h];
    }
    clientRes.writeHead(up.statusCode, respHeaders);
    up.pipe(clientRes);
  }).on('error', err => {
    console.error('Proxy error:', err.message);
    clientRes.writeHead(502, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({ error: err.message }));
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // Config endpoint — client can check auth status without exposing the key.
  if (parsed.pathname === '/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      authConfigured: !!API_KEY,
      keyPrefix:      API_KEY ? API_KEY.slice(0, 14) + '…' : null,
    }));
    return;
  }

  if (parsed.pathname.startsWith('/api/')) {
    const upstreamPath = req.url.replace(/^\/api/, '');
    return pipeProxy(`https://${LIVE_HOST}${upstreamPath}`, req, res, /*injectAuth=*/true);
  }

  if (parsed.pathname.startsWith('/histapi/')) {
    const upstreamPath = req.url.replace(/^\/histapi/, '');
    return pipeProxy(`https://${HIST_HOST}${upstreamPath}`, req, res, /*injectAuth=*/true);
  }

  if (parsed.pathname === '/fetch') {
    const target = parsed.query.url;
    if (!target || !/^https:\/\//.test(target)) {
      res.writeHead(400); res.end('bad url'); return;
    }
    // Presigned S3 URL — DO NOT inject our API key; would leak it outside GexBot.
    return pipeProxy(target, req, res, /*injectAuth=*/false);
  }

  // ── Static files ─────────────────────────────────────────
  const file = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  const fp = path.join(__dirname, file);
  if (!fp.startsWith(__dirname)) { res.writeHead(403); res.end('forbidden'); return; }

  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext  = path.extname(fp).toLowerCase();
    const mime = {
      '.html': 'text/html',
      '.js':   'text/javascript',
      '.css':  'text/css',
      '.json': 'application/json',
      '.svg':  'image/svg+xml',
      '.png':  'image/png',
    }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════════════╗`);
  console.log(`║  GexBot Heatmap running                       ║`);
  console.log(`║                                               ║`);
  console.log(`║  Open: http://localhost:${String(PORT).padEnd(6)}                ║`);
  console.log(`║  Auth: ${API_KEY ? 'configured    ' : 'NOT configured'}                         ║`);
  console.log(`╚═══════════════════════════════════════════════╝\n`);
});
