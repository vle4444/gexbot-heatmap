# Design History

Project-internal narrative: design rationale, resolved bugs, deferred items, and the commercial-product context. Loaded on demand by Claude — see `CLAUDE.md` for the always-loaded operational rules.

_Last reviewed: 2026-05-06 · corresponds to `v0.8.8`. See CHANGELOG for the narrative of v0.7.x (crosshair, annotations, replay, regime classifier, rAF coalescing, MaxCh Pulse rework) and v0.8.x (AUTO ★ live setup composer, level tracker, ★ tier filter, Loud detector, ★ MARKS toggle). The notes below are pre-v0.7 design decisions and ongoing context — they remain accurate but predate roughly half the current feature surface._

---

## Project context — two parallel tracks

1. **Personal / research dashboard** (this repo) — live GEX heatmap built on the GexBot API, rendered Bookmap-style. Two HTML dashboards served by a dependency-free Node server.
2. **Commercial product** (separate, planning phase) — from-scratch GEX heatmap product built on independently-licensed data (Databento OPRA.PILLAR + Polygon), target team of up to three people. Goal: replicate and expand GexBot-style functionality without depending on any GexBot endpoint or proprietary classification.

---

## API facts

- **Live host**: `api.gexbot.com`
  - GEX profile: `/{TICKER}/state/{zero|one|full}`
  - Greek overlays: `/{TICKER}/state/{greek}_{zero|one}` (no `full` for Greeks)
  - Max-change: `/{TICKER}/state/{period}/maxchange`
- **Historical host**: `api.gex.bot` — `/v2/hist/{TICKER}/state/{cat}/{YYYY-MM-DD}` returns a pre-signed S3 URL which `server.js` re-fetches via `/fetch?url=…`. **Requires Quant tier — not currently subscribed.**
- **Auth**: `Authorization: Bearer gexbot_custom_…`, injected server-side by `server.js` from `GEXBOT_API_KEY`. The key never reaches the browser.
- **Token gotcha**: the `gexbot_custom_` prefix is *not* a URL path segment. Costed hours of 400/404 debugging.
- Full reference: `docs/GEXBOT-API.md`.

## Subscription tier requirements

- `index.html` — Classic subscription or higher
- `delta.html` — State subscription (uses `/state/...`)
- Historical (`LOAD DATE`, `+ PREPEND` on classic) — **Quant** (not held)

---

## Dashboard state by version

### `delta.html` — full-featured (current)
- Raw GEX vs Δ Change measure with configurable lookback.
- Three Y-axis modes: absolute price / offset pts / offset %.
- 14 color-scale normalization modes (see `docs/COLOR_SCALES.md`).
- Blend modes: sharp (default since v0.4.0) / additive Gaussian / max (sign-safe).
- Strike-px ladder control with options `fit` and `2 / 3 / 4 / 6 / 8 / 12 / 16 / 20 / 24 / 32 / 48` (v0.2.3+). Capped at natural `rowHd` to prevent neighbor overflow.
- **Sub-pixel `Col px`** (v0.5.0+). `Col px` accepts `0.1 / 0.25 / 0.5 / 1` (sub-pixel), a `fit` mode that auto-sizes to the full current buffer, and a `1d` mode (v0.5.4+) that fixes the layout to one full US regular session (6.5h × 1s = 23,400 snaps). When width per snapshot is below one device pixel, the renderer aggregates source snapshots into output columns via max-abs per strike (preserves sign of the strongest print in the bin).
- **Session minimap** (v0.5.0–v0.6.1, **removed in v0.6.2**). Briefly added an 80px-tall always-visible session-overview strip above the main heatmap with a click/drag viewport rectangle. Removed because the focus is on the main heatmap; `Col px = fit` and `1d` cover the same use cases without taking screen real estate.
- TZ selector for x-axis labels (Local / UTC / NY / Chicago / London / Berlin / Tokyo / HK).
- SAVE / LOAD of session buffers as JSON.
- Per-snapshot M+, M−, ZG traces — **horizontal-only** as of v0.2.3. Each stretch of same-y snapshots is one line; transitions meet at the midpoint between columns with no vertical connector.
- **MaxCh overlay** (v0.3.0+, full rebuild v0.4.0, expanded v0.5.2 + v0.6.0). Strikes absorbing the most GEX-imbalance flow. Pulled from `/state/{period}/maxchange` in parallel with the main call so it works in every overlay mode. Two detector families:
  - **Persistence (CUSUM + hysteresis)** — `loose / normal / strict / tight / severe / extreme`. See § MaxCh design decision below.
  - **Event detectors** (v0.6.0+) — `burst / swarm / pump`. Velocity z-score, cluster, and combined+near-spot. Designed to fire on sudden coordinated activity and stay quiet in steady state. Complement the persistence layer (which by design filters fast events out as potential noise).
- **Auto-saved sessions + RESTORE** (v0.6.1+). Every snapshot writes to the browser's IndexedDB in the background, keyed by (ticker, expiry, greek, date). New `RESTORE` button next to `LOAD` enables itself with the on-disk count for today's session matching the current selection. Sessions older than today are auto-purged on startup. All MaxCh detection modes work on restored data because `meta.maxPriors` is part of the snapshot. Existing JSON `SAVE` / `LOAD` is untouched and remains the right tool for cross-machine portability.

### `index.html` — classic
- Absolute-price Y-axis only, simpler controls.
- Left-gutter horizontal-line guides for M+ / M− / ZG drawn from the latest snapshot's meta.
- Historical load buttons exist in the UI but require Quant tier.

---

## MaxCh design decision (research-backed)

**Problem**: the API returns 6 candidate `(strike, change)` events per second (one per lookback bucket). Showing them raw is overwhelmingly noisy because different strikes randomly "win" each bucket each cycle.

**Solution**: per-strike signed CUSUM with hysteresis, after a survey of the change-detection / microstructure-noise literature.

**Why CUSUM + hysteresis specifically:**
- CUSUM (Page 1954, *Biometrika*) is one float-op per observation, minimax-optimal for detecting a step change subject to a false-alarm bound (Lorden 1971, *Annals of Math Stat*). Lai (1995) bridges to finance.
- Hysteresis (Schmitt 1938) is the right *display-layer* debouncer on top of any persistence score — strike enters the rendered set when CUSUM crosses `h_high`, leaves only when it falls below `h_low < h_high`.
- Both are simple enough not to need a library. ~50 lines total in `delta.html`.

**Wrong tools (don't force-fit if iterating):**
- TSRV / Aït-Sahalia microstructure-noise filtering — assumes continuous Itô semimartingale + iid additive noise. Our signal is discrete tournament-winners; the framework's decomposition doesn't apply.
- Wavelets / Donoho-Johnstone — batch by nature, right-edge unstable. Useless for live triggering. Reasonable for retrospective panels.
- VPIN (Easley, López de Prado, O'Hara 2012) — measures market-wide order-flow toxicity, not per-strike events. Conceptual borrow only: bucket on volume, not time.

**Defer-when-needed upgrades:**
- BOCPD (Adams & MacKay 2007) for ranked confidence + non-stationarity.
- Multi-stream CPD (Xie & Siegmund 2013) for cross-strike coupling.
- Event-level FDR threshold calibration (Harvey, Liu, Zhu 2016).

**Sign-convention pitfall** (cost an investigation): the GexBot `/maxchange` value field appears to use an INVERTED sign relative to "direction of imbalance change at the strike," based on three live screenshots. The renderer negates raw before all downstream processing (`dir = -raw`). **A later observation (a clean pink → cyan pump producing red dots instead of green) cast doubt on this.** A debug logger is wired into `delta.html` (commit `54ba812`, activate via `?dbg=STRIKE` URL param) to capture API ground truth — the verification has not yet been run. The auto-memory file `todo_verify_maxch_sign.md` tracks this open item.

**Event detectors complement persistence (v0.6.0+):** the CUSUM presets are by design slow — they require multi-second sustained activity to fire. That filters fast events like pumps out as potential noise. Three event detectors were added alongside (not replacing) the CUSUM family:
- **`burst`** — sliding-60s velocity z-score on total firing magnitude. Fires at z ≥ 2.5, glyphs at strikes contributing ≥ 15 % of the spike.
- **`swarm`** — cluster detector. ≥ 2 same-sign firing strikes within ±5 price points, each ≥ 5 % of session max-abs.
- **`pump`** — strict combination: burst (z ≥ 2.0, lowered since combined) AND swarm AND cluster within ±0.5 % of latest spot.

Event detectors are simpler statistics than CUSUM (running z, cluster count) and aren't ARL-calibrated. They were chosen for responsiveness on sharp events. Parameters are reasonable defaults; future work could ARL-calibrate on recorded sessions.

The full reference list, ARL calibration targets, and trade-off notes for the persistence layer are mirrored in the user's auto-memory at `<USER_HOME>/.claude/projects/.../memory/maxch_design_decision.md` and should be re-read before any iteration on the noise-filtering layer.

---

## Recent resolved bugs (chronological)

- `||` coerced numeric zero as falsy → guide lines off by one tick. Fixed with `??`. (Promoted to a hard rule in `CLAUDE.md`.)
- Fractional column widths caused rendering artifacts. Fixed by integer-clamping `colW` with `Math.round`.
- Spot-price trace disappeared in Greek overlay mode due to `spot: 0` hardcode in the ingest branch. Fixed.
- X-axis zoom broke the heatmap on fractional DPR. Fixed by computing against the canvas's CSS footprint.
- Step-function level-trace rendering replaced `lineTo` diagonals that visually crossed through prices the level never actually held.
- **(v0.2.3)** M+/M− labels could sit on the wrong-color bar because the API's precomputed majors drifted from the strikes array. Fixed by deriving M+/M− locally from the strikes we render, in both `ingest()` and (for `index.html`) `normalizeSnap()`.
- **(v0.2.3)** Step-function level traces drew a vertical connector between runs whenever M+/M−/ZG jumped between strikes, falsely implying the level passed through intermediate prices. Replaced with a pure-horizontal renderer: runs of same-y snapshots draw as a single line; adjacent runs at different y meet at the midpoint between their transition columns with no vertical.
- **(v0.4.0)** MaxCh sign was inverted vs the user's intuition (red on rising walls, green on falling walls). Investigation across three live screenshots concluded the API's `/maxchange` value field uses an inverted sign convention. Renderer now negates raw before voting / coloring.
- **(v0.5.0)** SNAPSHOT-panel adjacent bars could share a row of pixels under unfavorable fractional offsets (`floor + ceil` rounding). Replaced with integer-slot geometry that guarantees a 1-pixel gutter between adjacent strike bars.

---

## Gotchas (background; rules form in CLAUDE.md)

- Strike-px cap (`Math.min(rowHd, px*dpr)`) means high values silently clamp at low zoom. Intentional; relax the cap only if overflow into neighbor strikes is acceptable.
- Color-scale "cumulative session-anchored" mode is what makes wall brightness meaningful across the day, but as session-max grows individual strike colors can fade even at constant absolute value. Worth keeping in mind when reading the heatmap.

---

## Commercial product track — status

Scoped through a four-phase rollout; technical and business plan complete.

**Architecture (planned)**:
Ingest (Rust/Go) → Redpanda/Kafka → ClickHouse or QuestDB (time-series) → Redis (hot state) → FastAPI/Axum API → frontend.

**Data sources**:
- Databento OPRA.PILLAR (options tape)
- Polygon (underlying prices)
- Free sources for risk-free rates

**Critical open risks**:
1. OPRA compliance — per-user subscriber agreements are non-trivial.
2. Classification validation — need a harness comparing outputs to GexBot.
3. Feed reliability during high-vol events (the moments the product matters most).

**Next concrete steps when commercial work resumes**:
- Draft the classifier (Lee-Ready with option-specific adjustments and OPRA condition-code filtering).
- Databento ingest service.
- Validation harness cross-checking against recorded GexBot outputs.

GexBot State endpoints are proprietary. Cannot be reverse-engineered or redistributed. Any commercial replication must use independently-licensed data and its own classification methodology.

---

## Open items (personal dashboard)

- GexBot Quant tier upgrade → unlocks historical endpoint → makes `LOAD DATE` / `+ PREPEND` actually usable.
- Decide whether Strike-px selection should be strictly authoritative (remove `rowHd` cap) or keep current overflow protection.
- Consider porting the computed-M+/M− approach to the classic heatmap's horizontal guides so its labels animate with the data too (currently single line from latest meta).
- Consider porting the horizontal-only trace renderer to the classic heatmap if per-snapshot traces are ever added there.
- Possible MaxCh upgrades when single-CUSUM proves insufficient: BOCPD for ranked confidence, multi-stream CPD for cross-strike coupling, FDR-calibrated thresholds. References in the auto-memory `maxch_design_decision.md`.

---

## How to run (full)

```bash
# one-time
cp .env.example .env             # then edit to set GEXBOT_API_KEY
node server.js                   # http://localhost:3001 → classic, /delta.html → delta
```

`server.js` injects the bearer token server-side; the key never reaches the browser. Static files, `/api/*`, `/histapi/*`, and `/fetch?url=` (for presigned S3) are all served by the same process.
