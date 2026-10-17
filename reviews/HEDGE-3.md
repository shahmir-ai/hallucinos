# HEDGE-3 — `auto` vs unhedged, alternated, with the trigger alive

2026-09-17, ~20:50–21:05 PKT. HANDOFF-5 #2: "BAKEOFF-4's verdict (leave `/` on
`cerebras-oss120`) was reached against a hedge that fired on every generation.
Re-run the alternating protocol with `HEDGE_AFTER_MS_BOOT=1200` before the
verdict is treated as final."

**Instrument:** `scripts/hedge-probe.mjs`, extended this pass to take comma
lists for `--engine` and `--kind` and to **alternate** the arms one generation
at a time. That matters more than anything else in this file: HEDGE-2 measured
the same provider at 798 ms and 1,047 ms of median TTFB four minutes apart, and
the architect photographed 2.1–4.7 s the same afternoon. Two runs half an hour
apart measure the hour, not the engine.

Heads only — no kernel, no browser, no images, `FAL_KEY` blank. Ports 8793 and
8794 (never 8799; `dist/play.js` untouched).

**Spend: $0.137** — $0.107 for the 40-generation main run, $0.031 for the
16-generation control. Raw rows: `reviews/hedge-4-arms.json`,
`reviews/hedge-5-notrigger.json`.

---

## Run A — 40 generations, `HEDGE_AFTER_MS_BOOT=1200`, `HEDGE_AFTER_MS=900`

`--engine=auto,cerebras-oss120 --kind=boot,page --n=10`, interleaved.

| arm | n | hedged | median first document | p100 first document | median provider TTFB | **$/generation** | total |
|---|---|---|---|---|---|---|---|
| `boot` / **auto** | 10 | 6 | 1,408 ms | 2,504 ms | 1,380 ms | **$0.002525** | $0.0253 |
| `boot` / cerebras-oss120 | 10 | — | **980 ms** | **1,498 ms** | 922 ms | **$0.001990** | $0.0199 |
| `page` / **auto** | 10 | 5 | 929 ms | **2,105 ms** | 925 ms | **$0.003347** | $0.0335 |
| `page` / cerebras-oss120 | 10 | — | **801 ms** | 2,311 ms | 799 ms | **$0.002791** | $0.0279 |

**0 missing documents, 0 truncations, 0 identity fallbacks, 0 errors in 40.**

- **`auto` costs +27% on a boot and +20% on a page.** That is the number
  BAKEOFF-4 reported as +55% against a trigger that fired on everything; with
  the trigger alive it is roughly half that, and it is still a real premium.
- **`auto` bought no speed.** Its median first document was *worse* in both
  kinds, and its boot p100 was worse by a second (2,504 vs 1,498 ms). The one
  place it won was the page p100, by 206 ms (2,105 vs 2,311) — one draw.
- **The primary won 19 of 20 routed generations**, continuing a streak that now
  stands at 49 of 50 across HEDGE-1/2/3.

### The two payouts, and they are the first ones worth looking at

HANDOFF-5 #3 was "`or-oss120-groq` has never won a document worth judging".
This run produced both halves of the answer:

| row | what happened |
|---|---|
| boot #3 | **failover**: the lane that inked first was not the one that finished. Primary TTFB 2,495 ms, loser aborted at 2,495 ms, client got a 1,851-character boot document at 2,504 ms. $0.00288 |
| page #5 | **Groq won a page** — 4,349 characters, first document at 2,105 ms, Cerebras aborted at 2,101 ms having produced **0 output tokens**. $0.00374 |

So the insurance does pay: 1 failover and 1 hedge win in 40. Both are still
**unlooked-at** — heads-only probes produce no screenshot — so #3 is not closed,
it is now *specific*: `reviews/hedge-4-arms.json` row 5 of the page arm is a
real Groq document and the cheapest way to judge the hedge is to open
`/bakeoff/run?engine=or-oss120-groq` once and look at it.

---

## Run B — the control that says the routed path itself is free

Run A's slow rows were all hedged rows, and the interleaving made that
suspicious: `auto` drew 4 boots above 2,000 ms while the `cerebras-oss120` arm
running *between* them drew none. Two explanations fit — either the routed code
path costs something (the 64-character in-process hold, H2's commit point), or
the trigger selects slow draws by construction. One cheap run separates them:
same alternating protocol, `HEDGE_AFTER_MS_BOOT=HEDGE_AFTER_MS=60000`, so the
routed path and the hold are fully exercised and **no second lane can start**.

| arm | n | hedged | median first document | p100 | median TTFB | $/generation |
|---|---|---|---|---|---|---|
| `boot` / auto (trigger disarmed) | 8 | **0** | 1,313 ms | **1,548 ms** | 1,256 ms | $0.001939 |
| `boot` / cerebras-oss120 | 8 | — | 1,119 ms | 2,029 ms | 1,113 ms | $0.001895 |

**The two arms are indistinguishable** — 764–1,548 ms against 761–2,029 ms, and
$0.00194 against $0.00190 (2%, which is the routed path's `Math.max` of the two
engines' `max_tokens` showing up in the reservation, not in the bill).

So: **routing is free, the commit hold is free, and every cost and every slow
row in run A belongs to the second lane.** That also means run A's median
comparison is confounded and should not be quoted on its own: the trigger fires
precisely on the draws where the primary is slow, so "hedged rows are slower"
is partly a definition. What survives the confound is the money (token
accounting, not clocks) and the p100 on `boot`.

---

## Recommendation for `/`

**`DEFAULT_ENGINE=cerebras-oss120`. Unchanged, and now for a measured reason
rather than an inherited one.**

BAKEOFF-4's verdict stands, on better evidence than BAKEOFF-4 had: with a
working trigger `auto` is 20–27% dearer, is not faster at the median in either
kind, is worse at the boot p100, and its primary wins 19 of 20. A 20–27%
premium for insurance that paid out twice in 40 generations is a judgement call,
and the thing it insures — a provider having a bad hour — is not what `/` needs
protection from first. What `/` needs is the cheapest fast path, because the
boot screen is the product (SPEC §12.1) and because HANDOFF-5 #1 (the app window
that paints nothing) is a bigger threat to a visitor than a slow provider.

`auto` stays **the lever, not the default**: it is what `/bakeoff` offers, what
a bad afternoon is switched to, and the only thing in the tree that covers a
provider outage. `ROUTING=off` remains the one-variable kill switch.

### The one decision left to the architect

**The code default for `HEDGE_AFTER_MS_BOOT` is still `0`** (SERVER-v03's seam
ruling: "the first second is the product"). Three runs now say 0 is strictly
worse than 1,200 — it buys a second full input pass on **every** boot
($0.00280 vs $0.00195, HEDGE-2) for a primary that has won 49 of 50 — and this
pass deliberately did not change it, because the brief asked for a
recommendation and a documentation change, not a new default. The
recommendation is **1,200**, and until someone changes the code, `auto` is only
safe to deploy with the variable set explicitly. `.env.example` and `DEPLOY.md`
now say that in as many words.

### Open, for the next pass

1. **Look at the Groq page.** `hedge-4-arms.json`, page arm row 5: 4,349
   characters that no human has read. That, plus one
   `/bakeoff/run?engine=or-oss120-groq` boot, closes HANDOFF-5 #3.
2. **The `boot` tail asymmetry in run A is not fully explained.** Run B rules
   out the routed path and the hold, and the selection effect explains most of
   it, but 4 of 10 above 2,000 ms against 0 of 10 interleaved is still a
   surprising draw. If it recurs, the mechanism to test is whether parsing a
   second SSE stream on the same event loop delays the timestamp we put on the
   primary's chunks (`firstContentAt` is stamped when our loop *processes* a
   chunk, not when the byte arrives).
3. **`auto` has still never been measured on a bad hour**, which is the only
   hour it exists for. Every run so far — HEDGE-1, 2, 3 — has been on a provider
   doing 0.8–1.4 s. The measurement that would actually justify the premium is
   one taken at 2–5 s, and it cannot be scheduled.

### Traps

- **Alternate the arms or measure nothing.** Two sequential runs of this probe
  half an hour apart would have produced a 30% difference from the provider's
  mood alone.
- **An absurd parameter value is still the cheapest instrument here.** Run B
  cost 3 cents and removed two hypotheses that reading `hedge.ts` had not
  settled — the same trick that found the dead trigger at `--n=2`
  `HEDGE_AFTER_MS_BOOT=60000`.
- **Do not quote run A's median column alone.** The trigger selects slow draws;
  the cost column is the one that is not confounded.
