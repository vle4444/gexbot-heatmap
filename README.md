# GexBot Heatmap

A live, Bookmap-style visualization of options gamma exposure (GEX) built on the
[GexBot](https://www.gexbot.com) State-tier API. A flow-oriented browser
dashboard with a live setup composer (AUTO ★), a dependency-free local server,
an optional recorder, and an offline analyzer for retrospective signal study.

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
- **6 palettes** — including Hi-contrast (white-tipped) and Stepped (4 bands) — and
  **8 gamma curves** (2.5 → 0.3) for fine-grained contrast control
- **14 color-scale modes** — grouped by whether the past repaints
  (see [docs/COLOR_SCALES.md](docs/COLOR_SCALES.md))
- **DPR-aware rendering** — sharp on retina and fractional-DPR displays
- **Gaussian vertical blending** — smooth transitions between strikes, sign-safe
  winner-take-all or traditional additive modes
- **Live level traces** — M+, M−, and Zero Gamma tracked historically per snapshot
- **MaxCh detectors (4 families)** — Pulse (per-strike velocity), Loud (magnitude
  rank), Burst/Swarm/Pump (chain-aggregate events), Legacy CUSUM (persistence)
- **AUTO ★ live setup composer** — combines sticky-wall detection + Pulse + regime
  classifier + spot velocity to fire labeled rejection / breakout setups with
  ↑/↓ direction arrows. Auto-annotations persist in IndexedDB; toast + log panel
  surface fire history; configurable sensitivity + ★ tier filter
- **Crosshair + tooltip, persistent annotations, replay scrubber** — for
  reviewing live or restored sessions
- **Light / dark theme** — with theme-aware palette inversion
- **Session auto-save** to IndexedDB; manual SAVE / LOAD to JSON; **RESTORE**
  to recover today's buffer after a tab refresh
- **Optional long-running recorder** — stream State endpoints to JSONL for
  every ticker you care about
- **Offline analyzer** — replay any saved JSON through every signal family;
  produces a markdown report with lift / fire density / lead-time tables and
  three SVG visualizers (one per sensitivity)

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
delta.html              Flow-oriented heatmap with advanced controls + AUTO ★
server.js               Dependency-free HTTP server + API proxy
recorder.js             Long-running recorder → JSONL (optional, standalone)
analyze-recording.js    Offline forensic + sweep analyzer for saved sessions
docs/
  COLOR_SCALES.md     Detailed guide to the 14 scale modes
  CONTROLS.md         Full keyboard/mouse + toolbar reference
  CONCEPTS.md         GEX / vanna / charm / regime theory
  GEXBOT-API.md       API reference (endpoints, auth, sign convention)
  HISTORY.md          Design decisions, resolved bugs, open items
screenshots/          Readme images
```

## Controls (quick reference)

- **Scroll** — zoom Y
- **Shift + Scroll** — zoom X (column width)
- **Ctrl + Scroll** (or horizontal trackpad) — scroll history
- **Hover in chart** — crosshair + floating tooltip with timestamp / strike / vol / spot / ZG
- **Drag in chart area** — pan Y
- **Alt + Drag in chart area** — pan X
- **Drag in right price-axis gutter** — zoom Y (pull up = zoom in)
- **Drag in bottom time-axis strip** — zoom X (pull right = zoom in)
- **Click in chart area (Mark ≠ off)** — drop annotation
- **Right-click annotation** — delete (within ~8 px)
- **← / →** — step through history (5 at a time; Shift+arrow = 50)
- **End** — jump to live
- **Home** — jump to oldest buffered snapshot
- **Esc** — close help overlay

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

## AUTO ★ live setup composer

The dashboard's headline feature. Combines four signals to fire labeled
rejection / breakout setups in real time:

1. **Sticky walls** — strikes that have been M+ or M− for a while during
   the session. Top-N render as faint dashed horizontal lines with `★ tier
   · strike · holdMin` labels at the left edge (★ ≥ 5min, ★★ ≥ 15min,
   ★★★ ≥ 30min).
2. **Pulse** — per-strike z-score on `|maxchange|`, fires on a magnitude
   spike vs the strike's own EMA baseline.
3. **Regime** — long γ (spot above zero gamma, dealers fade) vs short γ
   (spot below, dealers chase) vs flip (within ±5 bp).
4. **Spot velocity** — direction and magnitude of recent spot movement.

When all conditions stack, AUTO ★ drops a labeled annotation on the chart
with a directional arrow (`reject 7335 ↓`, `break 7270 ↑`), pops a toast in
the top-right corner, and (optionally) plays a brief WebAudio chirp. Fire
history is stored in IndexedDB and surfaced via the **LOG** button — click
any row to scroll the chart to that snapshot.

Tunable via the AUTO ★ toolbar group:
- **AUTO ★** — master toggle (on/off)
- **sensitivity** (high / med / low) — wider/narrower near-wall band, longer/
  shorter Pulse window, looser/tighter velocity floor
- **★ tier filter** (★+ / ★★+ / **★★★** default) — minimum wall hold-time tier
  for level lines to render and setups to fire alerts
- **LOG** — open the setup-fire history panel
- **★ MARKS** — show/hide auto-annotations on the chart (history preserved)
- **🔊** — WebAudio chirp on each fire

Fires are typically 4-10 per hour at default sensitivity. Calibrated empirically
against real recorded sessions to balance precision and recall.

## Offline analyzer

`analyze-recording.js` replays one or more saved JSON files through every
signal family (Pulse, CUSUM, Burst, Swarm, Pump, Loud, spot-velocity,
wall-migration, wall-proximity, AUTO ★ setup composer). It produces a
markdown report with:

- **Forensic** — for each user-supplied event, lookback table showing which
  signals fired in the 5-min window and how many seconds in advance, with
  **lift** (fire density before the event vs base rate)
- **Sweep** — auto-detected `|Δspot|/spot ≥ 0.08%` candidates over a 5-min
  rolling window, same lookback analysis
- **Setup composer fires** — chronological list of every AUTO ★ fire under
  three sensitivities (high / med / low) with full metadata + ★ tier
  projection table

Plus three SVG visualizers (one per sensitivity) showing the spot trace
overlaid with sticky levels, user events, sweep candidates, and setup
fires (color-coded, hoverable for details).

Usage:

```bash
node analyze-recording.js \
  --events events-2026-05-05.json \
  --out analysis-2026-05-05.md \
  gexbot-SPX-zero-gamma-2026-05-05T18-40-33.json
```

`events-DATE.json` is a list of `{label, tsLocal, tz, type}` objects for the
forensic mode. If omitted, only the sweep + setup-composer sections run.

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
- `.gitignore` excludes `data/` (recorded JSONL, potentially large), any
  `*.session.json` (saved buffers from the dashboard's SAVE button), and
  `gexbot-*-*-*.json` recording files.

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgments

GEX methodology, API, and data are proprietary to [GexBot](https://www.gexbot.com).
This project is an independent visualization client, not affiliated with or
endorsed by GexBot. Use in accordance with their terms of service.
