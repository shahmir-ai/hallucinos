# BAKEOFF-3 (SPEC §7)

Run 2026-09-17T12:01:19.508Z
`node scripts/bakeoff.mjs --engines=cerebras-oss120 --boots=4`

4×`cerebras-oss120` boots. Per boot: identity → boot screen → desktop, then 4 apps
(`browser`, `calculator`, `notes`, `store`) and 5 URL visits inside the browser (google.com home, a search for
"best pizza in town", the first result of that search, reddit.com/r/cats, netflix.com,
en.wikipedia.org/wiki/Moon).

A step (one app open, one page load) is abandoned as a timeout after 60 s.

Every per-generation number is read from the server's own stdout telemetry line
(`contract_ok`, `ttfb_ms`, `total_ms`, `tok_per_s`, `tokens_in/out`, `usd`); the
HUD was photographed at every step as an independent witness. A render counts as
**broken** if the frame was blank, if its body carried no CSS at all, if a JS
error fired while it loaded, or if it never arrived. Shots:
`reviews/shots-bakeoff/3-runA/<engine>/<boot>/<step>.png`.

| engine | boots | contract miss | boot paint ms | desktop interactive ms | desktop revealed ms | ttfb ms | tok/s | broken renders | $/session (gen + img) |
|---|---|---|---|---|---|---|---|---|---|
| `cerebras-oss120` | 4 | 0% (0/20) | 849 | 3050 | 3835 | 655 | 959 | 0% (0/40) | $0.0277 + $0.0090 = **$0.0367** |

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
| `cerebras-oss120` | **0.85 s** PASS | **3.05 s** PASS | **1.62 s** PASS | **1.74 s** PASS | 709 ms | 542 ms | 693 ms |

## §12.3 archetype compliance

Judged on the mounted desktop, not on the attribute: where the bar actually sits,
whether the launchers form a grid of labelled icons rather than a list, whether a
clock is there and ticks. "patched" means the kernel had to inject the hook, which
is a contract miss the model made good on paper.

| engine | boot | archetype | bar edge | clock | ticks | launchers | layout | clipped | icons filled | wallpaper |
|---|---|---|---|---|---|---|---|---|---|---|
| `cerebras-oss120` | 1 | taskbar | bottom | yes | yes (minutes) | 16/16 labelled | 8×2 grid | 0 | 16/20 | **none** |
| `cerebras-oss120` | 2 | dock | bottom | yes | yes (seconds) | 16/16 labelled | 8×2 grid | 8 | 16/20 | **none** |
| `cerebras-oss120` | 3 | taskbar | bottom | yes | **no** | 16/16 labelled | 8×2 grid | 0 | 16/20 | **none** |
| `cerebras-oss120` | 4 | dock | bottom | yes | **no** | 16/16 labelled | 4×4 grid | 0 | 16/20 | **none** |

## §12.4 identity variety

Every machine this run invented, in order. A repeated name or a repeated
archetype-plus-era across boots of the same engine is the failure §12.4's dice
exist to prevent.

| engine | boot | name | version | era | archetype | tagline |
|---|---|---|---|---|---|---|
| `cerebras-oss120` | 1 | **Bridgewick** | 2.4.1 rc2 [Nimbus] | 2030s coal weighbridge | taskbar | Weigh the future |
| `cerebras-oss120` | 2 | **Vox** | 1.4.2-rc1 [cobalt] | 1990s village telephone exchange | dock | Whispers of the exchange |
| `cerebras-oss120` | 3 | **Mira Cove** | 1.2.0-rc1 (cobalt) | 2020s oil rig galley | taskbar | Thrifty rigs run lean |
| `cerebras-oss120` | 4 | **First Beacon** | 3.2.1-rc1 [Nimbus] | 1960s oil rig galley | dock | Quiet humming of steel and spice |

- `cerebras-oss120`: 4/4 distinct names · archetypes taskbar, dock, taskbar, dock

## §12.5 images

| engine | image calls | per boot | $ images | $ per image | blocked/failed |
|---|---|---|---|---|---|
| `cerebras-oss120` | 24 | 6.0 | $0.0360 | $0.0015 | 13 |

Whether the wallpaper fits the era and whether the icon sheet is legible at 64 px
is a human's call on the shots — see the taste section at the end.

"$/session" is one boot with its apps and pages — what one visitor costs. A console
error that is the CSP refusing a generated document's network call is counted
separately ("network blocked by CSP" below): that is the sandbox working, not a
broken render, though a high number says the model keeps reaching for the web.

## `cerebras-oss120`

| kind | n | ttfb ms (med) | total ms (med) | tok/s (med) | tok in (avg) | tok out (avg) | contract ok | errors | $ |
|---|---|---|---|---|---|---|---|---|---|
| boot | 4 | 696 | 1041 | 790 | 5692 | 884 | — | 0 | $0.0081 |
| mark | 47 | 0 | 0 | 0 | 0 | 0 | — | 0 | $0.0000 |
| desktop | 4 | 1194 | 2313 | 1023 | 8359 | 1598 | 4/4 | 0 | $0.0128 |
| img | 24 | 0 | 2657 | 0 | 0 | 0 | — | 13 | $0.0360 |
| app | 16 | 692 | 1181 | 1045 | 5045 | 1298 | 16/16 | 0 | $0.0345 |
| page | 24 | 593 | 1269 | 959 | 5566 | 1338 | — | 0 | $0.0555 |

### Per boot

| boot | machine | boot paint ms | interactive ms | revealed ms | contract | injected | blank | unstyled | JS errors | network blocked by CSP |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Bridgewick | — | 5132 | 5345 | ok | 0 | 0 | 0 | 0 | 0 |
| 2 | Vox | 1085 | 2593 | 3835 | ok | 0 | 0 | 0 | 0 | 0 |
| 3 | Mira Cove | 849 | 3050 | 3329 | ok | 0 | 0 | 0 | 0 | 1 |
| 4 | First Beacon | 782 | 2497 | 3321 | ok | 0 | 0 | 0 | 0 | 0 |

### Renders

Wall-clock ms, measured from the click to the document going quiet; it carries about
1.5 s of the harness's own settle polling, so compare engines with it, not the
generation times in the table above.

| boot | step | ms | chars | how | flags | address shown |
|---|---|---|---|---|---|---|
| 1 | app `browser` | 1216 | 0 | launcher | ok | — |
| 1 | app `calculator` | 2427 | 47 | launcher | ok | — |
| 1 | app `notes` | 2430 | 265 | launcher | ok | — |
| 1 | app `store` | 2426 | 768 | launcher | ok | — |
| 1 | url-1-google-home | 406 | 88 | home | ok | `https://google.com/` |
| 1 | url-2-search | 1633 | 1423 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 1 | url-3-first-result | 1740 | 1180 | https://pizzaopolis.com/menu | ok | `https://pizzaopolis.com/menu` |
| 1 | url-4-reddit | 1738 | 1203 | navigate | ok | `https://reddit.com/r/cats` |
| 1 | url-5-netflix | 1742 | 280 | navigate | ok | `https://netflix.com/` |
| 1 | url-6-wikipedia | 2143 | 2571 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 2 | app `browser` | 2430 | 7 | launcher | ok | — |
| 2 | app `calculator` | 1618 | 78 | launcher | ok | — |
| 2 | app `notes` | 1626 | 129 | launcher | ok | — |
| 2 | app `store` | 1620 | 1153 | launcher | ok | — |
| 2 | url-1-google-home | 404 | 88 | home | ok | `https://google.com/` |
| 2 | url-2-search | 2440 | 1679 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 2 | url-3-first-result | 2825 | 523 | https://pizzacraft.example.com/menu | ok | `https://pizzacraft.example.com/menu` |
| 2 | url-4-reddit | 2143 | 761 | navigate | ok | `https://reddit.com/r/cats` |
| 2 | url-5-netflix | 1335 | 155 | navigate | ok | `https://netflix.com/` |
| 2 | url-6-wikipedia | 2146 | 2184 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 3 | app `browser` | 1217 | 10 | launcher | ok | — |
| 3 | app `calculator` | 1215 | 40 | launcher | ok | — |
| 3 | app `notes` | 1615 | 223 | launcher | ok | — |
| 3 | app `store` | 2418 | 837 | launcher | ok | — |
| 3 | url-1-google-home | 406 | 86 | home | ok | `https://google.com/` |
| 3 | url-2-search | 3244 | 1536 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 3 | url-3-first-result | 1339 | 67 | https://google.com/ | ok | `https://google.com/` |
| 3 | url-4-reddit | 2145 | 927 | navigate | ok | `https://reddit.com/r/cats` |
| 3 | url-5-netflix | 2144 | 323 | navigate | ok | `https://netflix.com/` |
| 3 | url-6-wikipedia | 1742 | 2084 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 4 | app `browser` | 1220 | 7 | launcher | ok | — |
| 4 | app `calculator` | 2423 | 41 | launcher | ok | — |
| 4 | app `notes` | 1616 | 348 | launcher | ok | — |
| 4 | app `store` | 1618 | 731 | launcher | ok | — |
| 4 | url-1-google-home | 406 | 79 | home | ok | `https://google.com/` |
| 4 | url-2-search | 3244 | 1751 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 4 | url-3-first-result | 2015 | 522 | https://www.pizzapioneer.com/menu | ok | `https://www.pizzapioneer.com/menu` |
| 4 | url-4-reddit | 1732 | 810 | navigate | ok | `https://reddit.com/r/cats` |
| 4 | url-5-netflix | 1332 | 661 | navigate | ok | `https://netflix.com/` |
| 4 | url-6-wikipedia | 3343 | 2536 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |

Engine/server errors, as telemetry recorded them:

- `img: img timeout`

JS errors (first few): none

HUD at the end of the last boot:

```
engine   cerebras-oss120
last     app
ttfb     450 ms
split    mod 0 / srv 2 / prov 448
tok/s    1298
tokens   5240 in / 1466 out
gen $    0.00232
contract ok
app store
session $ 0.02727
```

---

## Funniness and variety — for a human

This harness does not score taste. Open the shots and fill this in.

### `cerebras-oss120`

Machines it invented:

- boot 1: **Bridgewick** v2.4.1 rc2 [Nimbus] (taskbar, 2030s coal weighbridge) — _Weigh the future_ · shots `reviews/shots-bakeoff/3-runA/cerebras-oss120/1/`
- boot 2: **Vox** v1.4.2-rc1 [cobalt] (dock, 1990s village telephone exchange) — _Whispers of the exchange_ · shots `reviews/shots-bakeoff/3-runA/cerebras-oss120/2/`
- boot 3: **Mira Cove** v1.2.0-rc1 (cobalt) (taskbar, 2020s oil rig galley) — _Thrifty rigs run lean_ · shots `reviews/shots-bakeoff/3-runA/cerebras-oss120/3/`
- boot 4: **First Beacon** v3.2.1-rc1 [Nimbus] (dock, 1960s oil rig galley) — _Quiet humming of steel and spice_ · shots `reviews/shots-bakeoff/3-runA/cerebras-oss120/4/`

Funny? _____ / 5 · Varied across boots? _____ / 5 · Would you screenshot it? _____

Notes:

> 

## Verdict

Pick the top two or three by contract-miss rate, desktop time and $/session; then play with them on `/bakeoff` (or `/bakeoff/run?engine=<id>` directly) before deciding. Taste breaks ties, numbers do not.
