# Controls Reference

## Mouse

| Input | Action |
|-------|--------|
| Scroll | Zoom Y-axis (price / offset) |
| Shift + Scroll | Zoom X-axis (column width) |
| Ctrl + Scroll | Scroll through history |
| Horizontal trackpad gesture | Scroll through history |
| Drag in chart area | Pan Y-axis |
| Alt + Drag in chart area | Pan X-axis (time) |
| Drag in **right price-axis gutter** | Zoom Y (pull up = zoom in, down = zoom out) |
| Drag in **bottom time-axis strip** | Zoom X (pull right = zoom in, left = zoom out) |
| Drag right edge of profile panel | Resize profile panel |
| **Hover** in chart area | Crosshair + floating tooltip (timestamp, y, nearest strike + vol, spot, ZG, net GEX) |
| **Click** in chart area (Mark ≠ off) | Drop annotation of selected type at cursor |
| **Right-click** an annotation | Delete it (within ~8 px) |

## Keyboard

| Key | Action |
|-----|--------|
| ← / → | Scroll history by 5 snapshots |
| Shift + ← / → | Scroll history by 50 snapshots |
| End | Jump to live edge |
| Home | Jump to oldest buffered snapshot |
| Esc | Close help overlay |

## Toolbar (left → right, top row)

- **Ticker** — which instrument to poll. List is pre-set; edit in the HTML
  file to add more symbols supported by your subscription tier.
- **Expiry** — 0DTE (`zero`), 1DTE (`one`), or `full` (all expirations).
- **Overlay** — `GEX` returns the raw/classified GEX profile. `Gamma`,
  `Delta`, `Charm`, `Vanna` return the corresponding per-strike Greek
  imbalance (requires State subscription).
- **Refresh** — polling interval. 1s is the default.
- **Palette** — 6 color schemes. GEX (green/red) is the convention; Electric,
  Solar, Ice/Fire are saturated-hue alternatives. **Hi-contrast** (white-tipped)
  pushes peaks to near-white luminance for max-magnitude emphasis. **Stepped**
  quantizes magnitude into 4 bands so even small non-zero values pop visibly.
- **Gamma** — 8 contrast curves from 2.5 (peaks-only, kills mid-tone noise) down
  to 0.3 (extreme low-magnitude lift, hunts faint detail). 1.0 = linear.
- **Blend**
  - *None (sharp)* — flat cells per strike
  - *Additive* — Gaussian contributions accumulated; punchy but sign-alternating
    neighbors may cancel
  - *Max (sign-safe)* — winner-take-all per pixel; preserves each strike's sign (default)
- **Col px** — column width in pixels. Shift+Scroll does the same live.
  `fit` (default since v0.6.4) auto-shrinks to show the entire buffer; `1d` fixes
  layout to one full US session (23,400 snaps); sub-pixel values aggregate
  multiple snaps per column via max-abs.
- **Strike px** — caps each strike's vertical band height. `fit` fills the full
  slot between strikes (continuous heat field); numeric values produce a
  Bookmap-style ladder. The Gaussian blend kernel scales with this setting so
  Additive / Max blend modes don't bleed across strikes.
- **MaxCh** — per-strike or chain-aggregate detector overlay. Four families:
  - **Pulse** (per-strike z-score, fires on changes) — fast / normal / strict
  - **Loud** (magnitude rank vs session-max, fires on absolute big prints) —
    loose (≥10%) / normal (≥20%) / strict (≥35%) — added v0.8.7
  - **Event detectors** — burst (chain z-score), swarm (cluster), pump (combined)
  - **Legacy CUSUM** — bucket-win persistence; demoted v0.8.2 (lift ≈ 1.0)
- **TZ** — time zone for the x-axis, cursor hover tooltip, last-update stamp.
  Always 24-hour (HH:MM). `Local` uses the browser's default; named zones
  (NY, Chicago, London, Berlin, Tokyo, HK, UTC) pin the display.
- **● LIVE** — toggle live polling on/off.
- **RESET ZOOM** — unlock Y-axis auto-range and jump to live.
- **CLEAR** — empty the snapshot buffer.
- **SAVE / LOAD** — download / upload a buffer as JSON.
- **RESTORE** — re-load today's auto-saved IndexedDB session for the current
  ticker / expiry / overlay tuple. Button reflects available snap count.
- **Mark** — annotation type to drop on next click. Options: `off`,
  `price line`, `time marker`, `point + note`. Annotations persist in
  IndexedDB scoped to (ticker, expiry, overlay). Right-click an annotation
  to delete it; the **⌫** button clears all for the current key.
- **REPLAY** — open the scrubber bar at the bottom. Pauses live polling. Drag
  the knob to scrub, ▶ to play at 1×/5×/15×/30×/60× speed, EXIT to resume live.

## AUTO ★ toolbar group

- **AUTO ★** — master toggle for the live setup composer (default ON).
  When OFF, no detection runs — no level lines, no setup fires, no toasts.
- **sensitivity** (high / med / low) — wider/narrower near-wall band, longer/
  shorter Pulse window, looser/tighter velocity floor, shorter/longer cooldown.
  Default: `med`.
- **★ tier filter** (★+ / ★★+ / **★★★** default) — minimum wall hold-time for
  level lines to render and setups to fire. ★★★ = ≥30 min, ★★ ≥ 15 min,
  ★ ≥ 5 min. Toggling produces immediate visual change.
- **LOG** — open the setup-fire history panel (last 50 fires, click row to
  scroll the chart to that snap).
- **★ MARKS** — show/hide auto-annotations on the chart. History preserved
  (toast still pops, log still tracks, IDB still stores). Persisted in
  localStorage.
- **🔊** — WebAudio chirp on each fire (660 Hz rejection / 880 Hz breakout).
  Off by default.

## Top-right toolbar

- **? HELP** — open the in-page control reference.
- **DARK / LIGHT** — toggle theme. Persisted in localStorage.

## Stats bar

- **Spot / Net GEX / Zero γ / Maj +/−** — current snapshot's headline values.
- **Regime** — auto-classified GEX regime: `Long γ · fade` (spot above zero
  gamma; dealers fade moves), `Short γ · chase` (below ZG; dealers chase),
  or `Flip · ±X%` (within ±5 bp of ZG, transitional). In gamma overlay where
  zero γ is missing, the badge shows `—`. Hover the pill for a one-line
  interpretation.
- **★ rate** — AUTO ★ live fire density (setups/h over the last 60 min of
  buffer time, filtered by current ★ tier). Color-coded: green &lt; 5/h,
  yellow 5-15/h, red &gt; 15/h. Empty when AUTO ★ is OFF.
- **Mode badge** (right) — `Raw GEX` (cyan) or `Δ Change · N snaps` (orange).
- **Snaps** — total snapshots in buffer.
- **Updated** — timestamp of latest snapshot in current TZ.

## Toolbar (second row)

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
## Level traces

(Drawn directly on the heatmap, via the existing M+/M−/ZG step lines.)

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

