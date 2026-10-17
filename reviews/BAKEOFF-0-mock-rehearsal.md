# BAKEOFF-0 — mock rehearsal (SPEC §7)

**This is not a judging run.** It is `scripts/bakeoff.mjs` driven end to end on the
`mock` engine, at $0, to prove the harness does what SPEC §7 asks before any real
money is spent. The numbers below are the mock's, and mean nothing about any
model. The first real run writes `reviews/BAKEOFF-1.md`.


Run 2026-09-17T01:01:35.065Z
`node scripts/bakeoff.mjs --engines=mock --boots=2`

2 boots per engine. Per boot: identity → boot screen → desktop, then 4 apps
(`browser`, `calculator`, `notes`, `store`) and 5 URL visits inside the browser (google.com home, a search for
"best pizza in town", the first result of that search, reddit.com/r/cats, netflix.com,
en.wikipedia.org/wiki/Moon).

Every per-generation number is read from the server's own stdout telemetry line
(`contract_ok`, `ttfb_ms`, `total_ms`, `tok_per_s`, `tokens_in/out`, `usd`); the
HUD was photographed at every step as an independent witness. A render counts as
**broken** if the frame was blank, if its body carried no CSS at all, if a JS
error fired while it loaded, or if it never arrived. Shots:
`reviews/shots-bakeoff/<engine>/<boot>/<step>.png`.

| engine | boots | contract miss | boot paint ms (med) | desktop ms (med) | ttfb ms (med) | tok/s (med) | broken renders | $/session |
|---|---|---|---|---|---|---|---|---|
| `mock` | 2 | 0% (0/10) | 280 | 861 | 11 | 3414 | 0% (0/20) | $0.0000 |

"$/session" is one boot with its apps and pages — what one visitor costs. A console
error that is the CSP refusing a generated document's network call is counted
separately ("network blocked by CSP" below): that is the sandbox working, not a
broken render, though a high number says the model keeps reaching for the web.

## `mock`

| kind | n | ttfb ms (med) | total ms (med) | tok/s (med) | tok in (avg) | tok out (avg) | contract ok | errors | $ |
|---|---|---|---|---|---|---|---|---|---|
| identity | 2 | 14 | 121 | 845 | 719 | 97 | — | 0 | $0.0000 |
| boot | 2 | 10 | 117 | 3409 | 2783 | 391 | — | 0 | $0.0000 |
| desktop | 2 | 10 | 263 | 3587 | 4180 | 930 | 2/2 | 0 | $0.0000 |
| app | 8 | 11 | 115 | 3374 | 3696 | 370 | 8/8 | 0 | $0.0000 |
| page | 12 | 11 | 155 | 3475 | 3764 | 613 | — | 0 | $0.0000 |

### Per boot

| boot | machine | boot paint ms | desktop ms | contract | injected | blank | unstyled | JS errors | network blocked by CSP |
|---|---|---|---|---|---|---|---|---|---|
| 1 | HALCYON 1 | 280 | 861 | ok | 0 | 0 | 0 | 0 | 165 |
| 2 | GLASSHOUSE 14 | 207 | 807 | ok | 0 | 0 | 0 | 0 | 165 |

### Renders

Wall-clock ms, measured from the click to the document going quiet; it carries about
1.5 s of the harness's own settle polling, so compare engines with it, not the
generation times in the table above.

| boot | step | ms | chars | how | flags | address shown |
|---|---|---|---|---|---|---|
| 1 | app `browser` | 2056 | 36 | launcher | ok | — |
| 1 | app `calculator` | 2054 | 177 | launcher | ok | — |
| 1 | app `notes` | 2050 | 208 | launcher | ok | — |
| 1 | app `store` | 2053 | 215 | launcher | ok | — |
| 1 | url-1-google-home | 0 | 130 | home | ok | `https://google.com/` |
| 1 | url-2-search | 1630 | 1264 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 1 | url-3-first-result | 1738 | 301 | https://fathom0.com/fathom-guide | ok | `https://fathom0.com/fathom-guide` |
| 1 | url-4-reddit | 1738 | 395 | navigate | ok | `https://reddit.com/r/cats` |
| 1 | url-5-netflix | 1737 | 264 | navigate | ok | `https://netflix.com/` |
| 1 | url-6-wikipedia | 1738 | 297 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 2 | app `browser` | 2052 | 34 | launcher | ok | — |
| 2 | app `calculator` | 2060 | 175 | launcher | ok | — |
| 2 | app `notes` | 2045 | 208 | launcher | ok | — |
| 2 | app `store` | 2049 | 214 | launcher | ok | — |
| 2 | url-1-google-home | 0 | 135 | home | ok | `https://google.com/` |
| 2 | url-2-search | 1632 | 1289 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 2 | url-3-first-result | 1612 | 286 | https://lark0.com/lark-guide | ok | `https://lark0.com/lark-guide` |
| 2 | url-4-reddit | 1753 | 398 | navigate | ok | `https://reddit.com/r/cats` |
| 2 | url-5-netflix | 1734 | 269 | navigate | ok | `https://netflix.com/` |
| 2 | url-6-wikipedia | 1740 | 297 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |

JS errors (first few): none

HUD at the end of the last boot:

```
engine   mock
last     app
ttfb     12 ms
tok/s    3374
tokens   3763 in / 388 out
gen $    0.00000
contract ok
app store
session $ 0.00000
```

---

## Funniness and variety — for a human

This harness does not score taste. Open the shots and fill this in.

### `mock`

Machines it invented:

- boot 1: **HALCYON 1** v2.1 — _a static machine_ · shots `reviews/shots-bakeoff/mock/1/`
- boot 2: **GLASSHOUSE 14** v6.0 — _a cobalt machine_ · shots `reviews/shots-bakeoff/mock/2/`

Funny? _____ / 5 · Varied across boots? _____ / 5 · Would you screenshot it? _____

Notes:

> 

## Verdict

Pick the top two or three by contract-miss rate, desktop time and $/session; then play with them on `/bakeoff?engine=<id>` before deciding. Taste breaks ties, numbers do not.
