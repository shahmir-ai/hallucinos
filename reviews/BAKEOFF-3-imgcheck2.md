# BAKEOFF-3-imgcheck2 (SPEC §7)

Run 2026-09-17T12:42:42.919Z
`node scripts/bakeoff.mjs --engines=cerebras-oss120 --boots=1 --report=BAKEOFF-3-imgcheck2`

1×`cerebras-oss120` boots. Per boot: identity → boot screen → desktop, then 4 apps
(`browser`, `photos`, `mail`, `store`) and 5 URL visits inside the browser (google.com home, a search for
"best pizza in town", the first result of that search, reddit.com/r/cats, netflix.com,
en.wikipedia.org/wiki/Moon).

A step (one app open, one page load) is abandoned as a timeout after 60 s.

Every per-generation number is read from the server's own stdout telemetry line
(`contract_ok`, `ttfb_ms`, `total_ms`, `tok_per_s`, `tokens_in/out`, `usd`); the
HUD was photographed at every step as an independent witness. A render counts as
**broken** if the frame was blank, if its body carried no CSS at all, if a JS
error fired while it loaded, or if it never arrived. Shots:
`reviews/shots-bakeoff/3-imgcheck2/<engine>/<boot>/<step>.png`.

| engine | boots | contract miss | boot paint ms | desktop interactive ms | desktop revealed ms | ttfb ms | tok/s | broken renders | $/session (gen + img) |
|---|---|---|---|---|---|---|---|---|---|
| `cerebras-oss120` | 1 | 0% (0/5) | 6268 | 8173 | 8856 | 1568 | 726 | 0% (0/10) | $0.0289 + $0.0180 = **$0.0469** |

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
| `cerebras-oss120` | 6.27 s MISS | 8.17 s MISS | **2.43 s** PASS | 2.84 s MISS | 1094 ms | 1577 ms | 6056 ms |

## §12.3 archetype compliance

Judged on the mounted desktop, not on the attribute: where the bar actually sits,
whether the launchers form a grid of labelled icons rather than a list, whether a
clock is there and ticks. "patched" means the kernel had to inject the hook, which
is a contract miss the model made good on paper.

| engine | boot | archetype | bar edge | clock | ticks | launchers | layout | clipped | icons filled | wallpaper |
|---|---|---|---|---|---|---|---|---|---|---|
| `cerebras-oss120` | 1 | taskbar | bottom | yes | yes (seconds) | 16/16 labelled | 4×4 grid | 0 | 16/20 | slot |

## §12.4 identity variety

Every machine this run invented, in order. A repeated name or a repeated
archetype-plus-era across boots of the same engine is the failure §12.4's dice
exist to prevent.

| engine | boot | name | version | era | archetype | tagline |
|---|---|---|---|---|---|---|
| `cerebras-oss120` | 1 | **paper5** | 0.9.2-rc1 (beta‑glass) | 1970s school dinner kitchen | taskbar | Serving trays, serving files |

- `cerebras-oss120`: 1/1 distinct names · archetypes taskbar

## §12.5 images

| engine | image calls | per boot | $ images | $ per image | blocked/failed |
|---|---|---|---|---|---|
| `cerebras-oss120` | 10 | 10.0 | $0.0180 | $0.0018 | 6 |

| engine | img kind | n | ok | median ms | not delivered (reason × n) |
|---|---|---|---|---|---|
| `cerebras-oss120` | photo | 7 | 2 | 3888 | img timeout (client) × 5 |
| `cerebras-oss120` | faces | 1 | 0 | 0 | img timeout (client) × 1 |
| `cerebras-oss120` | wallpaper | 1 | 1 | 15134 | — |
| `cerebras-oss120` | icons | 1 | 1 | 15948 | — |

Whether the wallpaper fits the era and whether the icon sheet is legible at 64 px
is a human's call on the shots — see the taste section at the end.

"$/session" is one boot with its apps and pages — what one visitor costs. A console
error that is the CSP refusing a generated document's network call is counted
separately ("network blocked by CSP" below): that is the sandbox working, not a
broken render, though a high number says the model keeps reaching for the web.

## `cerebras-oss120`

| kind | n | ttfb ms (med) | total ms (med) | tok/s (med) | tok in (avg) | tok out (avg) | contract ok | errors | $ |
|---|---|---|---|---|---|---|---|---|---|
| boot | 1 | 6060 | 6312 | 127 | 5337 | 800 | — | 0 | $0.0019 |
| desktop | 1 | 1187 | 2020 | 693 | 8499 | 1400 | 1/1 | 0 | $0.0031 |
| mark | 11 | 0 | 0 | 0 | 0 | 0 | — | 0 | $0.0000 |
| app | 4 | 1084 | 2322 | 994 | 5140 | 1608 | 4/4 | 0 | $0.0096 |
| page | 6 | 1635 | 2243 | 726 | 5569 | 1446 | — | 0 | $0.0143 |
| img | 10 | 0 | 2151 | 0 | 0 | 0 | — | 6 | $0.0180 |

### Per boot

| boot | machine | boot paint ms | interactive ms | revealed ms | contract | injected | blank | unstyled | JS errors | network blocked by CSP |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | paper5 | 6268 | 8173 | 8856 | ok | 0 | 0 | 0 | 0 | 0 |

### Renders

Wall-clock ms, measured from the click to the document going quiet; it carries about
1.5 s of the harness's own settle polling, so compare engines with it, not the
generation times in the table above.

| boot | step | ms | chars | how | flags | address shown |
|---|---|---|---|---|---|---|
| 1 | app `browser` | 3237 | 93 | launcher | ok | — |
| 1 | app `photos` | 2426 | 103 | launcher | ok | — |
| 1 | app `mail` | 2431 | 511 | launcher | ok | — |
| 1 | app `store` | 2018 | 813 | launcher | ok | — |
| 1 | url-1-google-home | 1635 | 89 | home | ok | `https://google.com/` |
| 1 | url-2-search | 2843 | 1835 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 1 | url-3-first-result | 2951 | 1010 | https://pizzahaven.example.com/menu | ok | `https://pizzahaven.example.com/menu` |
| 1 | url-4-reddit | 2021 | 935 | navigate | ok | `https://reddit.com/r/cats` |
| 1 | url-5-netflix | 2545 | 881 | navigate | ok | `https://netflix.com/` |
| 1 | url-6-wikipedia | 2947 | 2124 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |

Engine/server errors, as telemetry recorded them:

- `img: img timeout (client)`

JS errors (first few): none

HUD at the end of the last boot:

```
engine   cerebras-oss120
last     app
ttfb     953 ms
split    mod 0 / srv 2 / prov 951
tok/s    994
tokens   5234 in / 1422 out
gen $    0.00229
contract ok
app store
session $ 0.02889
```

---

## Funniness and variety — for a human

This harness does not score taste. Open the shots and fill this in.

### `cerebras-oss120`

Machines it invented:

- boot 1: **paper5** v0.9.2-rc1 (beta‑glass) (taskbar, 1970s school dinner kitchen) — _Serving trays, serving files_ · shots `reviews/shots-bakeoff/3-imgcheck2/cerebras-oss120/1/`

Funny? _____ / 5 · Varied across boots? _____ / 5 · Would you screenshot it? _____

Notes:

> 

## Verdict

Pick the top two or three by contract-miss rate, desktop time and $/session; then play with them on `/bakeoff` (or `/bakeoff/run?engine=<id>` directly) before deciding. Taste breaks ties, numbers do not.
