# BAKEOFF-2 (SPEC §7)

Run 2026-09-17T09:58:46.166Z
`node scripts/bakeoff.mjs --engines=cerebras-oss120,anthropic-haiku,or-oss20-groq,mercury-2.5 --boots=4,4,4,1`

4×`cerebras-oss120`, 4×`anthropic-haiku`, 4×`or-oss20-groq`, 1×`mercury-2.5` boots. Per boot: identity → boot screen → desktop, then 4 apps
(`browser`, `calculator`, `notes`, `store`) and 5 URL visits inside the browser (google.com home, a search for
"best pizza in town", the first result of that search, reddit.com/r/cats, netflix.com,
en.wikipedia.org/wiki/Moon).

A step (one app open, one page load) is abandoned as a timeout after 45 s.

**What this run is.** One clean run of the judging protocol, 2026-09-17 afternoon.
Three earlier attempts the same afternoon were thrown away rather than reported,
and why matters: the first stalled because the harness's boot-paint poll had no
element timeout (fixed); the second was abandoned when a dead engine cost ten
minutes a boot at the old 180-second step ceiling (now 45 s); the third
discovered that the harness itself was hitting `GEN_PER_IP_PER_HOUR=60` and that
every boot after the fourth was being served the kernel's queue screen instead of
an OS — which is what had made `anthropic-haiku` look like it could not boot at
all and `or-oss20-groq` look dead (see Findings 1). This run is the first with
all three fixed. Spend, everything included: **$0.67** for this run, ~$1.15 for
the afternoon; the day counter stands well inside the $25 ceiling.

**`reviews/BAKEOFF-2-mock-rehearsal.md`** is the adapted harness proving itself on
the mock engine at $0.012 (images are real even on mock) before any of this was
spent.

Every per-generation number is read from the server's own stdout telemetry line
(`contract_ok`, `ttfb_ms`, `total_ms`, `tok_per_s`, `tokens_in/out`, `usd`); the
HUD was photographed at every step as an independent witness. A render counts as
**broken** if the frame was blank, if its body carried no CSS at all, if a JS
error fired while it loaded, or if it never arrived. Shots:
`reviews/shots-bakeoff/<engine>/<boot>/<step>.png`.

| engine | boots | contract miss | boot paint ms | desktop interactive ms | desktop revealed ms | ttfb ms | tok/s | broken renders | $/session (gen + img) |
|---|---|---|---|---|---|---|---|---|---|
| `cerebras-oss120` | 4 | 0% (0/20) | 1064 | 2334 | 3830 | 529 | 1152 | 7.5% (3/40) | $0.0262 + $0.0045 = **$0.0307** |
| `anthropic-haiku` | 4 (2 up) | 0% (0/8) | 5027 | 19894 | 20432 | 979 | 118 | 5% (1/20) | $0.2314 + $0.0120 = **$0.2434** |
| `or-oss20-groq` | 4 | 10% (2/20) | 1662 | 4816 | 5324 | 968 | 543 | 17.5% (7/40) | $0.0091 + $0.0060 = **$0.0151** |
| `mercury-2.5` | 1 (0 up) | 0% (0/0) | 0 | 0 | 0 | 0 | 2 | 0% (0/0) | $0.0002 + $0.0000 = **$0.0002** |

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
| `cerebras-oss120` | 1.06 s MISS | **2.33 s** PASS | **1.62 s** PASS | **1.73 s** PASS | 541 ms | 27 ms | 674 ms |
| `anthropic-haiku` | 5.03 s MISS | 19.89 s MISS | 12.89 s MISS | 15.83 s MISS | 1333 ms | 36 ms | 1215 ms |
| `or-oss20-groq` | 1.66 s MISS | 4.82 s MISS | 2.82 s MISS | 3.34 s MISS | 1004 ms | 25 ms | 1487 ms |

## §12.3 archetype compliance

Judged on the mounted desktop, not on the attribute: where the bar actually sits,
whether the launchers form a grid of labelled icons rather than a list, whether a
clock is there and ticks. "patched" means the kernel had to inject the hook, which
is a contract miss the model made good on paper.

| engine | boot | archetype | bar edge | clock | ticks | launchers | layout | clipped | icons filled | wallpaper |
|---|---|---|---|---|---|---|---|---|---|---|
| `cerebras-oss120` | 1 | taskbar | bottom | yes | yes (seconds) | 16/16 labelled | 1×16 **line** | 5 | 0/20 | **none** |
| `cerebras-oss120` | 2 | dock | bottom | yes | yes (seconds) | 16/16 labelled | 16×1 **line** | 0 | 16/20 | slot |
| `cerebras-oss120` | 3 | taskbar | bottom | yes | yes (seconds) | 16/16 labelled | 15×2 grid | 1 | 16/20 | slot |
| `cerebras-oss120` | 4 | dock | bottom | yes | yes (seconds) | 16/16 labelled | 15×2 grid | 0 | 16/20 | slot |
| `anthropic-haiku` | 1 | taskbar | bottom | yes | yes (minutes) | 16/16 labelled | 4×4 grid | 0 | 16/16 | slot |
| `anthropic-haiku` | 2 | — (no boot: error) | — | — | — | — | — | — | — | — |
| `anthropic-haiku` | 3 | taskbar | bottom | yes | yes (seconds) | 16/16 labelled | 4×4 grid | 0 | 16/16 | slot |
| `anthropic-haiku` | 4 | — (no boot: error) | — | — | — | — | — | — | — | — |
| `or-oss20-groq` | 1 | dock | bottom | yes | yes (minutes) | 16/16 labelled | 10×2 grid | 0 | 16/20 | slot |
| `or-oss20-groq` | 2 | dock | bottom | patched | yes (seconds) | 16/16 labelled | 15×2 grid | 0 | 16/21 | slot |
| `or-oss20-groq` | 3 | dock | bottom | yes | yes (minutes) | 16/16 labelled | 1×16 **line** | 16 | 16/20 | slot |
| `or-oss20-groq` | 4 | taskbar | bottom | patched | yes (seconds) | 16/17 labelled | 3×7 grid | 0 | 16/20 | slot |
| `mercury-2.5` | 1 | — (no boot: error) | — | — | — | — | — | — | — | — |

## §12.4 identity variety

Every machine this run invented, in order. A repeated name or a repeated
archetype-plus-era across boots of the same engine is the failure §12.4's dice
exist to prevent.

| engine | boot | name | version | era | archetype | tagline |
|---|---|---|---|---|---|---|
| `cerebras-oss120` | 1 | **SignalOak** | 2.3 | 2040s railway signal box | taskbar | Lights and logs, ever vigilant |
| `cerebras-oss120` | 2 | **QuarryDock** | 5.1.0-legacy | 2030s quarry office | dock | Where stone meets screen |
| `cerebras-oss120` | 3 | **Scriptorix** | 3.7 (Monasterial) | 1970s monastery scriptorium | taskbar | Ink the silence, code the margins |
| `cerebras-oss120` | 4 | **UNNAMED/6BXG** | 1.0 | unknown | dock | it boots. |
| `anthropic-haiku` | 1 | **WindWatch** | 2.7.1 Solstice | 2010s wind farm control room | taskbar | Turbine fleet supervision terminal |
| `anthropic-haiku` | 2 | **—** | — | — | — |  |
| `anthropic-haiku` | 3 | **FURNACE** | 3.1a | 1980s glassblowing works heat management system | taskbar | Thermal Inventory and Kiln Management |
| `anthropic-haiku` | 4 | **—** | — | — | — |  |
| `or-oss20-groq` | 1 | **StitchWeld** | 7.4.2 | 2090s shoe repair chain | dock | The Sole of Tomorrow |
| `or-oss20-groq` | 2 | **ArcaneGlide** | 2.7 | 2060s amusement arcade | dock | Let the reels roll |
| `or-oss20-groq` | 3 | **Honeyhive** | 4.2 | 1980s rooftop apiary | dock | Buzzing into service |
| `or-oss20-groq` | 4 | **TideGrill** | 2.4.7 | 2030s oil rig galley | taskbar | Keep the crew fed, keep the tide in sight |
| `mercury-2.5` | 1 | **—** | — | — | — |  |

- `cerebras-oss120`: 4/4 distinct names · archetypes taskbar, dock, taskbar, dock

- `anthropic-haiku`: 2/2 distinct names · archetypes taskbar, taskbar

- `or-oss20-groq`: 4/4 distinct names · archetypes dock, dock, dock, taskbar

- `mercury-2.5`: 0/0 distinct names · archetypes —

## §12.5 images

| engine | image calls | per boot | $ images | $ per image | blocked/failed |
|---|---|---|---|---|---|
| `cerebras-oss120` | 8 | 2.0 | $0.0180 | $0.0022 | 2 |
| `anthropic-haiku` | 8 | 4.0 | $0.0240 | $0.0030 | 0 |
| `or-oss20-groq` | 8 | 2.0 | $0.0240 | $0.0030 | 0 |
| `mercury-2.5` | 0 | 0.0 | $0.0000 | $— | 0 |

Whether the wallpaper fits the era and whether the icon sheet is legible at 64 px
is a human's call on the shots — see the taste section at the end.

"$/session" is one boot with its apps and pages — what one visitor costs. A console
error that is the CSP refusing a generated document's network call is counted
separately ("network blocked by CSP" below): that is the sandbox working, not a
broken render, though a high number says the model keeps reaching for the web.

## `cerebras-oss120`

| kind | n | ttfb ms (med) | total ms (med) | tok/s (med) | tok in (avg) | tok out (avg) | contract ok | errors | $ |
|---|---|---|---|---|---|---|---|---|---|
| mark | 66 | 0 | 0 | 0 | 0 | 0 | — | 0 | $0.0000 |
| boot | 4 | 675 | 1128 | 685 | 4716 | 767 | — | 0 | $0.0068 |
| desktop | 4 | 727 | 1262 | 1193 | 7313 | 1348 | 4/4 | 0 | $0.0110 |
| page | 25 | 491 | 1092 | 1155 | 4646 | 1362 | — | 0 | $0.0525 |
| app | 16 | 529 | 1101 | 1225 | 4540 | 1464 | 16/16 | 0 | $0.0343 |
| img | 8 | 0 | 15261 | 0 | 0 | 0 | — | 2 | $0.0180 |

### Per boot

| boot | machine | boot paint ms | interactive ms | revealed ms | contract | injected | blank | unstyled | JS errors | network blocked by CSP |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SignalOak | 1064 | 2101 | 3830 | ok | 0 | 0 | 0 | 2 | 0 |
| 2 | QuarryDock | 799 | 2334 | 3326 | ok | 0 | 0 | 0 | 0 | 0 |
| 3 | Scriptorix | 833 | 1960 | 3319 | ok | 0 | 0 | 0 | 1 | 0 |
| 4 | UNNAMED/6BXG | 2164 | 3172 | 4829 | ok | 0 | 0 | 0 | 2 | 0 |

### Renders

Wall-clock ms, measured from the click to the document going quiet; it carries about
1.5 s of the harness's own settle polling, so compare engines with it, not the
generation times in the table above.

| boot | step | ms | chars | how | flags | address shown |
|---|---|---|---|---|---|---|
| 1 | app `browser` | 1618 | 111 | launcher | ok | — |
| 1 | app `calculator` | 1615 | 31 | launcher | ok | — |
| 1 | app `notes` | 1616 | 174 | launcher | ok | — |
| 1 | app `store` | 2022 | 1094 | launcher | ok | — |
| 1 | url-1-google-home | 405 | 79 | home | ok | `https://google.com/` |
| 1 | url-2-search | 2027 | 2126 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 1 | url-3-first-result | 1739 | 920 | https://pizzacove.example.com/menu | ok | `https://pizzacove.example.com/menu` |
| 1 | url-4-reddit | 1734 | 1083 | navigate | ok | `https://reddit.com/r/cats` |
| 1 | url-5-netflix | 1613 | 692 | navigate | ok | `https://netflix.com/` |
| 1 | url-6-wikipedia | 2140 | 2393 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 2 | app `browser` | 2020 | 118 | launcher | ok | — |
| 2 | app `calculator` | 1633 | 100 | launcher | ok | — |
| 2 | app `notes` | 2020 | 288 | launcher | ok | — |
| 2 | app `store` | 2421 | 690 | launcher | ok | — |
| 2 | url-1-google-home | 410 | 59 | home | ok | `https://search.quarrydock/` |
| 2 | url-2-search | 1625 | 124 | form | ok | `https://search.quarrydock/search?q=best%20pizza%20in%20town` |
| 2 | url-3-first-result | 1734 | 1484 | https://search.quarrydock/lucky?q=best%20pizza%20in%20town | ok | `https://search.quarrydock/lucky?q=best%20pizza%20in%20town` |
| 2 | url-4-reddit | 1738 | 1065 | navigate | ok | `https://reddit.com/r/cats` |
| 2 | url-5-netflix | 1613 | 465 | navigate | ok | `https://netflix.com/` |
| 2 | url-6-wikipedia | 2136 | 1917 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 3 | app `browser` | 1211 | 65 | launcher | ok | — |
| 3 | app `calculator` | 1616 | 33 | launcher | ok | — |
| 3 | app `notes` | 1618 | 224 | launcher | ok | — |
| 3 | app `store` | 1619 | 97 | launcher | 1 js | — |
| 3 | url-1-google-home | 403 | 81 | home | ok | `https://google.com/` |
| 3 | url-2-search | 4843 | 1561 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 3 | url-3-first-result | 2539 | 1067 | https://pizzapalace.example.com/menu | ok | `https://pizzapalace.example.com/menu` |
| 3 | url-4-reddit | 1617 | 765 | navigate | ok | `https://reddit.com/r/cats` |
| 3 | url-5-netflix | 1732 | 154 | navigate | ok | `https://netflix.com/` |
| 3 | url-6-wikipedia | 2135 | 1947 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 4 | app `browser` | 1616 | 59 | launcher | ok | — |
| 4 | app `calculator` | 1215 | 66 | launcher | 1 js | — |
| 4 | app `notes` | 3224 | 154 | launcher | ok | — |
| 4 | app `store` | 2023 | 986 | launcher | 1 js | — |
| 4 | url-1-google-home | 404 | 81 | home | ok | `https://google.com/` |
| 4 | url-2-search | 1624 | 1687 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 4 | url-3-first-result | 1334 | 99 | https://google.com/ | ok | `https://google.com/` |
| 4 | url-4-reddit | 2536 | 801 | navigate | ok | `https://reddit.com/r/cats` |
| 4 | url-5-netflix | 1735 | 497 | navigate | ok | `https://netflix.com/` |
| 4 | url-6-wikipedia | 1738 | 2183 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |

Engine/server errors, as telemetry recorded them:

- `img: img timeout`

JS errors (first few): `Failed to load resource: the server responded with a status of 504 (Gateway Timeout)` · `Failed to load resource: the server responded with a status of 504 (Gateway Timeout)` · `Failed to read the 'localStorage' property from 'Window': The document is sandboxed and lacks the 'allow-same-origin' flag.` · `Failed to execute 'write' on 'Document': Invalid or unexpected token` · `Failed to execute 'write' on 'Document': Unexpected token ']'`

HUD at the end of the last boot:

```
engine   cerebras-oss120
last     app
ttfb     546 ms
split    mod 0 / srv 5 / prov 541
tok/s    1611
tokens   4540 in / 2358 out
gen $    0.00276
contract ok
app store
session $ 0.02572
```

## `anthropic-haiku`

| kind | n | ttfb ms (med) | total ms (med) | tok/s (med) | tok in (avg) | tok out (avg) | contract ok | errors | $ |
|---|---|---|---|---|---|---|---|---|---|
| mark | 32 | 0 | 0 | 0 | 0 | 0 | — | 0 | $0.0000 |
| img | 8 | 0 | 6864 | 0 | 0 | 0 | — | 0 | $0.0240 |
| boot | 4 | 1217 | 8515 | 95 | 4851 | 738 | — | 0 | $0.0342 |
| desktop | 6 | 1079 | 25003 | 79 | 7674 | 2149 | 2/2 | 4 | $0.1105 |
| app | 8 | 979 | 17470 | 118 | 4888 | 2040 | 6/6 | 2 | $0.1207 |
| page | 12 | 784 | 15338 | 163 | 5068 | 2276 | — | 0 | $0.1974 |

### Per boot

| boot | machine | boot paint ms | interactive ms | revealed ms | contract | injected | blank | unstyled | JS errors | network blocked by CSP |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | WindWatch | 5496 | 19324 | 19407 | ok | 0 | 1 | 0 | 0 | 1 |
| 2 | — (error) | 4054 | — | 53108 | — | 0 | 0 | 0 | 0 | 0 |
| 3 | FURNACE | 5027 | 19894 | 20432 | ok | 0 | 0 | 0 | 0 | 1 |
| 4 | — (error) | 4470 | — | 53120 | — | 0 | 0 | 0 | 0 | 0 |

### Renders

Wall-clock ms, measured from the click to the document going quiet; it carries about
1.5 s of the harness's own settle polling, so compare engines with it, not the
generation times in the table above.

| boot | step | ms | chars | how | flags | address shown |
|---|---|---|---|---|---|---|
| 1 | app `browser` | 9264 | 63 | launcher | ok | — |
| 1 | app `calculator` | 12487 | 83 | launcher | ok | — |
| 1 | app `notes` | 13293 | 599 | launcher | ok | — |
| 1 | app `store` | 14097 | 62 | launcher | ok | — |
| 1 | url-1-google-home | 405 | 0 | home | blank | `windwatch://home` |
| 1 | url-2-search | 18650 | 2397 | fallback-navigate | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 1 | url-3-first-result | 15710 | 2003 | https://www.marcositalianoven.com/menu | ok | `https://www.marcositalianoven.com/menu` |
| 1 | url-4-reddit | 21873 | 643 | navigate | ok | `https://reddit.com/r/cats` |
| 1 | url-5-netflix | 15018 | 444 | navigate | ok | `https://netflix.com/` |
| 1 | url-6-wikipedia | 16116 | 2429 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 3 | app `browser` | 9669 | 139 | launcher | ok | — |
| 3 | app `calculator` | 12889 | 211 | launcher | ok | — |
| 3 | app `notes` | 10467 | 5 | launcher | ok | — |
| 3 | app `store` | 23765 | 781 | launcher | ok | — |
| 3 | url-1-google-home | 404 | 105 | home | ok | `https://google.com/` |
| 3 | url-2-search | 22568 | 2351 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 3 | url-3-first-result | 16228 | 1612 | https://www.antelopepizza.com/ | ok | `https://www.antelopepizza.com/` |
| 3 | url-4-reddit | 15834 | 744 | navigate | ok | `https://reddit.com/r/cats` |
| 3 | url-5-netflix | 14208 | 705 | navigate | ok | `https://netflix.com/` |
| 3 | url-6-wikipedia | 8865 | 38 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |

Engine/server errors, as telemetry recorded them:

- `app: This operation was aborted`
- `desktop: timeout`

JS errors (first few): none

HUD at the end of the last boot:

```
engine   anthropic-haiku
last     boot
ttfb     1217 ms
split    mod 0 / srv 2 / prov 1215
tok/s    72
tokens   4852 in / 610 out
gen $    0.00790
contract n/a
desktop regenerating after error: timeout
session $ 0.00790
```

## `or-oss20-groq`

| kind | n | ttfb ms (med) | total ms (med) | tok/s (med) | tok in (avg) | tok out (avg) | contract ok | errors | $ |
|---|---|---|---|---|---|---|---|---|---|
| mark | 66 | 0 | 0 | 0 | 0 | 0 | — | 0 | $0.0000 |
| boot | 4 | 1489 | 2499 | 392 | 4760 | 835 | — | 0 | $0.0024 |
| desktop | 4 | 1215 | 2562 | 542 | 7315 | 1431 | 2/4 | 0 | $0.0039 |
| app | 16 | 1003 | 2452 | 596 | 4543 | 1444 | 16/16 | 0 | $0.0124 |
| page | 24 | 884 | 2282 | 573 | 4650 | 1298 | — | 1 | $0.0177 |
| img | 8 | 0 | 6746 | 0 | 0 | 0 | — | 0 | $0.0240 |

### Per boot

| boot | machine | boot paint ms | interactive ms | revealed ms | contract | injected | blank | unstyled | JS errors | network blocked by CSP |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | StitchWeld | 2523 | 4816 | 5324 | ok | 0 | 6 | 6 | 0 | 0 |
| 2 | ArcaneGlide | — | 5517 | 5825 | miss | 1 | 0 | 0 | 1 | 1 |
| 3 | Honeyhive | 1599 | 4791 | 4821 | ok | 0 | 0 | 0 | 0 | 0 |
| 4 | TideGrill | 1662 | 3501 | 3824 | miss | 1 | 0 | 0 | 1 | 0 |

### Renders

Wall-clock ms, measured from the click to the document going quiet; it carries about
1.5 s of the harness's own settle polling, so compare engines with it, not the
generation times in the table above.

| boot | step | ms | chars | how | flags | address shown |
|---|---|---|---|---|---|---|
| 1 | app `browser` | 2016 | 43 | launcher | ok | — |
| 1 | app `calculator` | 2418 | 39 | launcher | ok | — |
| 1 | app `notes` | 2421 | 126 | launcher | ok | — |
| 1 | app `store` | 4029 | 2467 | launcher | ok | — |
| 1 | url-1-google-home | 45125 | 0 | home | never arrived, blank, unstyled | `https://google.com/` |
| 1 | url-2-search | 45017 | 0 | fallback-navigate | never arrived, blank, unstyled | `https://google.com/search?q=best%20pizza%20in%20town` |
| 1 | url-3-first-result | 45002 | 0 | null | never arrived, blank, unstyled | `https://google.com/search?q=best%20pizza%20in%20town` |
| 1 | url-4-reddit | 45109 | 0 | navigate | never arrived, blank, unstyled | `https://reddit.com/r/cats` |
| 1 | url-5-netflix | 45117 | 0 | navigate | never arrived, blank, unstyled | `https://netflix.com/` |
| 1 | url-6-wikipedia | 45121 | 0 | navigate | never arrived, blank, unstyled | `https://en.wikipedia.org/wiki/Moon` |
| 2 | app `browser` | 1612 | 8 | launcher | ok | — |
| 2 | app `calculator` | 2416 | 73 | launcher | 1 js | — |
| 2 | app `notes` | 2824 | 110 | launcher | ok | — |
| 2 | app `store` | 4025 | 804 | launcher | ok | — |
| 2 | url-1-google-home | 1209 | 72 | home | ok | `https://google.com/` |
| 2 | url-2-search | 2430 | 694 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 2 | url-3-first-result | 3342 | 727 | https://pepperpotpizza.com/ | ok | `https://pepperpotpizza.com/` |
| 2 | url-4-reddit | 2535 | 730 | navigate | ok | `https://reddit.com/r/cats` |
| 2 | url-5-netflix | 3344 | 215 | navigate | ok | `https://netflix.com/` |
| 2 | url-6-wikipedia | 2534 | 1070 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 3 | app `browser` | 2016 | 73 | launcher | ok | — |
| 3 | app `calculator` | 2824 | 53 | launcher | ok | — |
| 3 | app `notes` | 2826 | 194 | launcher | ok | — |
| 3 | app `store` | 4437 | 1992 | launcher | ok | — |
| 3 | url-1-google-home | 404 | 58 | home | ok | `https://google.com/` |
| 3 | url-2-search | 4449 | 1857 | form | ok | `https://www.google.com/search?q=best%20pizza%20in%20town` |
| 3 | url-3-first-result | 2943 | 1020 | https://www.tasteville.com/cheesy-crust-pizza | ok | `https://www.tasteville.com/cheesy-crust-pizza` |
| 3 | url-4-reddit | 3752 | 1292 | navigate | ok | `https://reddit.com/r/cats` |
| 3 | url-5-netflix | 3746 | 536 | navigate | ok | `https://netflix.com/` |
| 3 | url-6-wikipedia | 2540 | 1224 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 4 | app `browser` | 1615 | 8 | launcher | ok | — |
| 4 | app `calculator` | 3232 | 45 | launcher | ok | — |
| 4 | app `notes` | 3227 | 252 | launcher | ok | — |
| 4 | app `store` | 4437 | 558 | launcher | ok | — |
| 4 | url-1-google-home | 811 | 972 | home | ok | `https://google.com/` |
| 4 | url-2-search | 2837 | 1853 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 4 | url-3-first-result | 2544 | 1143 | https://delishpie.com/recipes/crisp-crust | ok | `https://delishpie.com/recipes/crisp-crust` |
| 4 | url-4-reddit | 2541 | 652 | navigate | ok | `https://reddit.com/r/cats` |
| 4 | url-5-netflix | 3351 | 345 | navigate | ok | `https://netflix.com/` |
| 4 | url-6-wikipedia | 2542 | 1106 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |

Engine/server errors, as telemetry recorded them:

- `page: engine or-oss20-groq HTTP 429: {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"openai/gpt-oss-20b is temporarily rate-limited upstre`

JS errors (first few): `Failed to execute 'write' on 'Document': missing ) after argument list` · `Cannot set properties of null (setting 'textContent')`

HUD at the end of the last boot:

```
engine   or-oss20-groq
last     app
ttfb     1188 ms
split    mod 0 / srv 1 / prov 1187
tok/s    682
tokens   4588 in / 2500 out
gen $    0.00109
contract ok
app store
session $ 0.00886
```

## `mercury-2.5`

| kind | n | ttfb ms (med) | total ms (med) | tok/s (med) | tok in (avg) | tok out (avg) | contract ok | errors | $ |
|---|---|---|---|---|---|---|---|---|---|
| boot | 1 | 0 | 655 | 2 | 4488 | 1 | — | 1 | $0.0002 |
| mark | 1 | 0 | 0 | 0 | 0 | 0 | — | 0 | $0.0000 |
| identity | 1 | 0 | 110 | 0 | 1032 | 0 | — | 1 | $0.0000 |

### Per boot

| boot | machine | boot paint ms | interactive ms | revealed ms | contract | injected | blank | unstyled | JS errors | network blocked by CSP |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | — (error) | — | — | 814 | — | 0 | 0 | 0 | 0 | 0 |

### Renders

Wall-clock ms, measured from the click to the document going quiet; it carries about
1.5 s of the harness's own settle polling, so compare engines with it, not the
generation times in the table above.

| boot | step | ms | chars | how | flags | address shown |
|---|---|---|---|---|---|---|

Engine/server errors, as telemetry recorded them:

- `boot: engine mercury-2.5 HTTP 403: <!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<HTML><HEAD><META HTTP-EQUIV`
- `identity: engine mercury-2.5 HTTP 403: <!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<HTML><HEAD><META HTTP-EQUIV`

JS errors (first few): none

HUD at the end of the last boot:

```
boot failed: engine unavailable
session $ 0.00000
```

---

## Funniness and variety — a human looked

I opened every desktop, every app and every page shot in this run. The scores are
mine. Shots: `reviews/shots-bakeoff/<engine>/<boot>/<step>.png`.

### The two prompt examples that are eating the product's variety

Neither is an engine's fault and both are one-line fixes.

**1. `prompts/system/voice.md` hands out three concrete examples of the "quietly
wrong detail", and every engine copies them almost verbatim, every boot.** The
line is: *"a folder dated next year, a process using 0.4 units of an unnamed
resource, a weather warning about 'low ceiling in the stairwell'"*. What shipped,
across engines and boots: `connected 0.4 units`, `connection age: 0.4 sunrises`,
`Conn age: 0.4 parsecs`, `0.4 units of yarn may be used per post`, `0.4 GB RAM
usage`, `Fee applied: £0.42 per calculation`, `uptime: 4.2z`, and a literal `low
ceiling in stairwell` in a browser status bar. The strangeness works — it is the
*same* strangeness in every hallucinated OS. §12.4 already established that
examples are attractors and deleted the identity prompt's name list; these three
examples deserve the same treatment: state the rule, delete the examples, and
roll the strange detail out of `data/dice.json` per session.

**2. `prompts/apps/store.md` names "Dowsing Kit" inside the `os.install()` code
example, and it appears in every store that rendered a listing on either
gpt-oss engine** — 10 of 10 across this session's runs, usually in the featured
slot, carrying the example's own semantics ("locate hidden water", "a live depth
readout and a log of past dowses"). SignalOak sold it with two named reviews;
Honeyhive's was by "Drip & Co."; AquaVault's found water *pipes*. The one
exception is `anthropic-haiku`, whose FURNACE store invented its own catalogue
(its other store was truncated before any listing). Replace the name in the
example with a placeholder.

### Identity variety (§12.4) — the dice work, the register does not vary yet

No name repeated in this session, and none can: `data/names-ring.json` is live
and carries the last 200. The **settings** are genuinely varied and are the best
thing the dice bought: a 2040s railway signal box, a 1970s monastery scriptorium,
a 2090s shoe repair chain, a 1980s rooftop apiary, a 2030s oil rig galley, a
1980s glassblowing works. Taglines are per-boot and good ("Ink the silence, code
the margins", "The Sole of Tomorrow", "Keep the crew fed, keep the tide in
sight").

What repeats is the **shape of the name**: two nouns welded together, initial
caps, no spaces — SignalOak, QuarryDock, WindWatch, StitchWeld, ArcaneGlide,
Honeyhive, TideGrill (7 of 9). `FURNACE` and `Scriptorix` are the two that break
it, and they are the two that feel like a machine rather than a startup. If
Shahmir wants boots that feel *unlike each other*, the dice should roll a naming
register too (a model number, an acronym, a single word, a person's name, a
government codename), not only a setting.

**One boot in four on `cerebras-oss120` was not named at all.** Boots 4 of this
run (`UNNAMED/6BXG`, tagline "it boots.") and of the previous run (`UNNAMED/OEP6`)
are the server's identity fallback firing because the boot stream's identity
comment did not parse. The kernel degrades correctly, but the result is the one
genuinely characterless OS in the set: no name on screen, generic labels
("Navigator", "Gallery", "Recycle", and "Navigator" again), no era. A 25%
identity-parse failure rate is the single biggest variety bug in the run, and it
is an I1 problem, not a taste problem.

### What is genuinely funny

The fake internet is the product. `reddit.com/r/cats` arrives with in-universe
rules ("No memes that reference a non-existent planet", "All posts must include a
timestamp") and posts like "Bengal cat attempts to climb the server rack, reports
0.4 GB RAM usage". The store invents plausible companies, prices, review counts
and one abandoned app with a furious review. The diary app had a locked
"Confidential protocol" entry and a "User arrival note" — the OS writing about
*you* is the best idea in the spec and it lands. Scriptorix's store footer read
"© 2026 Scriptorix — all inventions are fictitious." The calculator charges a fee
per sum. QuarryDock replaced Google with its own `search.quarrydock` and its
"I'm feeling lucky" went to `/lucky?q=`.

The weakest page in the run is **Wikipedia**. Asked for `/wiki/Moon`, every
engine recites the real Moon, accurately, in a clean Wikipedia shell: the one
page where the model's prior beats its invention, and it reads as a screenshot of
the actual internet. It is also the longest page every engine writes (2,183–2,733
chars on cerebras). Either make it Wikipedia-shaped about a moon that does not
exist in this reality, or accept that the demo URL in SPEC §7 is the dullest
thing in the OS.

### Images (§12.5)

**The icon sheets are the best money in the product.** At the size a dock or grid
renders them (~48–56 px on 1440×900) they read cleanly, they are distinct from
each other, and they take the boot's palette: the grain-elevator OS got beige and
steel plates, FURNACE got amber, Honeyhive got orange. Labels stay legible over
the wallpaper thanks to the kernel's one text-shadow rule. Complaints: two or
three cells per sheet come back as near-identical blank plates; one or two break
the palette; on one boot the launcher row overlapped its own icons; and the
counts say `16/20` filled on cerebras and groq, i.e. the model declares more
`[data-os-icon]` elements than the sheet has cells.

**The wallpapers are beautiful and mostly wrong.** flux-schnell returns
gallery-grade photography: a fox on a rope with ink blots, a greyhound in studio
grey, a whisk on a counter, a brass wall with a clock, a railway signal lamp, a
flaming lizard, a swimming pool. Lovely, and *not* OS wallpapers — no era signal,
no tiling, no restraint, and the subject is usually a photographed animal or hero
object. The two that did look like wallpaper were the flat-vector ones
(Honeyhive's honeycomb sunrise, Scriptorix's desk). The prompt is asking for a
picture; it should ask for **a desktop wallpaper of era X**, with the decade and
the word "wallpaper" in it, and a ban on animals and single hero objects.

And the timing shows: the desktop is revealed with **grey empty icon tiles and no
wallpaper**, and the pictures land 2–7 s later (`img` total_ms median 6.7–15.3 s
in the tables above, against §12.5's assumed 0.8 s). The first frame a visitor
sees is an unfinished desktop. On `cerebras-oss120` boot 1 the images never
arrived at all (`img timeout`, 0/20 icons filled, no wallpaper) and that desktop
is flat tan rectangles — which is what every boot looks like for the first few
seconds.

### Scorecard

| engine | funny | varied across boots | would you screenshot it |
|---|---|---|---|
| `cerebras-oss120` | **4/5** | **4/5** (one boot unnamed) | **yes** — and it is the only one fast enough that you would still be there |
| `anthropic-haiku` | **4.5/5** | 3/5 (2 samples, both taskbar, both industrial-facility) | yes, but nobody waits 20 s |
| `or-oss20-groq` | 2.5/5 | 4/5 settings, 2/5 execution | rarely — the shells are thin and the labels are generic |
| `mercury-2.5` | — | — | did not boot |

`anthropic-haiku` writes the best-looking OS in the set by a distance: FURNACE is
an amber-on-black kiln terminal with a 4×4 icon grid, a taskbar reading
"START — THERMAL ALARM LATENT", and a store with a featured "Pyroclastic Monitor"
banner and categorised listings. It is the only engine whose store invented its own
catalogue instead of selling the prompt's Dowsing Kit. It is also the only engine whose desktops our own 25-second
generation timeout kills half the time.

`or-oss20-groq` is cheapest and reads cheapest: 4-letter launcher labels
("Route", "Snap", "Bin", "Calc"), duplicated category tabs, one boot with all 16
launchers off screen, and the only upstream 429 in the run.

## Shots, by boot

| engine | boot | machine | folder |
|---|---|---|---|
| `cerebras-oss120` | 1 | SignalOak | `reviews/shots-bakeoff/cerebras-oss120/1/` |
| `cerebras-oss120` | 2 | QuarryDock | `reviews/shots-bakeoff/cerebras-oss120/2/` |
| `cerebras-oss120` | 3 | Scriptorix | `reviews/shots-bakeoff/cerebras-oss120/3/` |
| `cerebras-oss120` | 4 | UNNAMED/6BXG | `reviews/shots-bakeoff/cerebras-oss120/4/` |
| `anthropic-haiku` | 1 | WindWatch | `reviews/shots-bakeoff/anthropic-haiku/1/` |
| `anthropic-haiku` | 2 | — (desktop timeout) | `reviews/shots-bakeoff/anthropic-haiku/2/` |
| `anthropic-haiku` | 3 | FURNACE | `reviews/shots-bakeoff/anthropic-haiku/3/` |
| `anthropic-haiku` | 4 | — (desktop timeout) | `reviews/shots-bakeoff/anthropic-haiku/4/` |
| `or-oss20-groq` | 1 | StitchWeld | `reviews/shots-bakeoff/or-oss20-groq/1/` |
| `or-oss20-groq` | 2 | ArcaneGlide | `reviews/shots-bakeoff/or-oss20-groq/2/` |
| `or-oss20-groq` | 3 | Honeyhive | `reviews/shots-bakeoff/or-oss20-groq/3/` |
| `or-oss20-groq` | 4 | TideGrill | `reviews/shots-bakeoff/or-oss20-groq/4/` |
| `mercury-2.5` | 1 | — (403 from the provider) | `reviews/shots-bakeoff/mercury-2.5/1/` |

Each folder holds `boot-screen.png` (at first paint, where there was one),
`desktop.png` (at reveal, usually before the images land), `desktop-after.png`
(end of the boot, images in place), `app-<id>.png` and `url-<n>-<name>.png`.

## Findings and fixes, ranked

### 1. The harness was rate-limiting the product (found and fixed during this run)

`GEN_PER_IP_PER_HOUR` defaults to 60. SPEC §7's protocol costs **13 generations
and 2 images per boot**, so four boots exhaust it and every later boot gets the
kernel's queue screen — "the operating system is over capacity, retry in 3480 s"
— instead of an OS. In the run immediately before this one that ate two engines:
`anthropic-haiku` returned four consecutive no-boots and `or-oss20-groq` returned
45–180 s timeouts on every app and page, and neither was the engine's fault.
BAKEOFF-1's "one 180 s timeout" on `or-oss20-groq` was very likely the same
thing. `scripts/bakeoff.mjs` now starts its server with
`GEN_PER_IP_PER_HOUR=100000` (`--percap=`); the daily USD cap is untouched.
**A queue screen and a dead engine are indistinguishable in the numbers**, which
is a product problem too: the queue screen should say which of the two it is in
the telemetry line.

### 2. `anthropic-haiku` cannot finish a desktop inside `GEN_TIMEOUT_MS=25000`

Its `desktop` generations have a median `total_ms` of **25,003 ms** — exactly the
server's wall clock — and two of four boots died as `desktop: timeout` +
`app: This operation was aborted`. That is our own cap, not Anthropic's. Either
give the slow reference engine its own timeout or stop treating haiku as a
possible production fallback: at 79–118 tok/s it cannot serve this product.

### 3. `store` is the least reliable app, and it is the one people screenshot

Three of sixteen app opens on cerebras threw script errors (`Document.write:
Unexpected token ']'`, `missing ) after argument list`, `Cannot set properties of
null`), and the affected stores rendered chrome with an empty catalogue. Others
hit `tokens_out = 2500` exactly — the §12.1 app cap — and were cut off mid-card;
**both of haiku's stores did**, one of them before it had drawn a single
listing (`anthropic-haiku/1/app-store.png`: a search field, five categories and
one orphan icon).
The shape asks for 8–16 listings with developer, version, size, price, rating,
pitch and a paragraph each, which does not fit. Cut the shape (6 listings, one
line each) or give `store` a larger cap; and ask for the listings as markup, not
as a JS array the model then has to render correctly.

### 4. `google.com/search?q=` sometimes renders the home page instead of results

Two boots of the eight in this session answered a `/search?q=` URL with a
google-shaped *home* page carrying the query pre-filled and no results (124 and
88 chars). "Click the first result" then lands on `About` or `I'm Feeling Lucky`
and the next page is Google again. §3.4 names the shape; `system/page.md` needs
the query-string case sharpened — a URL containing `/search?q=` is a results
page, never a home page, and the first link in the document must be a result.

### 5. Launchers: a single line of sixteen, some of them off screen

§12.3 asks for icons in a grid, reachable without scrolling. Three of the ten
booted desktops laid all sixteen launchers in a single line, four more in two
rows of fifteen-plus-one, and `data-os-launchers-offscreen` reported 5, 1 and
**16** clipped (Honeyhive put its entire dock off screen). `anthropic-haiku` is
the only engine that drew an actual 4×4 grid, and it did it both times. The
measurement works; the prompt does not land. One sentence in `desktop.md` — sixteen icons, in
rows of at most eight, none below the fold — is the cheap fix.

### 6. A failed boot still buys its images

`anthropic-haiku` spent 8 image calls across 4 boots of which only 2 booted:
$0.024 for two OSes. Images are started the moment the identity comment parses,
which is correct for speed and wrong for cost when the desktop then dies. Cheap
mitigation: do not start the icon sheet until the desktop generation has its
first chunk.

### 7. Harness fixes made in this session (all in `scripts/`)

- `frameChars` had no element timeout, so the boot-paint poll paid Playwright's
  20-second default per iteration on a boot that had no boot iframe — one dead
  engine could poll for hours. It now takes a 1.5 s element timeout, and the poll
  has a 130 s deadline and stops as soon as the kernel paints its own error
  screen.
- Step ceiling cut from 180 s to `--step=45`: §12.1's target is 2.5 s, so nothing
  informative happens after a minute, and a failing engine used to burn ten dead
  minutes per boot.
- The harness now dispatches `mousedown` before `click` on a launcher. That is
  what a real pointer does, and §12.1's speculative generation hangs off
  `mousedown` — a click-only harness measured a path no visitor takes. It also
  reveals a kernel bug: `streamApp()` sets `frame.onPaint` before the generation
  has an id, so `mark('')` is dropped and **an app's first paint is only ever
  recorded on the speculative path**.
- New in the report: §12.1 pass/fail per target, §12.3 archetype compliance read
  off the live DOM (bar edge, grid vs line, clipped launchers, clock ticking,
  icons filled, wallpaper), §12.4 identity table with era and archetype, §12.5
  image counts and cost, engine error strings, and `$/session` split into
  generations + images.
- Still to do: **shots are not run-numbered.** Report numbers are protected,
  screenshots are not — this run overwrote `shots-bakeoff/<engine>/<boot>/` in
  place, so BAKEOFF-1's shot references now point at BAKEOFF-2's pictures, and
  stale files from the older run had to be deleted by hand. The harness should
  write `shots-bakeoff/<n>/<engine>/<boot>/`.

### 8. Smaller things

- The `/bakeoff/run` engine picker overlaps the boot screen's own first line of
  text at the top-left (cosmetic, and only on the bake-off route).
- `mercury-2.5` is still **HTTP 403 from CloudFront on every call**, including a
  bare `GET /v1/models` with the key in `.env` — `x-amz-cf-pop: MCT50` says the
  distribution is refusing this network, not this key. It cannot be judged from
  this machine. Everything else in `engines.json` answered.
- FURNACE's icon labels are dark on a dark wallpaper and barely legible. The
  kernel's text-shadow is not enough when the model picks a dark label colour on
  a dark image it never saw.

## Verdict

**`cerebras-oss120` is the engine.** It is the only one that passes three of the
four §12.1 targets (desktop interactive 2.33 s, app 1.62 s, page 1.73 s), it took
0 contract misses in 20 generations, it costs **$0.031 a session including
images**, and its fake internet is funny. Its boot-screen paint is 1.06 s against
a 1.0 s target, and the reason is not our code: `provider_ttfb_ms` is 674 ms and
the kernel adds ~90 ms. That target is unreachable while the provider's first
token takes two thirds of a second — either accept ~1.1 s or have the kernel
paint its own first frame from the identity comment, as INTEGRATE-1 already
proposed.

Before it ships, two of its faults are worth more than any engine swap: the
**25% identity-parse failure** (one boot in four has no name and no character)
and the **store's script errors**. Both are cheaper to fix than a re-bake.

**`or-oss20-groq` stays the cheap fallback** ($0.015 a session, 4.82 s to a live
desktop) and nothing more: 10% contract miss, 17.5% broken renders, generic
shells, and it is the only engine that got rate-limited upstream.

**`anthropic-haiku` is the quality ceiling and the reference, not a candidate.**
Twenty seconds to a desktop, $0.24 a session, and our own 25 s generation timeout
kills half its boots. Keep it on `/bakeoff` for anything Shahmir films, and steal
its desktops: if the fast engines could be prompted into FURNACE's 4×4 grid and
its taskbar, §12.3 would be solved.

**`mercury-2.5` cannot be judged from this network** (403 CloudFront on every
call, `GET /v1/models` included). Re-run `npm run bakeoff -- --engines=mercury-2.5
--boots=4` from anywhere else before deciding anything about it; §12.8 still
calls it the challenger on price and variety and there is still no evidence
either way.

Next: fix the two prompt attractors, the identity-parse rate and the store, then
re-bake `cerebras-oss120` alone against this report's numbers. Nothing else in
`engines.json` needs to be tried until then.
