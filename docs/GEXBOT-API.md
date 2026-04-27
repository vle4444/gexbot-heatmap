# GexBot API — Comprehensive Reference

_Compiled from upstream documentation (`Gexbot-State-Documentation.txt`,
`docs/GEXBOT-API-DOC.txt`) and project-internal knowledge from `server.js`,
`delta.html`, `index.html`, and `CLAUDE.md`. This file is intended to be
self-contained: an AI or developer should be able to build against the GexBot
API using only this document._

_Last reviewed: 2026-04-27._

---

## 1. Overview

GexBot is a hosted REST API that publishes options-market structure data —
gamma exposure (GEX), zero-gamma, major positive/negative levels, and
classified-orderflow Greek imbalances — for a fixed list of US stocks,
indexes, and futures. There is no streaming/websocket interface; clients
poll on an interval.

Two underlying models:

| Model | Endpoint family | Subscription | What it shows |
|---|---|---|---|
| **Classic** | `/{TICKER}/classic/...` | Classic | Net GEX (call − put) per strike, by volume and open interest. |
| **State** | `/{TICKER}/state/...` | State | Imbalanced-orderflow GEX and Greeks: net of classified imbalanced calls vs imbalanced puts. |

A separate **Historical** endpoint set exists on a different host, gated by
the **Quant** subscription.

---

## 2. Authentication

All endpoints require a Bearer token.

```
Authorization: Bearer gexbot_custom_<rest-of-key>
```

**Critical gotcha**: the literal string `gexbot_custom_` is part of the
**token value**, not a URL path segment. Putting it in the path will produce
404/400 responses that look like an endpoint mismatch. The full token goes
into the `Authorization` header verbatim.

**Required request headers**:

| Header | Value |
|---|---|
| `Authorization` | `Bearer <YOUR_API_KEY>` |
| `User-Agent` | Identify your client (e.g. `MyApp/1.0`). Required. |
| `Accept` | `application/json` |

`Accept-Encoding: gzip` is supported and recommended (see `pipeProxy` in
`server.js`).

**Server-side injection**: in this repo, the API key is held only by
`server.js` (read from `GEXBOT_API_KEY` env var or `.env`). Browser-side
code talks to local `/api/*` and `/histapi/*` paths; the proxy attaches the
`Authorization` header. The key never reaches the browser.

---

## 3. Hosts

| Purpose | Host |
|---|---|
| Live (Classic, State, Greeks) | `https://api.gexbot.com` |
| Historical (Quant) | `https://api.gex.bot` |

Note the different domains: `gexbot.com` (live) vs `gex.bot` (historical).

---

## 4. Subscription tiers

| Tier | Unlocks |
|---|---|
| Classic | `/{TICKER}/classic/...` (3 endpoints) + `/tickers` |
| State | All Classic + `/{TICKER}/state/...` (3 endpoints) + State Greeks |
| Quant | All State + historical endpoint on `api.gex.bot` |

The `/tickers` endpoint requires a valid Bearer token but no specific tier
beyond what's needed for any other call.

---

## 5. Aggregation periods

The `{AGGREGATION_PERIOD}` path parameter selects which expiries are
included in the GEX calculation:

| Value | Meaning |
|---|---|
| `zero` | 0DTE only — options expiring today. |
| `one` | 1DTE only — options expiring tomorrow's session. |
| `full` | All listed expiries combined. |

Greeks endpoints accept **only `zero` and `one`** — there is no `full`
variant for Greeks. Greeks are exposed as a single combined path:
`/{TICKER}/state/{greek}_{zero|one}` (e.g. `delta_zero`, `gamma_one`,
`charm_one`, `vanna_zero`).

---

## 6. Polling guidance

GexBot does not document a published refresh cadence or rate-limit ceiling.
Empirically, the upstream snapshot updates roughly once per second. The
`delta.html` and `index.html` dashboards in this repo poll at 1 s by default
and expose a UI selector for 2 / 3 / 5 s.

If you build a long-running client, default to **≥ 1 s** between polls per
ticker and back off on 4xx/5xx. Do not retry tighter than the upstream
generation cadence — you'll just get duplicate `timestamp` values back.

---

## 7. Endpoint reference

All examples assume the headers from §2.

### 7.1 `GET /tickers`

Lists every ticker the API can serve. No path/query parameters.

**Response shape**:

```json
{
  "stocks":  ["AAPL", "AMD", ...],
  "indexes": ["SPX", "VIX", "NDX", "RUT"],
  "futures": ["ES_SPX", "NQ_NDX"]
}
```

Use this to validate ticker symbols at startup. Futures use the
`<root>_<index>` convention (e.g. `ES_SPX`).

---

### 7.2 Classic — GEX chain

```
GET /{TICKER}/classic/{full|zero|one}
```

Tier: **Classic**. Full ladder of net GEX per strike, by volume and OI.

**Response fields**:

| Field | Type | Notes |
|---|---|---|
| `timestamp` | int64 | Unix seconds, UTC. |
| `ticker` | string | Echo of the requested symbol. |
| `min_dte` | int | Days-to-expiration of the nearest expiry included. |
| `sec_min_dte` | int | DTE of the next-nearest expiry. |
| `spot` | float | Underlying spot at calculation time. |
| `zero_gamma` | float | Spline-interpolated zero-gamma level (volume-based). |
| `major_pos_vol` | float | Strike with largest positive GEX (volume). |
| `major_pos_oi` | float | Strike with largest positive GEX (OI). |
| `major_neg_vol` | float | Strike with largest negative GEX (volume). |
| `major_neg_oi` | float | Strike with largest negative GEX (OI). |
| `strikes` | array | See "Strikes array" below. |
| `sum_gex_vol` | float | Total volume-based net GEX summed across strikes. |
| `sum_gex_oi` | float | Total OI-based net GEX summed across strikes. |
| `delta_risk_reversal` | float | **Discontinued.** Always `0` or stale; do not use. |
| `max_priors` | array | See "Max priors array" below. |

**Strikes array** — each entry is:

```
[ strike, gex_by_volume, gex_by_oi, priors ]
```

`priors` is a 5-element array of historical GEX values for that strike. The
**cadence is undocumented upstream**; given the surrounding `max_priors`
intervals (1/5/10/15/30 min), a matching cadence is plausible but
**unverified**. Treat as opaque historical context.

**Max priors array** — 6 entries, each `[strike, gex_value]`, in this fixed
order: current cycle, 1-min, 5-min, 10-min, 15-min, 30-min.

---

### 7.3 Classic — majors only

```
GET /{TICKER}/classic/{full|zero|one}/majors
```

Tier: **Classic**. Slim version of 7.2 with no `strikes`, no `max_priors`.

**Response fields**:

| Field | Type | Notes |
|---|---|---|
| `timestamp` | int64 | |
| `ticker` | string | |
| `spot` | float | |
| `mpos_vol` | float | Same as `major_pos_vol` in 7.2. |
| `mpos_oi` | float | Same as `major_pos_oi`. |
| `mneg_vol` | float | Same as `major_neg_vol`. |
| `mneg_oi` | float | Same as `major_neg_oi`. |
| `zero_gamma` | float | |
| `net_gex_vol` | float | Net GEX, volume-based. |
| `net_gex_oi` | float | Net GEX, OI-based. |

Use this when you only need the level lines (e.g. a header indicator) and
don't want to pay the bandwidth of the full ladder.

---

### 7.4 Classic — max change

```
GET /{TICKER}/classic/{full|zero|one}/maxchange
```

Tier: **Classic**. The "max priors" data on its own.

**Response fields**:

| Field | Type | Description |
|---|---|---|
| `timestamp` | int64 | |
| `ticker` | string | |
| `current` | `[strike, value]` | Largest GEX change in the most recent calculation cycle. |
| `one` | `[strike, value]` | Largest change in last 1 min. |
| `five` | `[strike, value]` | Last 5 min. |
| `ten` | `[strike, value]` | Last 10 min. |
| `fifteen` | `[strike, value]` | Last 15 min. |
| `thirty` | `[strike, value]` | Last 30 min. |

---

### 7.5 State — GEX profile

```
GET /{TICKER}/state/{full|zero|one}
```

Tier: **State**. Same shape as the Classic chain (7.2) with two important
differences:

1. The State model is **volume-only** (built from classified orderflow). The
   `_oi` fields are present in the response but always `0` — do not use them.
2. `gex_by_volume` represents the **GEX imbalance** (net of imbalanced calls
   minus imbalanced puts), not a raw volume-weighted GEX.

The fields that are always zero in State responses: `major_pos_oi`,
`major_neg_oi`, `sum_gex_oi`, `delta_risk_reversal`, and the third element
(OI) of each entry in `strikes`. Build clients to ignore these in State mode
rather than rendering them as legitimate zeros.

`zero_gamma` is also reported as `0` in State mode (the spline is a Classic
model concept). Render the State zero-gamma from `/state/.../majors`'s
`zero_gamma` only if non-zero, or compute your own.

---

### 7.6 State — majors only

```
GET /{TICKER}/state/{full|zero|one}/majors
```

Tier: **State**. Same shape as 7.3, with `mpos_oi`, `mneg_oi`, `zero_gamma`,
and `net_gex_oi` reported as `0` (not applicable to the State model).

---

### 7.7 State — max change

```
GET /{TICKER}/state/{full|zero|one}/maxchange
```

Tier: **State**. Identical shape to 7.4 (`current`/`one`/`five`/`ten`/`fifteen`/`thirty`),
but values represent **GEX imbalance change**, not raw GEX change.

---

### 7.8 State — Greeks

```
GET /{TICKER}/state/{GREEK}
```

Tier: **State**. `{GREEK}` is one of:

```
delta_zero   gamma_zero   charm_zero   vanna_zero
delta_one    gamma_one    charm_one    vanna_one
```

There is **no `_full` variant** for Greeks. The combined token (Greek name +
expiry bucket) is a single path segment.

> **Note on the upstream example**: the official doc shows
> `GET https://api.gexbot.com/SPX/state/delta` as an example, which
> contradicts the parameter table. The table form (`delta_zero`, `delta_one`,
> etc.) is the one used by this dashboard and is what works in practice.

**Response fields**:

| Field | Type | Description |
|---|---|---|
| `timestamp` | int64 | |
| `ticker` | string | |
| `spot` | float | |
| `min_dte` | int | |
| `sec_min_dte` | int | |
| `major_positive` | float | Strike with largest positive exposure for this Greek. |
| `major_negative` | float | Strike with largest negative exposure. |
| `major_long_gamma` | float | Strike with largest long customer gamma. |
| `major_short_gamma` | float | Strike with largest short customer gamma. |
| `mini_contracts` | array | See below. |

**`mini_contracts` array** — each entry has the shape:

```
[ strike, call_ivol, put_ivol, greek_value, priors, ?, ? ]
```

- `priors` is a 3-element history of `greek_value` for this strike (cadence
  undocumented; almost certainly different from the 5-element `priors` in
  Classic/State chain responses).
- The **trailing two fields are `null` in all observed samples** and their
  semantics are **undocumented**. Treat as reserved/opaque.

---

### 7.9 Historical (Quant tier, separate host)

```
GET https://api.gex.bot/v2/hist/{TICKER}/state/{cat}/{YYYY-MM-DD}
```

Tier: **Quant**. The response is **not** the state data itself — it's a
pre-signed S3 URL. Fetch that URL to get the actual JSON archive for that
day.

`{cat}` mirrors the live State path's category (e.g. `zero`, `one`,
`full`, or a Greek bucket).

**Two-step flow** as implemented in `server.js` + `index.html`:

1. `GET /v2/hist/...?noredirect` — returns JSON describing the archive,
   including a presigned URL.
2. `GET <presigned-url>` — returns the historical JSON. **Do not** send
   your `Authorization` header to the presigned S3 URL; it would leak your
   GexBot key to AWS. The proxy in `server.js` (`/fetch?url=…`) is the
   reference pattern for this.

This endpoint is currently unused at runtime in this repo (no Quant
subscription).

---

## 8. Common gotchas

| # | Gotcha | Mitigation |
|---|---|---|
| 1 | `gexbot_custom_` is part of the token, not the URL. | Put the entire token in the `Authorization` header. |
| 2 | Many State fields are reported as the literal value `0`, not `null` or omitted. | Treat State `_oi` and `zero_gamma` as "not applicable" rather than data. |
| 3 | The API's precomputed `major_pos_*` / `major_neg_*` levels can drift away from the `strikes` array (e.g. label sits on a wrong-color bar). | If you render majors against your own ladder, **derive them locally** from the strikes array. See `computeMajors()` in `delta.html`. |
| 4 | JavaScript `\|\|` coerces numeric `0` as falsy, which silently drops legitimate zero-strike values. | Use `??` for any numeric financial field (strike, price, greek). |
| 5 | Greek path is a single segment (`delta_zero`), not two (`/delta/zero`). | Build paths as `/state/${greek}_${period}`. |
| 6 | Presigned S3 URLs returned by the historical endpoint must **not** be called with your Bearer token. | Strip `Authorization` before fetching the presigned URL. |
| 7 | `delta_risk_reversal` is always present in responses but is a discontinued metric. | Ignore it. |
| 8 | Greeks have no `_full` aggregation. | Don't request `gamma_full`; it doesn't exist. |

---

## 9. Open questions (undocumented upstream)

These are flagged here so future work can verify and update:

1. **`priors` cadence (chain endpoints)** — 5 elements per strike, cadence
   not stated. Plausibly 1/5/10/15/30 min by analogy with `max_priors`.
2. **`mini_contracts` trailing `null` fields (Greeks endpoint)** — purpose
   unknown, always `null` in observed samples.
3. **Rate limits** — no explicit ceiling published. 1-second polling is
   tolerated.
4. **Error contract** — observed status codes in normal operation: `200`,
   `401` (bad/missing token), `404` (unknown ticker, malformed path).
   `429`/`5xx` behavior not characterized.

---

## 10. Reference: server proxy pattern (this repo)

For local dashboards, route browser requests through a small proxy so the
key stays server-side:

| Browser path | Upstream | Auth injected? |
|---|---|---|
| `/api/<anything>` | `https://api.gexbot.com<anything>` | yes |
| `/histapi/<anything>` | `https://api.gex.bot<anything>` | yes |
| `/fetch?url=<presigned>` | the presigned S3 URL verbatim | **no** |
| `/config` | (local) reports `{authConfigured, keyPrefix}` | n/a |

See `server.js` for the full implementation (~140 lines, no dependencies).

---

## 11. Quick recipe — minimal Node client

```js
const KEY = process.env.GEXBOT_API_KEY;            // gexbot_custom_...
const headers = {
  'Authorization': `Bearer ${KEY}`,
  'User-Agent':    'MyApp/1.0',
  'Accept':        'application/json',
};

async function gex(ticker, period = 'zero') {
  const r = await fetch(
    `https://api.gexbot.com/${ticker}/state/${period}`,
    { headers }
  );
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

// Poll every 1s
setInterval(async () => {
  const snap = await gex('SPX', 'zero');
  console.log(snap.spot, snap.major_pos_vol, snap.major_neg_vol);
}, 1000);
```
