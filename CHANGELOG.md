# Changelog

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
