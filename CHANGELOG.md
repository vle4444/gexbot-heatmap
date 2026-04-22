# Changelog

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
- **? HELP** button — full in-page control reference

### Defaults
- Measure: Raw GEX
- Y-axis: Absolute price
- Gamma: Linear
- Blend: Max (sign-safe)
- Color scale: Window: last 5 min (matches previous default's scope)

### Documentation
- `docs/COLOR_SCALES.md` — per-mode explanation with decision matrix
- `docs/CONTROLS.md` — full keyboard/mouse/toolbar reference
- `README.md` — quick start, file layout, subscription requirements

## [0.1.0] — initial working version
- Classic GEX heatmap (`index.html`)
- Early delta heatmap (`delta.html`) with offset Y-axis and rolling color scales
- Dependency-free Node server with CORS proxy and historical pre-signed-URL
  fetch handling
- Standalone recorder (`recorder.js`) for continuous JSONL capture
