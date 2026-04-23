# Controls Reference

## Mouse

| Input | Action |
|-------|--------|
| Scroll | Zoom Y-axis (price / offset) |
| Shift + Scroll | Zoom X-axis (column width) |
| Ctrl + Scroll | Scroll through history |
| Horizontal trackpad gesture | Scroll through history |
| Drag | Pan Y-axis |
| Alt + Drag | Pan X-axis (time) |
| Drag in bottom time-axis strip | Pan X-axis (time) |
| Drag right edge of profile panel | Resize profile panel |

## Keyboard

| Key | Action |
|-----|--------|
| ← / → | Scroll history by 5 snapshots |
| Shift + ← / → | Scroll history by 50 snapshots |
| End | Jump to live edge |
| Home | Jump to oldest buffered snapshot |
| Esc | Close help overlay (delta.html only) |

## Toolbar — common to both dashboards

- **Ticker** — which instrument to poll. List is pre-set; edit in the HTML
  file to add more symbols supported by your subscription tier.
- **Expiry** — 0DTE (`zero`), 1DTE (`one`), or `full` (all expirations).
- **Overlay** — `GEX` returns the raw/classified GEX profile. `Gamma`,
  `Delta`, `Charm`, `Vanna` return the corresponding per-strike Greek
  imbalance (requires State subscription).
- **Refresh** — polling interval. 1s is the default.
- **Palette** — color scheme. GEX (green/red) is the convention; the
  others are aesthetic alternatives.
- **Col px** — column width in pixels. Shift+Scroll does the same live.
- **TZ** *(delta.html only)* — time zone for the x-axis, cursor hover tooltip,
  and last-update stamp. Always 24-hour (HH:MM). `Local` uses the browser's
  default; named zones (NY, Chicago, London, Berlin, Tokyo, HK, UTC) pin the
  display regardless of the machine's clock.
- **LIVE** — toggle live polling on/off.
- **RESET ZOOM** — unlock Y-axis auto-range and jump to live.
- **CLEAR** — empty the snapshot buffer.

## delta.html — additional controls

- **Measure**
  - *Raw GEX* — current value at each strike
  - *Δ Change* — difference vs. N snapshots ago
- **Window** — lookback for Δ mode (hidden in Raw mode)
- **Y-axis**
  - *Absolute price* — traditional
  - *Offset (pts)* — `strike − spot` in points
  - *Offset (%)* — `strike − spot` in percent
- **Color scale** — 14 normalization modes. See [COLOR_SCALES.md](COLOR_SCALES.md).
- **Cap** — appears when Color scale = "Fixed cap"; type a numeric denominator.
- **Gamma**
  - *Linear* — true proportional brightness (default)
  - *0.7* — mild low-end lift
  - *0.55 (old)* — legacy gamma-compressed behavior
- **Blend**
  - *None (sharp)* — flat cells per strike
  - *Additive* — Gaussian contributions accumulated; punchy but sign-alternating
    neighbors may cancel
  - *Max (sign-safe)* — winner-take-all per pixel; preserves each strike's sign
    at its own center (default)

## delta.html — session buttons

- **SAVE** — download the current buffer as JSON. Filename includes ticker,
  expiry, overlay, and timestamp.
- **LOAD** — open a saved session file. Pauses live polling, replaces the
  buffer. Click LIVE to resume appending.
- **? HELP** — open the in-page control reference.

## Level traces (delta.html)

- **M+ (solid green)** — strike with the largest positive GEX imbalance at
  each snapshot
- **M− (solid red)** — strike with the largest negative GEX imbalance
- **ZG (yellow dashed)** — Zero Gamma line (only populated in GEX overlay mode;
  Greek endpoints don't return `zero_gamma`)

Each is drawn as a per-snapshot **step function**: the line holds its y-value
horizontally until the next column, then jumps vertically to the new level.
This reflects the discrete nature of M+/M−/ZG — the level never slides
through intermediate prices; it jumps between strikes. Segments break across
gaps (missing values, or points outside the visible y-range) so you won't see
long connecting lines across discontinuities when you scroll or zoom.

## index.html — history buttons

- **TODAY SO FAR** — load today's recorded snapshots and resume live
- **LOAD DATE** — replace buffer with a past date (requires Quant subscription)
- **+ PREPEND** — chain a past date before the current buffer
