# Concepts — Options Exposure Metrics

A theory reference for everything the dashboards visualize: open interest, orderflow classification, the Greek exposures (delta, gamma, vanna, charm), and the profile/orderflow views built on top of them.

This document is a cleaned-up, deduplicated, and notation-consistent version of the methodology described in the upstream GexBot documentation. Where this project's conventions differ from textbook conventions, those deviations are flagged explicitly.

> **For the API surface**, see [GEXBOT-API.md](./GEXBOT-API.md).
> **For dashboard controls**, see [CONTROLS.md](./CONTROLS.md).
> **For color-scale modes**, see [COLOR_SCALES.md](./COLOR_SCALES.md).

---

## Table of Contents

1. [Why options exposure matters](#1-why-options-exposure-matters)
2. [Measuring "how many"](#2-measuring-how-many)
3. [The Greek exposures](#3-the-greek-exposures)
4. [Profile views](#4-profile-views)
5. [Orderflow (time-series) views](#5-orderflow-time-series-views)
6. [Aggregate metrics](#6-aggregate-metrics)
7. [Reading the tape: regimes and pinning](#7-reading-the-tape-regimes-and-pinning)
8. [Conventions and deviations](#8-conventions-and-deviations)
9. [Glossary](#9-glossary)
10. [References](#10-references)

---

## 1. Why options exposure matters

Options are levered, convex instruments. They allow market participants to express views on direction *and* volatility with high capital efficiency, and they have made up an increasing proportion of equity-market activity in recent years.

An option is a contract between a buyer and a seller. The seller takes on a **convex liability** — payoffs that are non-linear in the underlying — which a responsible market-maker will hedge by trading the underlying. When option positioning is large enough relative to the notional traded in the underlying, that hedging flow itself becomes a meaningful driver of underlying price action. The "gamma squeeze" is the most dramatic case of this feedback loop, but the same mechanic operates continuously in all directions.

To analyze this effect, we need answers to two questions:

1. **How much option exposure is out there, and where?**
2. **How will that exposure translate into hedging flows?**

The first question is harder than it sounds. The second is what the Greek exposures are designed to answer.

---

## 2. Measuring "how many"

### 2.1 Open interest (OI)

After each trading day, the **OCC (Options Clearing Corporation)** tallies orders "to open" and orders "to close" and reports the result before the next session. That tally — open interest — is the most reliable measure of how many contracts are outstanding at each strike and expiry.

**Limitations:**

- OI is published once per day, after the close. It is not available intraday.
- OI tells you the *count* of open contracts but not which side initiated them. Because options spreads are wide and most fills happen at or near the mid, time & sales data alone cannot reliably classify a trade as opening or closing, or as buyer- vs. seller-initiated.

### 2.2 Volume as a proxy

An intermediate workaround is volume. Wherever **daily volume exceeds OI**, we know that net new contracts have entered the system that day, which gives a rough idea of where (and how much) intraday hedging has to take place.

Volume is a noisy proxy — it cannot distinguish opens from closes, and rolls inflate it without changing exposure — but it is available in real time and useful as a lower-bound estimate of fresh activity.

### 2.3 Orderflow classification

A more sophisticated approach is to think like a market-maker. Almost every retail and institutional order routes through one. The market-maker is indifferent to whether your order is to open or to close — they care about how it affects their inventory. If you buy, they must locate a seller; if you sell, they must locate a buyer. As long as matches are easy, inventory stays balanced. When matches are *not* easy — when demand on one side outpaces supply on the other — the market-maker must move their price to clear the imbalance. Otherwise, they accumulate convex inventory, which is dangerous.

**The classification idea:** by monitoring how market-maker quotes and aggressor-side fills behave in real time, we can infer whenever demand outpaces supply (or vice versa) at each strike, even without knowing the open/close split. Over the course of a session, those classified imbalances accumulate into a picture of unmatched inventory that *must* be hedged in the underlying. In quant terms, this is monitoring the volatility surface.

This is the engine that powers the **State** endpoints and the orderflow-classified views in this project.

---

## 3. The Greek exposures

Once we have a measure of "how many" (whether by OI, volume, or classified imbalance), we translate it into **shares of the underlying required to hedge** by multiplying by the relevant Greek and the contract multiplier (100). To make magnitudes comparable across underlyings and through time, we further multiply by the spot price to express the result in **dollars of notional hedge**.

In all formulas below:

- `Δ` — delta, the rate of change of option price with respect to underlying price
- `γ` — gamma, the rate of change of delta with respect to underlying price
- `OI` — open interest at the strike (or, for State endpoints, classified imbalance)
- `S` — spot price of the underlying
- `100` — the contract multiplier for standard equity/index options

### 3.1 Delta exposure (DEX)

Delta measures how much an option's price moves per **$1** change in the underlying. By convention, delta is positive for calls and negative for puts.

```
DEX (per strike) = 100 × Δ × OI × S
```

The interpretation: if all option holders at this strike were perfectly delta-hedged, this is the **dollar notional of underlying** they would need to hold. Multiplying by `S` converts the share count into capital, which makes magnitudes comparable across tickers.

When the underlying moves 1%, the notional hedge required scales by approximately 1% as well — *approximately*, because deltas themselves change as spot moves. That second-order effect is gamma.

**Sign convention.** In the customer-positioning view used throughout this project:

- Long calls and short puts → **positive** customer delta
- Short calls and long puts → **negative** customer delta

### 3.2 Gamma exposure (GEX)

Gamma is the **acceleration of delta** — the rate at which delta changes as spot moves. Long options (whether calls or puts) have positive gamma; short options have negative gamma.

For a $1 move in the underlying, the additional shares required to remain delta-neutral at a given strike are `100 × γ × OI`. Multiplying by `S` converts that to a dollar hedge. To get a metric that is directly proportional to a **1% move** in the underlying — which is what most traders actually think in — we multiply the dollar hedge by `S × 0.01`:

```
GEX (per strike) = 100 × γ × OI × S² × 0.01
```

This is the standard "$GEX per 1% move" convention used across the industry.

**Reading GEX:**

- A strike with **positive net GEX** means the dominant holders are long gamma there. As spot approaches that strike, hedgers buy low and sell high, dampening volatility — these strikes act like magnets or pinning levels.
- A strike with **negative net GEX** means the dominant holders are short gamma. Hedgers buy high and sell low, amplifying volatility — these strikes accelerate moves once breached.

### 3.3 Vanna exposure

**Vanna** measures the rate of change of delta with respect to **implied volatility (IV)**, rather than with respect to spot.

Implied volatility expresses option prices in terms of the move in the underlying they imply, normalized for time to expiration. By convention IV is quoted as an annualized 1-standard-deviation move: an at-the-money IV of 20% on a $100 underlying implies a roughly $20 range above or below current price over the next 365 days. Like option prices, IVs change as expectations change.

A useful intuition: think of an increase in IV as equivalent to *adding more time to expiration*, and a decrease as equivalent to *taking time away*.

| Position | Moneyness | Effect of ↑ IV on P(ITM) | Effect on \|Δ\| | Vanna |
|----------|-----------|--------------------------|----------------|-------|
| Call     | OTM       | ↑                        | ↑              | **+** |
| Call     | ITM       | ↓                        | ↓              | **−** |
| Put      | OTM (below spot) | ↑                | ↑ (more negative) | **−** |
| Put      | ITM (above spot) | ↓                | ↓ (less negative) | **+** |

Working through the cases for both calls and puts produces a clean rule: **for long options, vanna is positive above spot and negative below spot, regardless of option type.** Short positions invert this.

#### Vanna exposure: this project's convention

The textbook definition of vanna exposure measures the share-and-capital impact of a **1-point increase in IV** (e.g., 20% → 21%):

```
Vanna exposure (textbook) = 100 × vanna × OI × S      [per +1pt IV]
```

This embeds an awkward assumption: it treats every strike's IV as moving in lockstep, which almost never holds. On any given day, 0DTE IVs collapse to zero while 1DTE IVs typically drift slightly higher.

**Because this project focuses on short-dated options, it uses a different normalization.** Rather than modeling a 1-point IV bump, we model the impact of **IV collapsing to zero** — that is, the capital required to hedge the position if every contract were to expire. We do this by multiplying the per-point vanna exposure by each strike's current IV, with a sign flip:

```
"−vanna ex" (per strike) = 100 × vanna × OI × S × (−IV)
```

The result is intuitive: it gives the dollar hedging pressure that will play out as the option goes to expiry, on a per-strike basis. Magnitudes can be directly compared to GEX and DEX, and the metric is consistent across strikes. The trade-off is that the value is **expiry-specific** — "−vanna ex" for 0DTE refers to the impact of expiry today; "−vanna ex" for 1DTE refers to the impact of expiry tomorrow. To compare across expiries, see charm.

> **Convention deviation flag.** This is the one place where the project's metric definitions diverge from textbook usage. The deviation is intentional and is justified by the focus on near-dated expiries.

### 3.4 Charm exposure

**Charm** — sometimes called *delta decay* — measures how delta changes as **time to expiration** decreases. It has the opposite sign structure to vanna:

| Moneyness | \|Δ\| as time runs out | Charm |
|-----------|------------------------|-------|
| OTM       | ↓ (decays toward 0)    | depends on call/put sign |
| ITM       | ↑ (toward ±1)          | depends on call/put sign |

The intuition is straightforward: as expiry approaches, ITM options behave more and more like the underlying (\|Δ\| → 1), while OTM options decay toward worthlessness (\|Δ\| → 0).

#### Charm exposure formula

`100 × charm × OI` gives shares per *year* of delta decay. To produce something traders can act on intraday, we normalize to **shares per hour** by dividing by `365 × 24`, then multiply by spot to get dollar terms:

```
Charm exposure (per strike) = (100 × charm × OI × S) / (365 × 24)     [$/hour]
```

This approximates the hourly hedging pressure assuming all other variables (spot, IV) are held constant.

**Unlike vanna exposure, charm exposure can be aggregated across expiries** — every expiry's contribution is in the same units ($/hour), so 0DTE charm and 1DTE charm can be summed directly.

---

## 4. Profile views

The profile views render exposure as a **ladder histogram across strikes** — one bar per strike, with sign encoded by direction (right = positive, left = negative). They show the *shape* of positioning at a single point in time.

### 4.1 GexBot Classic — OI- and volume-based GEX

GexBot Classic displays **GEX by OI** and **GEX by volume** as a strike-by-strike ladder. At each strike, call GEX is netted against put GEX. Bars to the right indicate net call GEX; bars to the left indicate net put GEX.

The plot embeds **lookback dots** showing GEX values at intervals into the past, plus a slider for scrubbing through the day's history.

**Key levels** (calculated from GEX-by-volume, with OI-based versions also shown in the side panel):

- **Zero gamma** — the strike where net GEX crosses zero; the center of the complex
- **Major positive gamma** — the strike with the largest positive net GEX
- **Major negative gamma** — the strike with the largest negative net GEX
- **Max-change strikes** — the strikes with the largest GEX change over the last 1 / 5 / 15 / 30 minutes

**Three expiry scopes:**

- `full` — all expiries within 90 days
- `latest` — the nearest expiry only
- `next` — the following expiry

### 4.2 GEX profile (State) — orderflow-imbalance GEX

Where Classic uses OI or volume, the **GEX profile** uses the orderflow-classified imbalance from the State engine. The methodology:

1. The profile measures the **net imbalance** of transactions so far that day. If one customer buys an option and another customer sells it, neither shows up — they cancel. The chart only renders excess demand or excess supply.
2. The conventional framing focuses narrowly on dealer positioning and assumes only dealers hedge dynamically. In practice, customers also reposition themselves toward their optimal incentives in aggregate, so dealer-only thinking captures only half the picture.
3. Wherever there is a net imbalance, *someone* on the other side is forced to adjust, regardless of whether that someone is dealer or customer.
4. The GEX profile therefore nets imbalanced calls against imbalanced puts (irrespective of dealer vs. customer) to surface strikes with imbalanced exposure. Call imbalance renders to the right; put imbalance renders to the left.

This view makes it easy to distinguish:

- **High-gamma nodes** (targets / pinning levels)
- **Low-gamma nodes** (transition zones)
- **Call-dominated vs. put-dominated regimes**

Same expiry scopes as Classic (`full`, `latest`, `next`) and the same lookback / history-slider / major-level controls.

### 4.3 DEX ladder

The DEX ladder takes the day's net transaction imbalance and renders **delta exposure at each strike** as a single signed bar:

```
Customer long calls and short puts  →  positive delta
Customer short calls and long puts  →  negative delta
```

The DEX ladder is the **options-market analog of an order book**. Heavy net short interest above spot reads like a passive limit seller stacked above price — a warning sign. Heavy net long interest below spot reads like a passive limit buyer — supportive. Transition points between heavy short and heavy long interest signal probable targets and reversion zones.

A glance at the DEX ladder is also a fast way to read *bias* on flow-driven underlyings (e.g., SPY): how aggressively are participants positioned today, and in which direction?

**Why DEX matters more in high-vol environments:** as volatility rises, the gamma curve flattens, which strengthens the relationship between delta and realized price movement. As liquidity dries up, the delta of a transaction becomes increasingly relevant, so DEX gets more weight relative to GEX in turbulent conditions.

### 4.4 Convexity ladder

The convexity ladder takes the day's net transaction imbalance and renders **net gamma exposure** of those positions per strike. Long calls and long puts both contribute long customer gamma; short calls and short puts both contribute short customer gamma.

The "convexity" framing emphasizes what the chart actually means at a behavioral level:

- **Positive convexity** (customers long convexity): Customers benefit from moves that *exceed* expectations. They want price travelling as far away from these strikes as possible.
- **Negative convexity** (customers short convexity): Customers benefit from moves that *underperform* expectations. They want price approaching and resting at these strikes.

The convexity ladder is less about direction and more about **risk topology**. A canonical setup: a single strike of negative convexity dwarfs all others as spot hovers just above. Being short convexity in a crowded place can produce cascading panic if given a small shove. The shove may never come, but the map tells you where the risk is.

#### Convexity ladder as terrain map

| Volatility regime | Positive convexity zone | Negative convexity zone |
|-------------------|-------------------------|--------------------------|
| Falling vol (most common) | Stalls price | Soars right through |
| Rising vol        | Glides through          | Stalls at it             |

In both regimes, transition points between positive and negative convexity act as **pivots**, where incentives change and traders reshuffle.

#### Convexity ladder as volatility-environment indicator

- **Significant, well-distributed negative convexity:** liquid markets — traders are happy to sell options. (Concentrated negative convexity is the exception and is the riskiest setup.)
- **Significant, well-distributed positive convexity:** elevated, well-informed expectation of volatility. Typically appears ahead of event-driven days.

#### Pinning

As the close approaches, **0DTE negative convexity (dealer-long-gamma strikes) acts as a magnet for price**, driven by vanna and charm flows accelerating in the same direction. This is the standard pinning mechanic.

---

## 5. Orderflow (time-series) views

Where the profile views show *shape across strikes at one point in time*, the orderflow views show *aggregates through the session* using time on the x-axis. Both are powered by the orderflow-classification engine.

Two flavors of subplot:

- **"Orderflow" subplots** — measure and report the delta and gamma of each incoming order in real time, classified as long or short. Useful for highlighting transition points in direction or volatility.
- **"Net" subplots** — sum across all strikes to give a snapshot of total positioning at each moment. Useful for sanity-checking whether the options complex is in line with price action.

All equations and visualizations are framed in terms of **paper (customer) positioning**.

### 5.1 GEX orderflow

```
GEX orderflow = (call GEX imbalance) − (put GEX imbalance)
```

A bar up indicates that call GEX imbalance has grown (more "right-side green" on the GEX profile); a bar down indicates that put GEX imbalance has grown (more "left-side red").

**Reading GEX orderflow:**

- Positive GEX orderflow shifts the regime toward **call-dominated gamma**. This is *not* a simple buy signal. It adds convexity to the upside (a rally would go further) while *elevating* the probability that spot drifts down — the expected return distribution becomes negatively skewed but with fatter upside tails. The opposite holds for negative GEX orderflow.
- GEX orderflow marks high-gamma transactions, which carry larger payoffs and greater risk. It tends to highlight **high-conviction pivots**.
- On indexes like SPX, which are structurally dominated by short customer gamma, positive GEX orderflow can mark unwind events — short sellers covering rather than fresh longs — and is therefore especially worth examining in context.

### 5.2 DEX orderflow

```
DEX orderflow = (bullish volume × Δ) − (bearish volume × Δ)
```

Where:

- Bullish volume = long calls **or** short puts
- Bearish volume = short calls **or** long puts

DEX orderflow translates incoming options activity into a directional **share-equivalent** flow: "someone just bought/sold this many shares' worth of options here." Significant prints highlight levels of interest. Large transactions tell us aggressive new positions are being established or that liquidations are taking place.

A local bottom is often marked either by an aggressive bullish print (a buyer stepping in) *or* by aggressive bearish prints (a long forced to liquidate). Reading DEX orderflow against price action distinguishes those two cases.

### 5.3 Convexity orderflow

```
Convexity orderflow = (long orderflow × γ) − (short orderflow × γ)
```

The most useful interpretation comes from cross-referencing convexity orderflow with DEX orderflow:

| DEX orderflow | Convexity orderflow | Implied transaction |
|---------------|---------------------|---------------------|
| **+** (bullish) | **−** (short γ)   | Short put           |
| **+** (bullish) | **+** (long γ)    | Long call           |
| **−** (bearish) | **−** (short γ)   | Short call          |
| **−** (bearish) | **+** (long γ)    | Long put            |

This lets you read the options profile without inspecting the ladder.

More generally, convexity orderflow indicates whether participants are wagering on **more** or **less** near-term volatility:

- Positive convexity orderflow → participants buying options → expecting more volatility
- Negative convexity orderflow → participants selling options → expecting less volatility

Sell-offs are often accompanied by consistently positive convexity orderflow (demand for hedging/volatility). Grinding-up and squeeze sessions often feature persistently negative convexity orderflow (volatility supply as participants sell into the move).

---

## 6. Aggregate metrics

These compress the ladder views into single time-series numbers, useful for at-a-glance regime assessment.

### 6.1 Net GEX

```
Net GEX = (total call GEX imbalance) − (total put GEX imbalance)
```

Net GEX is the GEX profile collapsed to one number:

- **Net GEX > 0, large** — more holders of call gamma than put gamma; upside convexity dominates
- **Net GEX < 0, large in absolute value** — more holders of put gamma than call gamma; downside convexity dominates

**Reading net GEX in conjunction with the profile shape:**

- Upside convexity high and rising, bars roughly equal across strikes → **squeeze likely**
- Upside convexity high and rising, but a single bar above price predominates → **look for reversion at that strike**
- Downside convexity decreasing (deeply negative), bars roughly equal → **selloff likely**
- Downside convexity decreasing, single bar below price predominates → **look for reversion at that strike**

Read alongside net convexity (next), this tells you at a glance whether the gamma exposure was *bought* (upside-skewed long convexity) or *sold* (paid for via put writing) and how it is distributed.

### 6.2 Net convexity

```
Net convexity = (total customer long GEX) − (total customer short GEX)
```

Net convexity measures option **buying vs. selling** in aggregate:

- **Positive (high) net convexity** — participants expect more near-term volatility than is currently priced in
- **Negative (low) net convexity** — participants expect less near-term volatility than is currently priced in

Because of the well-known **inverse correlation between equity-index spot and IV** (the leverage effect), low net convexity is *mildly constructive on underlying price*: when participants are net selling options, vol is suppressed and drift tends to be positive. Very high net convexity, indicating high demand for options, typically only appears during **panic regimes**.

### 6.3 Net vanna and net charm (beta)

> See vanna/charm ladder views. These metrics are in beta.

```
Net charm = (charm exposure across all strikes)            [$MM/hour]
Net vanna = −(vanna exposure across all strikes)           [$MM until expiry]
```

Both approximate the **passive hedging pressure** that will be generated by today's transactions as time progresses toward expiration:

- **Positive** → customers will gain delta (get longer) into expiry → dealers must buy underlying to stay neutral → **bullish passive flow into expiry**
- **Negative** → customers will lose delta (get shorter) into expiry → dealers must sell to stay neutral → **bearish passive flow into expiry**

#### Worked example

Suppose the only positions on the ladder are customer-sold OTM calls (customers are short, dealers are long). As expiry approaches, the value of those OTM calls evaporates — customers become *less short*, and dealers become *less long*. To stay neutral, dealers buy the underlying. Net charm and net vanna are both positive, signaling **bullish passive flow from dealers into expiry**. These flows would cease (or reverse) if spot approached the short call strikes and they became at-the-money.

#### Timing and magnitude

Both timing and magnitude matter. Empirically, on SPX:

- Net vanna becomes relevant **above ~$800MM in magnitude**, typically during the last hour
- Above **~$1000MM in magnitude**, effects extend into the last few hours
- **Extreme days** typically feature intraday reversals as traders front-run unwinding positioning. In these cases, net vanna and especially net charm tend to *accompany and accelerate* the move rather than oppose it.

These thresholds are heuristic and require some discretion, but the gap between extreme and moderate days is consistent enough to be useful.

---

## 7. Reading the tape: regimes and pinning

A few synthesizing observations that tie the views together:

### 7.1 Long-gamma vs. short-gamma regimes

When net GEX is significantly **positive**, dealers are net long gamma. They buy underlying weakness and sell underlying strength to stay delta-neutral, which **suppresses realized volatility**. Days in long-gamma regimes tend to be quiet, mean-reverting, and pin around major positive GEX strikes.

When net GEX is significantly **negative**, dealers are net short gamma. They buy strength and sell weakness, which **amplifies realized volatility**. Days in short-gamma regimes tend to feature trending moves, momentum acceleration, and breakouts through major negative GEX strikes.

The **zero gamma** level marks the inflection between these two regimes and is one of the most-watched levels in this framework.

### 7.2 The pinning mechanic

Pinning toward the close — particularly on monthly OPEX and on heavy 0DTE days — is driven by the combination of three forces concentrated at high-OI strikes:

1. **Gamma hedging** (dealer long-gamma rebalancing pulls price toward the strike)
2. **Charm flow** (delta decay accelerates into the close, amplifying the gamma effect)
3. **Vanna flow** (IV crush as expiry approaches further accelerates dealer rebalancing)

The **convexity ladder** shows where these three forces will concentrate. A single dominant negative-convexity strike at-or-near spot in the final hour is the canonical pinning setup.

### 7.3 Volatility-environment readouts

Cross-referencing the ladders gives a high-level read on the volatility environment:

| Convexity profile | Interpretation |
|-------------------|----------------|
| Significant, well-distributed negative convexity | Liquid market, traders happy to sell options |
| Concentrated negative convexity at one strike | Risky setup — pinning candidate or accident-in-waiting |
| Significant, well-distributed positive convexity | Elevated, well-informed expectation of volatility (often pre-event) |

---

## 8. Conventions and deviations

This project follows mainstream GEX/DEX/vanna/charm conventions used across the industry (SqueezeMetrics, SpotGamma, the academic literature). The math is standard.

**One intentional deviation:** vanna exposure is normalized to "−vanna ex" — the capital required to hedge IV collapsing to zero — rather than the textbook 1-point IV bump. This is justified by the focus on short-dated expiries, where the textbook framing (uniform IV move across strikes) is least accurate. See [§3.3](#33-vanna-exposure) for the full rationale.

**Customer-positioning frame:** all formulas and visualizations are stated in terms of customer (paper) positioning. To translate to dealer positioning, flip the sign.

**Sign conventions for delta and gamma:**

- Long calls: +Δ, +γ
- Short calls: −Δ, −γ
- Long puts: −Δ, +γ
- Short puts: +Δ, −γ

**Spot-relative vanna:** for long positions, vanna is positive above spot and negative below spot regardless of call/put. Short positions invert this.

---

## 9. Glossary

| Term | Definition |
|------|------------|
| **0DTE / 1DTE** | Zero / one days to expiration |
| **Aggressor side** | The side of a trade that crossed the spread to execute (lifted the offer or hit the bid) |
| **Charm** | ∂Δ/∂t — rate of change of delta with respect to time decay |
| **Convexity** | Non-linearity of payoff with respect to the underlying. Long options have positive convexity; short options have negative convexity |
| **Delta (Δ)** | ∂V/∂S — rate of change of option value with respect to underlying price |
| **DEX** | Delta exposure — share or dollar hedge implied by current delta positioning |
| **Gamma (γ)** | ∂²V/∂S² — rate of change of delta with respect to underlying price |
| **GEX** | Gamma exposure — share or dollar hedge that *changes* per unit move in the underlying |
| **IV** | Implied volatility — annualized 1σ move implied by option price |
| **Major positive / negative gamma** | The strikes with the largest positive / negative net GEX |
| **OCC** | Options Clearing Corporation — publishes daily OI |
| **OI** | Open interest — number of outstanding contracts at a strike, settled daily |
| **OPRA** | Options Price Reporting Authority — consolidated US options market data feed |
| **Orderflow classification** | Inferring whether a print represents net buying or selling pressure based on quote and aggressor data |
| **Vanna** | ∂Δ/∂σ — rate of change of delta with respect to implied volatility |
| **Volatility surface** | The IV at each strike and expiry; a 2D function that real-time orderflow modifies continuously |
| **Zero gamma** | The strike where net GEX crosses zero — the center of the complex |

---

## 10. References

- **Cboe** — equity options market structure and growth statistics
- **Hau Volatility** — volatility surface monitoring as the foundation for orderflow inference
- **Perfiliev** — derivation of the standard GEX-per-1%-move formula
- **Ni, Pearson, & Poteshman (2005)** — *"Stock Price Clustering on Option Expiration Dates"*, the canonical academic treatment of the pinning effect
- **GexBot upstream documentation** — see [GEXBOT-API.md](./GEXBOT-API.md) for the API surface and [the upstream metric definitions](https://www.gexbot.com)

---

*Last reviewed: 2026-04-27. Cross-checked against standard options-market conventions and the upstream GexBot methodology.*
