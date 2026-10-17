# BAKEOFF-4-run (SPEC §7)

Run 2026-09-17T14:32:14.351Z
`node scripts/bakeoff.mjs --engines=auto,cerebras-oss120 --boots=4 --report=BAKEOFF-4-run`

4×`auto`, 4×`cerebras-oss120` boots. Per boot: identity → boot screen → desktop, then 4 apps
(`browser`, `calculator`, `notes`, `store`) and 5 URL visits inside the browser (google.com home, a search for
"best pizza in town", the first result of that search, reddit.com/r/cats, netflix.com,
en.wikipedia.org/wiki/Moon).

A step (one app open, one page load) is abandoned as a timeout after 60 s.

Every per-generation number is read from the server's own stdout telemetry line
(`contract_ok`, `ttfb_ms`, `total_ms`, `tok_per_s`, `tokens_in/out`, `usd`); the
HUD was photographed at every step as an independent witness. A render counts as
**broken** if the frame was blank, if its body carried no CSS at all, if a JS
error fired while it loaded, or if it never arrived. Shots:
`reviews/shots-bakeoff/4-run/<engine>/<boot>/<step>.png`.

| engine | boots | contract miss | boot paint ms | desktop interactive ms | desktop revealed ms | ttfb ms | tok/s | broken renders | $/session (gen + img) |
|---|---|---|---|---|---|---|---|---|---|
| `auto` | 4 | 0% (0/20) | 1922 | 4049 | 4833 | 1177 | 801 | 2.5% (1/40) | $0.0421 + $0.0082 = **$0.0503** |
| `cerebras-oss120` | 4 | 5.9% (1/17) | 1730 | 3743 | 4333 | 1188 | 774 | 8.8% (3/34) | $0.0250 + $0.0075 = **$0.0325** |

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
| `auto` | 1.92 s MISS | 4.05 s MISS | **2.42 s** PASS | **2.14 s** PASS | 1497 ms | 1108 ms | 1771 ms |
| `cerebras-oss120` | 1.73 s MISS | **3.74 s** PASS | **2.42 s** PASS | **2.42 s** PASS | 1415 ms | 1260 ms | 1626 ms |

## H3 — the boot screen, per boot

Two instruments, deliberately independent. **ink (harness)** is this runner
polling the boot iframe from outside for any element with a box — it knows
nothing about the runtime's report. **ink (kernel)** is `data-os-boot-ink`, the
runtime's own first-element-with-a-box message, and `none` there is the blank
boot of HANDOFF-4's headline: a generation that emitted the identity comment and
no document. **hold** is how long §12.3's 2.5 s floor actually held after that
ink (0 on a frame that never inked — the point of the seam), **revealed** is
when the overlay came off. A blank boot is only a *visible* fault if hold > 0.


| engine | boot | ink (harness) | ink (kernel) | interactive | hold | revealed | blank boot |
|---|---|---|---|---|---|---|---|
| `auto` | 1 | 1586 | 1530 | 2957 | 1073 | 4034 | no |
| `auto` | 2 | 2222 | 2191 | 4049 | 642 | 4694 | no |
| `auto` | 3 | 1376 | 1338 | 2956 | 882 | 3841 | no |
| `auto` | 4 | 1922 | 1873 | 6516 | 0 | 6518 | no |
| `cerebras-oss120` | 1 | 1322 | 1338 | 2696 | 1142 | 3841 | no |
| `cerebras-oss120` | 2 | 1042 | 1005 | 2865 | 640 | 3508 | no |
| `cerebras-oss120` | 3 | 1863 | 1838 | 3924 | 414 | 4342 | no |
| `cerebras-oss120` | 4 | 1730 | 1672 | 3743 | 429 | 4175 | no |

- `auto`: **0/4 blank boots** (kernel said `none`), 0/4 with no pixel the harness could see · median ink 1873 ms (kernel) / 1922 ms (harness) · worst 2222 ms (harness)

- `cerebras-oss120`: **0/4 blank boots** (kernel said `none`), 0/4 with no pixel the harness could see · median ink 1672 ms (kernel) / 1730 ms (harness) · worst 1863 ms (harness)

## H2 — the hedge

Which engine actually wrote each generation. `hedged` means a second lane was
started (for `boot` and `desktop` `HEDGE_AFTER_MS_BOOT` is 0, so both start at
once); the loser is aborted at the winner's 64-character commit point and its
billed input is already inside the `$/session` column above. An explicit engine
id bypasses routing and hedging entirely, so an unhedged column here is the
control, not a failure.

| engine | kind | n | hedged | winners | median loser abort ms | loser input tokens |
|---|---|---|---|---|---|---|
| `auto` | boot | 4 | 4 | cerebras-oss120 3, or-oss120-groq 1 | 1783 | 23251 |
| `auto` | desktop | 4 | 4 | cerebras-oss120 3, or-oss120-groq 1 | 905 | 40672 |
| `auto` | app | 16 | 16 | cerebras-oss120 16 | 1289 | 93615 |
| `auto` | page | 24 | 24 | cerebras-oss120 22, or-oss120-groq 2 | 975 | 161986 |
| `cerebras-oss120` | boot | 4 | 0 | cerebras-oss120 4 | — | 0 |
| `cerebras-oss120` | desktop | 4 | 0 | cerebras-oss120 4 | — | 0 |
| `cerebras-oss120` | app | 13 | 0 | cerebras-oss120 13 | — | 0 |
| `cerebras-oss120` | page | 18 | 0 | cerebras-oss120 18 | — | 0 |

- `auto`: 48/48 generations hedged · 79881 loser input tokens per session · 0 failovers

- `cerebras-oss120`: 0/39 generations hedged · 0 loser input tokens per session · 0 failovers

## §12.3 archetype compliance

Judged on the mounted desktop, not on the attribute: where the bar actually sits,
whether the launchers form a grid of labelled icons rather than a list, whether a
clock is there and ticks. "patched" means the kernel had to inject the hook, which
is a contract miss the model made good on paper. "clipped" is launchers off the
screen; "overlap" is launchers written across each other (BAKEOFF-3 open issue 3,
unmeasured until now); "icons filled" counts only the slots inside a launcher,
with any surplus slots elsewhere in the document — menus, task templates, which
the sheet was never bought for — in brackets (open issue 8).

| engine | boot | archetype | bar edge | clock | ticks | launchers | layout | clipped | overlap | icons filled | wallpaper |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `auto` | 1 | taskbar | bottom | yes | yes (seconds) | 16/16 labelled | 8×2 grid | 0 | 0 | 16/16 (+4 elsewhere) | slot |
| `auto` | 2 | taskbar | bottom | yes | yes (minutes) | 16/16 labelled | 4×4 grid | 0 | 0 | 16/16 (+4 elsewhere) | slot |
| `auto` | 3 | taskbar | bottom | yes | yes (seconds) | 16/16 labelled | 4×4 grid | 0 | 0 | 16/16 (+4 elsewhere) | slot |
| `auto` | 4 | dock | bottom | yes | yes (minutes) | 16/16 labelled | 12×3 grid | 0 | 0 | 16/16 (+5 elsewhere) | slot |
| `cerebras-oss120` | 1 | dock | bottom | yes | yes (seconds) | 16/16 labelled | 12×3 grid | 0 | 0 | 16/16 (+1 elsewhere) | slot |
| `cerebras-oss120` | 2 | taskbar | bottom | yes | undecided ("19:28 Sep 17, 2026" → "19:28 Sep 17, 2026") | 16/16 labelled | 4×4 grid | 0 | 0 | 16/16 (+4 elsewhere) | slot |
| `cerebras-oss120` | 3 | taskbar | bottom | yes | yes (seconds) | 16/16 labelled | 8×2 grid | 0 | 0 | 0/16 (+4 elsewhere) | **none** |
| `cerebras-oss120` | 4 | taskbar | bottom | patched | yes (seconds) | 16/16 labelled | 8×2 grid | 0 | 0 | 16/16 (+4 elsewhere) | slot |

## §12.4 identity variety

Every machine this run invented, in order. A repeated name or a repeated
archetype-plus-era across boots of the same engine is the failure §12.4's dice
exist to prevent.

| engine | boot | name | version | era | archetype | tagline |
|---|---|---|---|---|---|---|
| `auto` | 1 | **glide7** | 1.2.0-rc3 [Alpine] | 2030s ski‑lift control hut | taskbar | Elevating the lift, quietly |
| `auto` | 2 | **Nuvra** | 2.4.1-rc (Delta) | 1950s greenhouse complex | taskbar | Whispers of leaf and steel |
| `auto` | 3 | **Spade** | 1.3.0‑rc1 (Delta) | 1960s kelp‑harvesting boat | taskbar | Harvesting the tides with quiet care |
| `auto` | 4 | **node7** | 1.2.0‑rc1 (copper) | 2010s village telephone exchange | dock | Silent exchange core |
| `cerebras-oss120` | 1 | **FORGEWIN** | 2.1.0-rc3 [MIRAGE] | 2020s prison workshop | dock | When backups become gospel |
| `cerebras-oss120` | 2 | **Vivid** | 2.3.1‑rc5 [Aurora] | 2040s salt works | taskbar | Competitive salinity at peak efficiency |
| `cerebras-oss120` | 3 | **Zircon** | 1.0.0-rc1 [Obsidian] | 1950s glassblowing works | taskbar | Silent glass, silent flame |
| `cerebras-oss120` | 4 | **BKC** | 1.2.0-rc1 [Cinnamon] | 2000s bakery cooperative | taskbar | Breadcraft Kernel Console |

- `auto`: 4/4 distinct names · archetypes taskbar, taskbar, taskbar, dock

- `cerebras-oss120`: 4/4 distinct names · archetypes dock, taskbar, taskbar, taskbar

## §12.5 images

| engine | image calls | per boot | $ images | $ per image | blocked/failed |
|---|---|---|---|---|---|
| `auto` | 11 | 2.8 | $0.0330 | $0.0030 | 0 |
| `cerebras-oss120` | 11 | 2.8 | $0.0300 | $0.0027 | 2 |

| engine | img kind | n | ok | median ms | not delivered (reason × n) |
|---|---|---|---|---|---|
| `auto` | wallpaper | 4 | 4 | 9627 | — |
| `auto` | icons | 4 | 4 | 11751 | — |
| `auto` | photo | 3 | 3 | 3797 | — |
| `cerebras-oss120` | wallpaper | 4 | 3 | 3555 | img upstream × 1 |
| `cerebras-oss120` | icons | 4 | 3 | 4226 | img timeout (clock) × 1 |
| `cerebras-oss120` | photo | 3 | 3 | 6472 | — |

Whether the wallpaper fits the era and whether the icon sheet is legible at 64 px
is a human's call on the shots — see the taste section at the end.

"$/session" is one boot with its apps and pages — what one visitor costs. A console
error that is the CSP refusing a generated document's network call is counted
separately ("network blocked by CSP" below): that is the sandbox working, not a
broken render, though a high number says the model keeps reaching for the web.

## `auto`

| kind | n | ttfb ms (med) | total ms (med) | tok/s (med) | tok in (avg) | tok out (avg) | contract ok | errors | $ |
|---|---|---|---|---|---|---|---|---|---|
| boot | 4 | 1785 | 2293 | 384 | 5808 | 741 | — | 0 | $0.0113 |
| desktop | 4 | 906 | 1953 | 956 | 9909 | 1643 | 4/4 | 0 | $0.0204 |
| mark | 45 | 0 | 0 | 0 | 0 | 0 | — | 0 | $0.0000 |
| app | 16 | 1291 | 1838 | 658 | 5590 | 1239 | 16/16 | 0 | $0.0501 |
| page | 24 | 977 | 1567 | 972 | 6428 | 1447 | — | 0 | $0.0867 |
| img | 11 | 0 | 8917 | 0 | 0 | 0 | — | 0 | $0.0330 |

### Per boot

| boot | machine | boot paint ms | interactive ms | revealed ms | contract | injected | blank | unstyled | JS errors | network blocked by CSP |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | glide7 | 1586 | 2957 | 4345 | ok | 0 | 0 | 0 | 1 | 0 |
| 2 | Nuvra | 2222 | 4049 | 4833 | ok | 0 | 0 | 0 | 0 | 0 |
| 3 | Spade | 1376 | 2956 | 4330 | ok | 0 | 0 | 0 | 0 | 0 |
| 4 | node7 | 1922 | 6516 | 6828 | ok | 0 | 0 | 0 | 0 | 0 |

### Renders

Wall-clock ms, measured from the click to the document going quiet; it carries about
1.5 s of the harness's own settle polling, so compare engines with it, not the
generation times in the table above.

| boot | step | ms | chars | how | flags | address shown |
|---|---|---|---|---|---|---|
| 1 | app `browser` | 1214 | 8 | launcher | ok | — |
| 1 | app `calculator` | 2020 | 61 | launcher | 1 js | — |
| 1 | app `notes` | 2020 | 198 | launcher | ok | — |
| 1 | app `store` | 2424 | 883 | launcher | ok | — |
| 1 | url-1-google-home | 403 | 103 | home | ok | `https://google.com/` |
| 1 | url-2-search | 2032 | 1663 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 1 | url-3-first-result | 6576 | 1482 | https://crustyhaven.com/menu/pizza | ok | `https://crustyhaven.com/menu/pizza` |
| 1 | url-4-reddit | 3745 | 1920 | navigate | ok | `https://reddit.com/r/cats` |
| 1 | url-5-netflix | 2136 | 520 | navigate | ok | `https://netflix.com/` |
| 1 | url-6-wikipedia | 1733 | 1937 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 2 | app `browser` | 2423 | 48 | launcher | ok | — |
| 2 | app `calculator` | 1616 | 37 | launcher | ok | — |
| 2 | app `notes` | 2424 | 201 | launcher | ok | — |
| 2 | app `store` | 2830 | 1045 | launcher | ok | — |
| 2 | url-1-google-home | 403 | 73 | home | ok | `https://google.com/` |
| 2 | url-2-search | 2034 | 1546 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 2 | url-3-first-result | 1614 | 781 | https://tallowpizzas.com/menu | ok | `https://tallowpizzas.com/menu` |
| 2 | url-4-reddit | 2419 | 791 | navigate | ok | `https://reddit.com/r/cats` |
| 2 | url-5-netflix | 2139 | 69 | navigate | ok | `https://netflix.com/` |
| 2 | url-6-wikipedia | 1738 | 1684 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 3 | app `browser` | 2422 | 7 | launcher | ok | — |
| 3 | app `calculator` | 3227 | 70 | launcher | ok | — |
| 3 | app `notes` | 2830 | 141 | launcher | ok | — |
| 3 | app `store` | 2418 | 455 | launcher | ok | — |
| 3 | url-1-google-home | 404 | 88 | home | ok | `https://google.com/` |
| 3 | url-2-search | 2029 | 1552 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 3 | url-3-first-result | 2138 | 1437 | https://pizzaeuphoria.com/article/9842 | ok | `https://pizzaeuphoria.com/article/9842` |
| 3 | url-4-reddit | 2137 | 1570 | navigate | ok | `https://reddit.com/r/cats` |
| 3 | url-5-netflix | 3224 | 318 | navigate | ok | `https://netflix.com/` |
| 3 | url-6-wikipedia | 2140 | 1817 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 4 | app `browser` | 1614 | 0 | launcher | ok | — |
| 4 | app `calculator` | 2050 | 33 | launcher | ok | — |
| 4 | app `notes` | 4033 | 131 | launcher | ok | — |
| 4 | app `store` | 4842 | 913 | launcher | ok | — |
| 4 | url-1-google-home | 405 | 61 | home | ok | `https://google.com/` |
| 4 | url-2-search | 2428 | 1312 | form | ok | `https://www.google.com/search?q=best%20pizza%20in%20town` |
| 4 | url-3-first-result | 4951 | 954 | https://corbelpizza.example.com/menu | ok | `https://corbelpizza.example.com/menu` |
| 4 | url-4-reddit | 2938 | 1602 | navigate | ok | `https://reddit.com/r/cats` |
| 4 | url-5-netflix | 2132 | 432 | navigate | ok | `https://netflix.com/` |
| 4 | url-6-wikipedia | 2139 | 2525 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |

JS errors (first few): `Failed to execute 'write' on 'Document': Unexpected token ')'`

HUD at the end of the last boot:

```
engine   cerebras-oss120
last     app
ttfb     3140 ms
split    mod 0 / srv 6 / prov 3118
tok/s    350
tokens   5851 in / 1493 out
gen $    0.00341
contract ok
hedge    won by cerebras-oss120 / lost or-oss120-groq
ink      boot 1873 ms
app store
session $ 0.04208
```

## `cerebras-oss120`

| kind | n | ttfb ms (med) | total ms (med) | tok/s (med) | tok in (avg) | tok out (avg) | contract ok | errors | $ |
|---|---|---|---|---|---|---|---|---|---|
| boot | 4 | 1627 | 1798 | 457 | 5806 | 936 | — | 0 | $0.0084 |
| mark | 36 | 0 | 0 | 0 | 0 | 0 | — | 0 | $0.0000 |
| desktop | 4 | 1417 | 2066 | 860 | 9907 | 1621 | 3/4 | 0 | $0.0144 |
| img | 11 | 0 | 6472 | 0 | 0 | 0 | — | 2 | $0.0300 |
| app | 13 | 1299 | 1907 | 900 | 5576 | 1402 | 13/13 | 0 | $0.0307 |
| page | 18 | 1180 | 1815 | 830 | 6431 | 1411 | — | 0 | $0.0465 |

### Per boot

| boot | machine | boot paint ms | interactive ms | revealed ms | contract | injected | blank | unstyled | JS errors | network blocked by CSP |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | FORGEWIN | 1322 | 2696 | 4333 | ok | 0 | 2 | 2 | 0 | 0 |
| 2 | Vivid | 1042 | 2865 | 3828 | ok | 0 | 0 | 0 | 0 | 0 |
| 3 | Zircon | 1863 | 3924 | 4831 | ok | 0 | 0 | 0 | 2 | 0 |
| 4 | BKC | 1730 | 3743 | 4323 | miss | 1 | 0 | 0 | 1 | 0 |

### Renders

Wall-clock ms, measured from the click to the document going quiet; it carries about
1.5 s of the harness's own settle polling, so compare engines with it, not the
generation times in the table above.

| boot | step | ms | chars | how | flags | address shown |
|---|---|---|---|---|---|---|
| 1 | app `browser` | 60050 | 0 | launcher | blank, unstyled | — |
| 1 | app `calculator` | 60028 | 0 | launcher | blank, unstyled | — |
| 1 | app `notes` | 2424 | 241 | launcher | ok | — |
| 1 | app `store` | 410 | 241 | launcher | ok | — |
| 2 | app `browser` | 1612 | 58 | launcher | ok | — |
| 2 | app `calculator` | 1616 | 31 | launcher | ok | — |
| 2 | app `notes` | 2824 | 246 | launcher | ok | — |
| 2 | app `store` | 5640 | 894 | launcher | ok | — |
| 2 | url-1-google-home | 404 | 67 | home | ok | `https://google.com/` |
| 2 | url-2-search | 2029 | 1508 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 2 | url-3-first-result | 2136 | 861 | https://pizzaplus.marlgate.com/menu | ok | `https://pizzaplus.marlgate.com/menu` |
| 2 | url-4-reddit | 2942 | 871 | navigate | ok | `https://reddit.com/r/cats` |
| 2 | url-5-netflix | 1732 | 460 | navigate | ok | `https://netflix.com/` |
| 2 | url-6-wikipedia | 2133 | 2211 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 3 | app `browser` | 2020 | 7 | launcher | ok | — |
| 3 | app `calculator` | 2016 | 35 | launcher | ok | — |
| 3 | app `notes` | 2020 | 146 | launcher | ok | — |
| 3 | app `store` | 4830 | 804 | launcher | ok | — |
| 3 | url-1-google-home | 404 | 72 | home | ok | `https://google.com/` |
| 3 | url-2-search | 5254 | 1342 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 3 | url-3-first-result | 2540 | 1039 | https://pizzaparadise.stave.is/menus | 1 js | `https://pizzaparadise.stave.is/menus` |
| 3 | url-4-reddit | 2947 | 906 | navigate | ok | `https://reddit.com/r/cats` |
| 3 | url-5-netflix | 2142 | 362 | navigate | ok | `https://netflix.com/` |
| 3 | url-6-wikipedia | 2415 | 2252 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 4 | app `browser` | 2422 | 45 | launcher | ok | — |
| 4 | app `calculator` | 1615 | 35 | launcher | ok | — |
| 4 | app `notes` | 3225 | 211 | launcher | ok | — |
| 4 | app `store` | 2422 | 1331 | launcher | ok | — |
| 4 | url-1-google-home | 403 | 81 | home | ok | `https://google.com/` |
| 4 | url-2-search | 2836 | 1631 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 4 | url-3-first-result | 2421 | 1003 | https://pizzatown.com/menu | ok | `https://pizzatown.com/menu` |
| 4 | url-4-reddit | 2820 | 1791 | navigate | ok | `https://reddit.com/r/cats` |
| 4 | url-5-netflix | 3344 | 286 | navigate | ok | `https://netflix.com/` |
| 4 | url-6-wikipedia | 2541 | 2073 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |

Engine/server errors, as telemetry recorded them:

- `img: img upstream`
- `img: img timeout (clock)`

JS errors (first few): `Failed to load resource: the server responded with a status of 502 (Bad Gateway)` · `Failed to load resource: the server responded with a status of 504 (Gateway Timeout)` · `Cannot set properties of null (setting 'textContent')`

HUD at the end of the last boot:

```
engine   cerebras-oss120
last     app
ttfb     1201 ms
split    mod 0 / srv 1 / prov 1200
tok/s    1000
tokens   5861 in / 2044 out
gen $    0.00288
contract ok
ink      boot 1672 ms
app store
session $ 0.03083
```

---

## Funniness and variety — for a human

This harness does not score taste. Open the shots and fill this in.

### `auto`

Machines it invented:

- boot 1: **glide7** v1.2.0-rc3 [Alpine] (taskbar, 2030s ski‑lift control hut) — _Elevating the lift, quietly_ · shots `reviews/shots-bakeoff/4-run/auto/1/`
- boot 2: **Nuvra** v2.4.1-rc (Delta) (taskbar, 1950s greenhouse complex) — _Whispers of leaf and steel_ · shots `reviews/shots-bakeoff/4-run/auto/2/`
- boot 3: **Spade** v1.3.0‑rc1 (Delta) (taskbar, 1960s kelp‑harvesting boat) — _Harvesting the tides with quiet care_ · shots `reviews/shots-bakeoff/4-run/auto/3/`
- boot 4: **node7** v1.2.0‑rc1 (copper) (dock, 2010s village telephone exchange) — _Silent exchange core_ · shots `reviews/shots-bakeoff/4-run/auto/4/`

Funny? _____ / 5 · Varied across boots? _____ / 5 · Would you screenshot it? _____

Notes:

> 

### `cerebras-oss120`

Machines it invented:

- boot 1: **FORGEWIN** v2.1.0-rc3 [MIRAGE] (dock, 2020s prison workshop) — _When backups become gospel_ · shots `reviews/shots-bakeoff/4-run/cerebras-oss120/1/`
- boot 2: **Vivid** v2.3.1‑rc5 [Aurora] (taskbar, 2040s salt works) — _Competitive salinity at peak efficiency_ · shots `reviews/shots-bakeoff/4-run/cerebras-oss120/2/`
- boot 3: **Zircon** v1.0.0-rc1 [Obsidian] (taskbar, 1950s glassblowing works) — _Silent glass, silent flame_ · shots `reviews/shots-bakeoff/4-run/cerebras-oss120/3/`
- boot 4: **BKC** v1.2.0-rc1 [Cinnamon] (taskbar, 2000s bakery cooperative) — _Breadcraft Kernel Console_ · shots `reviews/shots-bakeoff/4-run/cerebras-oss120/4/`

Funny? _____ / 5 · Varied across boots? _____ / 5 · Would you screenshot it? _____

Notes:

> 

## Verdict

Pick the top two or three by contract-miss rate, desktop time and $/session; then play with them on `/bakeoff` (or `/bakeoff/run?engine=<id>` directly) before deciding. Taste breaks ties, numbers do not.
