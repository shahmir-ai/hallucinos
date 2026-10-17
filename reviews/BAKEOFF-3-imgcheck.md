# BAKEOFF-3-imgcheck (SPEC §7)

Run 2026-09-17T12:35:43.744Z
`node scripts/bakeoff.mjs --engines=cerebras-oss120 --boots=1 --report=BAKEOFF-3-imgcheck`

1×`cerebras-oss120` boots. Per boot: identity → boot screen → desktop, then 4 apps
(`photos`, `maps`, `mail`, `store`) and 5 URL visits inside the browser (google.com home, a search for
"best pizza in town", the first result of that search, reddit.com/r/cats, netflix.com,
en.wikipedia.org/wiki/Moon).

A step (one app open, one page load) is abandoned as a timeout after 60 s.

Every per-generation number is read from the server's own stdout telemetry line
(`contract_ok`, `ttfb_ms`, `total_ms`, `tok_per_s`, `tokens_in/out`, `usd`); the
HUD was photographed at every step as an independent witness. A render counts as
**broken** if the frame was blank, if its body carried no CSS at all, if a JS
error fired while it loaded, or if it never arrived. Shots:
`reviews/shots-bakeoff/3-imgcheck/<engine>/<boot>/<step>.png`.

| engine | boots | contract miss | boot paint ms | desktop interactive ms | desktop revealed ms | ttfb ms | tok/s | broken renders | $/session (gen + img) |
|---|---|---|---|---|---|---|---|---|---|
| `cerebras-oss120` | 1 | 0% (0/5) | 3147 | 4743 | 5873 | 1095 | 1128 | 0% (0/4) | $0.0157 + $0.0120 = **$0.0277** |

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
| `cerebras-oss120` | 3.15 s MISS | 4.74 s MISS | **2.42 s** PASS | **0.00 s** PASS | 653 ms | — ms | 2969 ms |

## §12.3 archetype compliance

Judged on the mounted desktop, not on the attribute: where the bar actually sits,
whether the launchers form a grid of labelled icons rather than a list, whether a
clock is there and ticks. "patched" means the kernel had to inject the hook, which
is a contract miss the model made good on paper.

| engine | boot | archetype | bar edge | clock | ticks | launchers | layout | clipped | icons filled | wallpaper |
|---|---|---|---|---|---|---|---|---|---|---|
| `cerebras-oss120` | 1 | dock | bottom | yes | yes (seconds) | 24/24 labelled | 12×5 grid | 0 | 16/28 | slot |

## §12.4 identity variety

Every machine this run invented, in order. A repeated name or a repeated
archetype-plus-era across boots of the same engine is the failure §12.4's dice
exist to prevent.

| engine | boot | name | version | era | archetype | tagline |
|---|---|---|---|---|---|---|
| `cerebras-oss120` | 1 | **XQR9** | 1.4.2-rc1 [Nimbus] | 2060s weather balloon station | dock | Elevate the clouds. |

- `cerebras-oss120`: 1/1 distinct names · archetypes dock

## §12.5 images

| engine | image calls | per boot | $ images | $ per image | blocked/failed |
|---|---|---|---|---|---|
| `cerebras-oss120` | 5 | 5.0 | $0.0120 | $0.0024 | 2 |

| engine | img kind | n | ok | median ms | not delivered (reason × n) |
|---|---|---|---|---|---|
| `cerebras-oss120` | wallpaper | 1 | 1 | 7972 | — |
| `cerebras-oss120` | icons | 1 | 1 | 8760 | — |
| `cerebras-oss120` | photo | 3 | 1 | 7627 | img timeout (client) × 2 |

Whether the wallpaper fits the era and whether the icon sheet is legible at 64 px
is a human's call on the shots — see the taste section at the end.

"$/session" is one boot with its apps and pages — what one visitor costs. A console
error that is the CSP refusing a generated document's network call is counted
separately ("network blocked by CSP" below): that is the sandbox working, not a
broken render, though a high number says the model keeps reaching for the web.

## `cerebras-oss120`

| kind | n | ttfb ms (med) | total ms (med) | tok/s (med) | tok in (avg) | tok out (avg) | contract ok | errors | $ |
|---|---|---|---|---|---|---|---|---|---|
| boot | 1 | 2972 | 3100 | 258 | 5335 | 800 | — | 0 | $0.0019 |
| desktop | 1 | 1095 | 1697 | 994 | 8494 | 1686 | 1/1 | 0 | $0.0033 |
| mark | 5 | 0 | 0 | 0 | 0 | 0 | — | 0 | $0.0000 |
| app | 4 | 643 | 1900 | 1225 | 5155 | 1947 | 4/4 | 0 | $0.0105 |
| img | 5 | 0 | 7972 | 0 | 0 | 0 | — | 2 | $0.0120 |

### Per boot

| boot | machine | boot paint ms | interactive ms | revealed ms | contract | injected | blank | unstyled | JS errors | network blocked by CSP |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | XQR9 | 3147 | 4743 | 5873 | ok | 0 | 0 | 0 | 0 | 0 |

### Renders

Wall-clock ms, measured from the click to the document going quiet; it carries about
1.5 s of the harness's own settle polling, so compare engines with it, not the
generation times in the table above.

| boot | step | ms | chars | how | flags | address shown |
|---|---|---|---|---|---|---|
| 1 | app `photos` | 2429 | 171 | launcher | ok | — |
| 1 | app `maps` | 1618 | 33 | launcher | ok | — |
| 1 | app `mail` | 2424 | 969 | launcher | ok | — |
| 1 | app `store` | 2028 | 792 | launcher | ok | — |

Engine/server errors, as telemetry recorded them:

- `img: img timeout (client)`

JS errors (first few): none

HUD at the end of the last boot:

```
engine   cerebras-oss120
last     app
ttfb     545 ms
split    mod 1 / srv 2 / prov 543
tok/s    1128
tokens   5230 in / 1560 out
gen $    0.00238
contract ok
img photo -> app s1
session $ 0.01570
```

---

## Funniness and variety — for a human

This harness does not score taste. Open the shots and fill this in.

### `cerebras-oss120`

Machines it invented:

- boot 1: **XQR9** v1.4.2-rc1 [Nimbus] (dock, 2060s weather balloon station) — _Elevate the clouds._ · shots `reviews/shots-bakeoff/3-imgcheck/cerebras-oss120/1/`

Funny? _____ / 5 · Varied across boots? _____ / 5 · Would you screenshot it? _____

Notes:

> 

## Verdict

Pick the top two or three by contract-miss rate, desktop time and $/session; then play with them on `/bakeoff` (or `/bakeoff/run?engine=<id>` directly) before deciding. Taste breaks ties, numbers do not.
