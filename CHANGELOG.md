# Changelog

## [0.5.3] — Minimap & `fit` mode bug fixes

### Fixes
- **`Col px = fit` now actually fits the whole session.** The aggregation
  branch used `Math.round(1 / cellSize)` for `binSize`, which evaluated to
  `1` for `cellSize ∈ (0.67, 1)` — leaving the renderer "wanting" sub-pixel
  rendering but not actually aggregating. Snapshots beyond the canvas
  width were silently truncated. Switched to `Math.ceil` with a floor of 2
  so any sub-1 cellSize forces real aggregation, in both `renderHeat` and
  the `renderMetrics` mouse-handler helper.
- **Minimap viewport rectangle visible again.** The previous CSS used
  `box-shadow: 0 0 0 9999px rgba(0,0,0,0.45) inset` to dim the area
  outside the rectangle — but `inset` darkens the *inside* of the
  element, so the rectangle's interior went near-black instead of the
  exterior. Replaced with a clean border + faint translucent fill, no
  inset shadow.
- **Minimap y-domain focuses on active strikes.** Was using the full
  observed strike range across the session, which left huge dead margins
  for assets like SPX where activity concentrates in a narrow band. Now
  computes per-strike max-|vol| across the session, drops strikes below
  5% of session max-abs, uses min/max of the survivors with ±10% padding
  (floor at 2 points). Falls back to the full range if the filter would
  remove everything (early session, no significant magnitude yet).

## [0.5.2] — MaxCh: three quieter presets above `strict`

### Why
User reported that even `strict` (k=1.5, h<sub>high</sub>=10, h<sub>low</sub>=5)
was producing too many glyphs during heavy flow. Rather than swap the detector
(literature review in `memory/maxch_design_decision.md` already validated CUSUM
as the right choice for this problem class), extend the same CUSUM + hysteresis
machinery with progressively quieter tiers.

### Changes
- **`delta.html`** — `MaxCh` selector gains three new options stacked above
  `strict`. CUSUM theory: ARL₀ grows ~exponentially in <i>h</i> and ~quadratically
  in <i>k</i>, so we escalate <i>h</i> first, then raise <i>k</i> for the
  noise-floor effect.
  - `tight`:   k=1.5, h<sub>high</sub>=15, h<sub>low</sub>=8  — ~1.5× strict's threshold
  - `severe`:  k=2.0, h<sub>high</sub>=22, h<sub>low</sub>=11 — both knobs raised; lone-bucket prints now decay faster than they accumulate
  - `extreme`: k=2.5, h<sub>high</sub>=35, h<sub>low</sub>=18 — only multi-minute sustained 3+-bucket dominance lights up
- In-page help (`<dl>` under MaxCh overlay) documents each tier with its
  numeric parameters and a one-line use case.
- Existing `loose / normal / strict` defaults are unchanged.

### No detector change
Same CUSUM + hysteresis state machine; same per-snapshot decay-then-accumulate
loop; same sign-convention inversion. Only the preset table is extended.

## [0.5.1] — Docs reorganization: lean `CLAUDE.md` + `docs/HISTORY.md` split

### Why
The previous `CLAUDE.md` (~330 lines) had grown into a narrative handover doc
mixing always-needed operational rules with deep design history. Per the
broader Claude Code convention, files >150–200 instructions start losing
adherence. Split into two files so the always-loaded prompt stays lean while
the design narrative remains accessible on demand.

### Changes
- **`CLAUDE.md`** — rewritten to ~70 lines following the established Claude
  Code template: Stack, Commands, Architecture, Rules, Workflow, Out of
  scope, Cross-session memory. Pure operational content. The hard rules
  block consolidates the "use `??` not `||`," DPR canvas math,
  `gexbot_custom_` token gotcha, MaxCh sign-convention warning, and the
  no-dependencies / no-framework constraints.
- **`docs/HISTORY.md`** (new) — design rationale, MaxCh research backing,
  resolved-bug log, deferred items, and the commercial-product track
  context. Linked from `CLAUDE.md`; Claude reads on demand when a task
  touches MaxCh, sign conventions, or any past decision.
- `.gitignore` — adds `CLAUDE.local.md` and `.claude/CLAUDE.local.md` so
  personal Claude Code overrides don't get committed.

### No behavior change
This is a docs-only release. No JS, HTML, CSS, or `server.js` changes. The
existing rich content all moves to `docs/HISTORY.md` — nothing is lost.

## [0.5.0] — Full-session zoom: sub-pixel `Col px`, aggregation, and minimap

### Sub-pixel `Col px` with max-abs aggregation (delta.html)
- `Col px` dropdown now accepts sub-pixel widths: `0.1 / 0.25 / 0.5 / 1`
  in addition to the existing `2 / 4 / 6 / 8 / 12`. Values < 1 trigger
  per-strike **max-abs aggregation**: multiple source snapshots collapse
  into one output column, and at each strike the largest-magnitude print
  in the bin survives (preserving sign). Lets you compress a full session
  into one screen at the cost of within-bin temporal resolution.
- New **`fit`** option auto-sizes `Col px` so the entire session fills the
  visible heatmap width. Aggregation kicks in automatically.
- Wheel-zoom (Shift + scroll on heatmap) is now continuous-float: each
  step multiplies width by `0.80` / `1.25` instead of stepping through
  fixed integer values, so you can land exactly on the desired range.
- The aggregation also flows through every overlay: M+/M−/ZG traces,
  MaxCh CUSUM glyphs, the spot trace, and the x-axis labels all sample
  the bin's representative source snapshot (last in the bin) so they stay
  aligned with the aggregated heatmap underneath.

### Session minimap with viewport rectangle (delta.html)
- New 80px-tall **minimap strip** above the main heatmap. Always renders
  the full session aggregated to the canvas width, regardless of the main
  heatmap's current zoom. The aggregation engine is shared with sub-pixel
  `Col px` — same max-abs-per-strike reduction, just at session scale.
- A blue **viewport rectangle** marks what the main heatmap currently
  shows. Updates every render.
- **Click anywhere** on the minimap to re-center the main heatmap at that
  point in the session. **Drag** to scrub continuously.
- Coloring uses raw GEX-imbalance values (not Δ Change), so the minimap
  stays a useful "where are the walls across the day" reference even when
  the main view is in Δ Change mode.

### Buffer
- `MAX_SNAPS` raised from `20000` to `28000` so a full 6.5h US session at
  1s refresh fits with headroom.

### Help overlay
- Updated `Col px` section with the sub-pixel + `fit` semantics.
- New "Minimap" section explaining click/drag navigation and the
  aggregation reduction.

### Notes
- Mouse hover, drag-to-scroll, and time-axis tick computations now share
  a single `renderMetrics()` helper that derives `binSize`, `colWd`,
  `effColW`, and the visible source range from `effectiveColW()` and
  `dpr`. Previously the geometry was duplicated inline at three sites
  with subtle drift potential.

## [0.4.0] — MaxCh: CUSUM + hysteresis filter (research-backed), sign-convention fix

### MaxCh overlay rebuild (delta.html)
- **Persistence filter** added on top of the per-snapshot rendering. The
  raw `/maxchange` feed is structurally noisy — six buckets each name a
  winning strike per second, and adjacent strikes randomly trade places.
  Showing every print produces a flicker storm. Filter design after a
  literature survey on real-time signal extraction:
  - **Per-strike signed CUSUM** (Page 1954, Lorden 1971's minimax-optimal
    setup): two accumulators per strike (positive, negative). Each snapshot,
    decay both by `k` (the noise-floor reference value); add the bucket-fire
    count to the matching-sign accumulator when the strike fires. Sustained
    multi-bucket prints accumulate; sporadic single-bucket winners decay
    faster than they accumulate.
  - **Hysteresis state machine** (Schmitt 1938): strike enters the
    `ON_POS` / `ON_NEG` displayed set when its CUSUM crosses `h_high`, and
    only leaves once it falls below `h_low < h_high`. Eliminates the
    threshold-boundary oscillation that pure single-threshold filters suffer.
  - Glyph color = consensus sign (green = call-side accumulation, red =
    put-side accumulation); size and opacity scale with magnitude of the
    most recent print, normalized over the visible window.
- **UI replaced**: dropdown is now `off / loose / normal / strict`. Single-
  bucket modes (`cur / 1m / 5m / 10m / 15m / 30m`) and the previous `agg`
  mode are removed — the CUSUM eats all the bucket information automatically.
- Default thresholds (no-simulation calibration; can be re-tuned via ARL):
  - `loose` — k=1.5, h_high=4, h_low=2 (faster trigger, more events)
  - `normal` — k=1.5, h_high=6, h_low=3 (default)
  - `strict` — k=1.5, h_high=10, h_low=5 (only the strongest events)

### Sign-convention fix (delta.html)
- The GexBot `/maxchange` and `/state.max_priors` value field is **inverted
  in sign relative to "direction of imbalance change at the strike"**.
  Empirically verified across three live screenshots: walls steadily
  growing more negative produce positive raw values; walls lightening from
  negative produce negative raw values. Renderer now negates raw before
  any voting / coloring / sizing. Green = imbalance rose (call-side flow),
  red = imbalance fell (put-side flow).

### Research provenance (delta.html, CLAUDE.md, memory store)
- Filter design choices are documented in `CLAUDE.md` under "MaxCh design
  decision" and mirrored in the project memory store at
  `<USER_HOME>/.claude/projects/.../memory/maxch_design_decision.md`.
- References cited: Page 1954 (CUSUM), Lorden 1971 (minimax optimality),
  Adams &amp; MacKay 2007 (BOCPD — deferred upgrade path), Cont/Kukanov/
  Stoikov 2014 (OFI as the right impact prior), Bouchaud et al. 2018
  (square-root metaorder-impact decay, motivates persistence-with-decay
  shape), Savickas &amp; Wilson 2003 (irreducible options-classifier noise
  floor — bounds what filtering can achieve), Easley/López de Prado/O'Hara
  2012 (VPIN — conceptual borrow only).
- Wavelets, TSRV, and VPIN explicitly ruled out as wrong-tool-for-the-job
  in `CLAUDE.md` so future iterations don't re-litigate.

### Help overlay docs
- "MaxCh overlay" section rewritten to describe the new CUSUM + hysteresis
  semantics, glyph encoding, and reading guidance, with literature
  references for any contributor curious about the design rationale.

## [0.3.0] — MaxCh overlay, comprehensive docs, default config refresh

### MaxCh overlay (new — delta.html)
- New **MaxCh** dropdown in the toolbar overlays strikes absorbing the most
  GEX-imbalance flow at each snapshot. Sourced from `/state/{period}/maxchange`,
  fetched in parallel with the main `/state` call so the overlay works in
  every overlay mode (Greek endpoints included — they don't return
  `max_priors` of their own).
- **`agg` mode (recommended).** For each snapshot, all six lookback buckets
  (current / 1m / 5m / 10m / 15m / 30m) are grouped by strike. A strike that
  fires in N buckets gets a glyph whose radius scales with N — multi-bucket
  agreement signals *persistent* flow across timescales, single-bucket hits
  signal transient noise. Strikes below 10% of the visible-window max
  magnitude are filtered out so the layer doesn't drown in low-conviction
  prints. Opacity scales with magnitude (sqrt for visibility floor).
- **Single-bucket modes** (`cur` / `1m` / `5m` / `10m` / `15m` / `30m`)
  preserved for analytical use — show only that bucket's winning strike per
  snapshot, sized by magnitude.
- Glyph color = sign of the change (green = call-side accumulation, red =
  put-side). Dark halo under each glyph for contrast against same-hue
  heatmap bars. Right-edge label identifies the active mode.
- `maxPriors` captured into the per-snapshot `meta` so SAVE/LOAD round-trips
  preserve the overlay.

### Defaults (delta.html)
Updated to the working day-to-day config after live testing:
- Color scale: `Window: last 5 min` → **`Cumulative (session anchored)`**
- Palette: `GEX ± (green/red)` → **`Electric (cyan/magenta)`**
- Blend: `Max (sign-safe)` → **`None (sharp)`**
- Strike px: `4` → **`fit`**

### Snapshot panel (delta.html)
- **Bar overlap fix.** The right-side SNAPSHOT bars used
  `floor(yMid − rowH/2)` paired with `ceil(rowH)` for geometry, which under
  unfavorable fractional offsets caused two adjacent bars to share a single
  pixel of overlap (bars visually merged at strike boundaries). Replaced
  with integer slot boundaries — `slotTop = round(yMid − rowH/2)`,
  `slotBot = round(yMid + rowH/2)`, `h = slotBot − slotTop − 1` — so adjacent
  bars never overlap and always have a guaranteed 1-px visual gutter.

### Level traces (delta.html)
- Final widths tuned against live data: M+/M−/ZG halo `3.5 → 4.5` px,
  colored stroke `2.0 → 2.5` px, halo opacity `0.75 → 0.85`. Visible against
  same-hue heatmap bars without dominating the chart.

### Documentation
- **`docs/GEXBOT-API.md`** — comprehensive API reference. Covers all live
  endpoints (Tickers, Classic GEX chain / majors / max-change, State GEX
  profile / majors / max-change, State Greeks) plus the historical Quant-tier
  endpoint, auth, hosts, subscription tiers, aggregation-period semantics
  (`zero` / `one` / `full`), polling guidance, common gotchas (e.g.
  `gexbot_custom_` is part of the token, not a path segment; State-mode `_oi`
  fields are always 0; presigned S3 URLs must be fetched without your bearer
  token), the local server proxy pattern, and a minimal Node client recipe.
  Pairs the upstream spec with project-internal knowledge from `server.js`
  and `CLAUDE.md`.
- **`docs/CONCEPTS.md`** — options-exposure metrics theory reference.
  Foundations (OI vs. volume vs. orderflow classification), the four Greek
  exposures (DEX, GEX, vanna, charm) with formulas and units, profile views
  (Classic, GEX profile, DEX ladder, convexity ladder), orderflow
  time-series views, aggregate metrics (net GEX, net convexity, net
  vanna/charm), and a regimes / pinning reading guide. Flags the project's
  `−vanna ex` convention deviation explicitly and includes a glossary +
  references section.

## [0.2.3] — M+/M− consistency, more Strike-px values, no vertical connectors, punchier traces

### Level labels
- **M+ and M− now derived locally** from the same `strikes[]` array the
  heatmap renders, via a new `computeMajors()` helper. Previously the labels
  read `data.major_pos_vol` / `data.major_neg_vol` (and `major_positive` /
  `major_negative` for Greek overlays) directly from the upstream payload,
  which could drift from the per-strike values in edge cases and put the M+
  label on a red bar (and M− on a green one). Computing locally guarantees
  the label sits on the brightest green / brightest red strike by construction.
- Applied in both `delta.html` (live ingest) and `index.html` (live ingest
  *and* historical `normalizeSnap` path, so LOAD DATE behaves identically).

### Level traces (delta.html)
- **Horizontal-only rendering** for M+, M−, ZG. The previous step function
  drew a horizontal segment at the old y and then a vertical connector up or
  down to the new y whenever the level jumped between strikes. The vertical
  was visually misleading — it suggested the level passed through every
  intermediate price, which it never did. Now each stretch of consecutive
  snapshots at the same y is drawn as a single horizontal line; adjacent
  runs at different y meet at the midpoint between their transition columns,
  leaving a clean horizontal-to-horizontal handoff with no vertical connector.
- **Punchier line rendering.** Width 1.25 → 2.0 px, opacity 0.85 → 1.0, plus
  a 3.5px black halo pass under each colored line so M+ stays visible when
  it sits on a bright green bar (same for M− on red, ZG on anything bright).
  Without the halo, a same-hue line was effectively invisible.

### Controls (delta.html)
- **Strike px dropdown** expanded above 12: added `16`, `20`, `24`, `32`,
  `48`. Effective row height is still capped at the natural inter-strike
  slot (`rowHd`) so bars can't overflow into neighbors; at low Y-zoom the
  higher values silently clamp to `rowHd`. To make a selection strictly
  authoritative, drop the `Math.min(rowHd, …)` in the `effRowPxD` expression.

## [0.2.2] — vertical resolution: Strike-px + reduced default kernel

### Rendering
- **Strike px control** in the toolbar (delta.html). Caps each strike's
  vertical band height in CSS pixels: `fit` (full inter-strike slot, the
  legacy look) or fixed values `2`–`12`. Fixed values produce a Bookmap-style
  ladder where every strike reads as its own discrete level with black gaps
  between, regardless of zoom level.
- **Reduced default Gaussian kernel reach.** Sigma multiplier dropped from
  `0.40 × rowHd` to `0.22 × rowHd`. Same-sign neighboring strikes no longer
  merge into continuous blobs in `Additive` and `Max` blend modes.
- **Kernel sigma now scales off the capped row height**, not the natural
  inter-strike slot. A thin Strike px (e.g. `4`) gets a tiny kernel
  automatically — Strike px and blend kernel stay coupled, so picking a
  ladder thickness gives you matching blend behavior for free.
- New default: Strike px = `4`. Existing users who prefer the old continuous
  heat-field look can switch to `fit`.

## [0.2.1] — delta.html level-trace + time-axis fixes

### Level traces
- **Step-function rendering** for M+, M−, and ZG. `lineTo` between consecutive
  snapshots was drawing diagonals through y-values the level never actually
  held (e.g., a jump from the 7155 strike to the 7135 strike visually passed
  through 7145). The renderer now holds the previous y horizontally until the
  new column, then jumps vertically — reflecting the discrete strike-level
  nature of these lines.
- **Segments now break across gaps.** Missing/invalid values and points outside
  the visible y-range no longer get connected by long stretched lines; the
  path ends and restarts at the next valid point.

### Time axis
- **24-hour format** (HH:MM) on the x-axis, replacing the locale-default
  12-hour `h:mm AM/PM`. Tighter labels — tick spacing reduced from 56→40px so
  you get more ticks before they start to overlap.
- **Time-zone selector** in the toolbar: Local / UTC / NY / Chicago / London /
  Berlin / Tokyo / HK. Applies to the x-axis, cursor hover tooltip, and
  last-update stamp. Driven by a single `tsFormatter(kind)` helper.

## [0.2.0] — delta.html overhaul

### Rendering
- **DPR-aware canvas**: backing store now scales with `devicePixelRatio`, so
  rendering is crisp on retina and fractional-DPR displays
- **Gaussian vertical blending** between strikes with three modes:
  - **None (sharp)** — flat cells, original behavior at new resolution
  - **Additive** — Gaussian accumulation, soft/glowy
  - **Max (sign-safe)** — winner-take-all per pixel, preserves each strike's
    sign at its center (default)
- **Fractional-DPR column-drift fix**: spot trace and time-axis ticks now
  compute against the heatmap's effective CSS footprint, eliminating
  accumulated horizontal drift on displays where `colW × dpr` is non-integer

### Color
- **Linear gamma** is now the default; color brightness is proportional to
  magnitude
- **Gamma dropdown**: Linear / 0.7 / 0.55 (old)
- Zero-offset artifacts removed from all palettes; each palette now goes
  cleanly to black at `t = 0`
- **14 color-scale modes**, grouped:
  - Unified (past repaints): Window 1/5/15 min, Window visible range
  - Trailing (past frozen): Trailing max 1/5/15 min
  - Per-column (past frozen): Snapshot only, Cumulative
  - Experimental: EMA α=0.1, Trailing p95 (5 min), Log-compressed, Z-score ±3σ
  - Manual: Fixed cap

### Level traces
- M+, M−, and ZG now draw as per-snapshot traces (one point per column) so
  historical positions are preserved as the session progresses, instead of
  being repainted statically from the latest snapshot
- Correct behavior in all Y-axis modes (absolute, offset-pts, offset-pct) —
  each historical point uses *its own* snapshot's spot as the offset reference

### Session management
- **SAVE** button — export current buffer as JSON
- **LOAD** button — restore a saved session (pauses live polling, switches
  ticker/expiry/overlay to match the file)
