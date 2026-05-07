# GEX Heatmap

_Last updated: 2026-05-06 · corresponds to `v0.8.8`_

Live GEX (gamma exposure) heatmap dashboard for options-market visualization, built on the GexBot API. Vanilla browser JS + a dependency-free Node proxy. Personal/research project — not for redistribution.

## Stack
- Vanilla HTML / CSS / Canvas2D — no framework, no bundler, no transpiler.
- Dependency-free Node HTTP server (`server.js`).
- One dashboard: `delta.html` (flow-oriented, requires GexBot **State** subscription). The legacy `index.html` (classic) was removed in v0.6.5.
- Vanilla Node analyzer: `analyze-recording.js` (added v0.7.x) for offline forensic + sweep analysis of saved recordings.
- Target: modern Chromium with DPR-aware rendering.

## Commands
- Run: `node server.js` → http://localhost:3001/ (serves delta.html).
- Required: `.env` containing `GEXBOT_API_KEY=gexbot_custom_…` (copy from `.env.example`).
- Syntax check after non-trivial JS edits to `delta.html`:
  `node -e "new Function(require('fs').readFileSync('delta.html','utf8').match(/<script>([\\s\\S]*)<\\/script>/)[1]); console.log('OK')"`
- Analyze a saved recording offline:
  `node analyze-recording.js [--events events-DATE.json] [--out report.md] file1.json [file2.json …]`
  Produces a markdown report (forensic + sweep) plus three SVG visualizers (`-high.svg`, `-med.svg`, `-low.svg`).
- No build / no test / no lint pipeline — vanilla JS, no toolchain.

## Architecture

### Dashboard (`delta.html`) — major feature areas
- **Heatmap rendering** — Δ vs Raw measure, offset Y modes (abs / rel-pts / rel-%), sub-pixel `Col px` with max-abs aggregation, Strike-px ladder (Bookmap-style), 6 palettes (incl. Hi-contrast / Stepped), 8 gamma values (2.5 → 0.3), 14 color-scale modes, 3 blend modes (hard / sum / max-sign-safe).
- **MaxCh detectors** (rewritten in v0.7.2, expanded v0.8.7) — four families:
  - **Pulse** (default) — per-strike Welford EMA + z-score. Catches velocity/changes at a strike vs its own baseline. fast/normal/strict.
  - **Loud** (v0.8.7) — magnitude rank vs `sessionMaxAbs`. Catches absolute big prints regardless of per-strike history. loose/normal/strict (≥10/20/35%).
  - **Event detectors** — burst (chain-aggregate z), swarm (same-sign cluster), pump (burst ∧ swarm ∧ near-spot).
  - **Legacy CUSUM** (demoted v0.8.2) — bucket-win persistence; empirically lift ≈ 1.0 in production (always-on noise). Kept for niche use.
- **AUTO ★ live setup composer** (added v0.8.0, tuned through v0.8.8) — combines a per-strike Pulse-equivalent live state, a session-wide level tracker (per-strike `holdSnaps` + `flowScore`), regime classifier, spot velocity, and spot-vs-wall position to fire two setup types:
  - **rejection** (orange) — spot near sticky wall + Pulse fired near + long-γ regime.
  - **breakout** (blue) — spot crosses sticky wall in direction of sustained velocity + Pulse fired near + short-γ regime.
  - Output: persistent level lines (top-N sticky strikes with ★ tier badges), auto-annotations on each fire (with ↑/↓ direction arrow), toast notifications, optional WebAudio chirp, log panel (`LOG` button), live `★ rate` density badge in stats bar, ★ tier filter (★★★ default = ≥30m hold required), `★ MARKS` toggle (v0.8.8) to hide auto-annotations from the chart without losing detection.
- **Light/dark theme** (v0.6.5) — chrome adapts via CSS variables; canvas adapts via runtime `THEME` object; palettes refactored to `{v, sat}` form so dark ramps black→saturated and light ramps white→saturated. Persisted in localStorage.
- **Crosshair + tooltip** (v0.7.0) — hover anywhere on the chart, get column/row crosshair lines + floating tabular tooltip with timestamp / nearest strike / vol / spot / zero-γ / net-GEX.
- **Annotations layer** (v0.7.0) — IndexedDB-persisted, scoped to (ticker, expiry, overlay). Three manual types (price line / time marker / point + note) via `Mark` dropdown. Auto-annotations carry `auto: true` flag.
- **Replay scrubber** (v0.7.0) — `REPLAY` button opens a bottom strip with play/pause, 1×–60× speed, draggable knob, click-to-jump track. Pauses live polling on enter, restores on EXIT.
- **Regime classifier** (v0.7.0) — pill in stats bar showing `Long γ · fade` / `Short γ · chase` / `Flip ±X%` based on spot vs zero gamma.
- **Axis-grip zoom** (v0.6.4) — drag right price-axis gutter zooms Y, drag bottom time-axis strip zooms X.
- **rAF render coalescing** (v0.7.0) — `render()` is wrapped in `requestAnimationFrame`; one paint per frame regardless of how many event handlers fire.
- **Auto-save / RESTORE** (v0.6.1) — every snapshot fire-and-forget written to IndexedDB. RESTORE button surfaces today's count for the current key. Schema bumped to v2 in v0.7.0 to add the annotations store.
- **Setup-composer rebuild on RESTORE/LOAD** is silent — no retroactive toasts/annotations.

### Other files
- `server.js` — all-in-one HTTP server: static files (root → `/delta.html`) + `/api/*` proxy to api.gexbot.com (auth-injected) + `/histapi/*` proxy + `/fetch?url=` for presigned S3.
- `recorder.js` — optional long-running JSONL recorder.
- `analyze-recording.js` — offline analyzer for saved JSON recordings. Loads one or more files, replays through every signal family (Pulse, CUSUM, Burst/Swarm/Pump, Loud, spot-velocity, wall-migration, wall-proximity, AUTO ★ setup composer), computes lift / fire density / lead times against user-supplied events and auto-detected sweep candidates, outputs markdown report + per-sensitivity SVG visualizers.
- `events-YYYY-MM-DD.json` — user-supplied events file (label, tsLocal, tz, type) for forensic analysis.
- `analysis-YYYY-MM-DD.md` + `analysis-YYYY-MM-DD-{high,med,low}.svg` — generated analyzer outputs.

### Docs
- `docs/CONCEPTS.md` — options-exposure metrics theory (DEX, GEX, vanna, charm, regime guide).
- `docs/GEXBOT-API.md` — comprehensive API reference (endpoints, auth, sign-convention gotchas).
- `docs/HISTORY.md` — design rationale, resolved bugs, open items, commercial-track context. **Read on demand for any task that touches MaxCh, sign conventions, or past decisions.**
- `docs/CONTROLS.md` — keyboard / mouse reference + toolbar inventory.
- `docs/COLOR_SCALES.md` — per-mode explanation of the 14 color-scale modes.
- `CHANGELOG.md` — versioned change log; bump on user-visible changes. Currently at v0.8.8.

## Rules
- Numeric financial fields (strike, price, greek): use `??`, **never** `||`. Numeric zero is falsy and silently drops legitimate values.
- DPR canvas math: compute tick / overlay positions in CSS-space via `setTransform(dpr, 0, 0, dpr, 0, 0)`, not in raw device pixels. Fractional DPR (1.25x, 1.33x) drifts otherwise.
- The `gexbot_custom_` prefix is part of the **token value**, not a URL path segment. Always goes in `Authorization: Bearer …`. Costed hours of 400/404 debugging once.
- GexBot `/maxchange` value field appears to use an **inverted** sign vs direction of imbalance change — the renderer negates raw before downstream processing (`dir = -raw`). This is based on three live screenshots; later evidence (a pump producing red where green was expected) puts it in doubt. A debug logger is wired in (`?dbg=STRIKE` URL param). **Don't "fix" the negation without first running the debug logger on a clean event** — see `docs/HISTORY.md` § MaxCh and the open TODO in the auto-memory store.
- State-endpoint responses report `_oi`, `zero_gamma`, and `delta_risk_reversal` as literal `0` (not null/missing). Treat as N/A in State mode rather than legitimate zeros.
- Recorded files in gamma overlay (most user recordings) have `meta.zeroG` and `meta.netGex` as `'—'` — these are GEX-overlay-only fields. Setup composer's regime classifier treats `unknown` as permissive so detection still works on gamma-overlay sessions.
- The `LIVE_SIGNALS.rebuild()` call on RESTORE/LOAD is intentionally **silent** (doesn't fire toasts/annotations for past data). Setup-fire history is therefore empty after RESTORE; live polling forward populates it.
- IMPORTANT: GexBot endpoints and the State classification engine are proprietary. Do not reverse-engineer or redistribute upstream payloads.
- IMPORTANT: Project is dependency-free. **Do not add npm dependencies** without explicit approval. Same for build tools / transpilers / frameworks.

## Workflow
- Default to minimal-diff edits. Don't refactor unrelated code while fixing or adding something.
- Commit format: descriptive message + trailing `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (mirror existing commits).
- User-visible behavior changes or major file shape changes: bump version in `CHANGELOG.md` with a structured entry following the existing style.
- Push to `origin/main` directly (`git push origin HEAD:main`) — the working branch tracks main, established pattern.
- After non-trivial JS changes, run the syntax-check command above before committing.
- When unsure between two approaches, explain both and let the user choose.
- The user works from the parent repo (`C:\Users\vle\Downloads\gexbot-heatmap\gexbot-heatmap`) — when they run `git pull` and get "Already up to date", that's normal: my commits land directly in their working tree via the bash tool.

## Out of scope
- Don't commit `.env` files or any secret material. `.env.example` only.
- Don't commit recording files (`gexbot-*-*-*.json`) or `data/` — both gitignored.
- Don't add a frontend framework, bundler, or transpiler — vanilla browser JS is the design.
- Historical / Quant-tier endpoints (`api.gex.bot/v2/hist/...`): code paths exist but are inactive (no Quant subscription). Don't refactor those paths assuming they're broken — they're parked.
- Commercial product track (separate Databento + Polygon project) lives in `docs/HISTORY.md` for context — **not** in this repo.

## Cross-session memory

The user's auto-memory at `~/.claude/projects/C--Users-vle-Downloads-gexbot-heatmap-gexbot-heatmap/memory/MEMORY.md` indexes session-spanning notes. Currently:
- `maxch_design_decision.md` — original literature-backed reasoning for the MaxCh CUSUM filter (CUSUM vs BOCPD vs wavelets etc.). **Stale**: CUSUM was demoted in v0.8.2 after empirical analysis showed lift ≈ 1.0. The reasoning in this file remains a useful reference for future change-detection work but the recommendation it makes is no longer the dashboard default.
- `maxch_pulse_v0_7_2.md` — Pulse detector design + presets (v0.7.2). Still authoritative for Pulse.
- `todo_verify_maxch_sign.md` — open TODO. The `dir = -raw` sign convention should be verified empirically using the `?dbg=STRIKE` URL param logger before being trusted long-term.
- `todo_offscreen_worker.md` — parked. The OffscreenCanvas + Worker offload was scoped during v0.7.0 but deferred because the renderHeat pixel loop interleaves with vector overlays in one sync flow.

## Quick orientation for a new session
- The dashboard's headline feature is **AUTO ★** — a live setup composer that fires labeled rejection/breakout annotations at sticky walls. Tunable via the AUTO ★ toolbar group (sensitivity, ★ tier filter, chirp, marks-visibility toggle).
- **MaxCh** has four families now (Pulse, Loud, Event detectors, Legacy CUSUM). Pulse `normal` is the live default for the chart's MaxCh layer; it complements Loud (which catches absolute-magnitude rank events).
- **Sticky levels** drive AUTO ★ — a level is a strike that's been M+ or M− for a while. The level tracker increments per-snapshot and the top-N strikes by hold-time render as faint dashed horizontal lines with `★ tier · strike · holdMin` labels at the left edge.
- **Light/dark theme**: persistent in localStorage. Palettes ramp differently per theme so cells fade into the right background color.
- The `analyze-recording.js` tool is the way to do post-hoc analysis — it has both forensic (vs user events) and automated sweep (auto-detected spot moves) modes, with a lift metric that controls for base rate.
