# GEX Heatmap Project — Handover

_Last updated: 2026-04-27 · corresponds to `v0.3.x`_

## What this project is

Two parallel tracks around options-market visualization:

1. **Personal/research dashboard** (this repo) — live GEX heatmap built on the
   GexBot API, rendered Bookmap-style. Two HTML dashboards served by a
   dependency-free Node server.
2. **Commercial product** (separate, planning phase) — from-scratch GEX
   heatmap product built on independently-licensed data (Databento OPRA.PILLAR
   + Polygon), target team of up to three people. Goal: replicate and expand
   GexBot-style functionality without depending on any GexBot endpoint or
   proprietary classification.

## Repo layout

```
delta.html       Flow-oriented heatmap, offset-Y mode, Strike-px ladder, Δ / Raw toggle
index.html       Classic absolute GEX heatmap (simpler, left-gutter labels)
server.js        Dependency-free HTTP server, CORS proxy, historical S3 chaining
recorder.js      Long-running JSONL recorder (optional)
docs/
  CONTROLS.md          Full keyboard/mouse reference
  COLOR_SCALES.md      Per-mode explanation of the 14 scale modes
  GEXBOT-API-DOC.txt   Upstream API reference (convenience copy)
CHANGELOG.md
```

## API facts

- **Live host**: `api.gexbot.com`
  - GEX profile: `/{TICKER}/state/{zero|one|full}`
  - Greek overlays: `/{TICKER}/state/{greek}_{zero|one}` (no `full` for Greeks)
- **Historical host**: `api.gex.bot` — `/v2/hist/{TICKER}/state/{cat}/{YYYY-MM-DD}`
  returns a pre-signed S3 URL which `server.js` re-fetches via `/fetch?url=…`.
  **Requires Quant tier — not currently subscribed.**
- **Auth**: `Authorization: Bearer gexbot_custom_...`, injected server-side
  in `server.js` from `GEXBOT_API_KEY` env var (or `.env` file). The key
  never reaches the browser.
- **Gotcha**: the `gexbot_custom_` prefix is *not* a URL path segment. Costed
  hours of 400/404 debugging.

## Subscription tier requirements

- `index.html` — Classic subscription or higher
- `delta.html` — State subscription (uses `/state/...`)
- Historical (`LOAD DATE`, `+ PREPEND` on classic) — **Quant** (not held)

## Current dashboard state (v0.3.x)

Both dashboards are working, DPR-aware, with correct level-trace rendering.

**delta.html** — full-featured:
- Raw GEX vs Δ Change measure with configurable lookback
- Three Y-axis modes: absolute price / offset pts / offset %
- 14 color-scale normalization modes (see `docs/COLOR_SCALES.md`)
- Blend modes: sharp / additive Gaussian / max (sign-safe, default)
- Strike-px ladder control with options `fit` and `2/3/4/6/8/12/16/20/24/32/48`
  as of v0.2.3. Still capped at natural `rowHd` to prevent neighbor overflow.
- **Sub-pixel `Col px` + session minimap** (v0.5.0+). `Col px` accepts
  `0.1 / 0.25 / 0.5 / 1` (sub-pixel) and a `fit` mode that auto-sizes to
  the full session. When width per snapshot is below one device pixel, the
  renderer aggregates source snapshots into output columns via max-abs per
  strike. Above the main heatmap, a fixed-height **minimap** always renders
  the entire session at session-wide aggregation; the blue viewport
  rectangle marks the current main view. Click to re-center, drag to scrub.
- TZ selector for x-axis labels (Local / UTC / NY / Chicago / London / Berlin
  / Tokyo / HK)
- SAVE/LOAD of session buffers as JSON
- Per-snapshot M+, M−, ZG traces — **horizontal-only** as of v0.2.3. Each
  stretch of same-y snapshots is one line; transitions meet at the midpoint
  between columns with no vertical connector.
- **MaxCh overlay** (v0.3.0+) — strikes absorbing the most GEX-imbalance
  flow. Pulled from `/state/{period}/maxchange` in parallel with the main
  call so it works in every overlay mode. **Filter is CUSUM + hysteresis**
  per strike, with `loose / normal / strict` presets. See "MaxCh design
  decision" below for the literature backing.

## MaxCh design decision (research-backed)

**Problem**: the API returns 6 candidate `(strike, change)` events per second
(one per lookback bucket). Showing them raw is overwhelmingly noisy because
different strikes randomly "win" each bucket each cycle.

**Solution**: per-strike signed CUSUM with hysteresis, after a survey of
the change-detection / microstructure-noise literature.

**Why CUSUM + hysteresis specifically:**
- CUSUM (Page 1954, *Biometrika*) is one float-op per observation, minimax-
  optimal for detecting a step change subject to a false-alarm bound
  (Lorden 1971, *Annals of Math Stat*). Lai (1995) bridges to finance.
- Hysteresis (Schmitt 1938) is the right *display-layer* debouncer on top
  of any persistence score — strike enters the rendered set when CUSUM
  crosses `h_high`, leaves only when it falls below `h_low < h_high`.
- Both are simple enough not to need a library. ~50 lines total.

**Wrong tools (don't force-fit if iterating):**
- TSRV / Aït-Sahalia microstructure-noise filtering — assumes continuous
  Itô semimartingale + iid additive noise. Our signal is discrete
  tournament-winners; the framework's decomposition doesn't apply.
- Wavelets / Donoho-Johnstone — batch by nature, right-edge unstable.
  Useless for live triggering. Reasonable for retrospective panels.
- VPIN (Easley, López de Prado, O'Hara 2012) — measures market-wide order-
  flow toxicity, not per-strike events. Conceptual borrow only: bucket on
  volume, not time.

**Defer-when-needed upgrades:**
- BOCPD (Adams & MacKay 2007) for ranked confidence + non-stationarity
- Multi-stream CPD (Xie & Siegmund 2013) for cross-strike coupling
- Event-level FDR threshold calibration (Harvey, Liu, Zhu 2016)

**Sign-convention pitfall** (cost an investigation): the GexBot
`/maxchange` value field uses an INVERTED sign relative to "direction of
imbalance change at the strike." Empirically verified on three live
screenshots. The renderer negates the raw value before all downstream
processing. See the comment in `delta.html` (search "API returns raw with
inverted sign").

The full reference list, ARL calibration targets, and trade-off notes are
mirrored in the project's memory store at
`<USER_HOME>/.claude/projects/.../memory/maxch_design_decision.md`.

**index.html** — classic:
- Absolute-price Y-axis only, simpler controls
- Left-gutter horizontal-line guides for M+/M−/ZG drawn from the latest
  snapshot's meta
- Historical load buttons exist in the UI but require Quant tier

## Recent resolved bugs (chronological)

- `||` coerced numeric zero as falsy → guide lines off by one tick. Fixed
  with `??`.
- Fractional column widths caused rendering artifacts. Fixed by integer-clamping
  `colW` with `Math.round`.
- Spot-price trace disappeared in Greek overlay mode due to `spot: 0` hardcode
  in the ingest branch. Fixed.
- X-axis zoom broke the heatmap on fractional DPR. Fixed by computing against
  the canvas's CSS footprint.
- Step-function level-trace rendering replaced `lineTo` diagonals that visually
  crossed through prices the level never actually held.
- **(v0.2.3)** M+/M− labels could sit on the wrong-color bar because the
  API's precomputed majors drifted from the strikes array. Fixed by deriving
  M+/M− locally from the strikes we render, in both `ingest()` and (for
  `index.html`) `normalizeSnap()`.
- **(v0.2.3)** Step-function level traces drew a vertical connector between
  runs whenever M+/M−/ZG jumped between strikes, falsely implying the level
  passed through intermediate prices. Replaced with a pure-horizontal
  renderer: runs of same-y snapshots draw as a single line; adjacent runs at
  different y meet at the midpoint between their transition columns with no
  vertical.

## Gotchas to carry forward

- Any numeric financial field (strike, price, greek) — use `??`, never `||`.
- Canvas math involving DPR — compute tick positions in CSS-space via
  `setTransform(dpr, 0, 0, dpr, 0, 0)`, not in device pixels.
- Strike-px cap (`Math.min(rowHd, px*dpr)`) means high values silently clamp
  at low zoom. Intentional; relax the cap only if overflow is acceptable.
- GexBot State endpoints are proprietary. Cannot be reverse-engineered or
  redistributed. Any commercial replication must use independently-licensed
  data and its own classification methodology.

## Commercial product track — status

Scoped through a four-phase rollout; technical and business plan complete.

**Architecture (planned)**:
Ingest (Rust/Go) → Redpanda/Kafka → ClickHouse or QuestDB (time-series)
→ Redis (hot state) → FastAPI/Axum API → frontend.

**Data sources**:
- Databento OPRA.PILLAR (options tape)
- Polygon (underlying prices)
- Free sources for risk-free rates

**Critical open risks**:
1. OPRA compliance — per-user subscriber agreements are non-trivial
2. Classification validation — need a harness comparing outputs to GexBot
3. Feed reliability during high-vol events (the moments the product matters most)

**Next concrete steps when commercial work resumes**:
- Draft the classifier (Lee-Ready with option-specific adjustments and OPRA
  condition-code filtering)
- Databento ingest service
- Validation harness cross-checking against recorded GexBot outputs

## Open items (personal dashboard)

- GexBot Quant tier upgrade → unlocks historical endpoint → makes
  `LOAD DATE` / `+ PREPEND` actually usable
- Decide whether Strike-px selection should be strictly authoritative
  (remove `rowHd` cap) or keep current overflow protection
- Consider porting the computed-M+/M− approach to the classic heatmap's
  horizontal guides so its labels animate with the data too (currently
  single line from latest meta)
- Consider porting the horizontal-only trace renderer to the classic
  heatmap too if per-snapshot traces are ever added there

## How to run

```bash
# one-time
cp .env.example .env        # then edit to set GEXBOT_API_KEY
node server.js              # http://localhost:3001 → classic, /delta.html → delta
```

## Reference conversation

Most recent session (2026-04-24) applied the v0.2.3 patches to
`delta.html` and `index.html`: computed-majors helper, expanded Strike-px
dropdown, and the horizontal-only level-trace renderer. Files currently on
disk reflect that state.
