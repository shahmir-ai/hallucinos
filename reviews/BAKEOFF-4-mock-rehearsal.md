# BAKEOFF-4-mock-rehearsal (SPEC §7)

Run 2026-09-17T14:23:24.560Z
`node scripts/bakeoff.mjs --engines=mock --boots=2 --report=BAKEOFF-4-mock-rehearsal`

2×`mock` boots. Per boot: identity → boot screen → desktop, then 2 apps
(`browser`, `notes`) and 5 URL visits inside the browser (google.com home, a search for
"best pizza in town", the first result of that search, reddit.com/r/cats, netflix.com,
en.wikipedia.org/wiki/Moon).

A step (one app open, one page load) is abandoned as a timeout after 60 s.

Every per-generation number is read from the server's own stdout telemetry line
(`contract_ok`, `ttfb_ms`, `total_ms`, `tok_per_s`, `tokens_in/out`, `usd`); the
HUD was photographed at every step as an independent witness. A render counts as
**broken** if the frame was blank, if its body carried no CSS at all, if a JS
error fired while it loaded, or if it never arrived. Shots:
`reviews/shots-bakeoff/4-mock-rehearsal/<engine>/<boot>/<step>.png`.

| engine | boots | contract miss | boot paint ms | desktop interactive ms | desktop revealed ms | ttfb ms | tok/s | broken renders | $/session (gen + img) |
|---|---|---|---|---|---|---|---|---|---|
| `mock` | 2 | 0% (0/6) | 115 | 326 | 2828 | 10 | 3829 | 0% (0/16) | $0.0000 + $0.0000 = **$0.0000** |

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
| `mock` | **0.12 s** PASS | **0.33 s** PASS | **0.81 s** PASS | **0.81 s** PASS | 75 ms | 65 ms | 9 ms |

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
| `mock` | 1 | 115 | 100 | 326 | 2274 | 2602 | no |
| `mock` | 2 | 99 | 89 | 305 | 2284 | 2591 | no |

- `mock`: **0/2 blank boots** (kernel said `none`), 0/2 with no pixel the harness could see · median ink 100 ms (kernel) / 115 ms (harness) · worst 115 ms (harness)

## H2 — the hedge

Which engine actually wrote each generation. `hedged` means a second lane was
started (for `boot` and `desktop` `HEDGE_AFTER_MS_BOOT` is 0, so both start at
once); the loser is aborted at the winner's 64-character commit point and its
billed input is already inside the `$/session` column above. An explicit engine
id bypasses routing and hedging entirely, so an unhedged column here is the
control, not a failure.

| engine | kind | n | hedged | winners | median loser abort ms | loser input tokens |
|---|---|---|---|---|---|---|
| `mock` | boot | 2 | 0 | mock 2 | — | 0 |
| `mock` | desktop | 2 | 0 | mock 2 | — | 0 |
| `mock` | app | 4 | 0 | mock 4 | — | 0 |
| `mock` | page | 12 | 0 | mock 12 | — | 0 |

- `mock`: 0/20 generations hedged · 0 loser input tokens per session · 0 failovers

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
| `mock` | 1 | taskbar | bottom | yes | yes (seconds) | 16/16 labelled | 11×2 grid | 0 | 0 | 0/16 (+2 elsewhere) | **none** |
| `mock` | 2 | dock | bottom | yes | yes (seconds) | 16/16 labelled | 11×2 grid | 0 | 0 | 0/16 (+2 elsewhere) | **none** |

## §12.4 identity variety

Every machine this run invented, in order. A repeated name or a repeated
archetype-plus-era across boots of the same engine is the failure §12.4's dice
exist to prevent.

| engine | boot | name | version | era | archetype | tagline |
|---|---|---|---|---|---|---|
| `mock` | 1 | **HALCYON 2** | 3.2 | 1997-adjacent | taskbar | a tundra machine |
| `mock` | 2 | **CROMULENT 13** | 5.6 | 1997-adjacent | dock | a argon machine |

- `mock`: 2/2 distinct names · archetypes taskbar, dock

## §12.5 images

| engine | image calls | per boot | $ images | $ per image | blocked/failed |
|---|---|---|---|---|---|
| `mock` | 0 | 0.0 | $0.0000 | $— | 0 |

| engine | img kind | n | ok | median ms | not delivered (reason × n) |
|---|---|---|---|---|---|

Whether the wallpaper fits the era and whether the icon sheet is legible at 64 px
is a human's call on the shots — see the taste section at the end.

"$/session" is one boot with its apps and pages — what one visitor costs. A console
error that is the CSP refusing a generated document's network call is counted
separately ("network blocked by CSP" below): that is the sandbox working, not a
broken render, though a high number says the model keeps reaching for the web.

## `mock`

| kind | n | ttfb ms (med) | total ms (med) | tok/s (med) | tok in (avg) | tok out (avg) | contract ok | errors | $ |
|---|---|---|---|---|---|---|---|---|---|
| boot | 2 | 14 | 130 | 3951 | 5797 | 482 | — | 0 | $0.0000 |
| desktop | 2 | 11 | 264 | 4114 | 10153 | 1048 | 2/2 | 0 | $0.0000 |
| mark | 18 | 0 | 0 | 0 | 0 | 0 | — | 0 | $0.0000 |
| app | 4 | 10 | 107 | 3243 | 5691 | 315 | 4/4 | 0 | $0.0000 |
| page | 12 | 10 | 140 | 3900 | 6743 | 614 | — | 0 | $0.0000 |

### Per boot

| boot | machine | boot paint ms | interactive ms | revealed ms | contract | injected | blank | unstyled | JS errors | network blocked by CSP |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | HALCYON 2 | 115 | 326 | 2828 | ok | 0 | 0 | 0 | 2 | 147 |
| 2 | CROMULENT 13 | 99 | 305 | 2822 | ok | 0 | 0 | 0 | 2 | 147 |

### Renders

Wall-clock ms, measured from the click to the document going quiet; it carries about
1.5 s of the harness's own settle polling, so compare engines with it, not the
generation times in the table above.

| boot | step | ms | chars | how | flags | address shown |
|---|---|---|---|---|---|---|
| 1 | app `browser` | 816 | 32 | launcher | ok | — |
| 1 | app `notes` | 811 | 214 | launcher | ok | — |
| 1 | url-1-google-home | 404 | 130 | home | ok | `https://google.com/` |
| 1 | url-2-search | 824 | 1265 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 1 | url-3-first-result | 928 | 300 | https://fathom0.com/fathom-guide | ok | `https://fathom0.com/fathom-guide` |
| 1 | url-4-reddit | 805 | 400 | navigate | ok | `https://reddit.com/r/cats` |
| 1 | url-5-netflix | 933 | 267 | navigate | ok | `https://netflix.com/` |
| 1 | url-6-wikipedia | 808 | 297 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |
| 2 | app `browser` | 809 | 35 | launcher | ok | — |
| 2 | app `notes` | 812 | 208 | launcher | ok | — |
| 2 | url-1-google-home | 404 | 132 | home | ok | `https://google.com/` |
| 2 | url-2-search | 821 | 1282 | form | ok | `https://google.com/search?q=best%20pizza%20in%20town` |
| 2 | url-3-first-result | 809 | 292 | https://static0.com/static-guide | ok | `https://static0.com/static-guide` |
| 2 | url-4-reddit | 807 | 395 | navigate | ok | `https://reddit.com/r/cats` |
| 2 | url-5-netflix | 809 | 269 | navigate | ok | `https://netflix.com/` |
| 2 | url-6-wikipedia | 929 | 299 | navigate | ok | `https://en.wikipedia.org/wiki/Moon` |

JS errors (first few): `Failed to load resource: the server responded with a status of 404 (Not Found)` · `Failed to load resource: the server responded with a status of 404 (Not Found)` · `Failed to load resource: the server responded with a status of 404 (Not Found)` · `Failed to load resource: the server responded with a status of 404 (Not Found)`

HUD at the end of the last boot:

```
engine   mock
last     app
ttfb     10 ms
split    mod 0 / srv 1 / prov 9
tok/s    3317
tokens   5629 in / 345 out
gen $    0.00000
contract ok
ink      boot 89 ms
app notes
session $ 0.00000
```

---

## Funniness and variety — for a human

This harness does not score taste. Open the shots and fill this in.

### `mock`

Machines it invented:

- boot 1: **HALCYON 2** v3.2 (taskbar, 1997-adjacent) — _a tundra machine_ · shots `reviews/shots-bakeoff/4-mock-rehearsal/mock/1/`
- boot 2: **CROMULENT 13** v5.6 (dock, 1997-adjacent) — _a argon machine_ · shots `reviews/shots-bakeoff/4-mock-rehearsal/mock/2/`

Funny? _____ / 5 · Varied across boots? _____ / 5 · Would you screenshot it? _____

Notes:

> 

## Verdict

Pick the top two or three by contract-miss rate, desktop time and $/session; then play with them on `/bakeoff` (or `/bakeoff/run?engine=<id>` directly) before deciding. Taste breaks ties, numbers do not.
