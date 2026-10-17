# KERNEL-7 — the two invisible defects, and the one the real click found

2026-09-17 23:15 → 2026-09-18 00:4x PKT. Kernel pass over the architect's live
test on `/` (engine `auto`, machine **wisp**, `dock` archetype): D2 (a window
with no visible title bar and no visible close control), D3 (the dock's launcher
labels gone once the plate sheet landed), plus SEAM T2's runtime half, T1's
kernel half, the e2e realism debt (KERNEL-6 #2 / HANDOFF-6 #7), the dead
generation lane, and the phone.

Owns `kernel/**`, `e2e/**`, the `public/` build output. `server/**`,
`prompts/**`, `engines.json` and `scripts/**` untouched — another session was
writing `server/**` and `test/**` in this same tree throughout (its T1/T2/T3
halves landed while this pass ran; §8).

**Headline: D2 and D3 are fixed at the cause, and the fix for the e2e suite
found a third defect that was worse than either.** `helpers.openApp` now clicks
with a real hit-tested pointer instead of dispatching an event, and on its first
run it found that **`#os-root` — the kernel page's own empty
`position:fixed;inset:0` div — was on top of every launcher on any desktop whose
launcher area is in normal flow, and took the click.** No window, no generation,
nothing logged: the exact failure shape KERNEL-6 traced to a CSS selector, in the
kernel again, invisible for the same reason (nothing in the suite had ever
clicked anything).

**Tree: green.** `npm test` **341 unit** · `npm run test:e2e` **134 e2e** on
mock (102 at 182b26a; +32 here, −3 unit deleted with the dead lane) · `npx tsc
--noEmit` clean · `npm run build` clean. **Spend: $0** — everything here was
proved on the mock engine with `/api/img` faked at the network layer; no
provider key was used and no picture was bought. `dist/play.js` untouched, port
8799 never used, nothing with `play.js` in its command line signalled. Nothing
committed.

---

## 1. D3 — the labels: found by probe, fixed at the cause

**The cause is one line, and the guard around it was measuring the wrong box.**

`kernel/img.ts` `centreGlyph` writes `line-height: <box height>px` onto the
element carrying `[data-os-icon]`, to sit the model's glyph in the middle of the
plate that just landed. On the shape `prompts/system/desktop.md` asks for — one
glyph in a 48 px `<span>`, the label in a **sibling** — that is harmless, and it
was guarded: applied, re-measured, reverted if the element's own box moved by as
much as a pixel.

On a launcher that carries `data-os-icon` **itself** (the whole launcher is the
icon slot — a shape the prompt asks against and models write anyway, especially
for a dock) the same line height inflates the glyph's line box *inside* the
launcher and pushes everything after the glyph — the label — down. The guard
cannot see it: a dock icon whose height the model's CSS pins (`height:66px`)
does not move at all. The label leaves through the nearest `overflow:hidden`,
which on a Mac-shaped dock is the dock's own rounded clip.

### The probe

`getBoundingClientRect` on the label reports the same box before and after, so
the probe measures the **visible pixels**: the label's box intersected with every
clipping ancestor and the viewport. Nineteen launcher shapes were built against
the real `applyIconSheet` (bundled out of `kernel/img.ts`, driven in Chromium):
canonical grid, canonical dock, empty icon element, inline icon, boxless icon,
icon-on-launcher, label-inside-icon, absolutely-positioned label, hover-only
labels, clipped dock, clipped launcher, and the combinations.

| shape | before the fix | after |
|---|---|---|
| canonical taskbar grid, canonical dock, 13 others | no change | no change |
| **icon-on-launcher** (dock) | label moved **15 px** down | no change |
| **icon-on-launcher + launcher clips at 60 px** | moved 21 px, **newly clipped** | no change |
| **icon-on-launcher inside a clipping dock** | moved 15 px, **newly clipped** | no change |
| **icon-on-launcher, launcher `height:68px;overflow:hidden`** | moved 25 px, **newly clipped** | no change |

### The fixes

- **`glyphOnly()`** — the centring is attempted only on a slot that holds one
  glyph and **no element children**. An icon slot that also contains the
  launcher's label is not a glyph in a box, it is the whole launcher, and a line
  height there is a layout instruction to somebody else's text.
- **`el.style.width || '44px'` read the INLINE style**, so a model that wrote
  `width:auto` inline on its icon slot kept its zero box and got a plate 0 px
  wide — bought, applied, invisible. The box the kernel measured (`had`) is now
  what decides, and the one reflow the kernel is allowed is marked
  `data-os-img-boxed="44"` so an instrument can count it instead of inferring it.
- **The legibility insurance now reaches a dock.** The one rule the kernel
  carries for the picture it injected was scoped
  `[data-os-desktop] [data-os-app]` — and in the `dock` archetype the dock is a
  **sibling** of `[data-os-desktop]`, so it reached everything except the
  launchers the architect could not read. Now `[data-os-app]`, anywhere.

### T4's net (`keepLabels`)

Cause fixes are not enough for a document nobody has seen yet, so the kernel now
asks the visitor's question after it applies a picture: **is the label still on
screen?** Per launcher, visible label pixels before and after
(`kernel/visible.ts` `textArea`); if the answer dropped below half, the kernel's
own styles are taken back off that launcher's icon slot and the reading is
recorded as `data-os-label-kept="1583>0>1583"`.

Two things it deliberately does not do: it never **adds** a style to make a
label appear (a dock that shows its names on hover is a real design — that reads
the same before and after, so there is nothing to undo), and it never moves
anything to make room.

### Why every instrument said 16/16

`scripts/run.mjs` counts a launcher as labelled when
`innerText.trim().length > 0 || el.querySelector('[data-os-icon],img,svg')`.
`innerText` is indifferent to clipping and the second clause passes on the glyph
alone, so `launchersLabelled: 16` was guaranteed while this defect was live, on
every boot of every probe in HANDOFF-6. `scripts/**` is not this pass's; that
one line is the instrument to fix, and `e2e/labels.spec.ts` measures it the
right way (with its own implementation, deliberately not the kernel's).

## 2. D2 — window chrome, measured in pixels (SEAM T4)

The live window's chrome had every hook §3.2 asks for, spelled correctly, and
the contract validator called the desktop `ok`. It was also a zero-height
clipped strip and three 0×0 transparent buttons. "The attribute is in the
document" and "a person can see and click it" are different claims, and only the
first was ever measured — the same gap KERNEL-6 found between a bar's box and
the contents of that bar.

`kernel/windows.ts` now reads the chrome (`readChrome`) off the **real window
root**, after it is in the document and sized:

- the title strip (`[data-os-drag]`, or the title's own parent) must be **≥ 20 px**
  tall, on screen, and not transparent;
- `[data-os-close]` must be **≥ 16×16 px**, at least half of it visible after
  clipping, with non-zero accumulated opacity, and **drawn** — a glyph, a word,
  an `<svg>`, its own background image, a background colour that differs from
  the bar's, a border, or a child that draws something.

A window that fails gets **one bare unstyled strip** (SPEC §3.2's fallback
class: system font, no colours, nothing invented about this machine's look)
inserted at the top of the window root, carrying the title and three bare
buttons — `wire()` then hooks them up like any other control, and the strip
carries `data-os-drag`, so the window can be moved as well as closed. If the
model's own content paints over the strip (an absolutely positioned root), the
strip is raised once, asked of `elementFromPoint` rather than assumed.

Also here:

- **A reading at mount, before anybody opens anything**: `probeChrome` clones
  the template into the layer at its real size, measures, and removes it
  **synchronously** — no yield to the renderer, so it is never painted and never
  seen. Published as `html[data-os-chrome-template]`.
- **The task-entry half.** An entry with no box, or with no visible title text,
  is replaced by a bare one carrying the title (`data-os-task-fallback`). This is
  the other half of §12.3's "one entry per open window"; BAKEOFF-4's
  `fitBarContents` grew a bar whose entries hung out of the screen, and this
  catches the entry that has no pixels at all.
- **Both are reported, never silent**: `contract_patch chrome|task` in
  telemetry, `html[data-os-contract-patch]`, `data-os-chrome="ok|patched"` and
  `data-os-chrome-why` per window. D2 is the defect that had no number anywhere;
  now it has four.
- A window's title is written to **every** `[data-os-title]` it declares, not
  the first: a window with the kernel's strip *and* the model's hidden header
  otherwise updates only the one nobody can see.

## 3. The defect the real click found — `#os-root` ate the launcher

`server/page.ts` serves one empty div, `#os-root{position:fixed;inset:0}`, and
the desktop is mounted into `document.body` beside it. A positioned box paints
above the in-flow content of the same stacking context. So on **every desktop
whose launcher area is in normal flow** — a `display:grid` section on the
wallpaper, which is exactly what the desktop prompt asks for — `#os-root` is the
topmost element at every launcher, `document.elementFromPoint` returns it, and a
real click lands on it. The kernel's delegation reads
`event.target.closest('[data-os-app]')`, gets `null`, and the launcher is dead:
no window, no connection, no generation, no exception, nothing logged anywhere.

It survived because every e2e test **dispatched** its clicks, and the two real
clickers in the tree (`scripts/stress.mjs`, `scripts/desk-probe.mjs`) happened
to meet desktops that positioned their launcher areas — `dockLaunchersDesktop`'s
`.desk` is `position:absolute`, and so were the 8 stressed boots' launcher
areas, which is why HANDOFF-6 measured 64/64 opens.

**Fix:** `#os-root` holds nothing (the boot overlay and the kernel's own screens
are appended to `document.body`), so it takes no pointer events. That is the
identical rule `stackDesktopLayers` already applies to the model's own empty
windows layer, applied to the kernel's own empty layer, and it paints nothing.
One line, `kernel/index.ts`.

**This is a candidate cause for part of HANDOFF-6 remaining issue 1** ("a
desktop with nothing to click"). It is not the off-screen-launcher case (those
boots reported 16/16 launchers outside the viewport, which is the model's
layout), but any boot whose launchers were on screen, reported `contract: ok`,
and produced no window on a click was this. It is worth re-reading the two
"nothing to click" boots' ancestor chains with that in mind.

## 4. T2 — tile sheets, runtime and kernel side

The wire contract is the concurrent session's (`server/img.ts` `normalizeTiles`,
`TILE_THEMES`), and this side was written against it rather than beside it:

- `kernel/protocol.ts`: `DocImgKind` gains `tiles`, plus `TILE_THEMES`
  (identical list to the server's), `TILE_THEME_DEFAULT`, `isSheetKind`.
- **The runtime groups by theme.** A document declares
  `data-os-img="tiles" data-os-theme="posters" data-os-tile="0..15"`, with one
  shared `data-os-prompt` on the group's **first** member describing the set.
  `collectImgSlots` issues **one** request per theme, marks every member of the
  group with the same slot, and counts the sheet **once** against the
  per-document ceiling (4 app / 2 page). Six tiles are not six pictures.
- **`fillTiles` slices by slot**, so two sheets in one document cannot slice into
  each other's elements: members are `[data-os-img-slot="s1"][data-os-tile]`,
  plus `[data-os-face]` for the `faces` theme. `faces` stays an alias in both
  directions — a page written against v0.4 (`data-os-img="faces"` + a 1×1 asker
  + `[data-os-face]` elements) keeps its pictures, and goes on the wire as
  `{kind:"tiles", theme:"faces"}`.
- The theme is clamped in `kernel/frames.ts` (length and character set) and
  passed through **verbatim** otherwise: the server refuses a theme it does not
  know, because quietly drawing sixteen faces where sixteen posters were asked
  for spends $0.003 on the wrong picture and hides the mismatch.

`e2e/tiles.spec.ts` (5 tests): one call per theme with the group's prompt, the
slicing against `sheetSlice`, two sheets not sharing a slot, the page ceiling
counting a sheet as one, all five themes, a group with no prompt anywhere being
no request, and the `faces` alias still slicing `[data-os-face]`.

## 5. T1 — `DEFAULT_ENGINE` honoured on `/` (kernel half)

`chooseEngine` preferred `auto` whenever `/api/engines` listed it and never
looked at the default underneath, which is why HANDOFF-6 §2 reproduced three
times that `DEFAULT_ENGINE=cerebras-oss120` still boots `/` on the routed,
hedged path at the hedged price. Now:

`?engine=` (a judge's explicit choice) → **the pin** → `auto` on `/` → the old
single-engine fallback. A pin naming an engine this server has no key for is not
a pin, because it is not in the list. `/api/engines`'s `pinned` field is the
authority when it answers at all (it is read at boot; the HTML that loaded the
bundle can be older than the bundle), and `<body data-engine>` is the fallback
for a server that has not shipped the field — `pinned: null` means "no pin",
`pinned` **absent** means "ask the page".

The server session shipped the other half during this pass, and both are now
verified together: `/api/engines` answers `pinned: "mock"` on the suite's own
servers (`DEFAULT_ENGINE=mock`), and 5 new tests in `e2e/routing.spec.ts` cover
the pin, no pin, a bogus pin, and `?engine=` outranking it.

## 6. The generation lane is deleted (HANDOFF-5 #9 / KERNEL-6 #3)

`GEN_CONCURRENCY`, `setGenConcurrency`, `genLaneState`, `setGenWaitReporter`,
`genSlot` and `test/genlane.test.ts` (3 tests) are gone; `genStream` calls the
fetch directly again. The lane rationed connections for a blank-window
mechanism that was never running — KERNEL-6 found the actual cause was one CSS
selector — so it was admission control over an empty queue, shipped inert behind
a switch nobody was allowed to touch, with three tests proving the rationing
worked. An epitaph comment stays in `kernel/gen.ts` saying what it was and what
would have to be measured before anything like it comes back. The live lane
(images, two at a time) is untouched.

## 7. e2e realism, and the phone

- **`helpers.openApp` clicks for real by default.** A real pointer press and
  release, through Playwright's actionability and hit-testing, which also
  exercises the production path a dispatched event never did: `mousedown` starts
  the speculative generation (§12.1 / I4) and the click claims it.
  **The documented fallback**: a window a test already opened can sit over the
  launcher grid (the geometry is the model's), so after `REAL_CLICK_MS` (4 s) the
  helper falls back to the old dispatch, **records it in `openAppFallbacks`** and
  says so on the console. In the full suite that fires **17 times** across 72
  `openApp` call sites, every one of them in a test that already has a window
  over the launcher grid (`focus`, `windows`, `trace`, `osimg` — the tests whose
  subject is two or three windows at once). Measured rather than assumed: a
  5×5 clear-point scan of each of those launchers' boxes found **no** point the
  pointer could reach, i.e. they are wholly covered, so this is the case the
  fallback exists for and not a hidden refusal. (The scan was written, measured,
  and then removed: it changed nothing in this suite and its only effect would
  have been in a half-covered case that does not occur here.)
  So roughly a quarter of the suite's opens are still dispatched, and closing
  that wants the owning tests to move or close their window first. What IS
  closed is the hole itself: a delegation bug that refuses real clicks can no
  longer pass the whole suite — it fails `hittest.spec.ts` five ways. `clickLauncher` is the strict version — no fallback, so a covered
  launcher fails the test — and `hitTestLauncher` reports what the pointer
  actually finds, re-measured at the moment it is asked (HANDOFF-6's trap: a
  launcher's box goes stale within a second).
- **`e2e/hittest.spec.ts`** — one real, hit-tested open per way a launcher can
  be reached, per archetype, on the mock engine, for free: a launcher inside the
  model's own dock, a desktop icon on the wallpaper, a start-menu entry that only
  exists after the model's own script runs, a grid icon, plus the `#os-root`
  regression and the press-then-claim of the speculative generation.
- **`e2e/mobile.spec.ts`** — 390×844, six tests: a tap opens a full-size window
  on the mock desktop and closes it again; the bar and its ticking clock stay on
  screen; a dock desktop's launchers are never covered-but-clickable; a taskbar
  with a start menu works by tap; T4's bare strip is reachable and closes the
  window at phone width; and a window is never dragged below the breakpoint
  (§2.2). **Nothing needed fixing beyond `#os-root`**, which was hitting phones
  too. One thing measured and left alone: a dock eight icons wide does not fit
  390 px, so some launchers are off screen — the model's layout, and HANDOFF-6
  remaining issue 1.

## 8. What the concurrent session shipped while this ran (verified, not assumed)

Read-only checks against the tree at the end of this pass, because these are the
other halves of the same seams:

| seam | server side | state |
|---|---|---|
| T1 | per-kind hedge triggers `HEDGE_AFTER_MS_BOOT=0` / `_DESKTOP=600` / `=900` | in `server/hedge.ts` |
| T1 | `advertisedDefault()` honours a real `DEFAULT_ENGINE`; `pinned` on `/api/engines`; `<body data-engine>` | in `server/index.ts`, `server/page.ts` |
| T2 | `kind: "tiles"` + `theme`, `normalizeTiles`, `TILE_THEMES`, `buildTilesPrompt` | in `server/img.ts`, `server/imgprompt.ts` |
| T3 | wallpaper 1024×576, icons 768×768, tiles 768×768, map 768×576, photo 640×640, `IMG_TIMEOUT_MS` 20000 | in `server/img.ts`, `server/env.ts` |

So **D1, D5 and D6 are closed by that side**, and D4 (the clock jammed against
the OS name, `sky23:12:50`) is the one live defect nobody's brief covered: it is
a prompt/markup matter unless the clock was the kernel's own fallback, and the
kernel's fallback clock carries `padding:0 8px`, so on wisp it was the model's.
Worth one line in `prompts/system/desktop.md`.

## 9. Files this pass changed

| file | change |
|---|---|
| `kernel/visible.ts` | **new** — `seen`/`visible`/`textEls`/`textArea`: visible pixels after clipping, the viewport and accumulated opacity |
| `kernel/img.ts` | D3: `glyphOnly` guard on the centring, the inline-`width` bug, `data-os-img-boxed`, T4's `keepLabels` net, the legibility rule reaching a dock, `theme` on a doc image request |
| `kernel/windows.ts` | T4: `readChrome`, `probeChrome`, `bareChromeStrip`, `ensureChrome` per window, the bare task entry, titles to every `[data-os-title]`, the `onPatch` hook |
| `kernel/index.ts` | `#os-root` takes no pointer events; T1's pin in `chooseEngine`; the mount-time chrome reading; `contract_patch` telemetry; `theme` through `handleImg`; the dead lane's reporter removed |
| `kernel/injected/runtime.ts` | T2: tile grouping by theme, one ask per group, `fillTiles` slicing by slot (`faces` kept as a theme) |
| `kernel/protocol.ts` | T2: `tiles` kind, `TILE_THEMES`, `TILE_THEME_DEFAULT`, `isSheetKind`, `theme` on both message directions |
| `kernel/frames.ts` | T2: the theme clamped and passed through, `fillImg(..., theme)` |
| `kernel/gen.ts` | the generation lane deleted, epitaph kept |
| `kernel/inject.ts` | `data-os-contract-patch` / `data-os-chrome-template` added to the forgery blocklist |
| `e2e/helpers.ts` | real hit-tested `openApp` with a recorded fallback, strict `clickLauncher`, `hitTestLauncher` |
| `e2e/fakes.ts` | `routeImg` + `FAKE_JPEG` (shared), `chromelessDesktop`, `dockLabelDesktop`, `boxlessIconDesktop`, `hoverLabelDesktop`, `startMenuDesktop`, `pinned` on `routeEngines` |
| `e2e/chrome.spec.ts` | **new**, 7 tests — D2/T4 |
| `e2e/labels.spec.ts` | **new**, 5 tests — D3 and the net |
| `e2e/tiles.spec.ts` | **new**, 5 tests — T2 |
| `e2e/hittest.spec.ts` | **new**, 5 tests — real clicks, both archetypes, three routes |
| `e2e/mobile.spec.ts` | **new**, 6 tests — 390×844 |
| `e2e/routing.spec.ts` | +5 tests — T1's pin |
| `e2e/*` counts | 7 chrome + 5 labels + 5 tiles + 5 hittest + 6 mobile + 5 routing = **+33**, one of which replaced an existing assertion's meaning |
| `e2e/osimg.spec.ts` | the `faces` wire kind is now `tiles` + `theme: "faces"` (the document spelling is unchanged and still asserted) |
| `test/genlane.test.ts` | **deleted** with the lane |

## 10. What remains

0. **17 of the suite's 72 `openApp` calls still fall back to a dispatched
   click** (§7) — all of them where a window is already over the launcher.
   Named, logged and counted now rather than silent; worth a pass that closes or
   moves the window in those tests so the fallback becomes dead code.
1. **`scripts/run.mjs`'s `launchersLabelled` is a false negative generator**
   (§1). One line: measure visible text pixels, not `innerText`-or-an-icon. Same
   file should record `data-os-chrome`, `data-os-contract-patch` and
   `data-os-label-kept` per boot, which is what turns the next D2/D3 into a
   number instead of an eye check.
2. **A start menu loses to the windows layer.** §12.9 raises the windows layer
   above `[data-os-desktop]` and the bar above the layer; a menu that is a
   sibling of the bar (`position:fixed`, no z-index) ends up under an open
   window. Measured in `e2e/hittest.spec.ts` (which now opens the menu entry
   before any window, deliberately). A menu is not a contract hook, so the
   kernel cannot identify one — this is a ruling (a `[data-os-menu]` hook, or
   accept it).
3. **D4, the clock spacing** — prompts (§8).
4. **The boxless-slot reflow is still a reflow.** The one sanctioned exception
   (nothing can show a picture in nothing) now actually fires, where before an
   inline `width:auto` silently defeated it, so a desktop that writes boxless
   icon slots will move its labels down by up to 44 px when the sheet lands.
   T4's net keeps them readable; INTEGRATE-1's "nothing may move" is still
   violated for that shape. If that trade is wrong, the answer is to drop the
   repair and let a boxless slot stay empty — one `if`, and the reading
   `data-os-img-boxed` says how often it would matter.
5. **None of this has been seen on a real engine.** Everything here is mock,
   which is the point ($0), but D2's and D3's fixes want one live `dock` boot
   with `data-os-chrome`, `data-os-contract-patch` and `data-os-label-kept` read
   at the end, and `#os-root` wants one live boot whose launcher grid is in
   normal flow — which was ~half of every desktop generated so far.
