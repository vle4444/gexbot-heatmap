# Changelog

## [0.8.11] — Maximize-chart toggle (hide toolbar)

Small button (▴/▾) at the right end of the stats bar collapses the entire
toolbar — every control above the Spot / Net GEX / Updated line — so the
chart fills more vertical space. Click again to bring the toolbar back.

The stats bar stays visible in both states (it carries the toggle button
plus the live readouts). State persists across reloads in `localStorage`
under `gexbot.toolbarHidden`. The canvas reflows on toggle via the
existing `resize()` + `render()` path.

## [0.8.10] — AUTO ★ approach/decel filter + analysis of 2026-05-07 SPX session

User feedback after a 4-hour SPX recording (file
`gexbot-SPX-zero-gamma-2026-05-07T17-48-35.json`, 9070 snaps,
14:11Z–18:05Z): "I don't see much edge in your auto live event
detector". The session contained 68 spot reversals (≥3 pt within 60s),
including the headline events:
- 15:34:51 → 16:01:51: 21.7 pt sell-off then 21.7 pt recovery
- 17:25:36 → 17:27:13: 18 pt drop then 12.6 pt bounce (low-of-day at 7321.66)
- repeating 7335 / 7320 wall tests through 17:00–18:00

### What the analysis showed
Replay of the existing AUTO ★ logic at ★★★ tier produced ~6 fires over
4 hours — already few. But the *quality* was the problem: most fires
were drift-near-wall (`vel ≈ −0.18 SPX/5s`), not real approaches.
The "approach" check fired any time velocity sign matched direction-
to-wall, with no minimum magnitude.

### Fix — decel + minimum-approach filter (per sensitivity preset)
Two new SENSITIVITY parameters wired into the rejection branch and
mirrored on the breakout branch:
- `minApproachVel` (SPX points / 5-snap window): the **prior** 5s spot
  velocity must have ≥ this magnitude. Filters drift.
- `decelRatio`: current 5s velocity must be `< |prior| × decelRatio`.
  The "wall is starting to hold" signature.

Tuning per preset (calibrated against the 2026-05-07 session):

| Sensitivity | minApproachVel | decelRatio |
|---|---|---|
| `high` | 0.30 SPX | 0.85 |
| `med`  | 1.00 SPX | 0.70 |
| `low`  | 2.00 SPX | 0.55 |

Replay on `low`: 4 fires/4h, including a single fire at 15:34 (wall=7375,
v_prev=+7.75, v_now=−2.74) that anchors the day's biggest pop-and-reverse
setup. Replay on `med`: 6 fires/4h.

Breakout uses the inverse — `accelRatio = 1/decelRatio` — and now requires
spot to be moving *faster* through the wall than into it.

### Other findings (not implemented — documented for follow-up)
- `accel` (per-strike d/dt of |dir|) was prototyped — same behavior as
  the existing Surprise detector, no added lead time. Skipped.
- `wall_flow` (cumulative |dir| at major wall over rolling window) was
  prototyped — flow saturates *after* bounces, not before. Skipped.
- The strict trio from v0.8.9 (Surprise / Consensus / Rank-Shift)
  catches ~all major events but with inherent ~0s lead time, since
  /maxchange is fundamentally reactive. The predictive edge lives in
  spot dynamics + wall stickiness, not in the maxch feed itself.

See `docs/ANALYSIS-2026-05-07.md` for the full session breakdown.

## [0.8.9] — Three new strict MaxCh detectors + sign-convention resolved

User feedback after reviewing a 2026-05-07 SPX recording (file
`gexbot-SPX-zero-gamma-2026-05-07T14-19-11.json`): around 14:14:01 UTC
strike 7350 absorbed a megaprint (raw -97 → -250 across 2 then 3
buckets, "negative gamma added"). Existing modes either fired with
wrong-color glyphs (sign convention bug) or weren't strict enough.

### Sign convention resolved (`dir = raw`, was `dir = -raw`)
The original `dir = -raw` negation had been an open TODO since the
detector was introduced — based on three early screenshots, with
later evidence putting it in doubt. The 7350 event finally provided a
clean three-way confirmation: raw value sign, heatmap rendering color,
and the user's stated read of the move all agreed. The negation has
been removed from `aggSnapBuckets` (delta.html) and the analyzer
(`analyze-recording.js`).

**Visible effect**: every Pulse / Loud / CUSUM glyph color flips. A
strike with raw -97 now renders RED (negative-direction change),
matching the heatmap's pink. Magnitudes and detection logic are
unchanged.

### New "Strict" detector family — three different math models
Three independent detectors at the top of the dropdown, each using
a different mathematical model so confluence between them is genuinely
informative:

| Mode | Model family | What it catches |
|---|---|---|
| `surprise_strict` | log-magnitude z-score, per-strike with session-pool fallback for new strikes | "this is unusual for THIS strike (or for the session, if new)" |
| `consensus_strict` | (n_buckets-1) × |dirSum|/sessionMax with Schmitt hysteresis on transitions | "multiple time horizons agree" |
| `rank_shift_strict` | top-1 rank-entry from outside last 30-snap window | "this strike just became the loudest, and it wasn't loud recently" |

All three fire on the 7350 anchor event in offline replay and stay
quiet through normal flow (~7-14 fires across a 7.5-min file vs Pulse
normal's 26).

### Other
- `aggSnapBuckets` now tracks the set of bucket indices per strike
  (`bset`) — needed by Consensus to measure cross-time-horizon
  agreement.
- Existing modes (Pulse / Loud / Burst / Swarm / Pump / CUSUM) all
  unchanged in logic. Pulse `normal` remains the default.

## [0.8.8] — `★ MARKS` toggle to hide auto-generated annotations

New toggle button in the AUTO ★ toolbar group, labeled `★ MARKS`. When
ON (default), reject / break auto-annotations render on the chart as
before. When OFF, those annotations are hidden — the chart shows only
the spot trace, level lines, manual annotations (price lines, time
markers, notes), and the always-visible toast/log.

The setup-fire history is unaffected — fires still happen, IDB still
stores annotations, the toast still pops, the LOG panel still lists
them. Only the chart-rendering of auto-marks is gated.

Useful for: decluttering the chart when reviewing market structure,
taking screenshots without setup clutter, or temporarily hiding stale
auto-annotations while a session keeps running.

State persists in `localStorage` under `gexbot.autoMarksVisible`.

## [0.8.7] — New `Loud` MaxCh family — magnitude-rank detector

User-reported: scrolling through Pulse presets, none caught a notable
event at strike 7375 around 18:09 CEST on 2026-05-06 — a print at 63%
of session-max preceding a price rise. Although offline replay shows
Pulse `normal` *does* fire on that print (z=31.57), the user wants a
detector that's reliable independent of per-strike history.

### New mode family — Loud
A magnitude-rank detector. No EMA, no z-score, no per-strike adaptation.
Fires whenever `|dir|` at a strike ≥ `sessionMaxAbs × magPct`. Per-strike
cooldown to prevent repeat-fire on a sustained big print.

| Preset | magPct | hold | cooldown | typical fires/h | catches 7375 event |
|---|---|---|---|---|---|
| `loud_loose`  | 10% | 3 | 30s | ~10 | yes |
| `loud_normal` | 20% | 5 | 60s | ~5  | yes |
| `loud_strict` | 35% | 8 | 90s | ~1.5 | yes |

Calibrated against the 2026-05-06 SPX session: all three presets catch
the 7375 event; `loud_normal` and `loud_strict` catch it with low noise
(5 and 1.5 fires/hour respectively over a 9.5-hour session).

### Why Loud and Pulse are complementary

- **Pulse** asks "is this print unusually large for *this* strike?" —
  a change/velocity detector. Catches "this strike just woke up" or
  "this strike just spiked harder than usual".
- **Loud** asks "is this print large in *session* terms?" — a magnitude/
  rank detector. Catches "this strike just put up a really big number"
  regardless of its history.

A strike that's been M- consistently at 60% magnitude → only Loud fires
(Pulse's EMA absorbed the consistent baseline). A strike that's been M-
and just *doubled* → only Pulse fires (60% → 70% isn't a session-rank
event but it's a per-strike z-score). A genuine session-record print →
both fire.

The dropdown now reads (from top to bottom):
1. Pulse (per-strike velocity) — recommended for change detection
2. **Loud** (magnitude rank) — added v0.8.7
3. Event detectors (burst / swarm / pump)
4. Legacy CUSUM (demoted)

Help overlay rewritten with the four-family comparison.

## [0.8.6] — Remove wall-touch dots entirely

User feedback after the v0.8.5 rewrite: the wall-touch concept is just
noise. The level lines + sparse setup-fire annotations already convey
what's needed; the extra dots cluttered the chart without adding
information. Reverted entirely.

### Removed
- `renderWallTouches()` — function and call site
- Wall-touch documentation in the help overlay

### Kept (unchanged)
- Persistent level lines with `★ tier · strike · holdMin` left-edge labels
- Setup-fire annotations (rejection / breakout) with directional ↑/↓ arrows
  (v0.8.4)
- Setup log panel showing the full fire history (v0.8.4)
- ★ tier filter (gates level lines + alert emissions)
- ★ rate density badge

The ★ tier filter description and dropdown tooltip updated to match —
no longer references the removed wall-touch layer.

## [0.8.5] — Wall-touch dots rewritten (entries + apexes, not every snap)

### Fixed regression
v0.8.3 emitted a wall-touch dot for every single snapshot where spot
was within ±0.08% of a sticky wall. On a session where spot chops near
a wall for 30+ minutes (which is the *normal* behavior of a sticky
wall — that's why it's sticky), this produced a flood of orange dots
covering the entire spot trace. User-reported regression.

### New behavior
Walks the visible source range and tracks zone state — only emits dots
on **transitions**:

- **Solid filled dot** — spot just *entered* a wall's near-zone. One
  per entry. Per-wall re-entry gap of 60s suppresses micro-oscillations
  at the band boundary.
- **Hollow ring** — *deepest approach* within the current zone, if
  spot kept getting closer after entry. So a brief touch = 1 entry dot,
  a sustained test = entry dot + ring at the closest point.

Net effect: a 50-minute touch of a wall now produces ~2 dots
(entry + apex) instead of ~3000. Brief touches still get a clear
single-dot mark.

Color and tier semantics unchanged (orange ★★★ / yellow ★★ / blue ★;
gated by ★ tier filter; absolute price mode only).

## [0.8.4] — Disambiguate rejection direction + setup log panel

### Fixed — `reject 7335` was ambiguous
The rejection label gave no clue whether spot was approaching from
above or below — i.e., whether the rejection was bullish (bounce up
off support) or bearish (push back down off resistance). Both setup
types now display a directional arrow following the same convention
that breakout has used since v0.8.0:
- **↑** = price expected / observed to go UP after the event
- **↓** = price expected / observed to go DOWN

Rejection direction is derived from spot's position relative to the
wall at fire time:
- `reject 7335 ↓` → spot was below 7335 (wall = resistance), rejection = bearish
- `reject 7335 ↑` → spot was above 7335 (wall = support), rejection = bullish
- `break 7270 ↑`  → spot crossed 7270 going up (continuation)

Convention applied to: auto-annotation labels on the chart, toast
rows, and the new setup-log panel below.

### Added — setup log panel
New `LOG` button in the AUTO ★ toolbar group. Opens a panel showing
the last 50 setup fires in memory, including those filtered out by
the current ★ tier (those rows are dimmed). Each row shows:

`time · type · strike · arrow · spot · velocity · ★ tier · regime · hold · Pulse mag`

Click any row to scroll the chart to that fire snapshot. The panel
auto-updates as new fires arrive while it's open. The header shows
`N total · M at ★X+ filter` so you can see the filter's effect at a
glance.

Useful for: reviewing what fired during a session you weren't watching;
auditing why a particular setup did/didn't pass the tier filter;
navigating to specific fires by clicking their row.

## [0.8.3] — ★ tier filter is fully visual + wall-touch indicator dots

### Fixed UX gap
The ★ tier filter (v0.8.1) only gated setup fires (annotations / toast /
chirp). On a quiet session with no fires, toggling the dropdown
produced zero visible effect — exposing a bad UX assumption that "you'd
see it work eventually." On a slow day, "selective" looks identical to
"broken."

### Changed
- **Tier filter now also gates level lines.** `★★★` → only the day's
  ≥30-min walls draw their dashed horizontal + label. `★★+` → ≥15-min.
  `★+` → all sticky walls. Toggling the dropdown is now immediately
  visual.
- The dropdown change handler also calls `render()` so the chart
  refreshes when the tier changes.

### Added — wall-touch dots
A new continuous-feedback indicator overlaid on the spot trace. At
every snapshot where spot was within ±0.08% of a sticky wall passing
the ★ tier filter, a small colored dot is drawn at (snap.ts, spot).
Color matches the wall's tier (orange ★★★, yellow ★★, blue ★). Halo
+ solid core for readability on both themes.

This sits between "level line shown" (mostly static) and "setup fire"
(rare) — gives many more visible "the system noticed something"
events without committing to a full setup-fire alert. Particularly
useful on quiet days where setup fires are sparse.

Lives in absolute price mode only (offset modes don't have a single
spot location to anchor a dot to). Render gate respects the AUTO ★
on/off toggle and the ★ tier filter.

## [0.8.2] — Demote CUSUM, SVG visualizer for setup-composer replays

### Changed — CUSUM demoted to Legacy
The six CUSUM presets are moved from the dedicated "Persistence" group
to a new "Legacy (CUSUM — fires constantly, low lift)" group at the
*bottom* of the MaxCh dropdown. Empirical analysis showed every
preset firing 83-99% of snapshots (lift ≈ 1.0 vs random) — i.e.,
always-on, no actual signal. Pulse (kept on top of the dropdown) is
the recommended detector for both quick events and persistent activity.

The presets remain available for niche cases where you specifically
want the "where is sustained flow building" view, but they are no
longer presented as competitive with Pulse. Each entry is now
prefixed `cusum ` in the dropdown to make the family explicit.
Help overlay rewritten with the empirical context.

### Added — SVG visualizer in `analyze-recording.js`
Each report run now produces three SVG files (one per sensitivity)
alongside the markdown report. Each SVG shows:

- **Spot price line** (cyan) over the full session timeline
- **Sticky levels** (top 6 by hold-time) as faint dashed horizontal
  references with left-edge `★ tier · strike · holdMin` labels
- **User events** as red dashed verticals with labels
- **Sweep candidates** as small gray ticks at the bottom
- **Setup composer fires** as colored circles (orange = rejection,
  blue = breakout), size scales with ★ tier, hover shows full
  metadata (time, spot, regime, velocity, hold, Pulse mag)
- **Right-side legend** with fire counts per tier

SVG is self-contained — open the file directly in any browser; no
deps. Per-element `<title>` attributes give native hover tooltips.
Use case: a quick "where on the day did the system fire vs my known
events" visual review without booting the dashboard.

Output paths follow the markdown report's basename: e.g.
`analysis-2026-05-05.md` produces
`analysis-2026-05-05-{high,med,low}.svg`.

## [0.8.1] — AUTO ★ tuning: ★ tier filter, longer cooldowns, live fire-density readout

After running v0.8.0 retrospectively against the 2026-05-05 SPX session
(133 fires at `med` sensitivity, 1 every ~3 minutes), three targeted
adjustments to bring the system from "always firing" to "high
conviction":

### Changed — cooldowns
Per-(type, strike) cooldown bumped 2.5-3× across all sensitivities:
| sensitivity | old | new |
|---|---|---|
| high | 180s | **360s** |
| med  | 240s | **600s** |
| low  | 360s | **900s** |

Yesterday's data showed ~30 fires at strike 7270 alone with the prior
240s cooldown — too repetitive on a single wall test. The new values
let one wall test produce 1-2 setups instead of 5-10.

### Added — ★ tier filter
New dropdown next to the sensitivity selector (★★★ default):
- **★★★** (≥30 min wall hold) — only the day's most durable walls
  fire annotations / toast / chirp. Default.
- **★★+** (≥15 min hold) — adds emerging structure.
- **★+** (all tiers) — most permissive; useful for the first
  hour before any wall reaches ★★★, or to study the composer's
  full output.

The filter only gates the **alert layer** (annotations, toast, chirp).
Persistent level lines render at all tiers regardless, so visual
context is preserved.

### Added — `★ rate` live density badge
New stat in the stats bar. Shows AUTO ★ fires per hour over the last
60 minutes of buffer time, after the ★ tier filter applies. Color-
coded: **green** &lt;5/h, **yellow** 5-15/h, **red** &gt;15/h.

Self-evident calibration: glance at the badge → "is this setting too
noisy?" without needing to run the offline analyzer.

### Combined impact (2026-05-05 retrospective at `med` sensitivity)

|                                       | fires | per hour | near user event |
|---------------------------------------|-------|----------|-----------------|
| v0.8.0 default (no tier filter)       | 133   | 19.5     | 19.5%           |
| v0.8.1 (cooldown bump only, tier ★+)  | 66    | 9.7      | 18%             |
| v0.8.1 default (med + ★★★)            | **22**| **3.2**  | **41%**         |
| v0.8.1 strictest (low + ★★★)          | 12    | 1.8      | 33%             |

83% reduction in fires + 2× improvement in precision.

### Updated
- Help-overlay AUTO ★ section rewritten with the tier filter and
  density-badge guidance.
- Analyzer (`analyze-recording.js`) cooldowns updated to match;
  setup-composer report now includes ★ tier projection table per
  sensitivity.

## [0.8.0] — Live setup detector: AUTO ★, level lines, rejection / breakout

The first iteration of the **level detector + setup composer** designed
on the back of yesterday's signal-vs-event analysis (`analysis-2026-05-05.md`).
That study showed the existing per-snapshot signals (Pulse, CUSUM,
burst/swarm/pump) are good at saying "*something* is happening
*somewhere*" but don't know **which level matters** — and 4 of 5 user
events were rejections at specific price levels (7255, 7270×3). This
release adds level-awareness on top of the existing Pulse machinery.

### New: `LIVE_SIGNALS` module

A live, stateful signal-intelligence layer that ingests on every new
snapshot (not per render frame). Three components:

- **Level tracker** — per-strike `holdSnaps` (count of snaps where
  strike was M+ or M−) + `flowScore` (fractional credit for /maxchange
  leadership). Top-N strikes by combined score are the session's
  "sticky walls."
- **Pulse live state** — replicates the v0.7.2 `pulse_normal` preset
  (Welford EMA + z-score per strike) but maintained as live state
  across ingests, exposing `recentPulseFires(ci, withinSnaps)`.
- **Setup composer** — combines the above with the regime classifier,
  spot velocity, and spot-vs-wall position to fire two setup types
  with per-(type, strike) cooldown.

### New: setup types

- **Rejection** — spot approaches a sticky wall (within ±0.04-0.10%
  depending on sensitivity), Pulse fired at or adjacent to the wall in
  the last 30-60s, regime is Long γ (or transitional). Expectation:
  dealers fade → bounce/reject. Color: orange.
- **Breakout** — spot just *crossed* a sticky wall in the direction of
  sustained velocity, Pulse fired near the wall, regime is Short γ (or
  transitional). Expectation: dealers chase → continuation. Color: blue.

### New: `AUTO ★` toolbar group

- **AUTO ★ button** (default ON) — toggles live setup detection.
- **Sensitivity dropdown** (high / med / low) — high = wider near-wall
  band, longer Pulse window, lower velocity floor (more setups, more
  noise). Low = tighter (fewer setups, higher conviction).
- **🔊 checkbox** — WebAudio chirp on fire (660 Hz rejection / 880 Hz
  breakout). Off by default.

### New: visual additions

- **Persistent level lines** — top-N sticky strikes render as faint
  dashed horizontal lines across the chart with left-edge labels:
  `★★ 7270 · 18m`. ★ tier scales with hold-time (★ ≥ 5m, ★★ ≥ 15m,
  ★★★ ≥ 30m). Stale levels dim. Left-edge avoids collision with the
  existing M+/M−/ZG right-edge labels.
- **Setup toast** — top-right floating panel shows the last 3-5
  setups (12s TTL each). Click any row to scroll the chart to that
  snapshot.
- **Auto-annotations** — setup fires drop a labeled annotation at the
  trigger snapshot. Auto-annotations have a soft halo + larger dot to
  distinguish from manual notes. Persist in IDB across reloads
  (reuses the v0.7.0 annotation store, additive `auto: true` field).

### Lifecycle hooks

- `ingest()` calls `LIVE_SIGNALS.ingest()` on every new snapshot.
- CLEAR / ticker-greek-expiry change → `LIVE_SIGNALS.reset()`.
- LOAD / RESTORE → `LIVE_SIGNALS.rebuild(snapshots)` (silent — no
  retroactive toasts/annotations on bulk restore).

### Notes

- The setup composer requires both a sticky wall AND a Pulse fire
  near it AND velocity in the right direction. This is intentionally
  more restrictive than any single signal — false positives drop
  sharply at the cost of some recall.
- Cooldown is 3-6 minutes per (type, strike) depending on sensitivity.
  Prevents one wall test from spamming the toast on every snapshot.
- Gamma overlay regime classifier returns `unknown` (zero γ is `—`).
  Setup composer treats `unknown` as a regime-permissive case so the
  detector still works on gamma-overlay sessions.

## [0.7.2] — MaxCh rework: new Pulse detector for quick + strong changes

### The problem

The CUSUM-based MaxCh had a structural blind spot. It counts *bucket
wins* per snapshot, not magnitudes — a strike that wins one bucket with
a huge value once is filtered as "not persistent" and never fires.
Sharp wall flips, fresh walls forming, and similar high-magnitude
single-event activity were silently dropped. CUSUM is correct for the
"sustained slow flow" case it was designed for, just not for "quick +
strong changes."

### The fix

New **Pulse** detector family. Per-strike Welford / Roberts EMVar
baseline (online EMA + variance update). Each snapshot:

1. `m = Σ |dir|` over buckets that named the strike (0 if absent)
2. `z = (m − μ_strike) / max(σ_strike, σ_floor)` against the strike's
   own baseline, before updating
3. State machine: fires on `z ≥ z_fire` immediately (1-snap latency),
   refreshes hold timer while `z ≥ z_keep`, exits when timer hits 0

`σ_floor = sessionMaxAbs · minSigmaPct` prevents micro-perturbations
firing after a long quiet period. Tracker self-prunes strikes silent
for `EMA × 5` snaps to keep memory bounded.

### Three new presets

| Preset       | EMA | z_fire | z_keep | hold | σ_floor pct |
|--------------|-----|--------|--------|------|-------------|
| pulse_fast   | 10  | 1.5    | 0.5    | 3    | 2%          |
| pulse_normal | 20  | 2.0    | 0.7    | 5    | 2%          |
| pulse_strict | 30  | 3.0    | 1.0    | 8    | 3%          |

### Other changes

- **`pulse_normal` is the new default** MaxCh mode (was: CUSUM `normal`).
  Existing CUSUM presets remain available under "Persistence" group.
- **MaxCh dropdown reorganized** with three explicit groupings:
  - Pulse — per-strike z-score (fast + strong)
  - Persistence — CUSUM + hysteresis (sustained flow)
  - Event detectors — burst / swarm / pump (snapshot-aggregate)
- **Help overlay rewritten** for the three families. Each answers a
  different question; pick one based on what you're watching for.
- **Sign convention unchanged**: still uses `dir = −raw`. The open TODO
  to verify that empirically (`todo_verify_maxch_sign.md`) is unaffected
  — Pulse uses `Σ |raw|` for magnitude, which is sign-flip-invariant.

### Notes

- Auto-memory: `maxch_pulse_v0_7_2.md` documents the algorithm,
  presets, and revisit triggers.
- Latency: Pulse fires on the first snapshot of a clean breakout
  (≤1 snap). CUSUM `normal` previously took 6–12 snapshots.

## [0.7.1] — Five new gamma modes (2.5 / 2.0 / 1.5 / 0.4 / 0.3)

The Gamma dropdown previously offered three values (1.0, 0.7, 0.55) all
on the lift-mids side. Five new options widen the contrast spectrum:

- **γ = 2.5 / 2.0 / 1.5** — *peaks only* / *peaks only* / *emphasize highs.*
  Mid-tones darken, only the largest walls remain bright. Useful in noisy
  regimes where mid-magnitude flutter clutters the view; pair with the
  **Hi-contrast** palette for max emphasis on the strongest signal.
- **γ = 0.4 / 0.3** — *strong lift* / *extreme lift.* Mid-tones brighten;
  any non-zero value reads as visibly bright. Useful for hunting fresh
  walls just appearing or for catching low-magnitude detail near the
  noise floor; pair with the **Stepped** palette for "is anything here?"
  binary visibility.

The dropdown is now ordered top-down from peaks-only (γ=2.5) through
linear (γ=1.0) down to extreme-lift (γ=0.3), with one-line descriptors
on each option. Help-overlay Gamma section rewritten with the curve
intuition.

## [0.7.0] — Crosshair, annotations, replay, regime classifier, rAF coalescing

A batch of UX-and-alpha additions selected from a brainstorm. Five of six
features land; the sixth (OffscreenCanvas + Worker) is parked for its own
focused commit because it requires a real refactor of the pixel-loop /
vector-overlay split (see "Deferred" below).

### Added — performance
- **rAF render coalescing.** The previously-synchronous `render()` is now an
  rAF wrapper around `_renderNow()`. All existing call sites (mousemove
  drag, wheel zoom, fetch ingest, control changes) are unchanged but at
  most one paint runs per frame regardless of how many times `render()`
  is invoked. Materially smoother drag-pan / drag-zoom on large buffers.

### Added — UX
- **Crosshair + floating tooltip.** Hover anywhere in the chart area →
  vertical column-aligned line, horizontal cursor line, and a tabular
  tooltip showing `{time, y, nearest strike, vol@strike, spot, zero γ,
  net GEX}`. Tooltip auto-flips at right/bottom edges.
- **Persistent annotation layer (IndexedDB).** New **Mark** dropdown +
  **⌫** clear button. Three annotation types: `price line` (horizontal,
  preserved across Y-axis modes via abs-price storage), `time marker`
  (vertical at a snapshot's timestamp), `point + note` (labeled dot at
  price+time). Scoped to (ticker, expiry, overlay), survives reloads.
  Right-click within ~8 px to delete; ⌫ clears all for the current key.
  IDB schema bumped from v1 → v2 (additive — `snapshots` store unchanged,
  new `annotations` store added).

### Added — alpha
- **GEX regime classifier badge.** New `Regime` pill in the stats bar.
  Computes from `meta.spot` and `meta.zeroG`:
  - `Long γ · fade` (spot above zero γ — dealers hedge counter-flow,
    walls magnetize, breakouts often fail)
  - `Short γ · chase` (spot below zero γ — dealers hedge with-flow,
    walls become barriers, breakouts accelerate)
  - `Flip · ±X%` (within ±5 bp of zero γ — transitional)
  Color-coded green / red / yellow. Frames the interpretation of every
  other on-screen signal.
- **Replay mode with timeline scrubber.** New **REPLAY** button opens a
  bottom strip with play/pause, 1×/5×/15×/30×/60× speed, draggable
  scrubber knob, click-to-jump track, and live position readout
  (`HH:MM:SS`, `i / N`). Pauses live polling on enter; restores it on
  EXIT. Pairs with the IDB **RESTORE** flow — you can restore yesterday's
  full session and replay it at 30× to study how walls formed and broke.

### Deferred
- **OffscreenCanvas + Worker for the heatmap pixel loop** is parked for a
  dedicated commit. Reason: the existing `renderHeat` interleaves the
  pixel loop with vector overlays (axis ticks, spot trace, level traces,
  legend) on the same canvas, so worker offload requires either splitting
  the render into "before-pixels" / "after-pixels" halves with a real
  state-passing protocol, or duplicating all palette/scale/blend code
  into a worker source string. With rAF coalescing landed in this batch,
  the perceived-snappiness gap closed enough that the worker becomes a
  pure-perf optimization (≤3-5 ms savings per frame on typical buffers)
  worth doing carefully in isolation.

## [0.6.5] — Single-dashboard repo, light/dark theme

### Removed
- **`index.html` (classic dashboard) deleted.** The repo now ships only
  `delta.html`. `server.js` still serves it at `/` (root path now resolves
  to `/delta.html` instead of `/index.html`). Active docs (README, CLAUDE.md,
  CONTROLS.md) updated; historical references in HISTORY.md / CHANGELOG /
  GEXBOT-API kept as-is.

### Added
- **Light / dark theme toggle.** New `DARK` / `LIGHT` button at the right
  end of the toolbar. Persisted in `localStorage` under `gexbot.theme`.
  Default is dark.
  - **Chrome** — toolbar, stats, footer, help overlay, error panels — fully
    re-skinned via CSS variables. Off-black bg / white text in dark; near-white
    bg / dark text in light, with restrained accent colors that hold up on
    white (`#1a6cb8` blue replaces the bright `#3090d0` etc.).
  - **Heatmap canvas** — background, axis ticks, axis labels, time-axis
    strip, spot trace, profile panel, and legend frame all read from a
    runtime `THEME` object that flips on theme change.
  - **Palettes** — refactored to a `{v, sat}` form so the renderer can
    compose them differently per theme:
    - dark mode rams **black → saturated** (`out_c = v · sat_c`, unchanged)
    - light mode rams **white → saturated** (`out_c = 255 − v · (255 − sat_c)`)
    - net effect: in light mode, t=0 cells blend into the white background;
      cells fade *up* in saturation as |t| grows, instead of fading *up* in
      brightness from black. Hue identity preserved at peaks.
  - All six palettes (GEX, Electric, Solar, Ice/Fire, Hi-contrast, Stepped)
    work in both themes.

## [0.6.4] — Fit-always-fits, axis-grip zoom, refreshed typography, new defaults

### Fixed
- **`Col px = fit` now actually fits the full buffer.** Previous floor of
  `0.05` CSS px/snap meant ~20+ source snaps per pixel was the densest the
  layout would go, so once the buffer exceeded ~6,000 snaps on a 1500px
  drawing area the oldest snapshots scrolled off the left even with `fit`
  selected. The floor is dropped to `1e-4`; the existing sub-pixel
  aggregation pipeline (max-abs per strike) now compresses every snap into
  available pixels at any buffer size.

### Changed
- **Typography overhaul.** Toolbar/labels now use a system sans stack
  (`-apple-system`, `Segoe UI`, system-ui, …) instead of monospace; the
  forced uppercase + 1–2px letter-spacing on every label is gone. Numeric
  values (axis ticks, spot, stats) keep a mono stack (`Consolas`, `Menlo`,
  …) with `font-variant-numeric: tabular-nums` so columns align. Base size
  bumped from 14 → 15 px; small labels from 11 → 13 px; canvas-rendered
  axis ticks bumped 1 px each.
- **Drag-axis zoom.** Drag in the **right price-axis gutter** to zoom Y
  (pull up = zoom in, pull down = zoom out, anchor preserved at the y-value
  under cursor at mousedown). Drag in the **bottom time-axis strip** to
  zoom X (pull right = zoom in, pull left = zoom out). Cursor switches to
  `ns-resize` / `ew-resize` over the gutters as a hint.
- **Pan X demoted from time-axis-drag.** Time-axis drag was previously
  pan-X; now it's zoom-X. Pan X is still available via **Alt+Drag in chart
  area**, **Ctrl+Scroll**, **Arrow keys**, and horizontal trackpad
  gestures.
- **New defaults**: `Blend = Max (sign-safe)` (was: None/sharp) and
  `Col px = fit` (was: 2). Aligns the out-of-box view with the now-fixed
  fit behavior and the sign-preserving blend most useful for spotting
  small opposite-sign strikes between large neighbors.

## [0.6.3] — Two max-contrast palettes (Hi-contrast, Stepped)

Two new options in the **Palette** dropdown of both dashboards, designed
specifically for spotting wall changes and new walls appearing — situations
where the existing equally-saturated palettes (GEX, Electric, Solar,
Ice/Fire) can hide low-magnitude or just-arrived activity.

### New
- **Hi-contrast (white-tipped)** — both poles ramp toward near-white at
  peak. Peak luminance is the highest of any palette here, so big walls
  visibly burn brighter against the black background and changes in the
  largest values are easier to see. Sign carried by tint at sub-peak:
  yellow-white (+), pink-white (−).
- **Stepped (4 bands, lime/magenta)** — |t| is quantized into 4 brightness
  bands (0.45, 0.65, 0.85, 1.0). Any non-zero value snaps to ≥45%
  brightness, so a wall popping into existence is loud rather than a soft
  fade-in. A wall crossing a band boundary produces a discrete step rather
  than a smooth shade, making magnitude changes easy to spot. Magnitude
  resolution is intentionally coarse — pair with a Trailing or Snapshot
  scale if you want band transitions to track local activity.

### Where
- `delta.html` (with the Gamma selector) and `index.html` (fixed γ=0.55)
  both ship the new options.
- Help overlay updated with descriptions in the **Palette** section.

## [0.6.2] — Remove session minimap

The 80px-tall always-visible session-overview strip added in v0.5.0 is
removed. It briefly served as a navigation aid, but in practice the
focus is on the main heatmap, and the same use cases are covered by
`Col px = fit` (auto-fits the buffer) and `Col px = 1d` (fixed
one-session layout). Removing it gives the main heatmap back the
~80px of vertical real estate.

### What's gone
- `#mm` HTML container, `<canvas id="minimap">`, `#mm-viewport`,
  `#mm-label` — and their CSS.
- `mmCV` / `mmCX` references in `resize()`.
- `renderMinimap()` function and its call from `render()`.
- `setMinimapCenter()` and the click/drag handlers on the minimap.
- "Minimap (session strip)" section in the help overlay.

### What's preserved
- All sub-pixel `Col px` aggregation logic (powered the minimap, still
  powers the main heatmap's `fit` / `1d` modes).
- All MaxCh detector modes — they never used the minimap.
- Auto-save / RESTORE — independent of the minimap; still works.

## [0.6.1] — Auto-saved sessions (browser IndexedDB) + RESTORE button

### New
- Every snapshot is now written to the browser's **IndexedDB** in the
  background (fire-and-forget), keyed by `(ticker, expiry, greek, date)`.
  Survives server restarts, dashboard reloads, and tab refreshes.
- New **`RESTORE`** button next to `LOAD`. On startup, the button is
  enabled with the on-disk snap count for today's date matching the
  current ticker/expiry/overlay selection — e.g. `RESTORE (1842)`.
  Click to load. The button updates whenever the selectors change.
- Old sessions (any `dateYMD < today`) are auto-purged on startup so
  the database stays lean.
- All MaxCh detection modes (CUSUM presets and event detectors) work
  on restored data, since `meta.maxPriors` is part of the snapshot
  and survives the IDB round-trip.

### What it does NOT change
- Existing `SAVE` / `LOAD` JSON workflow is untouched. Use those for
  portable archives across machines / browsers.
- `CLEAR` only wipes the in-memory buffer; the IDB record remains so
  RESTORE can bring it back. Browser-level "clear site data" is the
  only way to delete persisted sessions outside of the next-day purge.
- Auto-save is always-on. There is no UI to disable it. Storage cost
  is bounded by the next-day purge.

### Notes
- Storage estimate: ~5 KB per snap × 28k snaps × ~5 ticker tuples
  = ~700 MB worst case before the daily purge. Most browsers handle
  this; if quota errors appear they're logged once and silenced (the
  live render path is never blocked).
- `LOAD` (file-based) still works for cross-device restore. The two
  mechanisms are complementary.

## [0.6.0] — MaxCh: event detectors (burst / swarm / pump)

### Why
The existing CUSUM presets are *persistence* detectors — they require
multi-second sustained activity before firing, which by design filters
out fast events like pumps. User reported that a clean ~16:09 pump
(7140 flipping pink → cyan) didn't light up MaxCh at all on `normal`.
Three new detectors complement the persistence layer by firing on sudden
coordinated activity, staying quiet in steady state.

### New detectors
- **`burst`** — velocity z-score on total firing magnitude. Tracks a
  sliding 60-snap mean and σ of `Σ |dir|` across all firing strikes;
  fires when the current snap exceeds `mean + 2.5σ`. Glyphs render at
  strikes contributing ≥ 15% of the spike. Catches activity surges
  anywhere in the chain. Quiet because it normalizes against the recent
  baseline.
- **`swarm`** — cluster detector. Fires when ≥ 2 same-sign firing
  strikes sit within ±5 price points of each other in the same snapshot,
  each ≥ 5% of session max-abs. Catches "sweep" patterns where flow
  lights up a row of adjacent strikes simultaneously — aggressive
  directional trading signature. Quiet because random single-strike
  noise rarely clusters.
- **`pump`** — strict combination: `burst` AND `swarm` AND cluster
  center within ±0.5% of latest spot. `burst` z lowered to 2.0 since
  combined. Designed for genuine pump precursors — coordinated near-spot
  directional surges. Will fire least often.

### Implementation
- All three modes share the per-snapshot bucket aggregation
  (`aggSnapBuckets`) and the rendering path (`renderSnapStates`) with
  the existing CUSUM presets. Each populates a `snapStates[k]` array of
  `{strike, state, mag}` entries; the helper draws halo'd glyphs at
  each (output-column, strike) pair.
- Dropdown gets an `<optgroup>` split between "Persistence" and "Event
  detectors" so the two families are visually distinct.
- Help-overlay docs include a new section explaining the detector
  triad, parameter rationale, and the "persistence vs event" distinction.

### Notes
- Event detectors and CUSUM presets are mutually exclusive in the
  dropdown — pick one. Future: could add side-by-side rendering, but
  starts to clutter the main view.
- Parameters (z, cluster size/range, near-spot %) are reasonable
  defaults but not literature-calibrated. Open question: ARL-style
  threshold calibration on a recorded session would tighten these.

### Debug instrumentation
- Temporary console logger added to `ingest()` for verifying the API's
  sign convention. Activate via `?dbg=STRIKE` URL param or
  `window.__dbgStrike = N`. Strip after the sign convention is verified
  against a clean event. Reminder is saved to the project memory store.

## [0.5.4] — `Col px = 1d` mode (fixed one-session layout)

### New
- **`Col px` dropdown gains `1d`**, sitting between `fit` and the sub-pixel
  options. Where `fit` auto-sizes to the *current buffer length* (so the
  view re-flows as data accumulates), `1d` fixes the layout to exactly
  one full US regular session: `6.5h × 3600s = 23,400` snaps. The width
  per snapshot is `drawW / 23400`, which on a typical screen lands at
  `colW ≈ 0.08` and triggers ~13:1 max-abs aggregation.
- Behavior:
  - Buffer smaller than a session → rendered data fills the right end
    only; left side stays empty as the session progresses.
  - Buffer larger than a session → only the most recent 23,400 snaps
    show (older data is past the visible left edge but stays in the
    minimap, which always shows the full buffer).
- New `SNAPS_PER_DAY = 23400` constant in `delta.html` for clarity.
- Help-overlay docs updated with the `1d` semantics.

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
