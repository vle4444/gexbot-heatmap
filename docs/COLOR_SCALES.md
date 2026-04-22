# Color Scale Modes

The **Color scale** dropdown in `delta.html` controls how raw GEX values
become colors. Every cell's color is computed from `value / denominator`;
the mode controls what that denominator is — and, critically, **whether
it's computed globally across the view (so the past repaints when it
changes) or per-column and frozen at paint time.**

Pick a mode based on the question you're trying to answer:

- "What's biggest *right now*, across everything on screen?" → **Unified**
- "What was biggest in *that* moment, preserved for comparison?" → **Trailing**
- "What's the shape of each moment's activity?" → **Snapshot only**
- "Where are we relative to the session's extreme?" → **Cumulative**
- "Filter out noise and dominant outliers?" → **Experimental**
- "Lock the scale for cross-session comparison?" → **Fixed cap**

---

## Unified scale — past repaints

All cells on screen share one denominator. When that denominator changes —
because a new large value shifts the max, or because you scroll and a
different set of snapshots becomes visible — every cell visibly restretches.

This is the behavior of traditional heatmaps. Useful when you want to compare
everything on screen on equal footing: a wall from 30 minutes ago and a wall
from 30 seconds ago are both colored against the same yardstick.

### Window: last 1 / 5 / 15 min

The denominator is `max(|v|)` over the trailing N minutes of data, applied
uniformly to the whole visible range. The window is anchored to the latest
snapshot, so as new data arrives, old data rolls out of the window, and the
denominator changes — potentially both growing (new high) and shrinking
(old high aged out).

This is what the original "Rolling" labels in earlier versions of this tool did.
Kept for continuity.

**When to use:** You care more about "what's hot right now" than about preserving
historical color fidelity. You're happy for the past to restretch as activity
changes.

**When not to use:** You want a stable visual record of what happened earlier.
The repaint behavior can be disorienting if you're watching a specific level
from minutes ago.

### Window: visible range

The denominator is `max(|v|)` over whatever is currently on screen. If you
scroll to a different time range, the max changes, hence all colors change.

**When to use:** You want the contrast on screen optimized for what you're
currently looking at, with no influence from off-screen data.

**When not to use:** You're scrolling a lot and want stable colors to anchor
your mental model of the chart.

---

## Trailing — past frozen

Each snapshot is normalized against its own trailing window. Once a column is
painted, its colors are locked — they depend only on data that existed at or
before that snapshot's timestamp.

**These are probably the modes you want for serious analytical work.** They
give you cross-time intensity meaning (a cell colored 80% bright means "at this
moment, this strike was 80% of the recent max") without the disorienting
repaint behavior of unified modes.

### Trailing max: last 1 / 5 / 15 min

Each snapshot's max is computed over *its own* preceding N minutes. The
denominator varies column-by-column, but each column's denominator is fixed
the moment it's painted.

The live-edge column still "twitches" as the trailing window slides forward
(the most recent column, by definition, has to include the freshest data),
but the moment a snapshot becomes historical, its colors are locked.

**When to use:** Default choice for most workflows. Preserves the past,
highlights each moment's activity relative to its own neighborhood.

**Caveat:** Two cells with equal absolute value at different times may render
different colors because each was judged against a different trailing
window. For direct absolute-magnitude comparison across widely separated
moments, use **Fixed cap**.

---

## Per-column — past frozen

### Snapshot only (self-normalize)

Each column's max is computed over only *its own* strike data. Every column
self-normalizes, so the brightest strike in every column always reaches full
saturation, no matter its actual magnitude.

**When to use:** You want to see the *shape* of the imbalance distribution
at each moment — which strikes are hotter than which — regardless of absolute
intensity. Useful for spotting rotation, migration, and structural changes
in positioning.

**When not to use:** You want to know when something "big" happens. A
snapshot with one −10 strike and a snapshot with one −1000 strike look
identical because both self-normalize to full saturation.

### Cumulative (session anchored)

Running max from earliest visible snapshot through each column. Monotonic
non-decreasing — once the max grows, it never shrinks.

Past colors can only ever dim, never brighten, and only when a new record
appears. A cell drawn on a quiet morning and captured at 80% brightness
stays at 80% brightness forever, until a new record-breaking value shows
up and proportionally dims everything before it.

**When to use:** You want a stable reference point for "how does this moment
compare to the extreme of the session so far." Good on calm days where
you want a record of the session's progression.

**When not to use:** The session has one dominant spike. Everything before
and after can get washed out by that single event.

---

## Experimental

### EMA (smoothed trailing, α=0.1)

Exponentially-weighted moving average of per-snapshot max, then each column
uses its EMA value as the denominator. Smooths out the frame-to-frame
twitching of trailing-max modes.

Alpha 0.1 means each new snapshot contributes 10% to the moving average;
the EMA responds in roughly 10 snapshot's time to a sustained change in
magnitude.

**Tradeoff:** Cleaner visual evolution than raw trailing max, at the cost of
being slightly slower to respond to genuine shifts in activity level. Past
is frozen.

### Trailing p95 (5 min)

95th percentile of |v| over trailing 5 min, instead of max. Ignores the
top 5% of values — typically single-snapshot outliers that would otherwise
dominate the scale.

**When to use:** The session has occasional extreme spikes that make
everything else hard to see. p95 effectively ignores those spikes and
normalizes against "typical" activity.

**Cost:** Per-column sort is O(n log n). Noticeable at 5-min windows with
1-second polling (300 snapshots × strikes per snapshot) but still fast.
Past is frozen.

### Log-compressed (visible range)

`max(|v|)` over visible range, but values pass through
`sign(v) · log(1+|v|) / log(1+max)` before mapping to color. Compresses
the top end and expands the bottom end.

**When to use:** One dominant wall would otherwise saturate the scale and
hide everything else. Log compression brings subdued activity into
visible range without manually capping.

**When not to use:** You need faithful linear magnitude representation — the
transform explicitly distorts the relationship between value and brightness.
Past repaints (shares Window: visible range's max behavior).

### Z-score per snapshot (±3σ)

Each cell colored by `(v − mean) / (3 × std)` within each snapshot,
clipped to ±1. Highlights statistical outliers within each moment's
distribution, not absolute magnitude.

**When to use:** You want "which strikes are unusual right now" rather
than "which strikes are big." Useful for detecting structural breaks.

**When not to use:** You want magnitude comparisons at all — this mode
throws magnitude information away by design. Past is frozen.

---

## Manual

### Fixed cap

Denominator is the number you type in the **Cap** field (appears when
this mode is selected). Never changes, ever.

**When to use:** Cross-session A/B comparison — save a session, load it
on a different day, and view both at the same Fixed cap for direct
color comparability. Also good for demoing or teaching where you want
consistent visuals.

**When not to use:** You're watching live and want colors to adapt to
current activity.

---

## Quick lookup: does the past repaint?

| Mode                          | Past repaints | Scope |
|-------------------------------|---------------|-------|
| Window: last 1 / 5 / 15 min   | **yes**       | trailing N min from latest |
| Window: visible range         | **yes**       | whatever's on screen |
| Trailing max: last 1/5/15 min | no            | trailing N min from each column |
| Snapshot only                 | no            | each column's own strikes |
| Cumulative                    | dims only     | from session start |
| EMA                           | no            | smoothed trailing |
| Trailing p95                  | no            | trailing 5 min, 95th %ile |
| Log-compressed                | **yes**       | visible range |
| Z-score                       | no            | each column's distribution |
| Fixed cap                     | never         | manual |
