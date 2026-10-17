# BAKEOFF-4-verify (SPEC §7)

Run 2026-09-17T14:38:36.754Z
`node scripts/bakeoff.mjs --engines=auto --boots=1 --report=BAKEOFF-4-verify`

1×`auto` boots. Per boot: identity → boot screen → desktop, then 3 apps
(`photos`, `browser`, `store`) and 5 URL visits inside the browser (google.com home, a search for
"best pizza in town", the first result of that search, reddit.com/r/cats, netflix.com,
en.wikipedia.org/wiki/Moon).

A step (one app open, one page load) is abandoned as a timeout after 60 s.

Every per-generation number is read from the server's own stdout telemetry line
(`contract_ok`, `ttfb_ms`, `total_ms`, `tok_per_s`, `tokens_in/out`, `usd`); the
HUD was photographed at every step as an independent witness. A render counts as
**broken** if the frame was blank, if its body carried no CSS at all, if a JS
error fired while it loaded, or if it never arrived. Shots:
`reviews/shots-bakeoff/4-verify/<engine>/<boot>/<step>.png`.

| engine | boots | contract miss | boot paint ms | desktop interactive ms | desktop revealed ms | ttfb ms | tok/s | broken renders | $/session (gen + img) |
|---|---|---|---|---|---|---|---|---|---|
| `auto` | 1 | 0% (0/1) | 1738 | 6323 | 6875 | 1567 | 425 | 100% (3/3) | $0.0080 + $0.0060 = **$0.0140** |

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
| `auto` | 1.74 s MISS | 6.32 s MISS | 60.03 s MISS | **0.00 s** PASS | — ms | — ms | 1561 ms |

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
| `auto` | 1 | 1738 | 1659 | 6323 | 0 | 6325 | no |

- `auto`: **0/1 blank boots** (kernel said `none`), 0/1 with no pixel the harness could see · median ink 1659 ms (kernel) / 1738 ms (harness) · worst 1738 ms (harness)

## The bar, inside the viewport

`bar edge` above says where the bar sits; this says whether what is IN it can be
read. **outside** is bar descendants clipped by the screen, **past bar** is
descendants hanging out of the bar's own box (an entry taller than the bar,
centred on it — the shape of the fault), **overflow** is how far past the bottom
edge the worst one reaches. **tasks** is §12.3's one-entry-per-open-window,
legible / present: an entry whose box is off screen or which carries neither
text nor an icon is not an entry a user can use. **fit** is the kernel's own
guard (`data-os-fit` / `-pinned`) firing.


| engine | boot | bar edge | kids | outside | past bar | overflow | tasks legible | clock inside | fit |
|---|---|---|---|---|---|---|---|---|---|
| `auto` | 1 | bottom | 0 | 0 | 0 | 0 | 0/0 | yes | — |

## Pictures inside app windows

BAKEOFF-3 issue 5 and HANDOFF-4 #3. **early** is the fill count when the
document went quiet; **late** is after this runner waited for the pictures to
stop arriving (up to 10 s, stopping 3 s after the last one) — the previous
fixed 4 s wait was shorter than the kernel's second wave of two and reported
every second wave as lost. **last @** is when the final picture landed, measured
from the first photograph. `slots` is what the model asked for; §12.5 caps an
app at four, so a document that declares eight is not owed eight.


| engine | boot | app | slots | early | late | last @ | focused |
|---|---|---|---|---|---|---|---|

- `auto`: **0/0** app pictures on screen (capped at four per document) out of 0 the server actually delivered · 0/0 photographed unfocused

## H2 — the hedge

Which engine actually wrote each generation. `hedged` means a second lane was
started (for `boot` and `desktop` `HEDGE_AFTER_MS_BOOT` is 0, so both start at
once); the loser is aborted at the winner's 64-character commit point and its
billed input is already inside the `$/session` column above. An explicit engine
id bypasses routing and hedging entirely, so an unhedged column here is the
control, not a failure.

| engine | kind | n | hedged | winners | median loser abort ms | loser input tokens |
|---|---|---|---|---|---|---|
| `auto` | boot | 1 | 1 | cerebras-oss120 1 | 1561 | 5816 |
| `auto` | desktop | 1 | 1 | or-oss120-groq 1 | 1019 | 10173 |

- `auto`: 2/2 generations hedged · 15989 loser input tokens per session · 0 failovers

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
| `auto` | 1 | dock | bottom | yes | yes (seconds) | 16/16 labelled | 6×2 grid | 0 | **16** (1) | 16/16 | slot |

## §12.4 identity variety

Every machine this run invented, in order. A repeated name or a repeated
archetype-plus-era across boots of the same engine is the failure §12.4's dice
exist to prevent.

| engine | boot | name | version | era | archetype | tagline |
|---|---|---|---|---|---|---|
| `auto` | 1 | **M5-23** | 1.4.2-rc (Delta) | 2020s submarine tender | dock | Deep tides, steady logs |

- `auto`: 1/1 distinct names · archetypes dock

## §12.5 images

| engine | image calls | per boot | $ images | $ per image | blocked/failed |
|---|---|---|---|---|---|
| `auto` | 2 | 2.0 | $0.0060 | $0.0030 | 0 |

| engine | img kind | n | ok | median ms | not delivered (reason × n) |
|---|---|---|---|---|---|
| `auto` | wallpaper | 1 | 1 | 4927 | — |
| `auto` | icons | 1 | 1 | 8144 | — |

Whether the wallpaper fits the era and whether the icon sheet is legible at 64 px
is a human's call on the shots — see the taste section at the end.

"$/session" is one boot with its apps and pages — what one visitor costs. A console
error that is the CSP refusing a generated document's network call is counted
separately ("network blocked by CSP" below): that is the sandbox working, not a
broken render, though a high number says the model keeps reaching for the web.

## `auto`

| kind | n | ttfb ms (med) | total ms (med) | tok/s (med) | tok in (avg) | tok out (avg) | contract ok | errors | $ |
|---|---|---|---|---|---|---|---|---|---|
| boot | 1 | 1567 | 1829 | 425 | 5816 | 777 | — | 0 | $0.0029 |
| desktop | 1 | 1022 | 4668 | 407 | 9913 | 1901 | 1/1 | 0 | $0.0052 |
| mark | 1 | 0 | 0 | 0 | 0 | 0 | — | 0 | $0.0000 |
| img | 2 | 0 | 8144 | 0 | 0 | 0 | — | 0 | $0.0060 |

### Per boot

| boot | machine | boot paint ms | interactive ms | revealed ms | contract | injected | blank | unstyled | JS errors | network blocked by CSP |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | M5-23 | 1738 | 6323 | 6875 | ok | 0 | 3 | 3 | 0 | 0 |

### Renders

Wall-clock ms, measured from the click to the document going quiet; it carries about
1.5 s of the harness's own settle polling, so compare engines with it, not the
generation times in the table above.

| boot | step | ms | chars | how | flags | address shown |
|---|---|---|---|---|---|---|
| 1 | app `photos` | 60271 | 0 | launcher | blank, unstyled | — |
| 1 | app `browser` | 60034 | 0 | launcher | blank, unstyled | — |
| 1 | app `store` | 60001 | 0 | launcher | blank, unstyled | — |

JS errors (first few): none

HUD at the end of the last boot:

```
engine   or-oss120-groq
last     desktop
ttfb     1022 ms
split    mod 0 / srv 1 / prov 857
tok/s    407
tokens   9913 in / 1901 out
gen $    0.00517
contract ok
hedge    won by or-oss120-groq / lost cerebras-oss120
ink      boot 1659 ms
icons applied: 16
session $ 0.00803
```

---

## Funniness and variety — for a human

This harness does not score taste. Open the shots and fill this in.

### `auto`

Machines it invented:

- boot 1: **M5-23** v1.4.2-rc (Delta) (dock, 2020s submarine tender) — _Deep tides, steady logs_ · shots `reviews/shots-bakeoff/4-verify/auto/1/`

Funny? _____ / 5 · Varied across boots? _____ / 5 · Would you screenshot it? _____

Notes:

> 

## Verdict

Pick the top two or three by contract-miss rate, desktop time and $/session; then play with them on `/bakeoff` (or `/bakeoff/run?engine=<id>` directly) before deciding. Taste breaks ties, numbers do not.
