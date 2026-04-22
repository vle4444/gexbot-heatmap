# GexBot Heatmap

A live, Bookmap-style visualization of options gamma exposure (GEX) built on the
[GexBot](https://www.gexbot.com) State-tier API. Two complementary dashboards, a
dependency-free local server, and an optional recorder for backtesting.

![dashboard](screenshots/delta.png)

## What this is

When options dealers sell calls and puts, they hedge the resulting delta in the
underlying. As spot moves, their hedging flow is driven by the *gamma* of the
positions they hold. Visualizing that gamma across strikes and through time
reveals where hedging pressure is strongest — and those levels often act like
magnets or walls for the underlying.

GexBot exposes both the raw GEX profile and an orderflow-classified imbalance
("State" endpoints). This project renders that data as a rolling heatmap with:

- **Per-strike GEX and Greek overlays** — gamma, delta, vanna, charm
- **Multiple measures** — raw GEX or per-strike Δ change over a configurable window
- **Multiple Y-axes** — absolute price, offset from spot (points), or offset (%)
- **Multiple color-scale modes** — 14 variants, grouped by whether the past
  repaints when new data arrives (see [docs/COLOR_SCALES.md](docs/COLOR_SCALES.md))
- **DPR-aware rendering** — sharp on retina and fractional-DPR displays
- **Gaussian vertical blending** — smooth transitions between strikes, with sign-safe
  winner-take-all or traditional additive modes
- **Live level traces** — M+, M−, and Zero Gamma tracked historically per snapshot,
  not painted statically from the latest values
- **Session save/load** — capture the current buffer to JSON, replay later
- **Optional long-running recorder** — stream all State-tier endpoints to JSONL
  for every ticker you care about

## Dashboards

- **`index.html`** — classic absolute GEX heatmap
- **`delta.html`** — flow-oriented heatmap with all the advanced controls, Δ-change
  measure, offset-relative Y-axis modes, and the 14 color-scale modes

Open both in separate tabs — they poll independently.

## Quick start

### Requirements

- A GexBot API key (State subscription for the `delta.html` endpoints to work;
  Classic subscription covers `index.html`)
- Node.js (any recent version) — only used for the local server and recorder,
  both of which are dependency-free

### Setup

1. Clone this repo.
2. Put your API key in **both** HTML files. Find this line near the top of each
   `<script>` block:

   ```js
   const API_KEY = 'YOUR_GEXBOT_API_KEY_HERE';
   ```

   Replace with your actual key (format: `gexbot_custom_…`).

3. If you plan to use the recorder, update the same constant at the top of
   `recorder.js` as well.

4. Run the server:

   ```bash
   node server.js
   ```

5. Open in browser:

   - Classic: <http://localhost:3001/>
   - Delta: <http://localhost:3001/delta.html>

Stop with `Ctrl+C`.

### Why the local server exists

Two reasons. First, CORS — the browser can't hit `api.gexbot.com` directly
from a `file://` origin, so the Node server proxies API calls. Second, historical
data comes from a different host (`api.gex.bot`) and requires chained
requests (get pre-signed URL → fetch S3 object), which the server handles
transparently. No dependencies — just `http`, `https`, `fs`, `path`, `url`.

### Changing the port

Edit `PORT` at the top of `server.js`. Default is `3001`.

## Files

```
delta.html       Flow-oriented heatmap with advanced controls
index.html       Classic absolute GEX heatmap
server.js        Dependency-free HTTP server + API proxy
recorder.js      Long-running recorder → JSONL (optional, standalone)
docs/
  COLOR_SCALES.md     Detailed guide to the 14 scale modes
  CONTROLS.md         Full keyboard/mouse reference
  GEXBOT-API-DOC.txt  Upstream API reference (for convenience)
screenshots/     Readme images
```

## Controls (quick reference)

In either dashboard:

- **Scroll** — zoom Y
- **Shift + Scroll** — zoom X (column width)
- **Ctrl + Scroll** (or horizontal trackpad) — scroll history
- **Drag** — pan Y
- **Alt + Drag** (or drag in time-axis strip) — pan X
- **← / →** — step through history (5 at a time; Shift+arrow = 50)
- **End** — jump to live
- **Home** — jump to oldest buffered snapshot

The `? HELP` button in the `delta.html` toolbar opens an in-page reference for
every control.

## Color scale modes (short version)

`delta.html` ships with 14 normalization modes grouped by behavior:

- **Unified — past repaints**: one denominator across the whole view. When a new
  large value arrives, everything on screen restretches. Matches classic "rolling"
  intensity behavior.
- **Trailing — past frozen**: each column's denominator is computed from its own
  trailing window. Once a column is painted, its colors never change.
- **Per-column — past frozen**: Snapshot-only (each column self-normalizes to its
  own strike max) and Cumulative (running max since session start).
- **Experimental**: EMA-smoothed trailing, trailing p95, log-compressed, per-snapshot
  z-score.
- **Manual**: Fixed cap — you type the number.

Full explanations in [docs/COLOR_SCALES.md](docs/COLOR_SCALES.md).

## Recorder (optional)

`recorder.js` is a standalone process that continuously polls multiple State-tier
endpoints across a list of tickers and writes the raw responses to disk as
newline-delimited JSON. Layout:

```
data/YYYY-MM-DD/TICKER/endpoint.jsonl
```

Each line is a self-contained record with `recorded_ms`, `ticker`, `endpoint`,
and the full upstream `data` payload. Safe to run alongside `server.js`; it binds
no ports, only does outbound HTTPS + file appends.

Configure the ticker list and polling cadence at the top of `recorder.js`. See
comments in the file for reading recorded data back for backtesting.

```bash
node recorder.js
```

Graceful shutdown on `Ctrl+C` (streams flush before exit).

## Subscription requirements

- `index.html` (classic heatmap) — GexBot **Classic** subscription or higher
- `delta.html` — GexBot **State** subscription (uses `/state/...` endpoints and
  Greek overlays)
- Historical data (`+ PREPEND`, `LOAD DATE` buttons on classic heatmap) — GexBot
  **Quant** subscription

If your tier doesn't cover an endpoint, you'll see a 403 in the browser console
and an API error overlay. Recorder will log the 403 once and permanently skip
that endpoint for the session.

## Security notes

- The API key lives in client-side JavaScript in both HTML files. This is fine
  for personal/local use. **Do not host either dashboard on a public URL** — your
  key will be exfiltrated. If you want to host, move the key server-side and
  have the proxy inject the `Authorization` header.
- `.gitignore` excludes `data/` (recorded JSONL, potentially large) and any
  `*.session.json` (saved buffers from the dashboard's SAVE button).

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgments

GEX methodology, API, and data are proprietary to [GexBot](https://www.gexbot.com).
This project is an independent visualization client, not affiliated with or
endorsed by GexBot. Use in accordance with their terms of service.
