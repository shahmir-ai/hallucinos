# HEDGE-2 — the hedge trigger was inoperative, and what it costs once it works

2026-09-17, ~20:00 PKT (the bad evening; the architect measured
`cerebras-oss120` at 2.1–4.7 s of provider TTFB at 18:40 and 0.55–0.7 s the
same morning). BAKEOFF-4 ranked "`HEDGE_AFTER_MS_BOOT` at 0 is what makes
`auto` expensive" as #3 and asked for a measurement of a 600–900 ms trigger.
The measurement found a bug instead.

`node scripts/hedge-probe.mjs --n=10 --port=8793`, `kind=boot`, heads only,
route `cerebras-oss120` primary / `or-oss120-groq` hedge.
**Spend: $0.079 across 32 boots** (three tens and one control pair).

## The bug: the trigger did nothing

| HEDGE_AFTER_MS_BOOT | boots | hedged | $/boot | loser input tokens |
|---|---|---|---|---|
| 700 (before the fix) | 10 | **10/10** | $0.00275 | 54,504 |
| 60,000 (control, before the fix) | 2 | **2/2** | $0.00276 | 10,876 |

A trigger of a minute hedged both boots. `server/hedge.ts`'s `chooseLane` read
the primary as beaten when it had *content under the 64-character commit
threshold* —

```
const primaryDone = primaryLane && (primaryLane.done || (primaryLane.chars > 0 && primaryLane.chars < need));
```

— and a real engine's first chunk is a handful of tokens, so that clause fired
on the primary's **first chunk**, at its TTFB, on every stream. `HEDGE_AFTER_MS`
(900, `app`/`page`) and `HEDGE_AFTER_MS_BOOT` were both dead letters: every
routed generation in HEDGE-1 and in BAKEOFF-4 started two lanes, which is where
BAKEOFF-4's "+55% on the bill, 8% of generations" came from.

It passed its unit test because the fake upstream yields the whole document in
one chunk, which clears 64 characters on the first yield. Fixed
(`primaryDone = primaryLane.done`, i.e. only a primary that **ended** without a
usable document is overtaken before the trigger) plus two tests that stream in
12-character chunks the way a provider does.

## After the fix

| HEDGE_AFTER_MS_BOOT | boots | hedged | median first document | median provider TTFB | $/boot | loser input |
|---|---|---|---|---|---|---|
| 0 (HEDGE-1, 18:59) | 10 | 10/10 | 895 ms | 825 ms | $0.00280 | 54,466 |
| **700** | 10 | **7/10** | 1,072 ms | 1,047 ms | **$0.00256** | 38,166 |
| **1,200** | 10 | **0/10** | 861 ms | 798 ms | **$0.00195** | 0 |

- An unhedged boot is **$0.0019**, a hedged one **$0.0028**: the hedge is +47%
  on the boots it fires on and nothing on the boots it does not.
- 0 failovers, 0 documents missing, 0 identity fallbacks, 0 truncations in all
  30 boots. The primary won every single one — `or-oss120-groq` has not beaten
  Cerebras once in 30 boots since HEDGE-1's boot 0.
- The two runs straddle the provider's own mood (median TTFB 1,047 ms at 20:05,
  798 ms at 20:09), which is why 1,200 hedged nothing: **that is the point of a
  trigger.** The insurance is still armed for the 2.1–4.7 s afternoon; it just
  is not bought on a normal one.

## Recommendation

`HEDGE_AFTER_MS_BOOT=1200`, `HEDGE_AFTER_MS=900` as shipped. On this hour that
is the unhedged price with the tail still covered, and it makes BAKEOFF-4's
verdict ("`auto` costs 55% more and buys nothing measurable") a statement about
a broken trigger rather than about hedging. Re-run BAKEOFF-4's alternating
protocol before `auto` becomes the default on `/`; the cost column will be a
different number now.

Raw rows: `reviews/hedge-2-boots.json` (700), `reviews/hedge-3-boots.json`
(1,200), `reviews/hedge-1-boots.json` (0, HEDGE-1).
