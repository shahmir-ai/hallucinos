# HANDOFF-7 — v0.5 integrated, and the two instruments that were lying

2026-09-18, ~01:40–04:2x PKT. Integration pass over the three parallel v0.5
builds (`reviews/KERNEL-7.md` — D2/D3 at the cause, T2's runtime, T1's kernel
half, the `#os-root` defect; `reviews/SERVER-v05.md` — T1–T4's server halves and
the hedge A/B; `reviews/PROMPTS-4.md` — the prompt halves of D2/D3/D4 and T2),
then the judged real-engine run the brief asked for, then a full verification
from a wiped tree.

**Headline: 80 app opens on 14 real boots, 0 blank windows, 0 clicks that
reached no launcher — and every window on the last 6 boots is closeable and
draggable with no patch at all.** Two of the six defects this pass existed for
turned out to have no honest instrument: D4's bar-spacing reading scored the
very bar that reproduces it as `jammed: false, min: 1044 px`, and T4's chrome
patching was firing on 32 of 52 windows because **the kernel's own contract
repair was putting a missing close button at the bottom of the window** rather
than in the title bar. Both are fixed at the cause and re-measured.

**Tree state: green from a wiped tree** (`node_modules`, `dist/server.js`,
`public/` all removed, `npm ci`, rebuild): `npx tsc --noEmit` clean ·
`npm run build` clean · `npm test` **345 unit** (29 files) · `npm run test:e2e`
**138 e2e** on mock, alone on 8770–8780.

**Spend: $1.17** against the $4 ceiling — $0.66 the 8-boot desktop run, $0.37
the 4-boot re-measure, $0.14 the phone run, $0.01 the `/` pin check. Every mock
rehearsal was `--images=off` and cost $0. `dist/play.js` untouched, port 8799
never used, nothing with `play.js` in its command line signalled. **Nothing
committed.**

---

## 0. What ran

| run | dir | what |
|---|---|---|
| **A** | `reviews/shots-v05-real-desktop/` | 8 boots, 1440×900, `engine=auto`, 6 opens + the 4-URL browser walk each |
| **B** | `reviews/shots-v05-real-desktop-b/` | 4 boots, same, **after** the two fixes below — the re-measure |
| **C** | `reviews/shots-v05-real-mobile/` | 2 boots, 390×844, 4 opens + the walk |
| pin | — | one boot of **`/`** with `DEFAULT_ENGINE=cerebras-oss120`, pictures off |

Raw rows in each directory's `stress.json`; screenshots beside them. Every shot
in this pass is a `/bakeoff/run` shot, so **the HUD in the corner is in the
picture** — it is constructed only when `MODE === 'bakeoff'` (`kernel/index.ts`
:279), so no visitor of `/` ever sees it. On the phone shots it covers a third
of the screen; that is the harness, not the product.

## 1. D1 — the black boot

| | before | after |
|---|---|---|
| first ink on the boot screen | **~3 s black** (architect's live test, trigger was 1,200 ms) | median **1,222 ms** (A) / 1,187 ms (B) / 1,338 ms (C), range **873–2,003 ms** |
| boots over 2.5 s | the one that was judged | **0 of 14** |

`HEDGE_AFTER_MS_BOOT=0` ships as specified, and **its justification is
insurance, not speed.** SERVER-v05's own 40-boot A/B (n=20/arm, $0.10) found
racing from 0 ms did not cut time to first content — median 911 ms vs 980,
p90 1,179 vs 1,304, cost +35% — and the hedge lane produced first content in
**0 of 40** boots. With HEDGE-3 that is 0 wins in 60. Nothing in this pass
contradicts that; it adds only that the number a visitor actually waits for is
now ~1.2 s either way. **The lever to test next is the hedge engine, not the
trigger** — and note (§6) that a pinned `DEFAULT_ENGINE` has no second lane, so
on the deployment we are recommending the boot hedge never fires at all.

## 2. D2 — unusable window chrome, and the repair that caused most of it

The architect's window had a title bar with no rendered height and three
transparent 0×0 controls, and every instrument in the tree called that desktop
`ok`. T4 (KERNEL-7) gave it four numbers: the title strip must be ≥ 20 px, on
screen and not transparent; `[data-os-close]` must be ≥ 16×16, at least half
visible, non-zero opacity, and **drawn** (a glyph, a word, an `<svg>`, its own
background, a border) — else the kernel inserts one bare unstyled strip with the
title and three bare buttons and records `contract_patch chrome`.

Run A said the check works and fires a great deal:

| run A, 8 boots | value |
|---|---|
| windows measured | 52 |
| **usable with no patch** | **20 / 52 (38%)** |
| **usable after the patch** | **52 / 52 (100%)** |
| boots where every window was patched | 5 of 8 |
| the reason, on 13 of the 32 | `close-covered` |

`close-covered` means: at all three probe points of `[data-os-close]`,
`elementFromPoint` returned something of **this window's own content**. On boots
1 and 4 the template's own reading was `ok` and every window was patched, which
is a contradiction a number cannot settle — so I read the code.

**The cause is `kernel/inject.ts` `injectMissing`.** A desktop that writes a
good title bar and forgets `[data-os-close]` (boot 1's telemetry:
`contract MISS … template[data-os-window] [data-os-close]`) had the bare
fallback button **appended to the template's root**, i.e. after
`[data-os-content]` — the close button went to the *bottom of the window*, under
the app's content, where it is invisible and unclickable. T4 then correctly
found an unusable close and built a whole strip for a bar that needed one
button in it.

**Fix:** a patched control goes into the template's own `[data-os-drag]` bar
when the template has one (and the bar is patched first, so a title and a close
patched after it land inside it). `[data-os-content]` still goes to the root. It
is the same act as before — the contract's own hook, bare and unstyled — in the
place the contract describes.

| run B, 4 boots, after the fix | value |
|---|---|
| windows measured | 28 |
| **usable with no patch** | **28 / 28 (100%)** |
| patches | **0** |
| phone (run C) | **9 / 9 with no patch** |

Honest reading: B and C are different desktops from A, so part of that swing is
which engine answered. What is not variance is the mechanism — 13 windows of A
carry the exact signature of the mis-placed button, and the shape that produced
it cannot produce it again. **The T4 net is still the thing that makes the rate
100%**, and it is worth keeping: the architect's own live window would still
need it.

Eye check, `shots-v05-real-desktop/boot-1/03-windows.png`: title at the left of
the strip, `_ ▢ ✕` at the right, on the machine's own colour. A person can close
and move every window in every shot of all 14 boots.

## 3. D3 — the dock's labels

KERNEL-7 fixed this at the cause (`centreGlyph` wrote a line height onto an
element that was the whole launcher, and the label left through the dock's
`overflow:hidden`) and proved it over 19 launcher shapes on mock. Live:

| | run A (8 boots) | run B (4) | run C (phone, 2) |
|---|---|---|---|
| labels with no visible pixels after the pictures land | 8 | **0** | 10 |
| of those, invisible **before** the picture too | **8 of 8** | — | **10 of 10** |
| T4's net (`keepLabels`) had to restore a label | 0 | 0 | 0 |

**Every lost label in this pass was already invisible before any picture
landed** (`atPlates` equals `late` in every case), which is the model's own
layout and not the sheet: A's boot 5 is a dock whose second row of eight is off
screen, and C is a dock eight icons wide on a 390 px phone. D3's own mechanism
did not reproduce once in 14 boots, and the net never fired — so the net is
unexercised on a real engine, not proven by it.

## 4. D4 — the clock jammed against its neighbour

**The instrument was the defect.** `scripts/run.mjs`'s `barSpacing` anchored on
`[data-os-clock]` and measured only that element's two neighbours. On run A's
boot 1 it reported `jammed: false, min: 1044 px` — while the bar's own text was
`"Start 02:03:559/18/2026 …"`. Two reasons, both fatal: on a desktop that never
declared `[data-os-clock]` the element it measured was **the kernel's injected
clock**, which the kernel pads, so the model's jammed pair was never looked at;
and D4 is a property of the bar, not of one run of text.

Rewritten: every pair of text runs that share a line with nothing between them,
tightest gap wins, the kernel's own injected runs measured separately (`ours`)
so a defect of ours can never be read as the model's. Proved against three bars
before it was trusted:

| bar | old reading | new reading |
|---|---|---|
| `sky` + `23:12:50` (the live defect) | — | **jammed, `sky\|0px\|23:12:50`** |
| boot 1's `02:03:55` + `9/18/2026` | `jammed:false, min 1044` | **jammed, `02:03:55\|0px\|9/18/2026`** |
| a bar with a 12 px gap | — | not jammed, `Start\|12px\|02:03:55` |

With the honest instrument: **1 of 4 measured bars in run B is jammed** —
`02:20:50|3px|18/09/2026` — and the pair is named, so the next prompt iteration
has something to aim at. Run A's bars, re-read by eye from
`barSpacing.text`, jam on **3 of 5**: `02:03:559/18/2026`,
`02:06:28Fri, Sep 18, 2026`, `00:01:102099-12-01`. PROMPTS-4's rule (time and
date as separate elements, a gap between every two runs of text) is landing
partly at best. It is between **the time and the date**, not between the OS name
and the clock, on every live instance measured — which is a different sentence
from the one the prompt now carries.

Second thing the same reading found, and nobody's brief covered it: on A's
boot 1 the model wrote a visible clock without `[data-os-clock]`, so the kernel
injected its own — **two clocks on screen at once**, ours at the other end of
the same bar (`clock.patched: true`, `barSpacing.text` shows both). Ranked in §8.

## 5. D5 — the pictures, by kind and size (T3)

`IMG_TIMEOUT_MS` 20,000; the icon sheet at **768×768** instead of 1024×1024;
wallpaper back to **1024×576**.

| kind | size | n | median | max | failed |
|---|---|---|---|---|---|
| wallpaper | 1024×576 | 14 | 6.1 s | 12.7 s | 0 |
| icons | 768×768 | 14 | 6.5 s | 13.2 s | **0** |
| tiles | 768×768 | 48 | 3.8 s | 14.1 s | 0 |
| map | 768×576 | 17 | 3.3 s | 16.4 s | 0 |
| photo | 640×640 | 90 | 3.6 s | 16.1 s | **7** |

| | before (HANDOFF-6 §3) | after |
|---|---|---|
| icon sheet | 1024×1024, 5.3 s and 14.2 s under stress, `IMG_TIMEOUT_MS` 10 s | **0 sheets lost in 14 boots** |
| desktops with no plates | **3 of 8** | **0 of 14** (a full sheet on 13 of 14; the 14th is §11.4) |
| plates on screen after the desktop | — | median **3.0 s**, worst 11.0 s |

The 7 photo failures are `refusal: "engine_dead"` with `bytes: 0` at 3.5–4.6 s —
a fal-side fast failure, not a timeout. The slot stays empty and nothing else
breaks, which is the graceful path working; it is 8% of the photos bought and
worth one look at the fal error body (§8).

## 6. D6 — `DEFAULT_ENGINE` on `/`, verified live

HANDOFF-6 §2 reproduced three times that `DEFAULT_ENGINE=cerebras-oss120` still
served `/` on the routed, hedged path at the hedged price. One boot of `/` with
that variable, this tree:

```
/api/engines  default=cerebras-oss120  pinned="cerebras-oss120"  routing=true
<body data-engine>="cerebras-oss120"
boot     engine=cerebras-oss120 hedged=false usd=0.00196
desktop  engine=cerebras-oss120 hedged=false usd=0.00413
```

Closed. The pin is honoured by the advertised default, by `pinned`, by
`<body data-engine>` and by the kernel's `chooseEngine`; routing stays available
for `?engine=auto`; the boot costs **$0.00196 against HANDOFF-6's hedged
$0.00301**. `HEDGE_AFTER_MS_DESKTOP=600` closes the other half of D6 — every
routed boot used to buy two desktops.

## 7. T2 — the tile sheets, on real catalogue pages

The walk: `netflix.com`, `youtube.com`, `brasswick-supply.shop` (invented),
`reddit.com/r/cats`, per boot, after the app opens.

| reading | value |
|---|---|
| page visits | 56 |
| visits that declared a sheet | **37** |
| **`/api/img` calls per sheet** | **1, every time** (`slots: 1` on all 37 groups) |
| tiles asked | 484 |
| tiles **filled** | 428 (88%) |
| tiles with **visible pixels** when the page was judged | **194** |
| themes seen live | `posters`, `thumbnails`, `products`, `faces` (no `covers`) |

**T2's economic point holds exactly.** Sixteen pictures for one $0.003 call,
never sixteen calls — the defect T2 exists to prevent did not occur once in 37
groups. The 56 unfilled tiles sit on three boots — A's 3 and 4 (24 each) and B's 1
(8) — whose image lanes were running 12–16 s and whose poster sheets had not
arrived before the walk moved on. Every other boot filled every tile it asked
for.

**Do the catalogue pages look like catalogues? Yes, when the tiles are on
screen.** `shots-v05-real-desktop/boot-7/06-url-youtube-com.png` is the frame to
look at: "StreamSphere — Home", a search field, `Home / Trending /
Subscriptions / Library`, and a grid of photographic thumbnails with titles,
channels and view counts under them. It reads as YouTube without being it. The
phone version (`shots-v05-real-mobile/boot-2/06-url-youtube-com.png`) is better
still — a single column of full-width cards.

Three things the pictures do not do:

- **`seen` is less than half of `filled`.** The model sizes tile elements
  anywhere from 32×32 to **861×1292** (boot 7's netflix posters: one poster
  taller than the window), so a page often pays for sixteen and shows one or
  none above its own fold. Nothing is broken; the money is spent on pictures the
  visitor has to scroll to.
- **The sheets draw real places.** `thumbnails` produced a recognisable Eiffel
  Tower and Spanish Roman ruins, on a fake internet inside an invented OS, even
  though `prompts/images/tiles.md` says "scenes that do not exist" in the same
  words the map prompt uses and the map obeys. Immersion break, prompt-side,
  measured not argued.
- **The first row is often blank.** boot 7's youtube shows row 1 as white
  gradient with dark-on-dark captions over it while rows 2–3 are photographs —
  the sheet's own top-left cells, and the document's caption colour.

## 8. The phone — verdict

**Pages: usable, and the best-looking thing in this pass.** Windows: not yet.

| reading | value |
|---|---|
| opens | 8 / 8 painted, 0 blank |
| chrome | **9 / 9 usable with no patch** |
| boot ink / desktop interactive | 1,318 and 1,338 ms / 3.4 and 4.5 s |
| tiles | 32 asked, **32 filled**, 27 seen |
| launcher labels off screen | 8 of 16 (boot 1), 2 of 16 (boot 2) — the model's dock, invisible before any picture |

The defect a visitor would name first:
`shots-v05-real-mobile/boot-2/06-url-youtube-com.png`. SPEC §2.2 gives every
window the full screen below 768 px, so **four full-screen windows pile their
title bars into the same 28 px strip** — "SlateStream", "FlareStream — Home",
"TideForge" and two more drawn on top of each other, five ✕ buttons in a row,
none of the text legible. Only the topmost window's close is reachable
(`closeHit: true` on the top one, `closeBlocked: "other-window"` on the four
under it), which is correct — close the top and the next is reachable — but the
smear is not. It is partly ours: the kernel sizes them identically, and the
model's bar has no opaque background to hide the ones underneath (§12.3's
"a background differing from the body", which PROMPTS-4 now asks for).

Also: the phone desktop's first row of launchers sits **under the fixed menu
bar** (`shots-v05-real-mobile/boot-1/02b-desktop-plates.png`) — the machine's
name overlaps the first icon. The model's layout, at a width it has never been
asked to think about.

## 9. The one defect this pass found on its own

`e2e/trace.spec.ts:122` failed on the integrated tree, and it was not a flaky
test. KERNEL-7 routed `fitBarContents` through `visible.rectOf`, which fails a
measurement **soft** so one unreadable child cannot cost the whole bar repair —
right, and it also caught KERNEL-6's injected throw two frames earlier than
`guard()`, so **an exception out of the model's geometry stopped being recorded
anywhere**. The window still filled, which is the property that matters; the
line vanished, which is HANDOFF-5 issue 1's exact shape (a fault with no
evidence) reintroduced by the instrument built to prevent it.

Fixed in `kernel/visible.ts`: the swallow stays, and it is never silent —
`measure threw <tag> <message>` into the trace ring, loud (HUD + ring) for the
first 3, ring-only to 20, a counter after that so a throwing element cannot
evict the history it is trying to fill. `measureFailures()` reads the total and
`unmount` resets it. The test now asserts the property rather than the frame:
either `guard` or the measurement may own the throw, but a swallow with no line
fails.

## 10. Files this pass changed

| file | change |
|---|---|
| `kernel/inject.ts` | §2 — a patched window control goes into the template's `[data-os-drag]` bar, bar patched first; `resetMeasureFailures()` at unmount |
| `kernel/visible.ts` | §9 — `rectOf`'s swallow records `measure threw …` (rate limited), `measureFailures()` / `resetMeasureFailures()` |
| `e2e/trace.spec.ts` | §9 — the assertion is "never silent", not "caught in this frame" |
| `scripts/run.mjs` | §4 — `barSpacing` rewritten: every adjacent same-line text pair, `tightest`, `ours*`, `clock.{patched,inBar}` |

`server/**`, `prompts/**`, `engines.json`, `SPEC.md` untouched.

## 11. What remains, ranked

1. **The phone window stack** (§8). Four full-screen windows, four title bars in
   one strip, unreadable. Needs a ruling, not a guess: below the breakpoint,
   either hide a window completely covered by a later one (geometry, the
   kernel's, and they are unreachable anyway) or make the phone one-window-at-a-
   time. The prompt's "opaque title bar" clause helps and cannot be relied on.
2. **D4 is still live, 1 in 4 bars** (§4), between the time and the date. The
   instrument now names the pair; the prompt rule is written but not landing.
   Worth one iteration of `prompts/system/desktop.md` aimed at *that* pair, then
   a 4-boot re-measure — it is now a number, so it is cheap to check.
3. **Two clocks when the model forgets `[data-os-clock]`** (§4). The kernel
   should adopt a bar element whose text ticks rather than append a second
   clock; adopting requires a tick check (sample the text ~1.1 s apart) because
   a static string that looks like a time is not a clock. ~20 lines, one
   ruling: is adopting the model's element "identifying" (fine) or "forging"
   (not)?
4. **The `wallpaper` reading is not trustworthy** (`scripts/run.mjs`:1260).
   All 14 wallpaper calls succeeded, yet the reading is `false` on 4 of 14
   boots — and at least one of those, run A's boot 7, visibly *has* a
   photographic wallpaper in its own screenshots
   (`boot-7/06-url-youtube-com.png`, the rusted corrugated metal). So either a
   bought wallpaper is not reaching the screen on some boots or the instrument
   is looking at the wrong element (it checks the kernel's layer, the
   `[data-os-img="wallpaper"]` element and `[data-os-desktop]` — not `body` or
   `html`). This is the third instrument in three passes to report a defect
   that is not there or miss one that is, and it is one Playwright fixture to
   settle. Do that before anyone reads a wallpaper number.
5. **`iconsFilled 5/16` on run A's boot 8** — 11 launchers took no plate while
   the sheet landed and the other 5 filled. All 16 of that desktop's glyphs were
   the same character (`🖥`), which smells like the slot-to-cell mapping keying
   on something non-unique. One boot in 14, and it looks for all the world like
   a desktop, so it is cosmetic — but it is unexplained, which is worse than
   cosmetic.
6. **`seen` ≪ `filled` for tiles** (§7): half the tiles we pay for are below
   the page's own fold. Cheapest honest answer is to read `data-os-tile` count
   against visible area before buying, i.e. do not buy a sheet for a group whose
   elements are all off screen — but a page the visitor scrolls is a real page,
   so this wants a measurement (how often does a visitor scroll to them?) before
   a rule.
7. **7 of 90 photos die `engine_dead` at ~4 s** (§5). Fast fal-side failure
   with `bytes: 0`; the body is not logged, so the cause is unknown. One line in
   `server/img.ts` to record the provider's error text would settle it.
8. **`thumbnails` draws real landmarks** (§7) despite the same
   "does not exist" clause the map obeys. Prompt-side; may simply be what FLUX
   schnell does with the word "scenes".
9. **17 of the e2e suite's 72 `openApp` calls still fall back to a dispatched
   click** (KERNEL-7 §10.1, unchanged here) — all where a window already covers
   the launcher. Run B's own opens were **24 of 24 real clicks**, so the
   production path is well covered elsewhere.
10. **T4's `keepLabels` net has never fired on a real engine** (§3), and neither
   has the bare task entry. They are mock-proven only. Not a defect — an
   unexercised guard, which is worth knowing before anyone deletes one.
