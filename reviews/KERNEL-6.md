# KERNEL-6 — the blank app window: found, proved, fixed

2026-09-17, ~20:25–22:05 PKT. Kernel pass over HANDOFF-5's remaining issue 1
(the blank app window), the architect's ICON RULING, and window opacity /
stacking. Owns `kernel/**`, `e2e/**`, the `public/` build output. `server/**`,
`prompts/**` and `engines.json` untouched (another session was writing those in
the same tree during this pass — see "Tree note").

**Verdict: the blank app window was not a socket, not a hang, not a race and not
a truncation. It was one CSS selector.** The desktop's click delegation skipped
anything inside `[data-os-dock]` — an attribute that identifies the kernel's own
bake-off chrome, in a document the **model** writes. SPEC §12.3's `dock`
archetype is literally "a dock along the bottom (or a side) holding the
launchers as icons", so every launcher a Mac-shaped desktop put in its own dock
was dead: `mousedown` returned before the speculative generation and `click`
returned before `openApp`. No window, no connection, no generation, no
exception, no log line anywhere.

That is HANDOFF-5's verification boot A exactly: `archetype: "dock"`, 4 of 4 app
opens lost, and — the reading three passes of diagnosis missed —
**`windowId: null`, `nodes: 0`, `tasks: 0` on all four**. There was never a
blank window. There was never a window.

---

## 1. The proof

The repro is a fixture, not an argument: `dockLaunchersDesktop`
(`dock-launchers`) in `e2e/fakes.ts` writes boot A's shape — `dock` archetype,
half the manifest in a `<nav data-os-dock>` along the bottom, half in a grid on
the wallpaper — and `e2e/trace.spec.ts` presses and clicks both halves.

With the v0.3 guard restored verbatim (temporarily, to falsify it), against the
real mock `/api/gen`:

| test | v0.3 guard | after the fix |
|---|---|---|
| a dock launcher opens a window | **0 windows** after 20 s | 1 window, document painted |
| one dock + one wallpaper launcher | **1 of 2** (the wallpaper one) | 2 of 2 |
| the trace reaches `gen.fetch` | no steps at all | full chain |
| the kernel's own HUD dock is not a launcher | passes | passes |

`1 of 2` is the signature: the launchers boot A had on the wallpaper would have
worked, and only the ones in the dock were dead. Nobody clicked those in that
run, because the harness opens `browser`, `photos`, `store`, `calculator` — and
a dock is exactly where a model puts those four.

Why every other instrument saw nothing:

- **no connection-ledger entry** — `netOpen` is called inside `genStream`, and
  `genStream` was never called. HANDOFF-5 read that absence correctly ("the
  kernel never got as far as `genStream`") and then looked one step too far
  downstream, between `wm.create` and `genStream`. The break is one step
  *upstream* of `wm.create`.
- **no JS error** — nothing threw. The handler returned normally.
- **`net.peak 4`, 0 gen sockets at the end** — correct and irrelevant. The
  socket hypothesis, HANDOFF-4's image lane and BAKEOFF-4's generation lane were
  all aimed at a mechanism that was never running.
- **e2e green, mock green** — no fixture in the suite had a `[data-os-dock]`,
  and `helpers.openApp` dispatches `click` on `[data-os-app]` without ever
  asking whether the kernel would have honoured it. A `taskbar` desktop (boot B,
  4 of 4 painted) cannot reproduce this at all.

**Not truncation.** The concurrent session's `reviews/BUDGET-2.md` found
`kind=app` on `photos` hitting `finish_reason=length` at 2,500 tokens and
leaving an unclosed document, and raised the cap. That is a real and separate
fault: it produces a document that *arrives* and is malformed. Boot A's windows
had 0 characters, 0 nodes and no window element — no generation was ever asked
for, so no budget could have bound.

## 2. The fix

`kernel/index.ts` — the delegation's two skip tests are now **identity**, not
selectors:

- `isKernelChrome(el)` (`kernel/hud.ts`) — is this inside the one dock element
  the kernel created (`#os-bakeoff-dock`)? Nothing a model writes can be it.
- `wm.owns(el)` (`kernel/windows.ts`) — is this inside one of the window
  manager's own window roots? Same reason; `[data-os-window-id]` was the other
  model-collidable attribute in the pair.

**The class, not the instance.** The bug is not "dock": it is *the kernel
identifying its own objects by an attribute inside a document the model
authors*. Every `data-os-*` attribute is in the model's namespace by design
(§3.2 asks for most of them), so any kernel behaviour keyed off one is a
collision waiting for the right archetype. The two in the delegation were the
only load-bearing ones — the rest of the kernel's `data-os-*` reads are either
*asking* the model for its hooks (that is the contract) or writing markers
outward (`data-os-focused`, `data-os-img-filled`). Anything the kernel keys its
own control flow off must be identity from here on.

## 3. The instrument (the trace format)

`kernel/trace.ts`, new. A 400-entry ring buffer, one bounded array, never
throws, paints nothing.

- **`window.__osTrace()`** → `string[]`, oldest first, one line per step:
  `+<ms since kernel load> <step> <detail>`, with a caught exception's stack
  indented under its line. Steps recorded on the open path, in order:
  `launcher.press` · `launcher.click` · `openApp.enter` · `openApp.claim`
  (`hit <id>` / `miss`) · `openApp.created` · `openApp.focused` ·
  `openApp.stream` · `openApp.exit` · `streamApp.enter` · `streamDoc.enter` ·
  `streamDoc.take` or `streamDoc.gen` · `gen.fetch` · `gen.headers` ·
  `gen.closed` · `streamApp.exit`. Failure steps: `click.kernelChrome`,
  `openApp.noWm`, `openApp.createFailed`, `threw <label>`, `watchdog.waiting`,
  `watchdog.fired`.
- **the HUD telemetry stream** gets only the LOUD entries (`traceLoud`): a
  caught exception, the watchdog. The HUD is four lines of a real screenshot and
  a flood of `openApp.enter` would be a pixel of ours in every shot. On `/`
  there is no HUD at all, which is why the ring exists.
- **`guard(label, fn)` / `guarded(label, fn)`** — every callback that runs
  inside a delegated handler is wrapped: `pushState` and `fitBarContents` in
  `onFocus`, `pushState` in `onClose`, `wm.create`, `wm.focus`, and both
  delegation handlers themselves. An exception is caught, recorded with its
  stack, echoed to `console.warn`, and **cannot abandon `openApp`** — the
  document still gets asked for. That was HANDOFF-5's suspect 2 and it is now
  structurally impossible rather than unobserved.

`e2e/trace.spec.ts` proves the format and the guard: the bar's own
`getBoundingClientRect` is made to throw (which is what `fitBarContents`
measures, on a bar the model wrote), the window still fills, and the trace
carries `threw onFocus fitBarContents`.

## 4. The watchdog (last line of defence)

`armWatchdog` in `kernel/index.ts`: **8 s** after a window is created, if its
frame has painted nothing, nothing is in flight for that window
(`genLive`, a per-window count because a browser window streams its chrome and
then its home page), and it has not fired before, one fresh generation is
started. It is not §12.2's forbidden replacement: it only ever runs where
nothing has been painted and nothing is coming.

Exercised end to end in `e2e/trace.spec.ts`: the first two app requests are
refused (the first is the ask, the second is I1's single regeneration), the
third — the watchdog's — is let through and the window fills.

Also hardened on the way past: `gen.claim` now marks its handle `taken`. `take`
is reached through microtasks only, so the TTL timer cannot currently interleave
— but a claimed, not-yet-mounted handle was one `!h.taken` check away from being
aborted out from under its own window, which is this exact bug class.

**Suspects from the brief, checked and cleared:** a claim awaiting a settled or
aborted prefetch (handled — `streamDocInner` regenerates on anything but a
user-superseded abort); a mousedown prefetch followed by a click on a different
launcher (`gen.start` drops the previous handle of the same kind, `claim` on the
new key returns null and the normal path runs); the 60 s TTL (10 s since
KERNEL-5, and `claim` rejects an expired handle); image-lane or `mark` calls
awaited on the open path (none are — `handleImg` is fire-and-forget, `mark` is
fire-and-forget, `netNote` is synchronous).

## 5. Icons — the ICON RULING, kernel half

`kernel/img.ts`. The two lines that made the model's own glyph invisible the
moment the sheet landed —

```
own.style.color = 'transparent';
own.style.textShadow = 'none';
```

— are **gone, and nothing replaces them**. The sliced cell is applied as a
`background-image` *behind* the glyph, which stays in the model's own colour,
with the legibility shadow the wallpaper injection already insures.

Centring, which the ruling asks for and §2.2 makes the kernel's: `text-align:
center` always (it changes no metric), plus a `line-height` equal to the slot's
measured height — **applied, re-measured, and reverted if the box moved by as
much as a pixel.** INTEGRATE-1's rule outranks the centring: a picture arriving
on a desktop someone is already looking at must not move anything. The one slot
the kernel does resize is the one with no box at all (nothing can show a picture
in nothing); that one now centres with `inline-flex` since the kernel is giving
it its box anyway.

`e2e/images.spec.ts` gained "the plate goes BEHIND the glyph and the glyph is
never hidden": every `[data-os-icon]` keeps its text, its computed colour is not
transparent, visibility is `visible`, opacity > 0, **its box is byte-identical
before and after the sheet lands**, and the plated ones are centred.

The prompt half of the ruling (sixteen matching blank plates, no symbols, no
text; a desktop glyph sized to read on a plate) belongs to `prompts/**` and was
not touched here.

## 6. Windows — never see-through while streaming, and the focused one is on top

`kernel/windows.ts` + `kernel/frames.ts`. The bootstrap document is transparent
on purpose (an app that sets no background should show the machine's desktop,
not a kernel-coloured pane), and the price is the first second of every window:
a hole with the wallpaper and any window underneath showing through something
that is supposed to be loading.

`templateBackdrop(root, content)` takes the **first opaque `background-color`
the model's own template already declares**, read from `[data-os-content]` and
then up its ancestors to the window root, and puts it on the frame container
until the first ink. A template that is transparent all the way up is left
exactly as it is — no pixel of ours, and inventing a colour there would be a
design decision. Recorded as `data-os-backdrop="<colour>"` on the window root,
then `"inked"`.

`Frame.addInkHook` exists because `onInk` is one slot and `streamApp` owns it
(that slot is where §12.1's app ink number is taken); the kernel's own
listeners queue separately.

Focus after open is asserted rather than assumed: `e2e/backdrop.spec.ts` opens
two windows and checks the newest has the unique maximum computed `z-index`,
carries `data-os-focused="true"` while the other carries `"false"`, and **wins
`elementFromPoint` at a point inside both**. `WindowManager.topOfStack(w)` is
there for the harness to ask the same question.

## 7. Tree state

| check | before | after |
|---|---|---|
| `npm test` | 291 (HANDOFF-5) | **305** — 8 new here (`test/trace.test.ts`), the rest from the concurrent session |
| `npm run test:e2e` | 92 | **102** — 6 in `e2e/trace.spec.ts`, 3 in `e2e/backdrop.spec.ts`, 1 in `e2e/images.spec.ts` |
| `npx tsc --noEmit` | clean | clean |
| `npm run build` | clean | clean |

**Spend: $0.** Everything here was proved on the mock server; no provider key
was used, no image was bought.

`dist/play.js` untouched, port 8799 never used, nothing with `play.js` in its
command line signalled. Nothing committed.

### Files changed

| file | change |
|---|---|
| `kernel/trace.ts` | **new** — the ring buffer, `window.__osTrace()`, `guard`/`guarded`, the loud sink |
| `kernel/index.ts` | `notOurs` (the fix), every delegated callback guarded, the open-path trace, the watchdog, `window.__osTrace` |
| `kernel/hud.ts` | `isKernelChrome` — the kernel's dock by identity |
| `kernel/windows.ts` | `owns`, `topOfStack`, `templateBackdrop` + the streaming backdrop |
| `kernel/frames.ts` | `addInkHook` / `fireInkHooks` |
| `kernel/img.ts` | the ICON RULING: the glyph is never hidden; `centreGlyph` reverts itself if it moves anything |
| `kernel/gen.ts` | `claim` marks its handle taken; `gen.fetch`/`gen.headers`/`gen.closed` trace |
| `e2e/fakes.ts` | **new fixture** `dockLaunchersDesktop` (`dock-launchers`) — boot A's shape |
| `e2e/trace.spec.ts` | **new** — 6 tests: the repro, the fix, the format, the guard, the watchdog, the HUD dock |
| `e2e/backdrop.spec.ts` | **new** — 3 tests: the streaming backdrop, the transparent template, the focused stack |
| `e2e/images.spec.ts` | +1 test: the plate behind the glyph |
| `test/trace.test.ts` | **new** — 8 unit tests: the ring, the bound, the loud split, `guard` |

### Tree note

Another session was writing `server/**`, `prompts/**`, `engines.json`,
`test/{engines,img,imgprompt}.test.ts`, `scripts/{kind-budget,img-latency2}.mjs`
and `reviews/{BUDGET-2,IMG-LATENCY-2}.md` in this same working tree during this
pass. None of those are mine and none were edited here; the 305/102 counts above
therefore include their tests as well as mine. (One `git stash -u`/`pop` was
used to read the pre-pass unit-test baseline — 291 — and everything came back
intact; it should not be repeated while two sessions share a tree.)

---

## What remains

1. **This has only been proved on mock.** The next real boot should be a `dock`
   archetype on purpose, with `window.__osTrace()` read at the end and dropped
   into the boot record by `scripts/run.mjs` beside `net`. The harness does not
   collect the trace yet — that is `scripts/**`, one line, and it is what turns
   the next occurrence of anything like this into a five-minute diagnosis.
2. **`helpers.openApp` dispatches a click the kernel might refuse and the suite
   never noticed.** Every app-opening test in the suite is one delegation bug
   away from being a test of nothing. Worth one test that asserts a *real*
   hit-tested click on every launcher of both archetypes opens a window.
3. **`GEN_CONCURRENCY` and `setGenWaitReporter` are now provably dead**
   (HANDOFF-5 #9): the lane was built for a mechanism that was never running.
   Delete them rather than leave a switch nobody may touch.
4. **The archetype the harness never plays.** Boot A was the first `dock` the
   harness had opened apps on since the archetypes shipped. `scripts/run.mjs`
   should fail loudly, not quietly, when a whole archetype's launchers produce
   no window — `apps: [{blank: true, windowId: null}]` was in the JSON all
   along.
5. **The watchdog has never fired on a real boot** and, if the diagnosis above
   is right, never should. If it starts firing in production, something else is
   swallowing the open path and its trace line will say where.
