# KERNEL-5 — ink, focus, the fit guard, and `auto` on `/`

2026-09-17, evening. Kernel side of SEAMS **H1** (the routed engine, client half),
**H3** (ink vs paint) and **H4** (focus state), plus the viewport fit guard.
Nothing outside `kernel/**`, `e2e/**` and the `public/` build output was touched;
`server/**` and `prompts/**` were being written in parallel by their own
sessions and are only read here.

**Spend: $0.00.** Everything in this pass ran on the mock engine and on faked
responses; no provider and no fal call was made.

---

## The headline: a visitor waits for black exactly never

HANDOFF-4's #1 was that on `cerebras-oss120` roughly one boot generation in three
spends its whole budget on reasoning, emits the identity comment and **no
document at all** — and that §12.3's 2.5 s floor then held an empty black overlay
in front of a desktop that was already interactive. Two instruments hid it in
opposite directions: the kernel called "the first chunk was written" a first
paint (4,176 ms, for a frame that was black for its whole life), and the harness's
text probe reported nothing for boot screens that were fine.

**The fix is the distinction, not a pixel of ours.** The injected runtime now
reports two separate things per document:

| message | means | reported as |
|---|---|---|
| `paint` | the first chunk was written; the runtime has the document open and its delegation attached | `interactive_ms` |
| `ink` | the document has an element with a box bigger than a pixel | `first_paint_ms` **and** `ink_ms` |

and the reveal rule became:

- the boot frame **inked** → the 2.5 s floor applies, **measured from the ink**,
  so a boot screen someone can read still gets its full time on screen;
- the boot frame **never inked** and the desktop is interactive → reveal
  **immediately**, synchronously, no timer, no hold.

One naming note, since the seam wrote it as `{type:'ink'}`: the message is
`{__os:1, t:'ink'}`, because every message in this protocol has used `t` since
v0 and both ends of it are kernel code. The server's `/api/mark` already accepts
`ink_ms`, so the two halves of H3 met without a change on either side — a real
telemetry line from this tree reads
`"interactive_ms":94,"first_paint_ms":95,"ink_ms":95`.

Ink is "any element inside `<body>` with a box > 1 px, with the tags that never
draw excluded by name" — deliberately the same rule as the harness's own probe
(`scripts/run.mjs`, `bootPainted`), so the two instruments can no longer
disagree. It is cheap: at most one scan per animation frame, first hit wins, at
most 400 elements looked at, and only a document with no ink at all ever pays
the full scan (those documents are tiny by definition).

New readings on `<html>`, for the harness and for a human with devtools open:

| attribute | value |
|---|---|
| `data-os-boot-ink` | ms from boot start to the boot frame's ink, or `none` |
| `data-os-boot-hold-ms` | how long the overlay was held after the desktop was interactive (`0` on a frame that never inked) |
| `data-os-revealed-ms` | when the overlay actually came off, against the same origin as `data-os-desktop-ms` |

The gap between `data-os-desktop-ms` and `data-os-revealed-ms` **is** the hold,
and it is now readable rather than inferred.

**What this does not fix, and cannot:** a boot whose generation produces no
document still shows black *until the desktop is interactive*, because the
kernel has nothing to show and is forbidden to paint anything of its own. On
BAKEOFF-3's bad afternoon that is 5.4-9.6 s, not 2.5. What is gone is the
**extra** 2.5 s spent holding an empty frame in front of a finished desktop —
the part that was ours. The rest is the provider, and the levers for it are #1
and #2 below (a boot retry, a different engine for `kind=boot`, or H2's hedge
actually rescuing the case), none of which this pass was asked to take.

### What this changes about I6's numbers

`first_paint_ms` for every kind — boot, desktop, app, page — is now the ink.
`interactive_ms` keeps the older meaning on app and page documents (the first
chunk, when the delegation attaches). One e2e assertion had to move with the
definition: `marks.spec.ts` asserted `interactive_ms === first_paint_ms`, which
was only ever true because both came from the same event; it now asserts both
are reported against the generation and that `interactive_ms <= first_paint_ms`.

**Bake-off numbers from before this pass are not comparable** where a document's
first chunk was not its first box. For `cerebras-oss120` boots that is the whole
point: the old boot `first_paint_ms` of 4,176 ms on a frame that never painted is
now either an honest ink time or nothing at all.

### Marks are coalesced now, and that is not cosmetic

H3 splits one moment into two, which would have meant a third `/api/mark` POST
per document. HANDOFF-4 issue 1 was a browser's **six-connection HTTP/1.1
ceiling** starving `/api/gen` outright, and the kernel's budget is three
generations plus two pictures — a mark must never be the sixth connection. So
`mark()` now buffers for 50 ms and merges, which puts the common case back at
**one** request carrying paint, ink and interactive together, and flushes on
`pagehide`/`beforeunload` so nothing is lost at teardown.

---

## H4 — focus state

- `data-os-focused="true|false"` on **every** window root, not only the focused
  one: `false` is a selector too, and `prompts/system/desktop.md` already
  promises the model both rules (lines 232-240, 320). The prompt side shipped
  this contract in the same window as this pass; the two agree.
- `data-os-active` on the task entry of the focused window, and on exactly one.
- Clicking a task entry focuses, or restores and focuses a minimized window
  (that wiring existed; it is now covered and the attributes follow it).
- A minimized window is not focused and its entry is not active; **closing the
  focused window hands focus to the window underneath it**, which is the one the
  visitor is now looking at.
- The focused window is fully above all others (`z` = the max on the desktop),
  and its **title bar is never left sharing a strip with another window's**.

That last one is placement, so it is the kernel's (§2.2). The subtlety worth
recording: *a cascade overlap is not a collision.* `CASCADE_STEP` is 36 px and
the mock's own window chrome measures a **46 px** title bar, so every second
window overlaps the previous one's bar by ten pixels — and both titles are
perfectly readable, because that is what a cascade looks like. Nudging for ten
pixels turned every second window into a 72 px double step and marched the sixth
into the corner (measured, then fixed). `stripsCollide` is therefore
proportional: the strips must cover **at least half of the shorter one, and at
least 12 px**, before anything moves. The case it exists for is the cascade
wrapping at `CASCADE_WRAP`, where the seventh window lands exactly on the first,
and a desktop script or a resize putting two windows in the same place. The
nudge steps the focused window down-right inside the layer, records
`data-os-nudged="<steps>"`, and gives up rather than walking into a corner.

---

## The viewport fit guard

The desktop is the model's document, and the page's own
`html,body{height:100%;overflow:hidden}` is **beaten** by the desktop's own
`<style>` blocks, which are appended to `<head>` after it. Give the desktop area
a fixed 1,700 px height, write the bar after it in the normal flow, and the bar —
with its clock and every window entry the kernel appends to it — is below the
fold of a document nobody can scroll. Geometry, not style, so:

1. `height:100%; overflow:hidden` **inline** on `<html>` and `<body>` (inline
   beats the model's stylesheet without `!important` and touches no colour,
   font, or position). Recorded as `data-os-fit="clamped"`.
2. **Only if** a `[data-os-taskbar]` is still clipped after that: pin it
   `position:fixed` to the viewport edge it is nearest **along its short axis**,
   so a wide bar goes to the top or bottom and a side dock to its side (§12.3
   allows all four). Recorded as `data-os-fit-pinned="top|bottom|left|right"`.

The pin is coarse on purpose: a horizontal bar gets `left:0;right:0`, so a
floating dock inset from both sides comes out full width. `position:fixed`
without those offsets shrink-wraps a bar that was in the normal flow, which
breaks a flex row outright — and a bar that reaches this code is off the screen
already. If a real desktop ever loses a floating dock to this, the narrower rule
is to keep the measured width for a bar under ~80% of the viewport.

Detection covers `[data-os-taskbar]` and `[data-os-clock]` — in the `dock`
archetype the clock is in the menu bar and the taskbar is the dock's running end,
so either can be the part that hangs off the screen. Pinning is only ever
applied to `[data-os-taskbar]`. It re-runs on resize, it is idempotent, and
`resetFit()` undoes every property at unmount so the next machine starts on the
document the page served. A desktop that already fits is not touched at all —
asserted.

---

## H1 — `/` asks for `auto`

`chooseEngine` now resolves, in order: `?engine=` (any id the server lists,
including `auto`), then **`auto` on `/` whenever `/api/engines` advertises it**,
then the server default, then the first real engine. `/bakeoff/run` never
resolves to `auto` on its own and its picker lists single engines only — a
single engine silently helped by a second one cannot be judged — while
`?engine=auto`, typed by a judge who wants to watch the router, still works.
A server that has not shipped the table lists no `auto` and the old choice
applies unchanged, so the suite (which runs `DEFAULT_ENGINE=mock` and no keys)
is unaffected.

The HUD gained three lines: `hedge won by <winner> / lost <loser> @<ms> <n> in
billed` when telemetry says `hedged`, `routed <winner>` when a routed generation
was not hedged, and `ink boot <ms|NONE>`, which is the reading the two
instruments used to disagree about.

---

## Three things found on the way

- **A reboot added another `resize` listener.** `mountDesk` wired
  `window.addEventListener('resize', …)` on every mount, so the fourth machine
  of a session reflowed four times per resize event. One listener for the life
  of the page now; it reads the live `wm`, which is why one is enough.
- **The stall report was asking the wrong question.** HANDOFF-4's fix for
  "a window that never paints, with no telemetry line anywhere" reports a
  generation that has *painted* nothing after 12 s — and a document whose only
  bytes are a comment or a stylesheet has painted. It asks `inked` now, and says
  which of the two it was: `(bytes arrived, none of them a box)` or
  `(no bytes at all)`. That is the same mistake as the headline, one layer down.
- **A generated desktop could forge the kernel's own readings.** `mountDesktop`
  carries the model's `<html>` `data-*` attributes across, and only refused the
  kernel's state flags where one was *already* set. A machine that declared
  `data-os-fit` or `data-os-boot-ink` on `<html>` would therefore have written
  the number a bake-off report trusts. The refusal is unconditional now, for
  every kernel-owned flag. `data-os-archetype` is deliberately still the
  model's (I5).

---

## Tests

**Verified on the final build**: `npm run build` clean, `npm test` **281 passed**,
`npx playwright test` **88 passed** (5.0 min, exit 0). `npx tsc --noEmit` is clean
for `kernel/**`; the one error it reports is in `server/index.ts`, which the
server session was mid-edit on and which this pass must not touch.

**Mock-only, $0.** `npm test` **281 unit** (unchanged by this pass — 252 at
HANDOFF-4, the rest arrived from the server and prompts sessions working in the
same window) · `npm run test:e2e` **88 e2e** (was 72), 16 new in four files:

| file | what it holds |
|---|---|
| `e2e/ink.spec.ts` | a boot stream that is only the identity comment reveals at once (`ink=none`, `hold=0`, revealed within 500 ms of interactive); a boot screen that inks keeps its floor, measured from the ink; the runtime reports `paint` for a `<style>`-only chunk and `ink` only once a box exists |
| `e2e/focus.spec.ts` | the focused/active attributes on both windows and one task entry; task-entry focus and restore; close hands focus down; the cascade needs no nudge and a real collision gets one |
| `e2e/fit.spec.ts` | the overflowing desktop is clamped and its bar pinned to the bottom with its clock on screen; a window entry lands in the pinned bar and is hit-testable; a desktop that fits is untouched |
| `e2e/routing.spec.ts` | `/` sends `engine:"auto"` on every generation when the server advertises it and falls back to a single engine when it does not; `/bakeoff/run` keeps explicit ids; the HUD names the hedge winner and the boot ink |

Two existing assertions moved with the definitions they were written against,
and both changes are in the report rather than quiet:

- `marks.spec.ts` — `interactive_ms === first_paint_ms` (above).
- `windows.spec.ts` — "the seventh window starts the cascade again" asserted the
  seventh window's *final* position equals the first's. It is still where
  `cascade()` puts it and then nudged off window one's title bar, so the
  assertion is now the thing that rule is actually for: **no two title bars on
  the desktop share a strip**, pairwise, across all seven. `cascade()`'s own
  wrap is unchanged and still pinned by `test/geometry.test.ts`.

### Two MOCK_BREAK modes the server's mock should serve

Both are faked at the network layer in `e2e/fakes.ts` for now (this pass does
not own `server/**`). Names, for whoever adds them:

- **`boot-ink-none`** — a boot stream that is the identity comment and then EOF.
  Distinct from the mock's new `fake:reason` seed, which emits *nothing at all*
  (no comment either, so the kernel takes the identity-rescue path instead).
  This is the shape HANDOFF-4's probe 1 actually had.
- **`desktop-overflow`** — a contract-complete desktop whose `[data-os-desktop]`
  is 1,700 px tall with the bar after it in the flow and `overflow:auto`
  re-opened on `html,body`.

When they land, `e2e/fakes.ts`'s `identityOnlyBoot` / `overflowDesktop` can be
replaced by two more `server(port, { MOCK_BREAK: … })` entries in
`playwright.config.ts` — deliberately not added here, because the server session
is editing that file for H2's fake upstreams in the same window.

---

## What is left

1. **The boot generation that emits no document still costs money for nothing**
   (HANDOFF-4 #2). This pass fixed the *symptom* exactly as ruled — the visitor
   never waits for black — and took no position on whether such a boot deserves
   a retry. With H2's hedge now in the server, the interesting measurement is
   whether the hedge's second engine rescues the no-document case at all, or
   whether both engines reason their budget away together. One real bake-off
   answers it; `data-os-boot-ink=none` is the number to count.
2. **`scripts/run.mjs` should read `data-os-boot-ink` rather than poll for
   pixels.** Its own probe is still a 50 ms poll loop with a 130 s deadline; the
   kernel now posts the same fact once, and the harness's `bootPaintMs: null`
   and the kernel's `ink_ms` should be the same number by construction. Not done
   here: `scripts/` is not in this pass's ownership.
3. **The fit guard has no real-engine evidence yet.** It has never fired on a
   generated desktop, because no desktop in BAKEOFF-3 wrote a clipped bar —
   `data-os-fit` is the attribute to count on the next run, and if it never
   appears the guard is insurance rather than a repair.
4. **`data-os-nudged` likewise**: the cascade wrap needs seven windows in one
   session, which no bake-off has opened. If a run shows nudges at two or three
   windows, `CASCADE_STEP` is too small for that machine's title bar and the
   step — not the nudge — is what should change.
5. **One wart in the nudge, accepted deliberately.** Focus fires on
   `pointerdown` inside a window, so the first click into a window whose title
   bar is sharing a strip moves that window by one cascade step under the
   cursor — once, because after it there is no collision. Real desktops do not
   move a window on focus; the alternative is leaving two title bars in one
   place, which is what H4 forbids. If it reads badly in use, the narrower rule
   is to nudge only on a task-entry focus and on a new window, and to leave a
   window the visitor is clicking into alone.
6. **Focus styling is unverified against a real engine.** The prompt promises
   the model `[data-os-focused="true|false"]` and `[data-os-active]`; whether
   `cerebras-oss120` actually writes two different title-bar rules is a
   bake-off reading, and worth one line in the next desktop-structure table.
