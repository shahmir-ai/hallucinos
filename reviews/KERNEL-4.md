# KERNEL-4 — the v0.2 kernel pass (2026-09-17)

Closing the kernel half of HANDOFF-3 §6 and BAKEOFF-2's "Findings and fixes,
ranked", plus my side of the three-builder seams S1 and S3.

Owned this session: `kernel/**`, `e2e/**`, the `public/` build output, and the
two unit files that test kernel modules (`test/geometry.test.ts`,
`test/sheet.test.ts`). `server/**` and `prompts/**` untouched.

**Result:** `npm test` **244 passed** (24 files), `npm run test:e2e` **65 passed**
(3.7 min) — 51 before this session, +14 new. `npm run build` clean.

---

## 1. S1 — `os.img`: images inside sandboxed documents

The seam, implemented exactly as specified.

**The contract a generated document uses** (nothing new for the model to learn
beyond two attributes):

```html
<div data-os-img="photo" data-os-prompt="a harbour that does not exist"></div>
<img data-os-img="photo" data-os-prompt="a kettle on a windowsill" alt="a kettle">
<div data-os-img="map"   data-os-prompt="a city that does not exist, top down"></div>

<div  data-os-img="faces" data-os-prompt="sixteen portraits of people who do not exist"></div>
<span data-os-face="0"></span> <span data-os-face="1"></span> …
```

**Flow.** The injected runtime collects slots in `endDoc()` — *after*
`document.close()`, deliberately: a slot in a still-streaming document may not
have its `data-os-prompt` yet (an attribute is only complete when its tag is),
and half a prompt is money spent on nothing. First **4** in document order for an
app document, **2** for a page, 0 for boot; each gets a `data-os-img-slot="sN"`
and one `postMessage({t:'img', kind, prompt, slot})` up. The kernel buys it and
posts `{t:'imgfill', slot, kind, dataUri}` back down; the runtime paints it —
`src` on an `<img>`, `background-image` otherwise. Page frames ride the existing
relay, so the fake internet gets pictures without a second channel.

`faces` is one sheet for the whole document, sliced by CSS into every
`[data-os-face]`: sixteen invented people for one $0.003 call, which is what
makes a contact list or a comment thread affordable.

**Request body.** `{kind, prompt, session, seed, scope, scopeKind}` — `scope` is
the **window id** for an app document and the **navigation id** for a page (so a
session walking Reddit cannot spend one page's budget on the next), `scopeKind`
is `'app' | 'page'`, which is what `server/img.ts scopeForRequest` wants.

**Three places count the ceiling, on purpose.** The runtime, the kernel
(`imgSpend`, keyed by scope), and the server. The runtime lives in the same
document as the model's own script, which can post the identical message itself;
each image is $0.003 and a loop is the day's budget. `kernel/frames.ts askImg()`
also validates the kind — `wallpaper` and `icons` are rejected from a document,
because those two are the boot's and their prompts are the server's.

**One bug this found and fixed:** an `<img data-os-img="photo">` with no `src`
was being de-fanged into the alt-text placeholder box (`sweep()` in the runtime,
`hallucinateImages()` in `kernel/inject.ts`) — i.e. the slot was deleted before
the picture arrived. Both now skip an element that carries a declared image slot.

## 2. S3 — the kernel stopped writing image prompts

`wallpaperPrompt()` and `iconSheetPrompt()` are **gone** from `kernel/img.ts`. The
boot now asks for `{kind, session, seed}` and the server owns every word
(`server/imgprompt.ts` + `prompts/images/*.md`).

**This is a hard cross-builder dependency.** A server without S3 answers
`400 prompt required`, which the kernel reads as "no image engine" and leaves the
model's SVG in place — a silent, safe degrade, not a crash, but the wallpaper and
the icon sheet are then simply absent. The S3 server landed in this tree, so the
pair is consistent as committed.

## 3. Window-manager legibility

`kernel/geometry.ts` is now written against an **`Area`** — the visible part of
the model's `[data-os-windows]` layer in the coordinates the kernel writes into
`style.left/top` — rather than against the viewport. The layer is the model's: it
can start under a menu bar, stop above a dock, or run past the fold, and a window
cascaded against the viewport inside such a layer lands under the model's own
chrome or below the bottom edge.

| rule | before | now |
|---|---|---|
| cascade step | 28 px | **36 px** down and right |
| wrap | after 8 | after **6** |
| default size | 56% × 62% of the **viewport** | **62% × 68% of the layer** |
| maximize | viewport | the layer (`fullSize(area)`) |
| new window | clamped to the viewport | wholly inside the layer, **measured after mount** (`fitOnScreen`) |
| drag | 48 px strip on screen | the **whole title bar** stays inside the area |
| focus | raise only | raise + `ensureTitleVisible`, measured off the live DOM |
| resize | mobile only | every window re-clamped into the new area |
| maximize gesture | `[data-os-maximize]` click | that, **plus double-click on the title bar** |

Why 36 and not "one title bar": the mock's own title bar is 46 px tall, so no
fixed step clears every bar. 36 clears the *title text* — the mock's text ends
33 px down — which is the rule that matters and what the e2e asserts
(`cur.titleTop >= prev.textBottom`). `fitOnScreen` exists because the model's
chrome can render bigger than the box the kernel asked for (`content-box` sizing
plus a border, a `min-width`), and what has to be on screen is what is drawn.

## 4. Images fade in — and the launcher-grid reflow that was hiding behind it

The fade is an opacity transition (`kernel/fade.ts`, 420 ms, inline styles
removed when it ends) on the element carrying the kernel's own background, and
nothing else.

The wallpaper needed a kernel-owned layer, because no browser can transition a
`background-image`: `applyWallpaper` inserts
`div[data-os-img-layer="wallpaper"]` as the host's first child —
`position:absolute; inset:0; z-index:-1; pointer-events:none` — and makes the
host a stacking context with `isolation:isolate` so the layer paints above the
host's background and below everything the model put in it. Absolutely
positioned, so it is out of flow and cannot become a grid or flex item: it
**cannot** reflow a launcher. `resetImgStyles()` takes it away on reboot.

Writing the "never reflow launchers" test then caught a real v0.1 bug: **every
launcher in the grid grew by 29 px the moment the icon sheet landed.**
`applyIconSheet` cleared the model's placeholder glyph with `textContent = ''`,
which collapsed the inline `<span>` to zero, and then the "slot has no box"
fallback gave it 44 × 44. Two fixes:

- the glyph goes **transparent** (`color:transparent; text-shadow:none`), not
  deleted, so the model's own box is kept exactly as laid out;
- the box is measured with **`getBoundingClientRect`**, not `clientWidth` — an
  inline `<span>`, which is what most engines write an icon slot as, reports
  `clientWidth: 0` whatever it renders, so the 44 px fallback used to fire on
  *every* launcher. It now fires only on a slot that genuinely occupies nothing,
  where there is no way to show a picture without taking space.

Same `clientWidth` mistake fixed in the runtime's `faces` path before it shipped.

## 5. The `streamApp()` first-paint drop (BAKEOFF-2 §7, item 4)

Already fixed in the tree at `0bf51b3`+working copy: the gen id is minted before
the request and sent with it, so `frame.onPaint` marks a real id. **It had no
test**, which is how it survived a whole bake-off. `e2e/marks.spec.ts` now reads
`/api/mark` off the wire and asserts that an app opened with a plain click (no
`mousedown`, so not the speculative path — the one path the bug hid in) posts a
`first_paint_ms` against the same `gen_id` the request carried, and that boot,
desktop, app and page are all marked, with no mark ever posted without an id.

## 6. `/bakeoff/run` — one dock, bottom-right, one key

HANDOFF-3 issue 11: the picker sat at the top left, over the boot document's own
first line — it hid the machine's banner, which is exactly the line a judge wants
to read. The HUD and the picker now live in one
`div[data-os-dock]` fixed to the bottom-right corner, stacked upwards, with a
one-line hint. **`` ` ``** (or `h`, or clicking the hint) collapses the lot, for a
screenshot with no kernel pixels in it at all; the key is ignored while a field
or the picker itself has focus.

## 7. The kernel paints nothing of its own during boot — confirmed

Asserted, not asserted-in-prose (`e2e/boot.spec.ts`, "nothing of the kernel is on
screen while the OS boots"): on `/`, while the boot document is streaming,
`document.body` has exactly `#os-root` and `#os-boot`, the overlay's only child
is the iframe, the overlay carries no text of its own, `background-color` is
`rgb(0, 0, 0)` — SPEC §2.1's black, empty page — and there are zero
`[data-os-kernel-screen]` and zero dock elements. The kernel's own two screens
(queue, error) exist only when there is no OS to show; the dock exists only on
`/bakeoff/run`.

---

## Files

New: `kernel/sheet.ts` (the 4×4 slicing arithmetic, shared by the kernel's icon
sheet and the runtime's faces — one source of truth, unit-tested),
`kernel/fade.ts`, `e2e/osimg.spec.ts`, `e2e/windows.spec.ts`,
`e2e/marks.spec.ts`, `test/sheet.test.ts`.

Changed: `kernel/{geometry,windows,img,frames,protocol,inject,hud,index}.ts`,
`kernel/injected/runtime.ts`, `test/geometry.test.ts`, and three existing e2e
files (`boot`, `bakeoff`, `images`) with the new assertions.

## Deviations and things left

1. **`scope` for an app document is the window id**, per the seam text, so
   `os.reload()` inside the same window shares that window's four-image bucket
   instead of getting a fresh one. Every *open* creates a new window, so in
   practice scope == app open; a reload is the one case that differs.
2. **`isolation:isolate` is written onto the model's wallpaper host.** It changes
   no layout and no colour, but it is a property the kernel sets on a generated
   element, which is one more than zero. It is the only way to contain a
   `z-index:-1` layer, and `resetImgStyles()` removes it on reboot.
3. **An icon slot that occupies nothing still reflows** when its picture lands
   (44 × 44). Unavoidable: there is no way to show an image in a zero box.
4. **The fade is cleaned up on a timer, not `transitionend`** — a slot inside a
   hidden or collapsed subtree never fires the event and would stay invisible.
5. **S4 (`timeout_ms` per engine in `engines.json`) is not mine** and was not
   touched; the kernel has no timeout of its own.
6. **Not attempted:** `photo`/`map` prompts are whatever the model writes in
   `data-os-prompt`, so their quality is now a prompts-side question (S1 gives
   the mechanism; nothing in `prompts/apps/*.md` has to use it yet). Worth one
   line in `photos.md`, `maps.md`, `messages.md` and the contact/profile page
   shapes.
7. **One full-suite run failed 11 tests with `ERR_CONNECTION_REFUSED` on 8770**
   mid-session, while another builder was rewriting `dist/server.js` underneath
   the Playwright web servers. The same files passed alone and the next two full
   runs were clean (65/65). Environmental, not a product fault — but a re-run
   after a parallel build is worth doing before trusting a red suite.
