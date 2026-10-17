# KERNEL-8 — the phone shows one window, the bar has one clock, and text stops touching

2026-09-18. Builder: Opus 5 (high). Lane: `kernel/**`, `e2e/**`, `public/**`
build output. `server/**` and `prompts/**` untouched by this pass (R4's tile
box/prompt half belongs to the server+prompts lane and is not in this file).

Rulings implemented: **R1** (one window at a time below 768 px), **R2** (adopt
the model's own clock instead of injecting a second one), **R3** (a thin space
between two runs of bar text that touch), plus HANDOFF-7 **§8**'s second phone
defect (the first launcher row under a fixed menu bar).

**Tree state: green.** `npx tsc --noEmit` clean · `npm run build` clean ·
`npm test` **361 unit** (29 files) · `npx playwright test` **150 e2e** on mock,
alone on 8770–8780. One test flaked in the full run and passes on its own:
`e2e/noreplace.spec.ts:71` ("widen MOCK_DELAY_MS") — a pre-existing timing
assertion that races the mock's stream under load, not a defect of this pass
and not a file this pass touched. `dist/play.js` untouched, port 8799 never
used, nothing with `play.js` in its command line signalled. **Nothing
committed.** No real-engine spend: every run here was mock, $0.

---

## R1 — a phone shows one window

HANDOFF-7 §8 named this the defect a visitor would name first: SPEC §2.2 gives
every window the full screen below 768 px, so four open windows piled four
title bars into one 28 px strip — five ✕ in a row, none of the text legible.
Only the topmost close was reachable, which was *correct* and still looked
broken. Four full-screen windows in the same rectangle are not a stack a thumb
can navigate; they are one illegible window.

**Rule, in the kernel:** below the breakpoint, opening or focusing a window
minimises every other one. Nothing new is drawn for it — it is the minimise
state the kernel already had (`display:none`, `data-os-minimized`), the bar's
`[data-os-task-for]` entries are already the way back, and closing the visible
window restores the most recently focused survivor. Desktop widths are
untouched: the cascade, the nudge and H4's title-collision rules are exactly
what shipped in v0.5.

| seam | `kernel/windows.ts` |
|---|---|
| `soloOnPhone(w)` | minimises every other connected, non-minimised window; no-op at ≥ 768 px |
| `focus()` | calls it first |
| `create()` | calls it too — a new window is already at the top of the z stack and never goes through `focus()` |
| `close()` | `topMost() \|\| lastFocused()` on a phone: with every other window minimised there is nothing "underneath", so the highest-z survivor is **restored**, which is what "close reveals the previous one" means |
| `reflow()` | a viewport that has just crossed the breakpoint is a pile; the invariant is re-imposed on resize, keeping the window the visitor was last on |

**The second half of R1, which the ruling did not ask for and the tests
found.** A phone window fills the windows layer. The mock's layer is `inset:0`
with a 34 px bar `position:fixed` over its bottom edge — so the full-size window
covered the bar, and with it every task entry, i.e. the only way back to the
windows R1 had just minimised. Measured as a 90 s Playwright retry against
`<iframe data-os-frame="app"> … intercepts pointer events`. `topBarBottom()` is
now `barInsets()` and returns **both** edges; `area()` takes the bottom inset
**below the breakpoint only**. Above it, taking 34 px off every window to
pre-empt an overlap it may not have is a bigger change than this pass is
allowed to make — it is in "what remains" as a ruling to take.

A bar that grows (`fitBarContents`, which the mock does on some seeds) is a
windows area that shrank, so the grow now triggers one `wm.reflow()`; without
it the phone window kept the height it was given against the 34 px bar and sat
21 px over the 55 px one.

**e2e** (`e2e/mobile.spec.ts`, 390×844, `hasTouch`):

- `opening three apps leaves exactly one window visible` — after each of
  `notes`, `calculator`, `weather`: `visible.length === 1`, `open === n`,
  **`barsInTopStrip === 1`** (the §8 smear, as a number), and at the end
  `minimized === 2`, `tasks === 3`, one `data-os-focused="true"`.
- `a task entry restores its window, and that minimises the other` — a **tap**
  on `[data-os-task-for]` restores, and the other goes to minimised.
- `closing the visible window reveals the previous one` — the first window's id
  is the only visible one afterwards, and it is focused.
- `a window is never dragged on a phone` — unchanged SPEC §2.2 property, still
  true with the solo rule on.
- `the mock desktop: a tap opens a full-size window` — now asserts
  `|dh + barH| ≤ 1` and `overBar === false` (the bar's height is *read*, not
  assumed, because of the grow above).
- `e2e/windows.spec.ts` — "under the mobile breakpoint a window fills the layer
  **minus its bottom bar**": `w.h === layer.h - bar`, `bar > 0`, and the window
  does not reach the bar's top.

## R2 — one clock

HANDOFF-7 §4's second finding: a live boot drew a visible ticking clock and
forgot `[data-os-clock]`, so `injectMissing` appended the kernel's fallback at
the other end of the same bar. Two clocks on screen — worse than the missing
hook it repaired, and it blinded the instrument, which then measured *ours*
(padded) and never looked at the model's jammed pair.

**Rule:** before `domMissing` runs — it is what decides whether a clock is
injected at all — the bar is searched for a run of text that reads as a time
(`HH:MM`, optionally `:SS`, `.` accepted as the separator) and that element is
given the hook, plus `data-os-clock-adopted` for the harness. The search space
is exactly R3's: `[data-os-taskbar]`, `[data-os-dock]`, and a top-edge
full-width strip no taller than a fifth of the screen (the unhooked menu bar,
breadth-first, depth-capped). Containers are dropped, our own injected runs are
excluded, and the shortest matching run wins, so the clock is adopted rather
than the row holding it.

**Adopting is identifying, not forging.** No pixel changes, the element stays
the model's, both attributes are taken back at unmount, and the fallback clock
is still there for a bar with no clock in it at all. Whether it *ticks* cannot
be answered synchronously — a static string that looks like a time is not a
clock — so `verifyClockTick` samples the element ~1.2 s later, writes
`data-os-clock-ticks` on `<html>` and one telemetry line. A non-ticking
adoption is **reported, never repaired**: writing the time into the model's
element would be forging it, and a second clock is the defect being removed.
(A clock with no seconds can take a minute to change, so `false` means "no
second hand", not "not a clock" — which is why it is a reading.)

**e2e** (`e2e/bars.spec.ts`), fixture `ownClockDesktop` — a dock desktop whose
menu bar carries no hook at all and a clock with none either, the live shape:

- ticking variant: exactly one `[data-os-clock]`, one `[data-os-clock-adopted]`,
  **zero** `[data-os-clock][data-os-injected]`, and — the claim that matters —
  exactly **one clock a visitor can see** (the spec re-derives every visible
  run of text that reads as a time, independent of our attributes);
  `data-os-clock-ticks="true"`.
- `static: true` variant (a string that only looks like a time): still one clock
  on screen, `data-os-clock-ticks="false"`.
- a desktop that declares its own `[data-os-clock]`: not adopted, not patched.

## R3 — the bar spacing net

§4, with the honest instrument: `sky23:12:50`, `02:03:559/18/2026`,
`02:20:50|3px|18/09/2026` — **1 live bar in 4**, and the jam is between the
**time and the date** on every live instance, not between the OS name and the
clock. The visitor reads two values as one word. PROMPTS-4's rule asking for
the gap is landing partly at best; the prompt still asks for it.

**Rule:** inside the bars above only, where two adjacent same-line runs of text
have **< 4 px** between them, one **U+2009 thin space** is inserted as a text
node between them, at the level the two runs share. Whitespace is geometry, not
style (SPEC §2.2): no colour, font, margin or padding of the model's is
touched — the e2e asserts the two runs' own `style` attributes come back
byte-identical.

Three details that make it work rather than nearly work:

- **U+2009 and not a normal space.** The model's bars are flex rows, and CSS
  drops a whitespace-only text node in a flex container — it would render
  nothing. A thin space is not CSS white space, so it becomes a real anonymous
  flex item with a real width.
- **One pair at a time, re-measured.** Inserting a space moves everything to
  its right, so a pair that was jammed may not be after; up to 6 passes per bar.
- **Bounded and idempotent.** `GAP_BUDGET = 12` nodes per machine, a pair that
  already has one of ours between it is skipped, every node is removed by
  `resetFit()` at unmount, and the bar records `data-os-fit-gap="<n>"`.

`textRuns` / `adjacentPairs` are deliberately the **same algorithm** as
`scripts/run.mjs`'s rewritten `barSpacing` (HANDOFF-7 §4), so what the net
repairs and what the instrument reports cannot disagree — the failure mode of
the last three passes.

Also re-run on focus: a window entry landing in the bar is new text on the
clock's line, so a bar that was spaced while empty can jam the moment somebody
opens something.

**e2e** (`e2e/bars.spec.ts`), fixture `jammedBarDesktop` — the three bars §4
names:

| fixture | assertion |
|---|---|
| `name-clock` (`sky` + `23:12:50`, `gap:0`) | one thin space between them, gap > 0, `data-os-fit-gap="1"`, both runs' `style` untouched |
| `time-date` (`02:03:55` + `9/18/2026`) | same |
| `spaced` (the same bar with `gap:12px`) | **nothing inserted**, no `[data-os-fit-gap]` anywhere, gap still ≥ 10 px — a net that fires on a legible bar is a net that edits the machine for no reason |
| `time-date`, then open `notes` | after the entry lands, **no pair of runs in the bar is touching** (the spec re-derives the tightest gap itself) and the count is ≥ 1 |

## §8 — the phone's first launcher row under a fixed menu bar

`shots-v05-real-mobile/boot-1/02b-desktop-plates.png`: a fixed menu bar and a
launcher grid starting at the top of the screen, so the machine's name is
written across the first icon. The model's layout at a width it has never been
asked to think about; the overlap is geometry, so the kernel may move the
launchers out from under the bar.

**The least it can do and still fix it:** top padding on `[data-os-desktop]`
equal to the height of the bar over it, added to whatever padding the model
already wrote. Only a bar that is **out of flow** (`fixed` or `sticky`) counts —
padding cannot help against a bar the padding would push down too — only a bar
that is not inside `[data-os-desktop]` for the same reason, only the top edge,
and **only when the first launcher's box actually intersects the bar** in both
axes. Once per machine, `data-os-fit-launchers="<px>"` recorded, undone at
unmount, one telemetry line.

**e2e** (`e2e/bars.spec.ts` at 390×844), fixture `menuOverLaunchersDesktop`:
`data-os-fit-launchers="34"`, computed `padding-top: 40px` (the model's own
6 px plus the 34 px bar), **zero** launchers intersecting the bar afterwards,
and the topmost launcher at or below the bar's bottom. The mock desktop, whose
launchers already clear its bar, gets **no** `[data-os-fit-launchers]` at all.

## Files this pass changed

| file | change |
|---|---|
| `kernel/windows.ts` | R1: `soloOnPhone`, `focus`/`create`/`reflow` call it, `close` restores `lastFocused()` on a phone; `topBarBottom()` → `barInsets()` (both edges), `area()` takes the bottom inset below the breakpoint only |
| `kernel/inject.ts` | R2: `looksLikeTime`, `adoptClock`, `verifyClockTick`, `stopClockCheck`. R3: `textRuns`, `adjacentPairs`, `insertThin`, `fitBarGaps`. §8: `fitLauncherRow`. `barRoots`/`isBarShaped` extended to the unhooked menu bar; all of it undone by `resetFit()` |
| `kernel/index.ts` | `adoptClock` + `verifyClockTick` before `domMissing`; `fitBarGaps` after `fitBarContents` and again on focus; `fitLauncherRow`; one `wm.reflow()` when a bar grows |
| `e2e/fakes.ts` | `ownClockDesktop` (R2, `static` variant), `jammedBarDesktop` (3 variants, R3), `menuOverLaunchersDesktop` (§8) |
| `e2e/bars.spec.ts` | new — R2 (3), R3 (4), §8 (2) |
| `e2e/mobile.spec.ts` | R1 (3 new tests), `windowStates` reading, the bottom-bar assertion on the existing open test |
| `e2e/windows.spec.ts` | the mobile-breakpoint test is now "fills the layer minus its bottom bar" |

## What remains

1. **The bottom-bar inset above 768 px.** `barInsets()` reads both edges but
   `area()` only applies the bottom one below the breakpoint. On a desktop whose
   layer is `inset:0` under a fixed bar, a *maximised* window still covers the
   bar. It needs a ruling (does maximise mean the screen or the work area?), not
   a guess.
2. **R3 is a net, not a fix.** The prompt rule for the time/date pair is still
   not landing (§4: 1 bar in 4). The net makes every such bar legible, and the
   instrument names the pair — so the prompt iteration is now cheap to check.
   Prompts are not this lane's.
3. **`fitLauncherRow` handles the top edge only.** A launcher row under a
   *bottom* dock is the mirror defect and was not seen live; padding-bottom is
   the same three lines when somebody photographs one.
4. **The solo rule is mock-proven only.** It wants one 2-boot phone run on a
   real engine to confirm what it looks like when the model's own bar is where
   the task entries live (HANDOFF-7 §10's standing warning: an unexercised
   guard is not a proven one).
5. **`e2e/noreplace.spec.ts:71` flakes under load** (passes alone). It polls for
   `document.readyState === 'loading'` against the mock's stream; it wants a
   wider `MOCK_DELAY_MS` or a property that does not race.
6. Unchanged from HANDOFF-7 §11 and untouched here because they are other
   lanes': the wallpaper instrument (#4), `iconsFilled 5/16` (#5), `seen ≪
   filled` (#6), the fal error body (#7), `thumbnails` drawing real landmarks
   (#8).
