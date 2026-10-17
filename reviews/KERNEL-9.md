# KERNEL-9 — the kernel's own bar repair was eating the launcher grid

2026-09-18. One issue: **HANDOFF-8 §8 item 1**. Fixed at the cause, geometry
only, with the first test in the tree that opens ten windows and then asks
whether a visitor can still start anything.

**Headline: the defect reproduces on mock and is gone.** On the fixture written
from run D boot 4, the shipped kernel loses **4 of 16 launchers** the moment
eight task entries grow the bar, and the blocker is its own attribute
(`footer[data-os-taskbar][data-os-fit-bar]`). After this pass: **16 of 16**, and
the entries are MORE legible than before, not less (10 of 10 task entries inside
the screen, against 8 of 10). The one real 2-boot check cost **$0.20** of the
$0.40 ceiling and did not present the precondition on either machine — no bar
grew, no inset was needed — so it is a **negative control**, reported as such:
24/24 and 20/24 launcher elements reachable, 16/16 apps on both, and no
`data-os-fit-*` anywhere in either boot's blockers.

`dist/play.js` untouched, port 8799 never used, nothing with `play.js` in its
command line signalled. **Nothing committed.**

---

## 1. The cause, in four qualifiers

`fitBarContents` grows a bar whose contents overflow it. `fitLauncherRow` — §8's
guard, shipped in KERNEL-8 — moved the launcher area out from under a bar. Every
one of the second function's four qualifiers was a hole, and run D fell through
three of them at once:

| §8's guard did this | and so |
|---|---|
| padded for a bar on the **TOP** edge | a bar at the bottom was invisible to it |
| padded **once**, `launcherFitted` latched | a bar that grew LATER was never re-checked |
| ran at **desktop time** only | the eight task entries that grow a bar do not exist yet |
| looked at the **first** launcher only | a bottom bar covers the LAST row, not the first |

And `fitBarContents` had exactly one bound — "not more than a third of the
screen" — which on a 900 px desktop permits a 38 px bar to become 300 px. Run D
boot 4: a 38 px bar with a row of launchers immediately above it (clipping the
bar by a few pixels, which is what a model writes when it centres a quick-launch
row over its own taskbar), eight windows opened, the bar grown to hold the
entries, and the pixels it took came out of the launchers.
`launchersReachable: 0/16`, blocked by
`div[data-os-taskbar data-os-stacked data-os-fit-pinned data-os-fit-bar]`. Boot
4's FIRST open was a real hit-tested click and its last was a dispatch, which
dates the change to during the session.

Nothing in the tree could see it. Every e2e test in the suite opened one or two
windows; the only instrument that opened eight needed a paid engine.

(Run D boot 3 is in the same row of that table and is **not** the same defect:
its desktop reported `launchers off screen: 16/16` at desktop time, before a
window existed — the model's own layout, HANDOFF-8 §8 item 5. Only boot 4 is
this one, and calling both of them "the grown bar" would have been a wrong
reading of the evidence.)

## 2. The ruling: the bar keeps its shape, its contents live inside it

Asked and answered explicitly, because the two halves are in tension — the bar's
entries and the desktop's launchers are both things a visitor has to be able to
reach, and the bar can only get bigger at the launchers' expense.

**Growing the bar is preferred, but only while it is free.** Three bounds, in
`barGrowth` (`kernel/geometry.ts`, pure and unit-tested):

1. **twice the bar's own height**, or one strip of chrome (48 px) more, whichever
   is larger — so BAKEOFF-4's 34 px bar can still be grown to hold a 70 px entry,
   and a bar whose entries wrap into three rows cannot become a third of the
   desktop;
2. **a third of the screen**, as before;
3. **the clearance to the nearest launcher that is clear of it today** — the
   bound run D needed. Measured against the bar AS THE MODEL WROTE IT, not as the
   kernel has since grown it: asking the grown bar answers itself, because every
   launcher the growth just covered would read as "already under it". A launcher
   the model put DEEP under its own bar (over half of it, or 24 px — a dock that
   holds the launchers contains all of them by design) is not the kernel's to
   account for; run D's row clipped its bar by 6 px and is exactly the row that
   has to be protected.

**What the bar cannot gain, its contents give up** (`containBarContents`): the
bar's overflow scrolls horizontally, a flex bar stops wrapping into new rows, and
the kernel's OWN task entries — instances of the model's `template[data-os-task]`,
which is what actually overflows a bar — are capped to the bar's inner height.
Still geometry: no colour, no font, no content, and every write is recorded and
undone at unmount.

**Growth only, and never for a pixel.** `fitBarContents` is asked on every focus
and its input is a live measurement of the model's document. A 55 px bar that
re-measures as 56 on the next click would resize the bar — and, on a phone, the
window that fills the area under it — on every open. So the write needs +2 px,
and shrinking is a separate deliberate act with one caller (§3).

## 3. The launcher inset: both edges, unlatched, verified

`fitLauncherRow` now runs at desktop time, on **every focus**, and on resize:

- **both edges** — `padding-top` for a top bar, `padding-bottom` for a bottom
  bar/dock — against every launcher, not just the first;
- **only out-of-flow bars** (fixed/sticky) at least half the screen wide, because
  padding would push an in-flow bar down with the launchers, and a narrow
  floating dock cannot cover a row;
- **idempotent, not cumulative**: the inset is recomputed from the launchers'
  own un-inset positions each time (the kernel's padding comes off, the
  measurement is taken, the new padding goes on — one synchronous pass, so
  nothing is ever painted in that state);
- **gated on the bars' geometry**, so a focus on a machine whose bars have not
  moved costs one `getBoundingClientRect` per bar and writes nothing;
- **verified after the fact**: if the launchers are STILL under a bar the kernel
  grew, `shrinkBarTo` walks the growth back to the clearance (never below the
  model's own height) and the inset is recomputed. Padding can only move
  launchers the model laid out against the edge it pads — a start-aligned grid
  does not come up off the bottom — so "I padded the desktop" and "the launchers
  are reachable" are different claims, and run D is what the difference cost.
  What cannot be repaired is recorded, never hidden: `data-os-fit-launchers-blocked`.

The loop converges upward rather than fighting itself: growth refused for want of
clearance is retried after the inset has made room, which is how the mock fixture
goes 39 → 87 px of bar and 0 → 87 px of inset over ten opens.

**And the windows.** `WindowManager.titlesClearOfBars()` moves any window whose
title strip would now sit under a bar the minimum distance that clears it, at
either edge. `area()` already insets the TOP bar, so `reflow()` covered that
half; the bottom edge it deliberately does not (KERNEL-8), and a window dragged
low enough had its whole title strip — and therefore its close control — under a
bar that grew upwards. Called whenever the bar's height or the inset changes.

## 4. Before / after

**The fixture** (`growing-bar` in `e2e/fakes.ts`, written from
`shots-v06-real-desktop/boot-4`): a 38 px bottom taskbar, a launcher row hanging
18 px into it, task entries 64 px tall in a bar that wraps. Ten windows opened,
then closed. Measured at 1280×720 by the same probe against both kernels.

| reading | v0.6 (`HEAD`) | this pass |
|---|---|---|
| launchers reachable, at boot | 16/16 | 16/16 |
| bar height after 10 opens | 39 → **65** px, unbounded | 39 → **87** px = the ceiling, and capped there |
| launcher-area inset | **none** (`data-os-fit-launchers*` absent) | `bottom: 39` at boot, `bottom: 87` after |
| task entries inside the screen | **8 of 10** | **10 of 10** |
| **launchers reachable, end of session** | **12/16** | **16/16** |
| what blocked them | `footer[data-os-taskbar][data-os-fit-bar]` — ours | — |

**Run D (HANDOFF-8), the machines this is about**, for the record:

| boot | launchers reachable | blocker |
|---|---|---|
| 1 | 16/16 | — |
| 2 | 8/23 | `div[data-os-img data-os-img-host]` (the wallpaper host; fixed in HANDOFF-8 §10) |
| 3 | 0/16 | `[data-os-taskbar][data-os-fit-bar]` — but `launchers off screen: 16/16` at desktop time: §8 item 5, not this |
| 4 | 0/16 | `[data-os-taskbar][data-os-fit-pinned][data-os-fit-bar]` — **this** |

## 5. The real check

`node scripts/stress.mjs --boots=2 --engine=auto --viewport=1440x900`,
`reviews/shots-kernel9-real/`. **$0.2033** of the $0.40 ceiling.

| boot | machine | opens | closed | launcher elements reachable | blocker |
|---|---|---|---|---|---|
| 1 | oak-warm, `dock` | 8/8 painted | all | **24/24** | — |
| 2 | Baxter, `dock` | 8/8 painted | all | **20/24** | `peNoneAt: div` — NOT a bar |

**Both boots: 16/16 apps reachable.** Boot 2's four unreachable elements are the
DOCK COPIES of four apps (24 `[data-os-app]` elements for 16 apps: a 16-icon
desktop grid plus an 8-icon dock), and each of those four has a reachable copy in
the grid — `boot-2/08-closed.png` shows all sixteen desktop icons clear. They are
blocked by an ancestor `div` with `pointer-events:none`, which is the `pe` /
`peNoneAt` diagnostic HANDOFF-8 §8 item 1 asked for doing its job: this is not
"covered", and it is not the bar.

**The honest limit of this run: it did not exercise the fix.** Neither desktop
grew a bar or needed an inset — `data-os-fit-bar`, `data-os-fit-launchers` and
`data-os-fit-launchers-bottom` appear nowhere in either boot's readings. Two
boots is a small sample of a defect that was 1 in 4. So the real run says
"nothing regressed on two machines that did not have the problem", and the
evidence that the problem is fixed is §4's before/after on the fixture the
defective machine's shape was copied into.

**One new reading, on boot 1**: `taskReach 9/10 unreachable` — nine of ten task
entries in the bar could not be reached, blocked by `div fixed zauto pe:auto`
whose parent is `<body>`: a model-authored full-screen fixed overlay painted over
its own bar. Same shape as HANDOFF-8 §10's wallpaper host, but WITHOUT the
`[data-os-img]` hook, so `passThrough` cannot see it and the kernel's launcher
guard (which acts on the launcher area, not on the bar) does not either. Not
caused by this pass, not fixed by it, and it is the first candidate for the next
one.

## 6. What ran

- `npx tsc --noEmit` — clean · `npm run build` — clean
- `npm test` — **366 unit** (29 files), 0 failed. +5 over HANDOFF-8's 361: the
  `barGrowth` block in `test/geometry.test.ts`. (One flaky failure was seen once
  in `test/reroute.test.ts` — the moderation timing race, a file this pass did
  not touch — and did not recur in three subsequent runs.)
- `npx playwright test` — **154 e2e**, 0 failed, alone on 8770–8780. +1 over
  HANDOFF-8's 153: `e2e/fit.spec.ts`'s "ten windows: every launcher is still
  hit-testable and every window closes".
- `node scripts/stress.mjs --boots=1 --engine=mock --images=off --opens=10` —
  the free rehearsal, `reviews/shots-kernel9-rehearsal/`: 10/10 painted, 16/16
  launchers, $0.
- `node scripts/stress.mjs --boots=2 --engine=auto --viewport=1440x900` — §5.

The new e2e test is the instrument, not just the assertion: ten windows, a real
hit-tested click on the close control of each window a visitor can see (the same
reading `scripts/stress.mjs` takes, because "measured the button" and "the button
works" came apart once already — HANDOFF-8 §2), and then `elementFromPoint` at
the middle of all sixteen launchers.

## 7. Files

- `kernel/geometry.ts` — `barGrowth` + `BAR_GROW_SLACK`, the three bounds, pure.
- `kernel/inject.ts` — `fitLauncherRow` rewritten (both edges, unlatched,
  idempotent, verified); `growBar`/`shrinkBarTo`/`writeBarHeight`/
  `containBarContents`; `launcherClearance`, `edgeBars`, `launcherBoxes`;
  `setStyleKeep`/`clearStyleKeep`, so a repair that is re-measured through a
  session records the model's own declaration once instead of once per write.
- `kernel/windows.ts` — `titlesClearOfBars()`.
- `kernel/index.ts` — the launcher guard on every focus and on resize, with the
  window nudge behind it; telemetry lines for both.
- `e2e/fakes.ts` — the `growing-bar` fixture. `e2e/fit.spec.ts` — the test.
- `test/geometry.test.ts` — `barGrowth`, five cases.
- `scripts/run.mjs` — `peNoneAt` now names the element the way the blocker above
  it is named (id + every `data-os-*` hook). The first reading in the tree said
  `"div"`, which cannot tell the model's own transparent overlay from the
  kernel's empty windows layer, `#os-root`, or the wallpaper pass-through — and
  boot 2 of §5 is exactly that question, still unanswered.

## 8. What remains

1. **The fix is mock-proven, not live-proven.** §5's two boots did not present
   the precondition. The next real run of four or more boots at 1440×900 should
   grep its `stress.json` for `data-os-fit-bar` and check `launchersReachable`
   beside it; until one does, "0/16 → 16/16 on a real machine" is not a claim
   this report makes.
2. **`taskReach 9/10` on §5 boot 1** — a model's own full-screen fixed div over
   its bar, with no hook on it. The bar's entries are the only way back to a
   minimised window, so this is the same class of defect as the launchers and has
   no guard at all.
3. **Boot 2's four dock duplicates** behind a `pointer-events:none` ancestor. The
   improved `peNoneAt` will name the div on the next run; if it turns out to be
   the kernel's own (`[data-os-windows]` when empty, or an `[data-os-img]`
   pass-through), it is a third kernel-caused reach defect and belongs in the
   same family as this one.
4. **The ceiling is a judgement, not a measurement.** `2× or +48 px` admits
   BAKEOFF-4's 34 → 70 px repair and refuses run D's runaway, and those are the
   only two real cases it has been tested against. A bar with a genuine two-row
   design would be capped by it and would have to scroll instead.
