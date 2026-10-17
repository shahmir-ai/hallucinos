# HEDGE-1 — ten routed boots on the real providers

2026-09-17, 18:59 PKT (the bad hour the architect measured at 18:40). Ten
`kind=boot` generations through `POST /api/gen` with `engine=auto`, heads only —
no desktop, no app, no page, no images. `node scripts/hedge-probe.mjs --n=10
--port=8793 --out=reviews/hedge-1-boots.json`; raw rows in
`reviews/hedge-1-boots.json`.

Route under test (`engines.json` → `routes.default`):
**primary `cerebras-oss120`, hedge `or-oss120-groq`**, `HEDGE_AFTER_MS_BOOT=0`
(both lanes start at once on boot and desktop).

**Spend: $0.0282 for ten boots** against the $0.50 ceiling — $0.0028 a boot, of
which the losing lane's billed input is ~$0.0008 (29%).

## Every boot

| # | winner | client first `<!doctype` | winner provider TTFB | loser aborted at | total | tokens out | loser tokens (in/out) | $ |
|---|---|---|---|---|---|---|---|---|
| 0 | **or-oss120-groq** | 1,901 ms | 1,629 ms | 1,672 ms | 2,777 ms | 799 | 5,439 / 0 | 0.00263 |
| 1 | cerebras-oss120 | 895 ms | 825 ms | 825 ms | 1,028 ms | 951 | 5,447 / 0 | 0.00279 |
| 2 | cerebras-oss120 | 789 ms | 769 ms | 784 ms | 946 ms | 870 | 5,443 / 0 | 0.00273 |
| 3 | cerebras-oss120 | 1,131 ms | 1,055 ms | 1,065 ms | 1,209 ms | 1,077 | 5,449 / 0 | 0.00288 |
| 4 | cerebras-oss120 | 1,038 ms | 1,010 ms | 1,010 ms | 1,130 ms | 1,472 | 5,447 / 0 | 0.00315 |
| 5 | cerebras-oss120 | 777 ms | 718 ms | 728 ms | 936 ms | 867 | 5,448 / 0 | 0.00274 |
| 6 | cerebras-oss120 | 793 ms | 741 ms | 741 ms | 939 ms | 783 | 5,455 / 0 | 0.00268 |
| 7 | cerebras-oss120 | 1,373 ms | 1,267 ms | 1,276 ms | 1,681 ms | 1,229 | 5,465 / 0 | 0.00299 |
| 8 | cerebras-oss120 | 728 ms | 674 ms | 674 ms | 887 ms | 888 | 5,460 / 0 | 0.00275 |
| 9 | cerebras-oss120 | 857 ms | 811 ms | 811 ms | 1,051 ms | 1,023 | 5,462 / 0 | 0.00285 |

Medians: **first document 895 ms**, provider TTFB 825 ms, total 1,051 ms.
Hedged 10 of 10. Failovers 0. Documents missing 0. Truncated 0. Identity
fallbacks 0.

## What it says

1. **The mechanism fires, and it earned its keep once in ten.** Boot 0 is the
   whole argument: Cerebras had not produced a content token at 1.6 s, Groq had,
   and the visitor got Groq's boot screen at 1,901 ms instead of waiting for
   whatever Cerebras was going to do. Nine times out of ten the primary won and
   the hedge was money; the tenth is the afternoon the architect photographed.
2. **The loser is aborted on the winner's first content token, near enough.**
   `loser_aborted_ms` equals the winner's provider TTFB to within 15 ms on nine
   of ten rows — the commit point (64 content characters) is reached inside the
   same chunk almost every time, so the "hold the head in this process" design
   costs nothing measurable. Every loser billed **input only**: 5,439-5,465
   tokens in, 0 out, because the abort lands before its first token.
3. **The hedge costs 29% and buys the tail.** $0.0028 a boot against $0.0020
   unhedged. Per SPEC §1.8's $25/day that is ~8,900 boots a day rather than
   12,500 — and nobody's first screen depends on one provider's afternoon.
   `HEDGE_AFTER_MS=900` on `app` and `page` means those pay the hedge only when
   the primary is actually slow, so a full session is nowhere near +29%.
4. **The raised boot budget is already visible.** Four of ten boots wrote more
   than 1,000 completion tokens (max 1,472) with `finish_reason=stop` and no
   truncation. Under the old 800 every one of those would have been cut off mid
   document — which is the blank/half-painted boot screen HANDOFF-4 led with.
   See `scripts/boot-budget.mjs` and SERVER-v03 §2 for the measurement that
   authorised the raise.
5. **Nothing silently degraded.** `identity_fallback` 0 of 10, so the I1 gate
   parsed the model's own comment every time, including on the Groq win — the
   two lanes get the identical prompt and the identity comment survives the
   swap.

## What this does not prove

- **A hedge on `app` and `page` is untested on the real providers.** The probe
  can do it (`--kind=page`) and it was not run: the boot is where the blank
  screen was, and the budget for this pass went to ten boots plus the budget
  probe.
- **One bad-hour sample.** Ten boots inside two minutes is one draw from one
  afternoon; the win split will move. What is pinned is that a bad primary
  cannot hold the first screen any more, which is a property of the mechanism
  rather than of the sample.
- **`or-oss120-groq` has never been judged as a product engine** (BAKEOFF-3
  issue 9 / HANDOFF-4 #5). It is the same `gpt-oss-120b` weights, so its
  documents are the same shape, but the one boot it won here was not looked at
  by a human. `/bakeoff/run?engine=or-oss120-groq` still bypasses routing and
  hedging, which is exactly how it should be judged.
