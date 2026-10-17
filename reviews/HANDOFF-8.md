# HANDOFF-8 — v0.6 integrated: one window on a phone, one clock, one click to close

2026-09-18, ~03:50–06:1x PKT. Integration pass over the two parallel v0.6
builds (`reviews/KERNEL-8.md` — R1/R2/R3 and HANDOFF-7 §8's launcher-row guard;
`reviews/SERVER-v06.md` — R4's prompt half, the photo-error logging, the phone
route), then the judged real-engine run, then a full verification from a wiped
tree.

**Headline: the rulings land, and the run found three defects nobody had asked
for — two of them fixed here.** R1 holds on every step of every phone boot (18
opens, 3 boots, never more than one window on screen). R4's first row is filled
on **35 of 36** desktop groups and **20 of 20** phone groups. D4, the jammed
bar, did not reproduce once in 7 boots. What the pass found on its own: a
**close button that could not be clicked** on any unfocused desktop window
(pointerdown focused it, focus de-overlapped it, the window moved out from under
the pointer and the click event never fired — twice in a row, so it was not
closeable by mouse at all); **`focus()` on a minimised phone window emptied the
screen** (R1's other half); and **a model's full-screen wallpaper element eating
15 of 15 launchers**. All three are fixed at the cause with tests.

**Tree state: green.** From a wiped tree (`node_modules`, `public/`,
`dist/server.js`, `test-results/` removed, `npm ci`, rebuild): `npx tsc
--noEmit` clean · `npm run build` clean · `npm test` **361 unit** (29 files) ·
`npx playwright test` **151 passed, 2 failed** — and both failures are named
here rather than rounded off. One was **my own new test**, whose premise was
wrong (the mock declares its wallpaper slot *on the launcher grid*, so the
element I appended was never the host the kernel adopted — which is the guard in
§10 working, and the test now installs the shape it meant to). The other was
`e2e/noreplace.spec.ts:71`, the pre-existing timing race KERNEL-8 §0 already
reported, in a file this pass did not touch. With the test's premise fixed, the
same tree runs **361 unit · 153 e2e, 0 failed**, alone on 8770–8780, and the
`noreplace` race did not recur. `npx tsc --noEmit` clean, `npm run build`
clean.

**Spend: $0.62** against the $2 ceiling — $0.37 the 4-boot desktop run, $0.26
the 3-boot phone run. Every mock rehearsal was `--images=off` and cost $0.
`dist/play.js` untouched, port 8799 never used, nothing with `play.js` in its
command line signalled. **Nothing committed.**

---

## 0. What ran

| run | dir | what |
|---|---|---|
| **D** | `reviews/shots-v06-real-desktop/` | 4 boots, 1440×900, `engine=auto`, 8 opens + the 4-URL walk + the close-down |
| **P** | `reviews/shots-v06-real-mobile/` | 3 boots, 390×844, same, 6 opens |
| rehearsals | `reviews/shots-v06-rehearsal-{desktop,desktop6,mobile3}/` | mock boots, `--images=off`, $0 — the before/after of §2 and where §1's other half was found (the intermediate diagnostic runs are deleted) |

Raw rows in each directory's `stress.json`, screenshots beside them. Every shot
is a `/bakeoff/run` shot, so the HUD is in the picture; it is constructed only
when `MODE === 'bakeoff'` and no visitor of `/` ever sees it. On a 390 px phone
it covers the bottom third, which matters below (§6).

---

## 1. R1 — a phone shows one window

| reading | before (HANDOFF-7 §8) | after (run P) |
|---|---|---|
| windows on screen after each open | 4 full-screen windows, 4 title bars in one 28 px strip, 5 ✕ in a row | **1, at every one of 18 opens on 3 boots** |
| the per-step series | — | `1/1 1/2 1/3 1/4 1/5 1/6` · `1/1 1/2 1/4 1/5 1/6 1/7` · `1/1 1/2 1/3 1/4 1/5 1/6` |
| window chrome usable with no patch | 9/9 | **19/19** (0 patched) |
| every window closeable | only the topmost was reachable | **all of them**: 19 windows closed in 19 real hit-tested clicks, 0 second clicks, 0 dead |
| launchers reachable after the close-down | not measured | **16/16 on all 3 boots** once the harness's own HUD is discounted (§6) |

"One window at every step" and "one window at the end" are different claims, so
the visible count is read after **every** open, before the next click goes in
(`solo.perOpen`). The count is windows a visitor can SEE — minimised is
`display:none` and its task entry is the way back, which is R1's design.

**The half R1 left open, found on the first phone rehearsal.** `focus()`
minimised every *other* window without showing the one being focused, so
focusing a window that was itself minimised left the phone with **four windows
open and none on the screen** — the wallpaper, with the whole session hidden
behind task entries. `restore()` is the only path that un-minimises, and the two
callers that happen to go through it (the task entry, `close`) hid the hole;
`wire`'s pointerdown raise, the frame's own focus event and the `wm.focus` after
`create` did not. The invariant now lives in `soloOnPhone`, where the solo rule
is: below the breakpoint, focusing a window *means* that window is on screen.
`e2e/mobile.spec.ts` — "focusing a minimised window shows it instead of
emptying the screen".

## 2. The defect this pass found: a close button that could not be clicked

Found on a mock rehearsal, at $0, by the first instrument in this tree that
**closes** windows instead of measuring them.

The runner clicks the `[data-os-close]` of the window a visitor can see, at its
own coordinates, hit-tested. On a 4-window desktop cascade it closed nothing —
twice. The pointer log says why:

```
mousedown @922,69 -> button in-window=w1     (no click event)
mousedown @958,105 -> button in-window=w1    (no click event)
```

The button moved **+36,+36** between the two attempts, which is exactly
`CASCADE_STEP`. `wire`'s pointerdown raise called `focus`, `focus` called
`clearTitleCollision` (H4: a newly raised window should not hide its title
under another's), the window was nudged one cascade step, and mouseup landed
where the button no longer was. Every press moved it again, so **the window was
not closeable by mouse at all** — and no instrument in the tree had ever seen
it, because every close in the e2e suite and every chrome probe in the harness
was `dispatchEvent`, which cannot reproduce it. HANDOFF-7 §2's "a person can
close and move every window in every shot" was measured the same way and is, for
this failure mode, not a claim the evidence supported.

**Fix (`kernel/windows.ts`):** a focus that comes from a pointer does not
de-overlap. `ensureTitleVisible` still runs — a title dragged off the screen is
a window with no handle, a safety repair `e2e/windows.spec.ts:211` locks — and
every focus that is *not* a pointer (create, a task entry, the window revealed
by a close) still clears the collision, which is where H4 wanted it. New test:
"a real click closes an unfocused window the first time", with a real mouse
click at hit-tested coordinates.

| | before | after |
|---|---|---|
| mock rehearsal, 4 cascaded windows | **0 of 4 closed**, the first click dead | 4 of 4, one click each |
| run D, 4 real desktops | — | **33 of 33 windows closed**, 0 needed a second click, 0 dead |
| run P, 3 real phones | — | **19 of 19**, same |

## 3. R2 — one clock

| run | clocks on screen per desktop | how |
|---|---|---|
| D (4 boots) | **1, 1, 1, 1** | every one the model's own element; the kernel injected none and adopted none |
| P (3 boots) | **1, 1, 1** | same |

The instrument is deliberately not the kernel's: `[data-os-clock]` is the hook,
and HANDOFF-7 §4's defect was a screen with two clocks and one hook. So every
visible leaf run of text whose own text reads as a time is counted, whoever
wrote it, and labelled `adopted` / `injected` / `model`.

Two honest notes. **First, R2's adoption path did not fire once in 7 boots** —
every one of these desktops declared `[data-os-clock]` itself, so `adoptClock`
returned early and the ruling is unexercised on a real engine, mock-proven only.
**Second, the raw count read 2 on desktop boot 2, and it was the instrument's
fault**: the second "face" was `Weather – 9/18/2026, 4:33:18 AM`, a *window
title* written by the Weather app, 298 px wide and outside any bar. A window
title carrying a timestamp is not a clock on the desktop. Counted by eye off
`boot-2/07-before-close.png`: one clock. The instrument now needs a
window-scope exclusion; it is in §8.

## 4. R3 — the bar spacing net, and D4

| | HANDOFF-7 (run B) | run D (4 boots) | run P (3 boots) |
|---|---|---|---|
| bars measured | 4 | 4 | 3 |
| **jammed (< 4 px between two runs of text)** | **1 of 4** | **0 of 4** | **0 of 3** |
| tightest pair, every boot | `02:20:50\|3px\|18/09/2026` | `8px` | `8px` |

Every one of the seven bars in this pass reads 8 px at its tightest pair, and on
five of the seven that pair is the time and the date — the exact pair HANDOFF-7
§4 named. Two things are true at once and the report has to say both: the R3
net had **nothing to insert** (no pair was under 4 px on any bar), so what is
measured here is PROMPTS-4 + SERVER-v06's `desktop.md` rule landing, not the
kernel net working. The net remains mock-proven. D4 is closed on this sample;
7 bars is not many, and 8 px is not a comfortable margin.

## 5. R4 — the tiles

| reading | HANDOFF-7 §7 | run D | run P |
|---|---|---|---|
| tile groups | 37 | 11 | 9 |
| tiles asked | 484 | 128 | 96 |
| **filled** | 428 (88%) | **127 (99%)** | **96 (100%)** |
| **first row filled** | "often blank" (eye) | **35 / 36 (97%)** | **20 / 20 (100%)** |
| first row inside the first screen | — | 7 of 11 groups | 8 of 9 |
| **seen** (≥24×24, on screen when judged) | 194 (40%) | 39 (30%) | 44 (46%) |
| `/api/img` calls per sheet | 1 | **1** | **1** |

**The first row is fixed as a *content* problem and is still a *placement*
problem.** The sheet's top-left cells now arrive with pictures in them — 55 of
56 first-row tiles across both runs — which is what HANDOFF-7 §7's "the first
row is often blank" was about. What R4's document half has not fixed is that on
4 of 11 desktop groups the first row starts *below the fold of the page*, so a
visitor sees a catalogue with no pictures until they scroll. `seen ≪ filled`
therefore survives, unchanged, as HANDOFF-7 §7 and its issue 6 described it.

**The bounded box lands except on one theme.** Widest tile per theme:
`posters` 200–202 px, `thumbnails` 200–204 px (D) / 390 (P, a full-width phone
card, which is right), `products` 173–295 px on three of four pages and
**853×853 on one** — one product page drew four 853 px squares and 1 of 16 tiles
was seen. The clause is in `page.md`; one page in eleven ignored it.

**Landmarks, by eye, on 20 shots.** `boot-4/06-url-youtube-com.png`'s first
thumbnail is a snow-covered domed public building that reads as a real capitol;
nothing else in the 20 shots is identifiable as a specific place. That is
consistent with SERVER-v06's own reading — the anti-landmark clause is unproven,
the positive subject classes are the part with signal — and better than
HANDOFF-7's Eiffel Tower and Roman ruins, on a sample too small to call it a
fix.

**What the pictures look like.** `boot-2/06-url-netflix-com.png` is the frame to
look at: a "STREAMSCAPE" header, Home/Browse/Latest/Categories, a wide hero
still of a submarine that does not exist, and a row of four posters under it.
The posters are drawn as *framed prints on a wall* — SERVER-v06 §1's structural
`posters`/`covers` finding, live and exactly as predicted.

## 6. The phone, and the two reach numbers that need reading carefully

Everything the brief asked about the phone is above; the reach numbers need one
sentence of honesty. `launchers 10/16` and `8/16` in the raw rows are **the
harness standing on the product**: the `/bakeoff` HUD is a fixed dock at
z 2147483600 covering the bottom third of a 390 px screen, and it is the only
blocker on every one of those launchers. Discounting it (the reading now flags
`harness: true`): **16/16 launchers reachable on all three phone boots**, and
task entries 0 unreachable on two boots, 2 of 7 on the third — those two blocked
by a *neighbouring task entry's own icon*, the model's own bar packing, not
ours.

One blank window in the whole phone run: run P boot 1's `photos`, created,
streamed, 0 chars. 17 of 18 painted; the desktop run was 32 of 32.

## 7. The first ten seconds, from the shots

**Desktop** (`shots-v06-real-desktop/boot-1/`). At **~1.4 s** (median; range
1.1–2.6 s) the black frame gives way to a boot screen with the machine naming
itself. By **~3.3 s** the desktop is interactive: a wallpaper, a taskbar with
`Start`, a clock reading `04:18:00 18/09/2026`, and a 4×4 grid of labelled icons
— *Navigator, Visions, Wastebin, Figurer, Depot, Postage, Chatter, Shell…* —
which at that instant are flat plates. **~1.0–2.1 s later** the icon sheet lands
and all 16 take photographic faces (`02b-desktop-plates.png`: an icon set that
looks bought, on graph-paper-and-floorboards wallpaper). A click on an icon
opens a window with a real title bar and `_ ▢ ✕` at the right, first text in it
at **~0.9 s** (kernel) / ~1.3 s (poll). Ten seconds in, a visitor who clicked
twice has two windows open, both closeable in one click, and a browser whose
address bar accepts a URL; a page comes back in **~2.5 s** with a picture grid
that fills over the next few seconds.

**Phone** (`shots-v06-real-mobile/boot-1/`). Ink at **~1.1 s**, interactive at
**~3.0 s**, a dock of labelled icons across the bottom. A tap opens one
full-screen window with one title bar and one ✕ — `07-before-close.png` is an
`r/cats` page with a working "About" sidebar, four posts with scores, authors
and comment counts, entirely invented, legible at phone width, and the previous
windows are waiting as entries in the dock. The thing HANDOFF-7 called the
defect a visitor would name first is gone.

## 8. What remains, ranked

1. **The kernel's own bar repair can grow a bar over the launcher grid.** On 2
   of 4 desktops (run D boots 3 and 4) **0 of 16 launchers were reachable at the
   end of the session** — the blocker is the model's bar carrying the kernel's
   own `data-os-fit-bar` / `data-os-fit-pinned` / `data-os-stacked` attributes.
   Boot 4's *first* open was a real click and its last was not, which dates the
   change to during the session: `fitBarContents` grows a bar whose contents
   overflow, and eight task entries are what makes it overflow. §8's
   `fitLauncherRow` pads the desktop for a fixed **top** bar, once, latched, at
   desktop time — so a bar that grows later, or grows at the bottom, is not
   covered. This is a dead desktop on half the machines measured and it is ours,
   not the model's. The `pe` / `peNoneAt` diagnostic added this pass will
   separate "covered" from "pointer-events:none" on the next 2-boot run.
2. **`seen ≪ filled`, and one page in eleven ignores the tile box.** 30–46% of
   the tiles bought are on screen when the page is judged; `products` drew
   853×853 tiles on one page. Unchanged from HANDOFF-7 issue 6 in substance, now
   with a first-row number that is good (97%) and a placement number that is
   not.
3. **The clock instrument counts window titles.** Run D boot 2 read 2 clocks
   because an app's window title carried a timestamp. Exclude anything inside
   `[data-os-window-id]` — one line, and until it is done no clock count above 1
   should be believed without the shot.
4. **R2 and R3 are both unexercised live.** Every one of 7 desktops declared its
   own `[data-os-clock]`, and no bar was under 4 px, so neither `adoptClock` nor
   `fitBarGaps` fired on a real engine. They are mock-proven guards, which is
   worth knowing before anyone reads "0 jammed bars" as proof the net works.
5. **Launcher labels, still 1 desktop in 2.** Run D lost 16 of 16 (boot 3) and 8
   of 16 (boot 4); `atPlates` equals `late` in both, so they were invisible
   before any picture landed — the model's own layout, D3's mechanism not
   reproducing, exactly HANDOFF-7 §3. `keepLabels` has still never fired on a
   real engine.
6. **Photos die at 8% and the reason is still not in the log.** Run D: 5 of 32
   photos, 2 of 17 tile sheets and 1 of 6 maps came back `engine_dead` with
   `bytes: 0`; run P: 1 of 20. SERVER-v06 made the fal error body *knowable*
   (`img_err` / `img_status`, server-side) and added one retry — the rate did
   not move, and this pass did not read the server's stderr for those lines.
   That is the next cheap thing: one grep on the next run's log.
7. **One blank window in 50 opens** (run P boot 1, `photos`): created, streamed,
   0 chars. 1 in 50 against HANDOFF-7's 0 in 80.
8. **The wallpaper reading** (HANDOFF-7 issue 4) is still unsettled, though it
   read `true` on all 7 boots this pass and the shots agree.

## 9. Would I show this to strangers today?

**Yes — on a phone, without reservation. On a desktop, yes with one hand on the
switch.**

The phone is the better product now: one full-screen window, one title bar, a
dock, pages that look like the sites they are pretending to be, and nothing in
three boots that a visitor could break. The desktop is more impressive and
carries issue 1 — half the desktops measured ended with an un-clickable icon
grid *after* a visitor had opened eight windows. A visitor who opens two or
three and closes them will never see it; a visitor who opens eight will end up
on a machine whose icons no longer respond, with the bar still working. That is
a fix of maybe twenty lines (re-run the launcher-row repair when a bar grows,
both edges, unlatched), and I would take it before a link goes anywhere public.

## 10. Files this pass changed

| file | change |
|---|---|
| `kernel/windows.ts` | §1 — `soloOnPhone` shows the window it is focusing; §2 — `focus(w, {collide})`, and `wire`'s pointer raise does not de-overlap |
| `kernel/img.ts` | §8/D — a dedicated wallpaper host with nothing interactive in it stops being what a pointer hits (`passThrough`), undone at unmount |
| `e2e/mobile.spec.ts` | §1 — "focusing a minimised window shows it instead of emptying the screen" |
| `e2e/windows.spec.ts` | §2 — "a real click closes an unfocused window the first time" (real mouse, hit-tested) |
| `e2e/images.spec.ts` | the wallpaper that ate the launchers, reproduced with a fixed full-screen `[data-os-img="wallpaper"]` |
| `scripts/run.mjs` | `inspectClocks`, `visibleWindows`, `reachReading` (with blocker naming, harness flag, `pe`/`peNoneAt`); `inspectTiles` gains rows, `row1`, `row1OnFirstScreen`, `maxW` |
| `scripts/stress.mjs` | the per-open visible count, the end-of-session clock/reach readings, and `closeEveryWindow` — the close-down that found §2 |

`server/**`, `prompts/**`, `engines.json`, `SPEC.md` untouched by this pass.

### The wallpaper that ate the launchers

Run D boot 2 declared its wallpaper slot as a `position:fixed` full-screen
`<div data-os-img="wallpaper">` painted after the icons. Every pixel of that
machine's 15 desktop launchers was covered by it — the run's **first** open,
before any window existed, could not be clicked for real, and `elementFromPoint`
on an icon returned the wallpaper div. A visitor would have found a
finished-looking desktop with 15 dead icons. A wallpaper holds nothing a pointer
wants, so once the kernel adopts one as a picture host it stops being what a
pointer hits — the same act as `#os-root`'s and the empty windows layer's
existing `pointer-events:none`, hit testing and not style, and only ever on a
dedicated `[data-os-img]` element with nothing interactive inside it (never the
`[data-os-desktop]` / `<body>` fallback, which holds the machine).
