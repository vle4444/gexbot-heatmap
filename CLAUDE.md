# GEX Heatmap

_Last updated: 2026-04-29 · corresponds to `v0.6.x`_

Live GEX (gamma exposure) heatmap dashboard for options-market visualization, built on the GexBot API. Vanilla browser JS + a dependency-free Node proxy. Personal/research project — not for redistribution.

## Stack
- Vanilla HTML / CSS / Canvas2D — no framework, no bundler, no transpiler.
- Dependency-free Node HTTP server (`server.js`).
- One dashboard: `delta.html` (flow-oriented, requires GexBot **State** subscription). The legacy `index.html` (classic) was removed in v0.6.5.
- Target: modern Chromium with DPR-aware rendering.

## Commands
- Run: `node server.js` → http://localhost:3001/ (serves delta.html).
- Required: `.env` containing `GEXBOT_API_KEY=gexbot_custom_…` (copy from `.env.example`).
- Syntax check after non-trivial JS edits to `delta.html`:
  `node -e "new Function(require('fs').readFileSync('delta.html','utf8').match(/<script>([\\s\\S]*)<\\/script>/)[1]); console.log('OK')"`
- No build / no test / no lint pipeline — vanilla JS, no toolchain.

## Architecture
- `delta.html` — flow-oriented heatmap. Δ vs Raw measure, offset Y modes, Strike-px ladder, MaxCh persistence (CUSUM) + event detectors (burst / swarm / pump), sub-pixel `Col px` with max-abs aggregation, IndexedDB auto-save + RESTORE, light/dark theme.
- `server.js` — all-in-one HTTP server: static files (root → `/delta.html`) + `/api/*` proxy to api.gexbot.com (auth-injected) + `/histapi/*` proxy + `/fetch?url=` for presigned S3.
- `recorder.js` — optional long-running JSONL recorder.
- `docs/CONCEPTS.md` — options-exposure metrics theory (DEX, GEX, vanna, charm, regime guide).
- `docs/GEXBOT-API.md` — comprehensive API reference (endpoints, auth, sign-convention gotchas).
- `docs/HISTORY.md` — design rationale, resolved bugs, open items, commercial-track context. **Read on demand for any task that touches MaxCh, sign conventions, or past decisions.**
- `docs/CONTROLS.md` — keyboard / mouse reference.
- `docs/COLOR_SCALES.md` — per-mode explanation of the 14 color-scale modes.
- `CHANGELOG.md` — versioned change log; bump on user-visible changes.

## Rules
- Numeric financial fields (strike, price, greek): use `??`, **never** `||`. Numeric zero is falsy and silently drops legitimate values.
- DPR canvas math: compute tick / overlay positions in CSS-space via `setTransform(dpr, 0, 0, dpr, 0, 0)`, not in raw device pixels. Fractional DPR (1.25x, 1.33x) drifts otherwise.
- The `gexbot_custom_` prefix is part of the **token value**, not a URL path segment. Always goes in `Authorization: Bearer …`. Costed hours of 400/404 debugging once.
- GexBot `/maxchange` value field appears to use an **inverted** sign vs direction of imbalance change — the renderer negates raw before downstream processing (`dir = -raw`). This is based on three live screenshots; later evidence (a pump producing red where green was expected) puts it in doubt. A debug logger is wired in (`?dbg=STRIKE` URL param). **Don't "fix" the negation without first running the debug logger on a clean event** — see `docs/HISTORY.md` § MaxCh and the open TODO in the auto-memory store.
- State-endpoint responses report `_oi`, `zero_gamma`, and `delta_risk_reversal` as literal `0` (not null/missing). Treat as N/A in State mode rather than legitimate zeros.
- IMPORTANT: GexBot endpoints and the State classification engine are proprietary. Do not reverse-engineer or redistribute upstream payloads.
- IMPORTANT: Project is dependency-free. **Do not add npm dependencies** without explicit approval. Same for build tools / transpilers / frameworks.

## Workflow
- Default to minimal-diff edits. Don't refactor unrelated code while fixing or adding something.
- Commit format: descriptive message + trailing `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (mirror existing commits).
- User-visible behavior changes or major file shape changes: bump version in `CHANGELOG.md` with a structured entry following the existing style.
- Push to `origin/main` directly (`git push origin HEAD:main`) — the working branch tracks main, established pattern.
- After non-trivial JS changes, run the syntax-check command above before committing.
- When unsure between two approaches, explain both and let the user choose.

## Out of scope
- Don't commit `.env` files or any secret material. `.env.example` only.
- Don't add a frontend framework, bundler, or transpiler — vanilla browser JS is the design.
- Historical / Quant-tier endpoints (`api.gex.bot/v2/hist/...`): code paths exist but are inactive (no Quant subscription). Don't refactor those paths assuming they're broken — they're parked.
- Commercial product track (separate Databento + Polygon project) lives in `docs/HISTORY.md` for context — **not** in this repo.

## Cross-session memory
The user's auto-memory at `~/.claude/projects/.../memory/maxch_design_decision.md` contains the literature-backed reasoning for the MaxCh CUSUM filter (CUSUM vs BOCPD vs wavelets etc.). Re-read before any iteration on the noise-filtering layer.
