# GexBot Heatmap

A live, Bookmap-style visualization of options gamma exposure (GEX) built on the
[GexBot](https://www.gexbot.com) State-tier API. A flow-oriented browser
dashboard, a dependency-free local server, and an optional recorder for
backtesting.

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

## Dashboard

**`delta.html`** — flow-oriented heatmap with all the advanced controls, Δ-change
measure, offset-relative Y-axis modes, the 14 color-scale modes, MaxCh event
detectors, light/dark theme, and IndexedDB auto-save.

## Quick start

### Requirements

- A GexBot API key with a **State** subscription
- Node.js (any recent version) — only used for the local server and recorder,
  both of which are dependency-free

### Setup

1. Clone this repo.
2. Copy `.env.example` to `.env` and put your API key in (`gexbot_custom_…`):

   ```
   GEXBOT_API_KEY=gexbot_custom_…
   ```

3. If you plan to use the recorder, update the same constant at the top of
   `recorder.js` as well.

4. Run the server:

   ```bash
   node server.js
   ```

5. Open <http://localhost:3001/> in a browser. Stop with `Ctrl+C`.

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
server.js        Dependency-free HTTP server + API proxy
recorder.js      Long-running recorder → JSONL (optional, standalone)
docs/
  COLOR_SCALES.md     Detailed guide to the 14 scale modes
  CONTROLS.md         Full keyboard/mouse reference
  GEXBOT-API-DOC.txt  Upstream API reference (for convenience)
screenshots/     Readme images
```

## Controls (quick reference)

- **Scroll** — zoom Y
- **Shift + Scroll** — zoom X (column width)
- **Ctrl + Scroll** (or horizontal trackpad) — scroll history
- **Drag in chart area** — pan Y
- **Alt + Drag in chart area** — pan X
- **Drag in right price-axis gutter** — zoom Y (pull up = zoom in)
- **Drag in bottom time-axis strip** — zoom X (pull right = zoom in)
- **← / →** — step through history (5 at a time; Shift+arrow = 50)
- **End** — jump to live
- **Home** — jump to oldest buffered snapshot

The `? HELP` button in the toolbar opens an in-page reference for every control.

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

- `delta.html` — GexBot **State** subscription (uses `/state/...` endpoints and
  Greek overlays)

If your tier doesn't cover an endpoint, you'll see a 403 in the browser console
and an API error overlay. Recorder will log the 403 once and permanently skip
that endpoint for the session.

## Security notes

- The API key is read from `.env` server-side and injected by `server.js` into
  every proxied request. It does **not** live in the HTML, so you can host the
  dashboard locally without leaking the key in client JS. Don't host on a
  public URL anyway — there's no per-user authentication.
- `.gitignore` excludes `data/` (recorded JSONL, potentially large) and any
  `*.session.json` (saved buffers from the dashboard's SAVE button).

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgments

GEX methodology, API, and data are proprietary to [GexBot](https://www.gexbot.com).
This project is an independent visualization client, not affiliated with or
endorsed by GexBot. Use in accordance with their terms of service.
