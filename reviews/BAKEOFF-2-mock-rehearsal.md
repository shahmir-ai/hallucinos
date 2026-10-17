# BAKEOFF-2-mock-rehearsal (SPEC §7)

Run 2026-09-17T09:07:21.709Z
`node scripts/bakeoff.mjs --engines=mock --boots=1 --report=BAKEOFF-2-mock-rehearsal`

1×`mock` boots. Per boot: identity → boot screen → desktop, then 4 apps
(`browser`, `calculator`, `notes`, `store`) and 5 URL visits inside the browser (google.com home, a search for
"best pizza in town", the first result of that search, reddit.com/r/cats, netflix.com,
en.wikipedia.org/wiki/Moon).

Every per-generation number is read from the server's own stdout telemetry line
(`contract_ok`, `ttfb_ms`, `total_ms`, `tok_per_s`, `tokens_in/out`, `usd`); the
HUD was photographed at every step as an independent witness. A render counts as
**broken** if the frame was blank, if its body carried no CSS at all, if a JS
error fired while it loaded, or if it never arrived. Shots:
`reviews/shots-bakeoff/<engine>/<boot>/<step>.png`.

| engine | boots | contract miss | boot paint ms | desktop interactive ms | desktop revealed ms | ttfb ms | tok/s | broken renders | $/session (gen + img) |
|---|---|---|---|---|---|---|---|---|---|
| `mock` | 1 | 0% (0/5) | 181 | 359 | 2871 | 11 | 3704 | 0% (0/10) | $0.0000 + $0.0060 = **$0.0060** |

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
| `mock` | **0.18 s** PASS | **0.36 s** PASS | **0.82 s** PASS | **0.93 s** PASS | 30 ms | 24 ms | 10 ms |

## §12.3 archetype compliance

Judged on the mounted desktop, not on the attribute: where the bar actually sits,
whether the launchers form a grid of labelled icons rather than a list, whether a
clock is there and ticks. "patched" means the kernel had to inject the hook, which
is a contract miss the model made good on paper.

| engine | boot | archetype | bar edge | clock | ticks | launchers | layout | clipped | icons filled | wallpaper |
|---|---|---|---|---|---|---|---|---|---|---|
| `mock` | 1 | taskbar | bottom | yes | yes (seconds) | 16/16 labelled | 11×2 grid | 0 | 16/20 | slot |

## §12.4 identity variety

Every machine this run invented, in order. A repeated name or a repeated
archetype-plus-era across boots of the same engine is the failure §12.4's dice
exist to prevent.

| engine | boot | name | version | era | archetype | tagline |
|---|---|---|---|---|---|---|
| `mock` | 1 | **SILENT PARTNER 2** | 3.2 | 1997-adjacent | taskbar | a static machine |

- `mock`: 1/1 distinct names · archetypes taskbar

## §12.5 images

| engine | image calls | per boot | $ images | $ per image | blocked/failed |
|---|---|---|---|---|---|
| `mock` | 2 | 2.0 | $0.0060 | $0.0030 | 0 |

Whether the wallpaper fits the era and whether the icon sheet is legible at 64 px
is a human's call on the shots — see the taste section at the end.

"$/session" is one boot with its apps and pages — what one visitor costs. A console
error that is the CSP refusing a generated document's network call is counted
separately ("network blocked by CSP" below): that is the sandbox working, not a
broken render, though a high number says the model keeps reaching for the web.

## `mock`

| kind | n | ttfb ms (med) | total ms (med) | tok/s (med) | tok in (avg) | tok out (avg) | contract ok | errors | $ |
|---|---|---|---|---|---|---|---|---|---|
| mark | 17 | 0 | 0 | 0 | 0 | 0 | — | 0 | $0.0000 |
| boot | 1 | 15 | 137 | 3569 | 4414 | 489 | — | 0 | $0.0000 |
| desktop | 1 | 20 | 284 | 3704 | 7339 | 1052 | 1/1 | 0 | $0.0000 |
| app | 4 | 11 | 111 | 3481 | 4675 | 370 | 4/4 | 0 | $0.0000 |
| page | 6 | 11 | 140 | 3811 | 4717 | 613 | — | 0 | $0.0000 |
| img | 2 | 0 | 7112 | 0 | 0 | 0 | — | 0 | $0.0060 |

### Per boot

| boot | machine | boot paint ms | interactive ms | revealed ms | contract | injected | blank | unstyled | JS errors | network blocked by CSP |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SILENT PARTNER 2 | 181 | 359 | 2871 | ok | 0 | 0 | 0 | 0 | 165 |

### Renders

Wall-clock ms, measured from the click to the document going quiet; it carries about
1.5 s of the harness's own settle polling, so compare engines with it, not the
generation times in the table above.

| boot | step | ms | chars | how | flags | address shown |
|---|---|---|---|---|---|---|
| 1 | app `browser` | 821 | 33 | launcher | ok | — |
| 1 | app `calculator` | 815 | 177 | launcher | ok | — |
| 1 | app `notes` | 814 | 210 | launcher | ok | — |
| 1 | app `store` | 819 | 213 | launcher | ok | — |
| 1 | url-1-google-home | 405 | 128 | home | ok | `https://google.com/` |
| 1 | url-2-search | 840 | 1267 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 1 | url-3-first-result | 931 | 301 | https://fathom0.com/fathom-guide | ok | `https://fathom0.com/fathom-guide` |
| 1 | url-4-reddit | 973 | 398 | navigate | ok | `https://reddit.com/r/cats` |
| 1 | url-5-netflix | 808 | 269 | navigate | ok | `https://netflix.com/` |
| 1 | url-6-wikipedia | 929 | 297 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |

JS errors (first few): none

HUD at the end of the last boot:

```
engine   mock
last     app
ttfb     11 ms
split    mod 0 / srv 3 / prov 8
tok/s    3495
tokens   4693 in / 388 out
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

- boot 1: **SILENT PARTNER 2** v3.2 (taskbar, 1997-adjacent) — _a static machine_ · shots `reviews/shots-bakeoff/mock/1/`

Funny? _____ / 5 · Varied across boots? _____ / 5 · Would you screenshot it? _____

Notes:

> 

## Verdict

Pick the top two or three by contract-miss rate, desktop time and $/session; then play with them on `/bakeoff` (or `/bakeoff/run?engine=<id>` directly) before deciding. Taste breaks ties, numbers do not.
