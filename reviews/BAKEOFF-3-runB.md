# BAKEOFF-3-runB (SPEC §7)

Run 2026-09-17T12:19:48.937Z
`node scripts/bakeoff.mjs --engines=cerebras-oss120,anthropic-haiku --boots=4,1 --report=BAKEOFF-3-runB`

4×`cerebras-oss120`, 1×`anthropic-haiku` boots. Per boot: identity → boot screen → desktop, then 4 apps
(`browser`, `calculator`, `notes`, `store`) and 5 URL visits inside the browser (google.com home, a search for
"best pizza in town", the first result of that search, reddit.com/r/cats, netflix.com,
en.wikipedia.org/wiki/Moon).

A step (one app open, one page load) is abandoned as a timeout after 60 s.

Every per-generation number is read from the server's own stdout telemetry line
(`contract_ok`, `ttfb_ms`, `total_ms`, `tok_per_s`, `tokens_in/out`, `usd`); the
HUD was photographed at every step as an independent witness. A render counts as
**broken** if the frame was blank, if its body carried no CSS at all, if a JS
error fired while it loaded, or if it never arrived. Shots:
`reviews/shots-bakeoff/3-runB/<engine>/<boot>/<step>.png`.

| engine | boots | contract miss | boot paint ms | desktop interactive ms | desktop revealed ms | ttfb ms | tok/s | broken renders | $/session (gen + img) |
|---|---|---|---|---|---|---|---|---|---|
| `cerebras-oss120` | 4 | 0% (0/17) | 1101 | 5201 | 5335 | 923 | 806 | 14.7% (5/34) | $0.0232 + $0.0097 = **$0.0329** |
| `anthropic-haiku` | 1 | 0% (0/3) | 0 | 29677 | 29962 | 1403 | 119 | 0% (0/10) | $0.1867 + $0.0060 = **$0.1927** |

## §12.1 targets

Boot-screen paint < 1.0 s · desktop interactive < 4.0 s · app content < 2.5 s · page < 2.5 s.
Boot paint and desktop-interactive are the kernel's own numbers (`data-os-desktop-ms`
is stamped when the desktop is wired, before the boot overlay's §12.3 2.5 s floor
lifts). App and page are wall clock from the click to the document going quiet,
which carries ~1.0-1.5 s of this harness's own settle polling — so they are an
upper bound; the generations' own first-paint marks are in the second pair of
columns.

| engine | boot paint (<1s) | desktop interactive (<4s) | app (<2.5s) | page (<2.5s) | app first paint | page first paint | boot provider ttfb |
|---|---|---|---|---|---|---|---|
| `cerebras-oss120` | 1.10 s MISS | 5.20 s MISS | 2.83 s MISS | **2.14 s** PASS | 1017 ms | 642 ms | 2474 ms |
| `anthropic-haiku` | **0.00 s** PASS | 29.68 s MISS | 13.31 s MISS | 15.86 s MISS | 1801 ms | 1260 ms | 1338 ms |

## §12.3 archetype compliance

Judged on the mounted desktop, not on the attribute: where the bar actually sits,
whether the launchers form a grid of labelled icons rather than a list, whether a
clock is there and ticks. "patched" means the kernel had to inject the hook, which
is a contract miss the model made good on paper.

| engine | boot | archetype | bar edge | clock | ticks | launchers | layout | clipped | icons filled | wallpaper |
|---|---|---|---|---|---|---|---|---|---|---|
| `cerebras-oss120` | 1 | taskbar | bottom | yes | yes (seconds) | 16/16 labelled | 8×2 grid | 0 | 0/20 | slot |
| `cerebras-oss120` | 2 | dock | bottom | yes | yes (seconds) | 16/16 labelled | 11×3 grid | 0 | 16/20 | slot |
| `cerebras-oss120` | 3 | taskbar | bottom | yes | yes (seconds) | 16/16 labelled | 8×2 grid | 0 | 16/20 | slot |
| `cerebras-oss120` | 4 | dock | bottom | yes | yes (minutes) | 16/16 labelled | 12×3 grid | 0 | 16/17 | **none** |
| `anthropic-haiku` | 1 | taskbar | bottom | yes | yes (minutes) | 16/16 labelled | 4×4 grid | 0 | 16/20 | slot |

## §12.4 identity variety

Every machine this run invented, in order. A repeated name or a repeated
archetype-plus-era across boots of the same engine is the failure §12.4's dice
exist to prevent.

| engine | boot | name | version | era | archetype | tagline |
|---|---|---|---|---|---|---|
| `cerebras-oss120` | 1 | **HGT7** | 1.3.0‑rc1 (Falcon) | 1960s tram workshop | taskbar | Steam‑Safe Interface |
| `cerebras-oss120` | 2 | **panel7** | 1.2.0-rc3 (copper) | 2020s customs shed | dock | Customs Shed Console |
| `cerebras-oss120` | 3 | **Holliday** | 2.0.1 (4RC2) | 1950s tram workshop | taskbar | Steady tracks, steady code |
| `cerebras-oss120` | 4 | **Ashford** | 1.3.0-rc3 [Cobaltine] | 2090s glassblowing works | dock | Precision in every pixel |
| `anthropic-haiku` | 1 | **Linen Fold** | 3.2.1 SP2 | 2010s hospital laundry operations | taskbar | Hospital Laundry Management System |

- `cerebras-oss120`: 4/4 distinct names · archetypes taskbar, dock, taskbar, dock

- `anthropic-haiku`: 1/1 distinct names · archetypes taskbar

## §12.5 images

| engine | image calls | per boot | $ images | $ per image | blocked/failed |
|---|---|---|---|---|---|
| `cerebras-oss120` | 25 | 6.3 | $0.0390 | $0.0016 | 18 |
| `anthropic-haiku` | 2 | 2.0 | $0.0060 | $0.0030 | 0 |

| engine | img kind | n | ok | median ms | not delivered (reason × n) |
|---|---|---|---|---|---|
| `cerebras-oss120` | wallpaper | 4 | 3 | 4523 | img timeout × 1 |
| `cerebras-oss120` | icons | 4 | 3 | 8365 | img timeout × 1 |
| `cerebras-oss120` | photo | 16 | 1 | 3021 | img timeout × 15 |
| `cerebras-oss120` | faces | 1 | 0 | 0 | img timeout × 1 |
| `anthropic-haiku` | icons | 1 | 1 | 5794 | — |
| `anthropic-haiku` | wallpaper | 1 | 1 | 8181 | — |

Whether the wallpaper fits the era and whether the icon sheet is legible at 64 px
is a human's call on the shots — see the taste section at the end.

"$/session" is one boot with its apps and pages — what one visitor costs. A console
error that is the CSP refusing a generated document's network call is counted
separately ("network blocked by CSP" below): that is the sandbox working, not a
broken render, though a high number says the model keeps reaching for the web.

## `cerebras-oss120`

| kind | n | ttfb ms (med) | total ms (med) | tok/s (med) | tok in (avg) | tok out (avg) | contract ok | errors | $ |
|---|---|---|---|---|---|---|---|---|---|
| boot | 4 | 2476 | 2537 | 747 | 5322 | 787 | — | 0 | $0.0075 |
| desktop | 4 | 1687 | 2219 | 719 | 8495 | 1595 | 4/4 | 0 | $0.0129 |
| mark | 40 | 0 | 0 | 0 | 0 | 0 | — | 0 | $0.0000 |
| img | 25 | 0 | 3021 | 0 | 0 | 0 | — | 18 | $0.0390 |
| page | 18 | 674 | 1377 | 1028 | 5571 | 1447 | — | 0 | $0.0430 |
| app | 13 | 1007 | 2092 | 670 | 5033 | 1430 | 13/13 | 0 | $0.0292 |

### Per boot

| boot | machine | boot paint ms | interactive ms | revealed ms | contract | injected | blank | unstyled | JS errors | network blocked by CSP |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | HGT7 | 3534 | 5413 | 6391 | ok | 0 | 0 | 0 | 1 | 0 |
| 2 | panel7 | 808 | 2898 | 3323 | ok | 0 | 0 | 0 | 1 | 0 |
| 3 | Holliday | — | 5201 | 5335 | ok | 0 | 0 | 0 | 1 | 0 |
| 4 | Ashford | 1101 | 3210 | 3830 | ok | 0 | 2 | 2 | 1 | 0 |

### Renders

Wall-clock ms, measured from the click to the document going quiet; it carries about
1.5 s of the harness's own settle polling, so compare engines with it, not the
generation times in the table above.

| boot | step | ms | chars | how | flags | address shown |
|---|---|---|---|---|---|---|
| 1 | app `browser` | 4841 | 0 | launcher | ok | — |
| 1 | app `calculator` | 1617 | 96 | launcher | ok | — |
| 1 | app `notes` | 3227 | 132 | launcher | ok | — |
| 1 | app `store` | 2022 | 925 | launcher | ok | — |
| 1 | url-1-google-home | 405 | 88 | home | ok | `https://google.com/` |
| 1 | url-2-search | 3651 | 1817 | form | 1 js | `https://google.com/search?q=best%20pizza%20in%20town` |
| 1 | url-3-first-result | 1741 | 1240 | https://bestpizzatown.com/ | ok | `https://bestpizzatown.com/` |
| 1 | url-4-reddit | 2140 | 709 | navigate | ok | `https://reddit.com/r/cats` |
| 1 | url-5-netflix | 1742 | 488 | navigate | ok | `https://netflix.com/` |
| 1 | url-6-wikipedia | 2949 | 2735 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 2 | app `browser` | 1620 | 7 | launcher | ok | — |
| 2 | app `calculator` | 2426 | 73 | launcher | ok | — |
| 2 | app `notes` | 4042 | 123 | launcher | ok | — |
| 2 | app `store` | 2832 | 861 | launcher | 1 js | — |
| 2 | url-1-google-home | 404 | 79 | home | ok | `https://google.com/` |
| 2 | url-2-search | 2034 | 1538 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 2 | url-3-first-result | 1615 | 848 | https://redbrickpizzeria.com/menu | ok | `https://redbrickpizzeria.com/menu` |
| 2 | url-4-reddit | 2545 | 917 | navigate | ok | `https://reddit.com/r/cats` |
| 2 | url-5-netflix | 1736 | 431 | navigate | ok | `https://netflix.com/` |
| 2 | url-6-wikipedia | 2142 | 2106 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 3 | app `browser` | 2829 | 9 | launcher | ok | — |
| 3 | app `calculator` | 1618 | 81 | launcher | 1 js | — |
| 3 | app `notes` | 2024 | 188 | launcher | ok | — |
| 3 | app `store` | 2023 | 1109 | launcher | ok | — |
| 3 | url-1-google-home | 403 | 88 | home | ok | `https://google.com/` |
| 3 | url-2-search | 2036 | 1551 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 3 | url-3-first-result | 3348 | 981 | https://pizzaparatropolis.com/menu | ok | `https://pizzaparatropolis.com/menu` |
| 3 | url-4-reddit | 2142 | 1107 | navigate | ok | `https://reddit.com/r/cats` |
| 3 | url-5-netflix | 2142 | 97 | navigate | ok | `https://netflix.com/` |
| 3 | url-6-wikipedia | 4160 | 2770 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 4 | app `browser` | 60146 | 0 | launcher | blank, unstyled, 1 js | — |
| 4 | app `calculator` | 60124 | 0 | launcher | blank, unstyled | — |
| 4 | app `notes` | 5654 | 216 | launcher | ok | — |
| 4 | app `store` | 410 | 216 | launcher | ok | — |

Engine/server errors, as telemetry recorded them:

- `img: img timeout`

JS errors (first few): `Failed to load resource: the server responded with a status of 504 (Gateway Timeout)` · `Failed to load resource: the server responded with a status of 504 (Gateway Timeout)` · `Failed to execute 'write' on 'Document': Invalid or unexpected token` · `Failed to load resource: the server responded with a status of 504 (Gateway Timeout)`

HUD at the end of the last boot:

```
engine   cerebras-oss120
last     app
ttfb     3836 ms
split    mod 0 / srv 5 / prov 3831
tok/s    349
tokens   4886 in / 1727 out
gen $    0.00241
contract ok
app notes
session $ 0.00737
```

## `anthropic-haiku`

| kind | n | ttfb ms (med) | total ms (med) | tok/s (med) | tok in (avg) | tok out (avg) | contract ok | errors | $ |
|---|---|---|---|---|---|---|---|---|---|
| boot | 1 | 1340 | 8547 | 94 | 5836 | 800 | — | 0 | $0.0098 |
| img | 2 | 0 | 8181 | 0 | 0 | 0 | — | 0 | $0.0060 |
| desktop | 1 | 2203 | 26313 | 119 | 9502 | 3134 | 1/1 | 0 | $0.0252 |
| mark | 8 | 0 | 0 | 0 | 0 | 0 | — | 0 | $0.0000 |
| app | 4 | 1604 | 16003 | 133 | 5378 | 1566 | 2/2 | 2 | $0.0528 |
| page | 6 | 1040 | 15275 | 133 | 6000 | 2095 | — | 1 | $0.0989 |

### Per boot

| boot | machine | boot paint ms | interactive ms | revealed ms | contract | injected | blank | unstyled | JS errors | network blocked by CSP |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Linen Fold | — | 29677 | 29962 | ok | 0 | 0 | 0 | 0 | 1 |

### Renders

Wall-clock ms, measured from the click to the document going quiet; it carries about
1.5 s of the harness's own settle polling, so compare engines with it, not the
generation times in the table above.

| boot | step | ms | chars | how | flags | address shown |
|---|---|---|---|---|---|---|
| 1 | app `browser` | 8071 | 93 | launcher | ok | — |
| 1 | app `calculator` | 13307 | 110 | launcher | ok | — |
| 1 | app `notes` | 15740 | 41 | launcher | ok | — |
| 1 | app `store` | 10089 | 36 | launcher | ok | — |
| 1 | url-1-google-home | 2980 | 88 | home | ok | `https://google.com/` |
| 1 | url-2-search | 19384 | 3007 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 1 | url-3-first-result | 15859 | 1257 | https://www.pizzaguide.net/local/northeast/marino-brick-ovens | ok | `https://www.pizzaguide.net/local/northeast/marino-brick-ovens` |
| 1 | url-4-reddit | 13427 | 576 | navigate | ok | `https://reddit.com/r/cats` |
| 1 | url-5-netflix | 15449 | 788 | navigate | ok | `https://netflix.com/` |
| 1 | url-6-wikipedia | 23132 | 2004 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |

Engine/server errors, as telemetry recorded them:

- `page: client aborted`
- `app: client aborted`

JS errors (first few): none

HUD at the end of the last boot:

```
engine   anthropic-haiku
last     app
ttfb     1604 ms
split    mod 0 / srv 2 / prov 1602
tok/s    156
tokens   5484 in / 2500 out
gen $    0.01798
contract ok
app calculator
session $ 0.14972
```

---

## Funniness and variety — for a human

This harness does not score taste. Open the shots and fill this in.

### `cerebras-oss120`

Machines it invented:

- boot 1: **HGT7** v1.3.0‑rc1 (Falcon) (taskbar, 1960s tram workshop) — _Steam‑Safe Interface_ · shots `reviews/shots-bakeoff/3-runB/cerebras-oss120/1/`
- boot 2: **panel7** v1.2.0-rc3 (copper) (dock, 2020s customs shed) — _Customs Shed Console_ · shots `reviews/shots-bakeoff/3-runB/cerebras-oss120/2/`
- boot 3: **Holliday** v2.0.1 (4RC2) (taskbar, 1950s tram workshop) — _Steady tracks, steady code_ · shots `reviews/shots-bakeoff/3-runB/cerebras-oss120/3/`
- boot 4: **Ashford** v1.3.0-rc3 [Cobaltine] (dock, 2090s glassblowing works) — _Precision in every pixel_ · shots `reviews/shots-bakeoff/3-runB/cerebras-oss120/4/`

Funny? _____ / 5 · Varied across boots? _____ / 5 · Would you screenshot it? _____

Notes:

> 

### `anthropic-haiku`

Machines it invented:

- boot 1: **Linen Fold** v3.2.1 SP2 (taskbar, 2010s hospital laundry operations) — _Hospital Laundry Management System_ · shots `reviews/shots-bakeoff/3-runB/anthropic-haiku/1/`

Funny? _____ / 5 · Varied across boots? _____ / 5 · Would you screenshot it? _____

Notes:

> 

## Verdict

Pick the top two or three by contract-miss rate, desktop time and $/session; then play with them on `/bakeoff` (or `/bakeoff/run?engine=<id>` directly) before deciding. Taste breaks ties, numbers do not.
