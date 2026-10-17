/**
 * Images (SPEC §12.5, INTERFACE I3, SEAMS S1/S3).
 *
 * The kernel asks the server for pictures; the server owns fal, the money cap,
 * the moderation — and, since S3, the WORDING. The two boot images are
 * requested as `{kind, session, seed}` and nothing else: a wallpaper prompt written
 * here would be a design instruction from the kernel, and BAKEOFF-2's verdict
 * ("the wallpapers are beautiful and mostly wrong") was a prompt problem, which
 * belongs in `prompts/images/*.md` where it can be tuned without a rebuild.
 *
 * Everything here is best-effort: without `FAL_KEY` the route answers 404 and
 * the SVG the model drew stays exactly where it is.
 *
 * Two calls per boot, both started the instant the identity comment is parsed —
 * before the desktop document exists, let alone mounted — and applied whenever
 * they land, which is usually after the desktop is already on screen. Nothing
 * waits for an image, ever.
 */
import { ensurePositioned, cssEscape } from './inject.js';
import { netOpen } from './net.js';
import { sheetSlice } from './sheet.js';
import { fadeIn } from './fade.js';
import { rectOf, textArea, type Rect } from './visible.js';
import type { DocImgKind } from './protocol.js';

export type BootImgKind = 'wallpaper' | 'icons';
export type ImgKind = BootImgKind | DocImgKind;

/**
 * The boot's two pictures. The server builds the prompt (S3) from the identity
 * and the dice it rolled for this session, which it finds by `seed`.
 */
export interface BootImgRequest {
  kind: BootImgKind;
  session: string;
  seed: string;
}

/**
 * A picture a generated document asked for (S1). The prompt is the document's
 * own `data-os-prompt`; `scope` is the window id for an app and the navigation
 * id for a page, which is the bucket the server charges 4-per-app-open and
 * 2-per-page against.
 */
export interface DocImgRequest {
  kind: DocImgKind;
  prompt: string;
  session: string;
  seed: string;
  scope: string;
  scopeKind: 'app' | 'page';
  /**
   * T2 — which set of sixteen a `tiles` sheet is. Absent for every other kind;
   * absent on a `tiles` request means the server's default (`faces`), which is
   * what the kind used to be called.
   */
  theme?: string;
}

/**
 * ONE lane for every picture in the process, two at a time, boot pictures
 * first. Two separate findings meet here.
 *
 * BAKEOFF-3: of sixteen `photo` slots asked for by app documents, ONE arrived.
 * A document is allowed four pictures and the runtime asked for all four at
 * once, so all four queued at fal and all four aged past the server's ceiling
 * together. Two at a time is the fix that costs nothing: the same four
 * pictures, in two waves, each wave inside the timeout.
 *
 * HANDOFF-4: the doc lane was two, the boot's wallpaper and icon sheet bypassed
 * it entirely, and a picture holds its POST open for 3-14 s. Four image
 * connections plus the boot and desktop streams is SIX, which is exactly a
 * browser's per-origin HTTP/1.1 connection limit — so the next `POST /api/gen`
 * never left the browser. That is the blank app window of BAKEOFF-3's open
 * issue 1: no server telemetry line, because the server never received the
 * request. Images now share one lane of two and generations are never starved
 * of a connection (2 images + at most 3 live generations = 5 of 6).
 *
 * The boot's pictures keep their priority — a desktop must never wait behind a
 * store's product shots — but they now wait for a slot instead of taking a
 * seventh connection.
 */
const IMG_CONCURRENCY = 2;
let imgActive = 0;
/** two queues, boot drained first; a waiter is a resolve fn */
const waitingBoot: (() => void)[] = [];
const waitingDoc: (() => void)[] = [];

function releaseSlot(): void {
  imgActive--;
  const next = waitingBoot.shift() || waitingDoc.shift();
  next?.();
}

async function imgSlot<T>(priority: 'boot' | 'doc', run: () => Promise<T>): Promise<T> {
  if (imgActive >= IMG_CONCURRENCY) {
    await new Promise<void>((res) => (priority === 'boot' ? waitingBoot : waitingDoc).push(res));
  }
  imgActive++;
  try {
    return await run();
  } finally {
    releaseSlot();
  }
}

/** in-flight + queued, for the tests and the HUD */
export function imgLaneState(): { active: number; waiting: number } {
  return { active: imgActive, waiting: waitingBoot.length + waitingDoc.length };
}

/** The doc-image lane (S1). Shares the lane with the boot's two, behind them. */
export function requestDocImage(req: DocImgRequest, signal?: AbortSignal): Promise<string | null> {
  return imgSlot('doc', () => requestImage(req, signal));
}

/** The boot's two pictures (S3): the same lane, at the front of the queue. */
export function requestBootImage(req: BootImgRequest, signal?: AbortSignal): Promise<string | null> {
  return imgSlot('boot', () => requestImage(req, signal));
}

/** POST /api/img. Returns a data: URI, or null when the route is absent or the call failed. */
export async function requestImage(req: BootImgRequest | DocImgRequest, signal?: AbortSignal): Promise<string | null> {
  const closeNet = netOpen('img', String((req as { kind?: string }).kind || 'img'));
  try {
    const res = await fetch('/api/img', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      cache: 'no-store',
      signal,
    });
    if (!res.ok) return null; // 404 = no FAL_KEY: the SVG fallback stands (SPEC §12.5)
    const j = (await res.json()) as { dataUri?: string };
    const uri = typeof j?.dataUri === 'string' ? j.dataUri : '';
    return /^data:image\//i.test(uri) ? uri : null;
  } catch {
    return null;
  } finally {
    closeNet();
  }
}

/* ------------------------------------------------------------- wallpaper */

const LAYER_ATTR = 'data-os-img-layer';

/**
 * Fill `[data-os-img="wallpaper"]` (SPEC §12.5). If the model never declared
 * the slot the picture is paid for either way, so it goes on the desktop layer
 * behind the icons rather than being thrown away.
 *
 * The picture goes on a kernel-owned layer rather than straight onto the host's
 * `background-image`, for one reason: it has to fade in, and there is no way to
 * transition a background image. The layer is `position:absolute;inset:0`, so
 * it is out of flow and CANNOT reflow a launcher (an absolutely positioned
 * child is not a grid or flex item), `pointer-events:none`, and `z-index:-1`
 * inside a host made a stacking context with `isolation:isolate` — which paints
 * it above the host's own background and below everything the model put in it.
 */
export function applyWallpaper(dataUri: string): boolean {
  const host =
    (document.querySelector('[data-os-img="wallpaper"]') as HTMLElement | null) ||
    (document.querySelector('[data-os-desktop]') as HTMLElement | null) ||
    document.body;
  if (!host) return false;
  ensurePositioned(host);
  host.style.isolation = 'isolate';
  host.setAttribute('data-os-img-host', 'wallpaper');
  passThrough(host);

  let layer = (Array.from(host.children).find((c) => c.getAttribute(LAYER_ATTR) === 'wallpaper') as HTMLElement | undefined) || null;
  const fresh = !layer;
  if (!layer) {
    layer = document.createElement('div');
    layer.setAttribute(LAYER_ATTR, 'wallpaper');
    layer.setAttribute('data-os-generated', '');
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;z-index:-1;pointer-events:none';
    host.insertBefore(layer, host.firstChild);
  }
  layer.style.backgroundImage = `url("${dataUri}")`;
  layer.style.backgroundSize = 'cover';
  layer.style.backgroundPosition = 'center';
  layer.style.backgroundRepeat = 'no-repeat';
  layer.setAttribute('data-os-img-filled', 'wallpaper');
  if (fresh) fadeIn(layer);
  legibleOverWallpaper();
  return true;
}

/**
 * HANDOFF-8 — a wallpaper that ate the whole launcher grid.
 *
 * Boot 2 of the v0.6 desktop run declared its wallpaper slot as a
 * `position:fixed` full-screen `<div data-os-img="wallpaper">`, painted after
 * the icons in document order. Every pixel of the desktop's 15 launchers was
 * then covered by it: `elementFromPoint` on an icon returned the wallpaper div,
 * the runner's first open — before a single window existed — had to fall back
 * to a dispatched click, and a visitor's mouse would have found 15 dead icons
 * on a machine that looked perfectly finished. 1 of 4 real boots.
 *
 * A wallpaper is decoration by definition, so if the element the model
 * dedicated to it holds nothing a pointer could ever want, it must not be what
 * a pointer hits. This is hit testing, not style: no colour, size, position or
 * layer of the model's is changed, exactly as `#os-root` and the empty windows
 * layer are already made transparent to pointers (`kernel/index.ts`:77,
 * `kernel/windows.ts`:116). A host that DOES hold something interactive — and
 * the `[data-os-desktop]`/`<body>` fallbacks, which hold everything — is left
 * alone.
 */
const INTERACTIVE =
  '[data-os-app],[data-os-taskbar],[data-os-dock],[data-os-menu],[data-os-clock],a,button,input,select,textarea,[onclick],[tabindex]';

function passThrough(host: HTMLElement): void {
  if (!host.matches('[data-os-img]')) return; // the desktop/body fallback holds the machine
  if (host.querySelector(INTERACTIVE)) return; // the model put something usable in it
  if (host.style.pointerEvents === 'none') return;
  host.style.pointerEvents = 'none';
  host.setAttribute('data-os-img-passthrough', '');
}

const IMG_STYLE_ID = 'os-img-legibility';

/**
 * Remove what this module put into the document. Called from the kernel's
 * teardown: a reboot that leaves it behind is a rule from the dead machine
 * styling the new one's launchers, and a wallpaper layer parented to
 * `document.body` (the case where the model declared no slot at all) is not
 * part of the mounted tree `unmount()` takes away.
 */
export function resetImgStyles(): void {
  document.getElementById(IMG_STYLE_ID)?.remove();
  document.querySelectorAll(`[${LAYER_ATTR}]`).forEach((el) => el.remove());
  document.querySelectorAll('[data-os-img-host]').forEach((el) => {
    (el as HTMLElement).style.isolation = '';
    if (el.hasAttribute('data-os-img-passthrough')) {
      (el as HTMLElement).style.pointerEvents = '';
      el.removeAttribute('data-os-img-passthrough');
    }
    el.removeAttribute('data-os-img-host');
  });
}

/**
 * The model styled its launcher labels for a background it never saw — on
 * cerebras-oss120 they came out dark-on-dark the moment a photographic
 * wallpaper landed under them (reviews/INTEGRATE-1.md). The wallpaper is the
 * kernel's own injection, so the legibility of what sits on top of it is the
 * kernel's to insure: one shadow rule, no colours, no layout, nothing the model
 * chose is overridden.
 */
function legibleOverWallpaper(): void {
  if (document.getElementById(IMG_STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = IMG_STYLE_ID;
  st.setAttribute('data-os-generated', '');
  /**
   * KERNEL-7 / D3 — every launcher, not only the ones inside `[data-os-desktop]`.
   *
   * In SPEC §12.3's `dock` archetype the launchers a visitor uses most are in
   * the dock, which is a SIBLING of `[data-os-desktop]`, so the one piece of
   * insurance the kernel carries for the picture it injected reached exactly
   * the launchers the architect could not read. `[data-os-app]` is the launcher
   * in both archetypes and in a menu, and a shadow is not a colour, a size or a
   * position: it is the minimum that keeps the model's own words on top of a
   * photograph nobody chose.
   */
  st.textContent = '[data-os-app],[data-os-app] *{text-shadow:0 1px 2px rgba(0,0,0,.85),0 0 1px rgba(0,0,0,.6)}';
  document.head.appendChild(st);
}

/* ------------------------------------------------------------- icon sheet */

/**
 * Slice the 4x4 sheet into `[data-os-icon="<appId>"]`, cell index = manifest
 * order (the arithmetic lives in kernel/sheet.ts, shared with the runtime's
 * `faces` slicing). A launcher that carries a bare `[data-os-icon]` instead of
 * the per-app one still gets its cell: the sheet was bought for these sixteen
 * apps and a slot is a slot.
 */
/**
 * KERNEL-7 / D3 — the label a visitor reads, and whether the kernel just hid it.
 *
 * The architect's live dock had launcher labels before the plate sheet landed
 * and none after it. The cause was one line below (`centreGlyph`) and the shape
 * of the guard around it: a `line-height` written onto the element carrying
 * `[data-os-icon]` is harmless when that element holds one glyph and nothing
 * else — which is what `prompts/system/desktop.md` asks for — and moves the
 * LABEL when the model put the attribute on the launcher itself, because the
 * glyph's line box grows inside it and everything after the glyph is pushed
 * down. The old guard measured the target's OWN box and reverted if it moved,
 * which is exactly the measurement that cannot see this: a launcher whose
 * height the model's CSS pins (a dock icon, `height:68px`) does not move at
 * all, and its label leaves through the nearest `overflow:hidden` — the dock's
 * rounded clip, or the launcher's own.
 *
 * So the question the kernel asks after it applies a picture is the visitor's
 * question: **is the label still on screen?** `textArea` (kernel/visible.ts) answers it in pixels
 * — the label's box intersected with every clipping ancestor and with the
 * viewport — and the sheet's layout styles are undone on any launcher whose
 * answer got worse. Nothing is ever *added* to make a label appear: a label the
 * MODEL hid (a dock that shows its names on hover is a real design) reads the
 * same before and after, so there is nothing to undo and the kernel leaves it
 * alone. Only the kernel's own styles are ever taken back.
 */
interface Undo {
  el: HTMLElement;
  prop: string;
  prev: string;
}

function setStyleU(el: HTMLElement, prop: string, value: string, undo: Undo[]): void {
  undo.push({ el, prop, prev: el.style.getPropertyValue(prop) });
  el.style.setProperty(prop, value);
}

function undoAll(undo: Undo[]): void {
  for (const u of undo.splice(0).reverse()) {
    if (u.prev) u.el.style.setProperty(u.prop, u.prev);
    else u.el.style.removeProperty(u.prop);
  }
}

/**
 * Put the model's glyph in the middle of its plate, and NEVER move anything.
 *
 * Horizontal centring is free (`text-align` changes no metric). Vertical
 * centring needs a line height, which can change a box — so it is applied,
 * measured and reverted if the element's own box moved, and it is only ever
 * attempted on a slot that holds **one glyph and nothing else** (the shape
 * §12.3's prompt asks for). An icon slot that also contains the launcher's
 * label is not a glyph in a box, it is the whole launcher, and a line height
 * there is a layout instruction to somebody else's text.
 */
function glyphOnly(el: HTMLElement): boolean {
  if (el.children.length > 0) return false;
  const text = (el.textContent || '').trim();
  // one glyph, and an emoji is up to a handful of code units
  return text.length > 0 && text.length <= 6;
}

function centreGlyph(el: HTMLElement, had: Rect, undo: Undo[]): void {
  setStyleU(el, 'text-align', 'center', undo);
  if (!glyphOnly(el)) return;
  if (el.style.lineHeight) return;
  setStyleU(el, 'line-height', Math.round(had.height) + 'px', undo);
  const now = rectOf(el);
  if (Math.abs(now.width - had.width) > 1 || Math.abs(now.height - had.height) > 1) el.style.lineHeight = '';
}

export function applyIconSheet(dataUri: string, appIds: string[]): number {
  let filled = 0;
  /** one record per launcher the sheet touched, so a label can take its styles back */
  const touched: { el: HTMLElement; launcher: HTMLElement | null; own: HTMLElement | null; before: number; undo: Undo[] }[] = [];

  appIds.slice(0, 16).forEach((id, i) => {
    const sel = cssEscape(id);
    const own = document.querySelector(`[data-os-icon="${sel}"]`) as HTMLElement | null;
    const el = own || (document.querySelector(`[data-os-app="${sel}"] [data-os-icon]`) as HTMLElement | null);
    if (!el) return;
    const launcher = (el.closest('[data-os-app]') as HTMLElement | null) || null;
    const undo: Undo[] = [];
    // D3: what a visitor can read of this launcher's label BEFORE the picture.
    // Measured per launcher and not once for the desktop, because the answer has
    // to name the launcher whose styles get taken back.
    const before = launcher ? textArea(launcher, el) : 0;
    // getBoundingClientRect, never clientWidth: an inline <span> — which is what
    // most engines write an icon slot as — reports clientWidth 0 whatever it
    // renders, so the "no box" test below fired on every launcher and the 44 px
    // fallback grew the whole grid the moment the sheet arrived.
    const had = rectOf(el);
    const slice = sheetSlice(i);
    // the picture itself: a background paints BEHIND text and cannot move
    // anything, so it is never part of the undo below
    el.style.backgroundImage = `url("${dataUri}")`;
    el.style.backgroundSize = slice.size;
    el.style.backgroundPosition = slice.position;
    el.style.backgroundRepeat = 'no-repeat';
    /**
     * ICON RULING (architect, 2026-09-17, verified live). The slicing is
     * correct — cell index is manifest order — but FLUX schnell does not put
     * sixteen *specific* icons in the requested order: weather got a music
     * note, news got the cloud. What WAS semantically perfect on every launcher
     * was the model's own emoji or glyph, and the kernel was painting over it.
     *
     * So the sheet is now sixteen matching BLANK PLATES (same shape, material,
     * era, palette, no symbols — the prompt side of the ruling), the plate is a
     * background BEHIND the glyph, and the kernel no longer hides the glyph in
     * any way. The two lines that used to set `color: transparent` and kill the
     * text shadow are gone; nothing replaces them.
     *
     * Centring is the one thing left, and it is geometry (SPEC §2.2): a glyph
     * sitting top-left of its plate reads as a mistake. It is attempted only on
     * a slot that holds one glyph and nothing else (`glyphOnly`) — KERNEL-7/D3:
     * on a launcher that carries `data-os-icon` itself, a line height is a
     * layout instruction to the label underneath it.
     */
    if (own && had.width >= 8 && had.height >= 8) centreGlyph(own, had, undo);
    // the exception, and the only reflow left: a slot with no box at all. There
    // is no way to show a picture in nothing, and nothing is what it occupied.
    if (had.width < 8 || had.height < 8) {
      // inline-flex, not inline-block: this is the one case the kernel gives the
      // slot its box, so it is also the one case it owes the glyph a centre
      setStyleU(el, 'display', 'inline-flex', undo);
      setStyleU(el, 'align-items', 'center', undo);
      setStyleU(el, 'justify-content', 'center', undo);
      /**
       * KERNEL-7 — `el.style.width || '44px'` read the INLINE style, so a model
       * that wrote `width:auto` inline on its icon slot kept its zero box and
       * got a plate 0 px wide: paid for, applied, invisible. The box is what was
       * measured (`had`), not what the style string says.
       */
      setStyleU(el, 'width', '44px', undo);
      setStyleU(el, 'height', '44px', undo);
      // the one reflow the kernel performs on a desktop someone is looking at,
      // marked so an instrument can count it instead of inferring it
      el.setAttribute('data-os-img-boxed', '44');
    }
    const already = el.getAttribute('data-os-img-filled') === 'icon';
    el.setAttribute('data-os-img-filled', 'icon');
    // opacity only, and only on the element the kernel just painted: it never
    // moves anything, so a launcher grid cannot reflow around it
    if (!already) fadeIn(el);
    touched.push({ el, launcher, own, before, undo });
    filled += 1;
  });

  keepLabels(touched);
  return filled;
}

/**
 * D3 / SEAM T4 — the launcher-label check.
 *
 * After the plates are on, every launcher whose label a visitor could read
 * before is asked the same question again. A label that has lost its pixels —
 * pushed out of a dock, clipped by its own launcher, moved off the screen — gets
 * the kernel's own styles taken back off that launcher's icon slot, and the
 * slot keeps its picture without them.
 *
 * Two things this deliberately does NOT do: it does not style a label the model
 * itself hid (that reads the same before and after, so there is nothing to
 * undo — a dock that shows its names on hover is a real design and not ours to
 * override), and it does not move anything to make room. `data-os-label-kept`
 * on the launcher is the reading a harness takes.
 */
function keepLabels(
  touched: { el: HTMLElement; launcher: HTMLElement | null; own: HTMLElement | null; before: number; undo: Undo[] }[]
): number {
  let kept = 0;
  for (const t of touched) {
    if (!t.launcher || t.before <= 0 || !t.undo.length) continue;
    const after = textArea(t.launcher, t.el);
    // half the label is a judgement call; zero is not. The threshold is there
    // for the dock that clips the bottom line of a two-line label and leaves a
    // sliver, which reads as broken exactly like nothing does.
    if (after >= t.before * 0.5) continue;
    undoAll(t.undo);
    const now = textArea(t.launcher, t.el);
    t.launcher.setAttribute('data-os-label-kept', String(Math.round(t.before)) + '>' + Math.round(after) + '>' + Math.round(now));
    kept += 1;
  }
  return kept;
}
