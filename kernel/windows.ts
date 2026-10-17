import { Frame } from './frames.js';
import { cascade, clampDrag, clampInside, fullSize, isMobile, stripsCollide, titleVisible, CASCADE_STEP, CASCADE_WRAP, TITLE_STRIP, type Area, type Box } from './geometry.js';
import { ensurePositioned } from './inject.js';
import { rectOf, seen, textArea } from './visible.js';
import type { WinState } from './session.js';

export interface OsWindow {
  state: WinState;
  root: HTMLElement;
  frame: Frame;
  task: HTMLElement | null;
  /** browser windows: the <title> of the page currently shown, for the next referer */
  pageTitle: string;
  /**
   * SEAM S1: the id of the navigation currently in the nested page frame. It is
   * the bucket the server charges "<= 2 images per page" against, so it has to
   * change on every navigation — a session scrolling a fake Reddit must not be
   * spending one page's image budget on the next.
   */
  pageScope: string;
  maximized: Box | null;
  /**
   * The generation currently streaming into this window. A second navigation
   * aborts it: without this, the chunks of the page you just left keep being
   * written into the document of the page you just asked for, and both end up
   * broken. Aborting the fetch also stops the server paying for the rest of it.
   */
  gen: AbortController | null;
  /**
   * The lifetime of the pictures THIS WINDOW'S app document asked for (S1), and
   * deliberately not `gen`.
   *
   * BAKEOFF-3 lost fifteen of sixteen app pictures to "img timeout", and the
   * server's own clock was not what ran out: the caller hung up, because an app
   * picture was riding the window's generation controller and every later
   * generation into the window (a browser navigating to its home page, a
   * document re-asked for) aborts that. The app document that asked is still on
   * screen, so its picture is still wanted. A picture is dead when the window
   * is closed — that is this controller — while a PAGE's picture is dead when
   * the page is navigated away from, which is what `gen` means.
   */
  imgs: AbortController | null;
}

export interface WindowHost {
  layer: HTMLElement;
  taskbar: HTMLElement | null;
  winTemplate: HTMLTemplateElement;
  taskTemplate: HTMLTemplateElement | null;
}

/** computed z-index as a number; `auto` is 0, which is what it paints like here */
function zOf(el: HTMLElement): number {
  const z = parseInt(getComputedStyle(el).zIndex, 10);
  return Number.isFinite(z) ? z : 0;
}

/**
 * Desktop icons below windows below the taskbar — what every real desktop does,
 * and what two of nine desktops in BAKEOFF-3 got wrong (windows painted BEHIND
 * the launcher grid, including on the best-looking machine in the run). The
 * archetype in SPEC §12.3 describes the parts, not their stacking, and stacking
 * is geometry, which is the kernel's (SPEC §2.2) — so it is repaired here
 * rather than asked for in a prompt.
 *
 * Nothing is touched that already wins: a z-index is only ever raised, never
 * lowered, and only on an element that is a separate subtree from the one it is
 * being ordered against.
 *
 * The one hazard this has to avoid is the reason it is more than one line: a
 * windows layer that covers the whole screen, raised above the icons, would
 * swallow every launcher click (the kernel's delegation reads `event.target`,
 * and the target would be the layer). So a layer the model left EMPTY — the
 * empty container §3.2 asks for — stops taking pointer events at all and the
 * kernel's own window roots take them back. A layer the model put its own
 * content into is left alone: that content is clickable and not ours to kill.
 */
function stackDesktopLayers(layer: HTMLElement): void {
  const apart = (a: HTMLElement | null, b: HTMLElement): a is HTMLElement =>
    !!a && a !== b && !a.contains(b) && !b.contains(a);

  /**
   * Does `over` already paint above `under`? Equal z-index is decided by tree
   * order, which is why a desktop that simply declares its windows layer last
   * — the common case, and the mock's — needs no repair at all and gets none.
   */
  const wins = (over: HTMLElement, under: HTMLElement): boolean => {
    const zo = zOf(over);
    const zu = zOf(under);
    if (zo !== zu) return zo > zu;
    return !!(under.compareDocumentPosition(over) & Node.DOCUMENT_POSITION_FOLLOWING);
  };

  const raise = (el: HTMLElement, above: HTMLElement, tag: string): void => {
    if (wins(el, above)) return;
    ensurePositioned(el);
    el.style.zIndex = String(zOf(above) + 1);
    el.setAttribute('data-os-stacked', tag);
  };

  const desktop = document.querySelector('[data-os-desktop]') as HTMLElement | null;
  if (apart(desktop, layer)) raise(layer, desktop, 'windows');

  const taskbar = document.querySelector('[data-os-taskbar]') as HTMLElement | null;
  if (apart(taskbar, layer)) raise(taskbar, layer, 'taskbar');

  /**
   * And the layer never eats a click. This one is unconditional, because it is
   * true of every desktop and not only a mis-stacked one: §3.2 defines
   * `[data-os-windows]` as the empty layer windows live in, the kernel's own
   * window roots set `pointer-events:auto` on themselves, and a full-screen
   * empty layer with pointer events is a dead launcher grid whether or not
   * anything was raised. A layer the model put its own content into is left
   * alone — that content is clickable and not ours to kill.
   */
  if (!layer.firstElementChild) layer.style.pointerEvents = 'none';
}

export function readHost(): WindowHost | null {
  const layer = document.querySelector('[data-os-windows]') as HTMLElement | null;
  const winTemplate = document.querySelector('template[data-os-window]') as HTMLTemplateElement | null;
  if (!layer || !winTemplate) return null;
  ensurePositioned(layer);
  stackDesktopLayers(layer);
  return {
    layer,
    taskbar: document.querySelector('[data-os-taskbar]') as HTMLElement | null,
    winTemplate,
    taskTemplate: document.querySelector('template[data-os-task]') as HTMLTemplateElement | null,
  };
}

function firstElement(tpl: HTMLTemplateElement): HTMLElement {
  const frag = tpl.content.cloneNode(true) as DocumentFragment;
  const el = frag.firstElementChild as HTMLElement | null;
  if (el) return el;
  const wrap = document.createElement('div');
  wrap.appendChild(frag);
  return wrap;
}

/**
 * Geometry repair, and geometry is the kernel's job (SPEC §2.2). The model's
 * window template decides how `[data-os-content]` is sized; a template that
 * gives it neither `flex` nor a height collapses it to zero, and then the
 * window is a title bar with nothing under it — the frame is mounted, the
 * document is generated and paid for, and none of it is visible. Every
 * `cerebras-oss120` window in BAKEOFF-1 did this.
 *
 * Measured after the root is in the document, and only touched when it really
 * is collapsed, so a template that sized itself correctly is left alone.
 */
function fitContent(root: HTMLElement, content: HTMLElement): void {
  if (content === root) return;
  const collapsed = () => content.clientHeight < 24;
  if (!collapsed() || root.clientHeight < 40) return;
  content.style.flex = '1 1 auto';
  content.style.minHeight = '0';
  if (!collapsed()) return;
  // the root is not a flex column either: fill what is left of it absolutely
  ensurePositioned(root);
  const top = Math.max(0, Math.round(content.getBoundingClientRect().top - root.getBoundingClientRect().top));
  content.style.position = 'absolute';
  content.style.left = '0';
  content.style.right = '0';
  content.style.top = top + 'px';
  content.style.bottom = '0';
  content.style.height = 'auto';
}

/**
 * KERNEL-6 / task 3 — a window body is never see-through while it streams.
 *
 * The bootstrap document every generated document is streamed into is
 * `background:transparent` on purpose (SPEC: an app that sets no background
 * shows the machine's own desktop through it, not a kernel-coloured pane). The
 * cost of that is the first second of a window's life: until the model's own
 * first stylesheet arrives, the frame is a hole, and what shows through is the
 * wallpaper and whatever other window is underneath — which reads as a broken
 * window rather than a loading one.
 *
 * The colour is never ours (no pixel of ours): it is the first opaque
 * `background-color` the model's OWN window template already declares, read
 * from `[data-os-content]` and then up its ancestors to the window root. A
 * template that is transparent all the way up is left exactly as it is — the
 * model meant it, and inventing a colour here would be a design decision.
 */
function templateBackdrop(root: HTMLElement, content: HTMLElement): string {
  let el: HTMLElement | null = content;
  while (el) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'transparent' && !/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)$/.test(bg)) return bg;
    if (el === root) break;
    el = el.parentElement;
  }
  return '';
}

/* ------------------------------------------------- chrome usability (T4/D2) */

/**
 * SEAM T4 / architect's defect D2 — a window a visitor cannot close or move.
 *
 * The live boot's window had no visible title bar and no visible close,
 * minimise or maximise control: the app's own header was the top of the window.
 * The contract validator found `[data-os-close]` and every harness in the tree
 * agreed the desktop was `ok`, because "the attribute is in the document" and
 * "a person can see and click it" are different claims — the same gap KERNEL-6
 * found between a bar's box and the contents of that bar.
 *
 * So the kernel measures the two things a window is unusable without, in
 * pixels: the title strip has to be at least `CHROME_MIN_BAR_H` tall and on
 * screen, and the close control has to be at least `CHROME_MIN_CTRL` square,
 * not transparent, and distinguishable from the bar it sits on (a glyph, a
 * word, its own background, a border — anything drawn). A window that fails
 * gets ONE bare unstyled strip at the top (SPEC §3.2's fallback: system font,
 * no colours, nothing invented about this machine's look) carrying its title
 * and three bare buttons, which `wire()` then hooks up like any other control.
 *
 * It is a fallback, not a restyle: the model's own chrome is left exactly where
 * it is, and a window whose chrome is usable is never touched.
 */
export const CHROME_MIN_BAR_H = 20;
export const CHROME_MIN_CTRL = 16;

export interface ChromeReading {
  ok: boolean;
  barH: number;
  closeW: number;
  closeH: number;
  closeOpacity: number;
  /** the close control is told apart from the bar by something drawn */
  closeDistinct: boolean;
  /** every reason it failed, for the telemetry line and the test */
  why: string[];
}

function transparentColour(c: string): boolean {
  return !c || c === 'transparent' || /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(\.0+)?\s*\)$/.test(c);
}

/** The strip the model means as the title bar: its drag handle, or the title's own parent. */
function chromeBar(root: HTMLElement): HTMLElement | null {
  return (root.querySelector('[data-os-drag]') as HTMLElement | null) || ((root.querySelector('[data-os-title]')?.parentElement as HTMLElement | null) || null);
}

/**
 * Is the close control drawn as something, or is it an invisible hit box? A
 * glyph, a word, an `<svg>`, its own background image, a background colour
 * that differs from the bar's, or a border all count; nothing at all does not.
 */
function controlDistinct(close: HTMLElement, bar: HTMLElement | null): boolean {
  if ((close.textContent || '').trim()) return true;
  if (close.querySelector('svg,img,canvas')) return true;
  let cs: CSSStyleDeclaration;
  try {
    cs = getComputedStyle(close);
  } catch {
    return false;
  }
  if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
  const barBg = bar ? getComputedStyle(bar).backgroundColor : '';
  if (!transparentColour(cs.backgroundColor) && cs.backgroundColor !== barBg) return true;
  const border =
    parseFloat(cs.borderTopWidth || '0') + parseFloat(cs.borderRightWidth || '0') + parseFloat(cs.borderBottomWidth || '0') + parseFloat(cs.borderLeftWidth || '0');
  if (border > 0 && cs.borderStyle !== 'none') return true;
  if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth || '0') > 0) return true;
  // one more chance: a child of the control that draws something of its own
  for (const child of Array.from(close.children) as HTMLElement[]) {
    const s = seen(child);
    if (s.area >= 9 && s.opacity > 0.01) return true;
  }
  return false;
}

/** Measure one window's chrome. Reads the live DOM and writes nothing. */
/**
 * Is the control the topmost thing at its own middle?
 *
 * HANDOFF-7, on a live `dock` boot: **every one of eleven windows** had a
 * 20x20 close control, drawn, opaque, distinct from its bar, `chrome: "ok"` —
 * and `document.elementFromPoint` at the middle of it returned another element
 * of the model's own title bar, the full-width drag strip laid over its own
 * buttons. The title bar moved the window and the close button did nothing,
 * because a real pointer never reached it. Drawn and reachable are two claims
 * and T4 only measured the first.
 *
 * Only the model's own content counts as covering: a window under another
 * window is the stack, and raising it is the visitor's business, not a defect
 * in its chrome. Three points across the control, because a button can be
 * clipped on one side by a bar that ends where it begins.
 */
function reachable(el: HTMLElement, root: HTMLElement): boolean {
  // an element whose own box cannot be read is given the benefit of the doubt:
  // `readChrome` decides whether to add pixels of ours, and it does not get to
  // add them because a measurement threw (KERNEL-6's reading, kept on purpose)
  let b: DOMRect;
  try {
    b = el.getBoundingClientRect();
  } catch (e) {
    return true;
  }
  if (b.width < 1 || b.height < 1) return false;
  const pts: number[][] = [
    [b.left + b.width / 2, b.top + b.height / 2],
    [b.left + b.width * 0.25, b.top + b.height / 2],
    [b.left + b.width * 0.75, b.top + b.height / 2],
  ];
  let sawOutside = false;
  let asked = 0;
  for (let i = 0; i < pts.length; i++) {
    const x = Math.round(pts[i][0]);
    const y = Math.round(pts[i][1]);
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
    asked++;
    let at: Element | null = null;
    try {
      at = document.elementFromPoint(x, y);
    } catch (e) {
      return true; // cannot ask: do not invent a defect
    }
    if (!at) continue;
    if (at === el || el.contains(at) || at.contains(el)) return true;
    // something of somebody else's is on top; whose?
    const win = at.closest('[data-os-window-id]');
    if (win && win !== root) {
      sawOutside = true; // another window: the stack, not this chrome
      continue;
    }
    if (!win) {
      sawOutside = true; // the bar, the dock, the desktop: not this chrome
      continue;
    }
  }
  // no point was on screen to ask about: a window off the edge is not a
  // chrome defect, and inventing one here would patch a strip onto every
  // window a probe measures before it is placed
  if (!asked) return true;
  // otherwise: every point that could be asked answered with something else of
  // THIS window's own content, which is the defect
  return sawOutside;
}

export function readChrome(root: HTMLElement): ChromeReading {
  const why: string[] = [];
  const bar = chromeBar(root);
  const barSeen = seen(bar);
  const barH = bar ? barSeen.h : 0;
  if (!bar) why.push('no-bar');
  else if (barSeen.area < 1 || barSeen.opacity <= 0.01) why.push('bar-invisible');
  else if (barH < CHROME_MIN_BAR_H) why.push('bar-' + barH + 'px');

  const close = root.querySelector('[data-os-close]') as HTMLElement | null;
  const closeSeen = seen(close);
  const distinct = close ? controlDistinct(close, bar) : false;
  if (!close) why.push('no-close');
  else if (closeSeen.opacity <= 0.01) why.push('close-transparent');
  else if (closeSeen.w < CHROME_MIN_CTRL || closeSeen.h < CHROME_MIN_CTRL) why.push('close-' + closeSeen.w + 'x' + closeSeen.h);
  else if (closeSeen.area < CHROME_MIN_CTRL * CHROME_MIN_CTRL * 0.5) why.push('close-clipped');
  else if (!distinct) why.push('close-undrawn');
  else if (!reachable(close, root)) why.push('close-covered');

  return {
    ok: why.length === 0,
    barH,
    closeW: closeSeen.w,
    closeH: closeSeen.h,
    closeOpacity: closeSeen.opacity,
    closeDistinct: distinct,
    why,
  };
}

/**
 * The bare strip. SPEC §3.2's fallback class: geometry and a system font, no
 * colour, no radius, no shadow — it is supposed to look like the model forgot
 * something, which it did.
 */
function bareChromeStrip(title: string): HTMLElement {
  const strip = document.createElement('div');
  strip.setAttribute('data-os-chrome-fallback', '');
  strip.setAttribute('data-os-injected', '');
  // the model's own drag handle is invisible or absent, so this one is the
  // handle: `wire()` reads the FIRST [data-os-drag] in the root
  strip.setAttribute('data-os-drag', '');
  strip.style.cssText =
    'display:flex;align-items:center;gap:6px;padding:2px 4px;min-height:22px;box-sizing:border-box;' +
    'font:13px/1.2 system-ui,sans-serif;cursor:move;user-select:none';
  const t = document.createElement('span');
  t.setAttribute('data-os-title', '');
  t.setAttribute('data-os-injected', '');
  t.style.cssText = 'overflow:hidden;white-space:nowrap;text-overflow:ellipsis';
  t.textContent = title;
  const spacer = document.createElement('span');
  spacer.style.flex = '1';
  const button = (attr: string, text: string) => {
    const b = document.createElement('button');
    b.setAttribute(attr, '');
    b.setAttribute('data-os-injected', '');
    b.style.font = 'inherit';
    b.textContent = text;
    return b;
  };
  strip.appendChild(t);
  strip.appendChild(spacer);
  strip.appendChild(button('data-os-minimize', '_'));
  strip.appendChild(button('data-os-maximize', '[]'));
  strip.appendChild(button('data-os-close', 'x'));
  return strip;
}

/**
 * T4 — the same reading, taken the moment the desktop mounts, before anybody
 * has opened anything.
 *
 * A `<template>`'s contents have no computed style worth reading, so the only
 * way to measure the chrome this machine will wear is to put one in the
 * document. The clone is inserted, measured and removed **synchronously** — no
 * yield to the renderer in between, so it is never painted and never seen —
 * which is also why it can be measured at its real size and position instead of
 * off screen, where `seen()` would report every part of it as invisible.
 *
 * Nothing is repaired here. This is the number that says whether the desktop
 * that just arrived has usable window chrome at all; the repair happens on each
 * real window, against the real thing.
 */
export function probeChrome(host: WindowHost): ChromeReading {
  const root = firstElement(host.winTemplate);
  const r = host.layer.getBoundingClientRect();
  root.style.position = 'absolute';
  root.style.pointerEvents = 'none';
  root.style.left = '0px';
  root.style.top = '0px';
  root.style.width = Math.max(240, Math.round(Math.min(r.width || 800, 800))) + 'px';
  root.style.height = Math.max(160, Math.round(Math.min(r.height || 480, 480))) + 'px';
  root.setAttribute('data-os-chrome-probe', '');
  host.layer.appendChild(root);
  let reading: ChromeReading;
  try {
    reading = readChrome(root);
  } finally {
    root.remove();
  }
  return reading;
}

export class WindowManager {
  windows: OsWindow[] = [];
  private seq = 0;
  private zTop = 10;

  constructor(
    private host: WindowHost,
    private hooks: {
      onClose: (w: OsWindow) => void;
      onFocus?: (w: OsWindow) => void;
      /**
       * T4 — the kernel patched a window's own chrome because a visitor could
       * not have used it. Reported, never silent: a `contract_patch` line is
       * how the next prompt iteration learns which part of §12.3 the model is
       * losing, and D2 is a defect nothing in the tree could see.
       */
      onPatch?: (what: 'chrome' | 'task', detail: string) => void;
    }
  ) {}

  vw() {
    return window.innerWidth || document.documentElement.clientWidth;
  }
  vh() {
    return window.innerHeight || document.documentElement.clientHeight;
  }

  /**
   * The visible part of the model's `[data-os-windows]` layer, in the
   * coordinates the kernel writes into `style.left/top`.
   *
   * Windows are placed against this rather than against the viewport: the
   * layer is the model's, so it can start under a menu bar, stop above a dock,
   * or run past the bottom of the screen — and a window cascaded against the
   * viewport inside such a layer lands under the model's own chrome or below
   * the fold. A layer with no measurable box (zero height, `display:contents`)
   * falls back to the viewport, which is what it effectively is.
   */
  area(): Area {
    const r = this.host.layer.getBoundingClientRect();
    const vw = this.vw();
    const vh = this.vh();
    const bars = this.barInsets();
    /**
     * KERNEL-8 / R1 — the bottom inset applies BELOW the breakpoint only.
     *
     * A phone window fills the whole area (SPEC §2.2), so it covers a bottom
     * bar every time and the task entries — the only way back to a minimised
     * window — cannot be tapped at all. Above the breakpoint a window is
     * cascaded and can be moved, dragged or closed by the visitor, and taking
     * 34 px off every desktop window to pre-empt an overlap it may not have is
     * a bigger change than this pass is allowed to make. The desktop half is
     * in KERNEL-8's "what remains" as a ruling to take, not guessed at here.
     */
    const inset = isMobile(vw) ? bars.bottom : 0;
    const left = Math.max(r.left, 0);
    const top = Math.max(bars.top, Math.max(r.top, 0));
    const w = Math.round(Math.min(r.right, vw) - left);
    const h = Math.round(Math.min(r.bottom, vh - inset) - top);
    if (!(w > 80 && h > 80)) return { x: 0, y: Math.round(bars.top), w: vw, h: Math.round(vh - bars.top - inset) };
    return { x: Math.round(left - r.left), y: Math.round(top - r.top), w, h };
  }

  /**
   * How much of the screen the model's own edge bars take, top and bottom.
   *
   * HANDOFF-7 / D2's last case. On a `dock` desktop the layer spans the
   * viewport, so the first window cascades to y = 20 — under the menu bar,
   * which §12.9 deliberately raises ABOVE the windows layer. Measured on a live
   * boot: the window's title strip was 893x28 with a 20x20 close control, every
   * pixel of it real, and `document.elementFromPoint` at the middle of both
   * returned the bar. The chrome was not broken and no patch of it could help;
   * the window was in the wrong place. A title bar a pointer cannot reach is a
   * geometry bug (`geometry.ts`, the rule a dragged window obeys) and geometry
   * is the kernel's, so this is the kernel's to fix.
   *
   * KERNEL-8 — and the BOTTOM edge too, which this refused on the grounds that
   * "a bottom bar covers content, which is the model's own layout decision, and
   * it takes no control surface with it". The second half of that sentence was
   * wrong, and R1 is what found it: the bar carries the task entries, and a
   * task entry is the ONLY way back to a minimised window. The mock's own
   * windows layer is `inset:0` with a 34 px bar fixed over its bottom edge, so
   * on a phone — where a window fills the layer — the full-size window covered
   * the bar and `[data-os-task-for]` could not be tapped at all
   * (`<iframe data-os-frame="app"> … intercepts pointer events`, 90 s of
   * retries). It is the same defect as D2's menu bar, at the other edge, and
   * §12.9's own words settle it: a window laid over the model's dock or bar is
   * not maximised, it is broken.
   *
   * Only a bar shaped like a bar and sitting ON an edge: a strip at the top or
   * bottom, no taller than a fifth of the screen, at least half its width. A
   * narrow floating dock is not an edge bar and costs a window nothing. A
   * layer that already stops above its bar gets no change at all — the `min`
   * in `area()` is then a no-op.
   */
  private barInsets(): { top: number; bottom: number } {
    let top = 0;
    let bottom = 0;
    let els: Element[] = [];
    try {
      els = Array.prototype.slice.call(document.querySelectorAll('[data-os-taskbar],[data-os-dock]'));
    } catch (e) {}
    const vw = this.vw();
    const vh = this.vh();
    for (let i = 0; i < els.length; i++) {
      const b = rectOf(els[i]);
      if (b.width < vw * 0.5) continue; // a floating dock is not an edge bar
      if (b.height > vh * 0.2 || b.height < 8) continue;
      if (b.top <= 2 && b.bottom > top) top = b.bottom;
      else if (b.bottom >= vh - 2 && vh - b.top > bottom) bottom = vh - b.top;
    }
    const cap = Math.round(vh * 0.2); // never give away more than a fifth of the screen
    return { top: Math.min(Math.round(top), cap), bottom: Math.min(Math.round(bottom), cap) };
  }

  /**
   * KERNEL-9 — a bar that just changed height must not leave a title strip
   * under it.
   *
   * `area()` insets the TOP bar, so `reflow()` already pushes a window out
   * from under a menu bar that grew. The bottom edge it deliberately does not
   * (KERNEL-8: taking 34 px off every desktop window to pre-empt an overlap it
   * may not have is a bigger change than that pass was allowed to make) — and
   * a window dragged low enough can have its whole title strip, and therefore
   * its close control, under a bar that has since grown upwards. That is the
   * same defect as D2's menu bar at the other edge, and one window at a time
   * is the smallest thing that fixes it: the window moves the minimum distance
   * that clears the bar, nothing is resized, and a window whose title is
   * already clear is not touched.
   */
  titlesClearOfBars(): number {
    if (isMobile(this.vw())) return 0; // a phone window fills `area()`, bottom inset included
    const bars = this.barInsets();
    if (!bars.top && !bars.bottom) return 0;
    const lr = this.host.layer.getBoundingClientRect();
    const area = this.area();
    /** the lowest a title strip may start, in the layer's coordinates */
    const floor = Math.round(this.vh() - bars.bottom - lr.top);
    let moved = 0;
    for (const w of this.windows) {
      if (w.state.minimized || w.maximized || !w.root.isConnected) continue;
      const box = this.liveBox(w);
      const strip = Math.max(8, Math.min(this.titleH(w), box.h));
      const maxY = Math.max(area.y, floor - strip);
      const y = Math.round(Math.min(Math.max(box.y, area.y), maxY));
      if (y === box.y) continue;
      const next = { ...box, y };
      w.state.geometry = next;
      this.applyBox(w.root, next);
      w.root.setAttribute('data-os-bar-nudged', String(y - box.y));
      moved++;
    }
    return moved;
  }

  /**
   * The height of this window's title strip, measured off the model's own
   * chrome. Used to guarantee the title stays on screen: guessing it would be a
   * visual opinion, and the drag handle is where the model put the title.
   */
  private titleH(w: OsWindow): number {
    const bar = (w.root.querySelector('[data-os-drag]') || w.root.querySelector('[data-os-title]')) as HTMLElement | null;
    const h = Math.round(rectOf(bar).height);
    return h > 8 ? Math.min(h, Math.max(40, Math.round(w.state.geometry.h / 2))) : TITLE_STRIP;
  }

  /**
   * Is this element inside one of the kernel's own window roots?
   *
   * KERNEL-6: the desktop's click delegation used to ask
   * `closest('[data-os-window-id]')`, which is an attribute in a document the
   * model writes. Identity instead — the same reason as `isKernelChrome`.
   */
  owns(el: Element | null | undefined): boolean {
    if (!el) return false;
    return this.windows.some((w) => w.root === el || w.root.contains(el));
  }

  /** KERNEL-6: does `w` paint above every other live window? */
  topOfStack(w: OsWindow): boolean {
    const z = Number(w.root.style.zIndex || 0);
    return this.windows.every((o) => o === w || o.state.minimized || !o.root.isConnected || Number(o.root.style.zIndex || 0) < z);
  }

  create(app: string, params: Record<string, unknown>, title: string): OsWindow {
    const root = firstElement(this.host.winTemplate);
    const geometry = cascade(this.seq++, this.area(), this.vw());
    root.setAttribute('data-os-window-id', 'w' + this.seq);
    root.style.position = 'absolute';
    root.style.pointerEvents = 'auto';
    this.applyBox(root, geometry);
    root.style.zIndex = String(++this.zTop);

    const content = (root.querySelector('[data-os-content]') as HTMLElement | null) || root;
    ensurePositioned(content);
    if (!content.style.overflow) content.style.overflow = 'hidden';

    // allow-forms: apps put real inputs in real forms (search, terminal, messages).
    // The runtime intercepts the submit and turns it into an os.navigate; without
    // the permission the event is never dispatched at all.
    const frame = new Frame('app', { allowForms: true });
    content.innerHTML = '';
    content.appendChild(frame.el);

    // every one of them: the bare chrome strip below carries a title element of
    // its own, and a window whose title only updates in the model's hidden
    // header is the D2 defect with extra steps
    root.querySelectorAll('[data-os-title]').forEach((el) => {
      el.textContent = title;
    });

    this.host.layer.appendChild(root);
    fitContent(root, content);

    /**
     * KERNEL-6 / task 3 — not see-through while it streams. Measured after the
     * root is in the document, because a computed style before that is the
     * template's, not this window's. The colour is the model's own; a template
     * that declares none keeps its transparency.
     */
    const backdrop = templateBackdrop(root, content);
    if (backdrop) {
      frame.el.style.background = backdrop;
      root.setAttribute('data-os-backdrop', backdrop);
      frame.addInkHook(() => {
        frame.el.style.background = 'transparent';
        root.setAttribute('data-os-backdrop', 'inked');
      });
    }

    const state: WinState = {
      id: 'w' + this.seq,
      app,
      params,
      title,
      geometry,
      z: this.zTop,
      minimized: false,
      history: [],
      cursor: -1,
    };
    const w: OsWindow = { state, root, frame, task: null, pageTitle: '', pageScope: '', maximized: null, gen: null, imgs: new AbortController() };
    this.windows.push(w);
    this.ensureChrome(w);
    this.wire(w);
    this.addTask(w);
    this.fitOnScreen(w);
    // reflow() marks the windows that exist when it runs; a window opened after
    // it has to mark itself or the flag only ever appears on a resize
    if (isMobile(this.vw())) root.setAttribute('data-os-fullsize', 'true');
    // R1 — opening counts as focusing: the new window is the one on screen, and
    // `create` does not go through `focus()` (it is already on top of the z
    // stack), so the solo rule has to be asked for here too.
    this.soloOnPhone(w);
    this.markFocus(w);
    return w;
  }

  /**
   * T4 / D2 — a window nobody can close is not a window.
   *
   * Measured on the REAL window root, once, after it is in the document and
   * sized: a template's computed style before that is the template's, and §12.3
   * makes the chrome the model's, so the only honest reading is of the thing
   * on screen. A window that fails gets the bare strip and keeps everything
   * else the model drew.
   */
  private ensureChrome(w: OsWindow): ChromeReading {
    const reading = readChrome(w.root);
    w.root.setAttribute('data-os-chrome', reading.ok ? 'ok' : 'patched');
    if (reading.ok) return reading;
    w.root.setAttribute('data-os-chrome-why', reading.why.join(','));
    const strip = bareChromeStrip(w.state.title);
    w.root.insertBefore(strip, w.root.firstChild);
    /**
     * A root whose own content is absolutely positioned over the top of it
     * paints over an in-flow strip, and an invisible fallback is no fallback.
     * Asked of the document rather than assumed: if the middle of the strip
     * belongs to somebody else, it is raised once — geometry, not style.
     */
    const r = strip.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      if (hit && hit !== strip && !strip.contains(hit)) {
        ensurePositioned(strip);
        strip.style.zIndex = '2147480000';
        strip.setAttribute('data-os-chrome-raised', '');
      }
    }
    this.hooks.onPatch?.('chrome', reading.why.join(',') + ' (bar ' + reading.barH + 'px, close ' + reading.closeW + 'x' + reading.closeH + ')');
    return reading;
  }

  /**
   * A new window is always wholly inside the layer's visible area.
   *
   * `cascade` already places it there, but only the box the kernel asked for:
   * the model's chrome can render larger than that (a template with
   * `content-box` sizing plus a border, a `min-width`, a padded header), and
   * what must be on screen is what is drawn. Measured after the root is in the
   * document and a no-op for a template that sized itself the way it was told.
   */
  private fitOnScreen(w: OsWindow) {
    if (isMobile(this.vw())) return;
    const area = this.area();
    const r = w.root.getBoundingClientRect();
    const box = { ...w.state.geometry };
    const padX = Math.max(0, Math.round(r.width) - box.w);
    const padY = Math.max(0, Math.round(r.height) - box.h);
    const fit: Area = { x: area.x, y: area.y, w: Math.max(120, area.w - padX), h: Math.max(100, area.h - padY) };
    const next = clampInside(
      { ...box, w: Math.min(box.w, fit.w), h: Math.min(box.h, fit.h) },
      fit
    );
    if (next.x === box.x && next.y === box.y && next.w === box.w && next.h === box.h) return;
    w.state.geometry = next;
    this.applyBox(w.root, next);
  }

  private applyBox(el: HTMLElement, b: Box) {
    el.style.left = b.x + 'px';
    el.style.top = b.y + 'px';
    el.style.width = b.w + 'px';
    el.style.height = b.h + 'px';
  }

  private wire(w: OsWindow) {
    /**
     * HANDOFF-8 — the close button that could not be clicked.
     *
     * Measured on a 4-window cascade: a real mouse click on the `[data-os-close]`
     * of a window that was not already focused produced a `mousedown` and NO
     * `click`, twice in a row, and the button moved +36,+36 between the two
     * attempts. The cause is this raise: `focus` ran `clearTitleCollision`,
     * which is exactly the cascade step, so pointerdown moved the window out
     * from under the pointer and mouseup landed on nothing. Every press moved
     * it again, so the window was not closeable by mouse at all — and no
     * instrument saw it, because every close in the tree until now was
     * dispatched rather than clicked.
     *
     * A focus that comes from a POINTER therefore does not de-overlap: the
     * visitor is looking at the window and touching it, and a window that runs
     * away from the finger is worse than two title bars that overlap.
     * `ensureTitleVisible` still runs — a title dragged off the screen is a
     * window with no handle at all, which is a safety repair and not cosmetics
     * (`e2e/windows.spec.ts:171` locks it) — and every focus that is NOT a
     * pointer (create, a task entry, the window revealed by a close) still
     * clears the collision, which is where H4 wanted it.
     */
    const raise = () => this.focus(w, { collide: false });
    w.root.addEventListener('pointerdown', raise, true);
    w.frame.el.addEventListener('focus', raise);

    w.root.querySelectorAll('[data-os-close]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.close(w);
      })
    );
    w.root.querySelectorAll('[data-os-minimize]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.minimize(w);
      })
    );
    w.root.querySelectorAll('[data-os-maximize]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleMax(w);
      })
    );

    const drag = w.root.querySelector('[data-os-drag]') as HTMLElement | null;
    const bar = drag || (w.root.querySelector('[data-os-title]')?.parentElement as HTMLElement | null);
    /**
     * Double-click the title bar toggles maximize — the gesture every desktop
     * in the archetype list has, and the only one available when the model's
     * chrome has no `[data-os-maximize]` control (SPEC §12.3 makes the controls
     * the model's; the geometry stays the kernel's).
     */
    if (bar) {
      bar.addEventListener('dblclick', (ev: Event) => {
        if ((ev.target as Element)?.closest?.('[data-os-close],[data-os-minimize],[data-os-maximize],input,textarea,select')) return;
        ev.preventDefault();
        this.toggleMax(w);
      });
    }
    if (drag) {
      drag.addEventListener('pointerdown', (ev: PointerEvent) => {
        if (isMobile(this.vw())) return; // no drag on small viewports
        if ((ev.target as Element)?.closest('[data-os-close],[data-os-minimize],[data-os-maximize]')) return;
        ev.preventDefault();
        this.focus(w);
        const startX = ev.clientX;
        const startY = ev.clientY;
        const base = { ...w.state.geometry };
        const area = this.area();
        const titleH = this.titleH(w);
        const move = (e: PointerEvent) => {
          const next = clampDrag({ ...base, x: base.x + (e.clientX - startX), y: base.y + (e.clientY - startY) }, area, titleH);
          w.state.geometry = next;
          this.applyBox(w.root, next);
        };
        const stop = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
      });
    }

    const resize = w.root.querySelector('[data-os-resize]') as HTMLElement | null;
    if (resize) {
      resize.addEventListener('pointerdown', (ev: PointerEvent) => {
        if (isMobile(this.vw())) return;
        ev.preventDefault();
        ev.stopPropagation();
        const startX = ev.clientX;
        const startY = ev.clientY;
        const base = { ...w.state.geometry };
        const move = (e: PointerEvent) => {
          const next: Box = {
            ...base,
            w: Math.max(200, base.w + (e.clientX - startX)),
            h: Math.max(140, base.h + (e.clientY - startY)),
          };
          w.state.geometry = next;
          this.applyBox(w.root, next);
        };
        const stop = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
      });
    }
  }

  private addTask(w: OsWindow) {
    if (!this.host.taskbar || !this.host.taskTemplate) return;
    let el = firstElement(this.host.taskTemplate);
    el.setAttribute('data-os-task-for', w.state.id);
    const t = el.querySelector('[data-os-title]');
    if (t) t.textContent = w.state.title;
    else el.textContent = w.state.title;
    this.host.taskbar.appendChild(el);
    /**
     * T4, the same question about the other template: §12.3 asks for "one entry
     * per open window" and BAKEOFF-4 already found a bar full of entries whose
     * icon and label were below the bottom of the screen (`fitBarContents` grows
     * the bar for that one). This is the remaining half: an entry with no box at
     * all, or one whose title has no visible pixels, is replaced by a bare
     * unstyled one carrying the title — the contract's fallback, not a restyle,
     * and only ever on an entry a visitor could not have read.
     *
     * A bar the model hid entirely cannot be fixed from here and is not ours to
     * un-hide: the bare entry goes in and the report says what was measured.
     */
    const box = seen(el);
    const words = textArea(el);
    if (box.area < 64 || box.opacity <= 0.01 || words < 1) {
      const bare = document.createElement('button');
      bare.setAttribute('data-os-task-for', w.state.id);
      bare.setAttribute('data-os-task-fallback', '');
      bare.setAttribute('data-os-injected', '');
      bare.style.font = '13px/1.2 system-ui,sans-serif';
      const span = document.createElement('span');
      span.setAttribute('data-os-title', '');
      span.textContent = w.state.title;
      bare.appendChild(span);
      el.replaceWith(bare);
      el = bare;
      this.hooks.onPatch?.(
        'task',
        'entry ' + box.w + 'x' + box.h + ', visible ' + box.area + 'px2, title ' + words + 'px2'
      );
    }
    el.addEventListener('click', (e) => {
      e.preventDefault();
      if (w.state.minimized) this.restore(w);
      else this.focus(w);
    });
    w.task = el;
  }

  focus(w: OsWindow, opts: { collide?: boolean } = {}) {
    this.soloOnPhone(w);
    w.state.z = ++this.zTop;
    w.root.style.zIndex = String(w.state.z);
    this.ensureTitleVisible(w);
    // `collide: false` — a pointer-driven raise never moves the window; see
    // `wire`
    if (opts.collide !== false) this.clearTitleCollision(w);
    this.markFocus(w);
    this.hooks.onFocus?.(w);
  }

  /**
   * R1 (KERNEL-8) — a phone shows ONE window at a time.
   *
   * HANDOFF-7 §8, the defect a visitor would name first: SPEC §2.2 gives every
   * window the full screen below 768 px, so four open windows piled four title
   * bars into the same 28 px strip — five close buttons in a row, none of the
   * text legible, and only the top one reachable (which was correct and still
   * looked broken). Four full-screen windows in the same rectangle are not a
   * stack a thumb can navigate; they are one illegible window.
   *
   * So below the breakpoint, opening or focusing a window minimises every
   * other one. Nothing new is drawn for it: it is the minimise state the
   * kernel already has (`display:none`, `data-os-minimized`), the bar's task
   * entries are already the way back (a tap restores), and closing the top
   * window hands the screen to the one under it (see `close`). Desktop widths
   * are untouched — the cascade, the nudge and the title-collision rules there
   * are all still the ones H4 shipped.
   */
  private soloOnPhone(w: OsWindow) {
    if (!isMobile(this.vw())) return;
    /**
     * HANDOFF-8 — the half R1 left open, found by the harness on the first
     * phone rehearsal: `focus()` hid every OTHER window without showing THIS
     * one, so focusing a window that was itself minimised left the phone with
     * four windows open and **none on the screen** — the wallpaper, with the
     * whole session hidden behind task entries. `restore()` is the only path
     * that un-minimises, and the two callers that matter (the task entry, and
     * `close`) happen to go through it; every other caller of `focus` —
     * `wire`'s pointerdown raise, the frame's own focus event, the kernel's
     * `wm.focus` after `create`, and anything a later pass adds — did not.
     *
     * So the invariant belongs here, where the solo rule is: below the
     * breakpoint, focusing a window MEANS that window is the one on screen.
     * Inlined rather than calling `restore()`, which calls `focus()` back.
     */
    if (w.state.minimized && w.root.isConnected) {
      w.state.minimized = false;
      w.root.style.display = '';
      w.root.removeAttribute('data-os-minimized');
    }
    for (const o of this.windows) {
      if (o === w || o.state.minimized || !o.root.isConnected) continue;
      this.minimize(o);
    }
  }

  /**
   * SEAM H4 — focus is a state the machine can see and style.
   *
   * `data-os-focused="true|false"` on every window root and `data-os-active` on
   * the matching task entry. The prompts tell the model these attributes exist,
   * so an inactive title bar can go grey and the running entry in the bar can
   * look pressed — which is how every desktop in SPEC §12.3's archetype list
   * behaves and something no generated document could work out for itself: the
   * kernel owns focus, so the kernel has to say who has it.
   *
   * Written on EVERY window, not only the newly focused one: `false` is a
   * selector too, and a machine styling `[data-os-focused="false"]` needs the
   * attribute to exist before the second window is ever opened.
   */
  private markFocus(focused: OsWindow | null) {
    for (const w of this.windows) {
      const on = w === focused && !w.state.minimized;
      w.root.setAttribute('data-os-focused', on ? 'true' : 'false');
      if (!w.task) continue;
      if (on) w.task.setAttribute('data-os-active', '');
      else w.task.removeAttribute('data-os-active');
    }
  }

  /** This window's title strip, in the layer's coordinates. */
  private titleStrip(w: OsWindow): Box {
    const b = this.liveBox(w);
    return { x: b.x, y: b.y, w: b.w, h: Math.max(8, Math.min(this.titleH(w), b.h)) };
  }

  /**
   * H4 — the focused window's title bar is never covered by another window's
   * title bar. Z-order alone does not achieve it: the focused window paints
   * above everything, but two title bars in the same place are still two
   * illegible title bars, and the cascade wraps after CASCADE_WRAP windows so
   * the seventh window lands exactly on the first.
   *
   * The repair is placement, which is the kernel's (SPEC §2.2): step the
   * focused window down-right until its strip is clear, giving up rather than
   * marching it into a corner. Nothing else on the desktop moves.
   */
  private clearTitleCollision(w: OsWindow) {
    if (isMobile(this.vw()) || w.maximized) return;
    const others = this.windows.filter((o) => o !== w && !o.state.minimized && o.root.isConnected);
    if (!others.length) return;
    const strips = others.map((o) => this.titleStrip(o));
    const hits = (box: Box) => {
      const strip = { x: box.x, y: box.y, w: box.w, h: Math.max(8, Math.min(this.titleH(w), box.h)) };
      return strips.some((s) => stripsCollide(strip, s));
    };
    const box = this.liveBox(w);
    if (!hits(box)) return;
    const area = this.area();
    let prev = box;
    for (let i = 1; i <= CASCADE_WRAP; i++) {
      const next = clampInside({ ...box, x: box.x + i * CASCADE_STEP, y: box.y + i * CASCADE_STEP }, area);
      // the clamp has stopped moving: the window is against the far corner and
      // there is nowhere left to step
      if (next.x === prev.x && next.y === prev.y) break;
      prev = next;
      if (hits(next)) continue;
      w.state.geometry = next;
      this.applyBox(w.root, next);
      w.root.setAttribute('data-os-nudged', String(i));
      return;
    }
  }

  /**
   * The focused window's title is readable in full.
   *
   * Raising a window is no use if its title bar is off the edge — you cannot
   * see which app it is, and you cannot drag it back. `clampDrag` stops a drag
   * from getting there in the first place, so in practice this fires only after
   * a viewport resize or a model layout that moved the layer under a window.
   */
  private ensureTitleVisible(w: OsWindow) {
    if (isMobile(this.vw()) || w.maximized) return;
    const area = this.area();
    const titleH = this.titleH(w);
    // measured off the live DOM, not off `state.geometry`: the desktop is the
    // model's document and its own script can move a window, and what has to be
    // legible is where the window actually is
    const box = this.liveBox(w);
    if (titleVisible(box, area, titleH)) return;
    const next = clampDrag(box, area, titleH);
    w.state.geometry = next;
    this.applyBox(w.root, next);
  }

  /** Where this window actually is, in the layer's coordinates. */
  private liveBox(w: OsWindow): Box {
    const lr = this.host.layer.getBoundingClientRect();
    const r = w.root.getBoundingClientRect();
    return {
      x: Math.round(r.left - lr.left),
      y: Math.round(r.top - lr.top),
      w: Math.round(r.width) || w.state.geometry.w,
      h: Math.round(r.height) || w.state.geometry.h,
    };
  }

  minimize(w: OsWindow) {
    w.state.minimized = true;
    w.root.style.display = 'none';
    w.root.setAttribute('data-os-minimized', 'true');
    // H4: a hidden window is not the focused one, and its task entry is the
    // thing you click to get it back — neither may still read as active
    this.markFocus(this.topMost());
  }

  restore(w: OsWindow) {
    w.state.minimized = false;
    w.root.style.display = '';
    w.root.removeAttribute('data-os-minimized');
    this.focus(w);
  }

  toggleMax(w: OsWindow) {
    if (w.maximized) {
      this.applyBox(w.root, w.maximized);
      w.state.geometry = w.maximized;
      w.maximized = null;
      w.root.removeAttribute('data-os-maximized');
      return;
    }
    w.maximized = { ...w.state.geometry };
    // maximize fills the model's windows layer, not the screen: a window laid
    // over the model's own dock or menu bar is not "maximized", it is broken
    const full = fullSize(this.area());
    w.state.geometry = full;
    this.applyBox(w.root, full);
    w.root.setAttribute('data-os-maximized', 'true');
  }

  close(w: OsWindow) {
    w.gen?.abort();
    // and the pictures it was still waiting for: nobody will ever see them
    w.imgs?.abort();
    w.frame.destroy();
    if (w.root.parentNode) w.root.parentNode.removeChild(w.root);
    if (w.task && w.task.parentNode) w.task.parentNode.removeChild(w.task);
    this.windows = this.windows.filter((x) => x !== w);
    // H4: closing the focused window hands focus to the one underneath it,
    // which is what the visitor is now looking at.
    //
    // R1 — on a phone there IS no window underneath: the solo rule minimised
    // every one of them, so `topMost()` is null and closing the only visible
    // window would drop the visitor onto the wallpaper with the rest of the
    // session hidden in the bar. The most recently focused of the survivors is
    // restored instead, which is what "close reveals the previous one" means.
    const next = this.topMost() || (isMobile(this.vw()) ? this.lastFocused() : null);
    if (next) {
      if (next.state.minimized) this.restore(next);
      else this.focus(next);
    } else this.markFocus(null);
    this.hooks.onClose(w);
  }

  /** The highest-z window still open, minimized or not (R1's "the previous one"). */
  private lastFocused(): OsWindow | null {
    let best: OsWindow | null = null;
    for (const w of this.windows) {
      if (!w.root.isConnected) continue;
      if (!best || w.state.z > best.state.z) best = w;
    }
    return best;
  }

  /** The visible window with the highest z, i.e. the one on top right now. */
  private topMost(): OsWindow | null {
    let best: OsWindow | null = null;
    for (const w of this.windows) {
      if (w.state.minimized) continue;
      if (!best || w.state.z > best.state.z) best = w;
    }
    return best;
  }

  byFrame(frame: Frame): OsWindow | null {
    return this.windows.find((w) => w.frame === frame) || null;
  }

  /**
   * Under the mobile breakpoint every window is full size. Above it, a resize
   * (or a desktop script that moved the layer) must not leave a window with its
   * title bar off the edge, so every window is re-clamped into the new area.
   */
  reflow() {
    const mobile = isMobile(this.vw());
    const area = this.area();
    /**
     * R1 — resizing is not "opening or focusing", but a viewport that has just
     * crossed the breakpoint turns whatever was on screen into the pile §8
     * measured. The invariant is "a phone shows one window", so it is restored
     * here too: the one the visitor was last on keeps the screen.
     */
    if (mobile) {
      const top = this.topMost();
      if (top) this.soloOnPhone(top);
    }
    for (const w of this.windows) {
      if (mobile) {
        const full = fullSize(area);
        w.state.geometry = full;
        this.applyBox(w.root, full);
        w.root.setAttribute('data-os-fullsize', 'true');
        continue;
      }
      w.root.removeAttribute('data-os-fullsize');
      if (w.maximized) {
        const full = fullSize(area);
        w.state.geometry = full;
        this.applyBox(w.root, full);
        continue;
      }
      const titleH = this.titleH(w);
      const box = w.state.geometry;
      const next = clampDrag({ ...box, w: Math.min(box.w, area.w), h: Math.min(box.h, area.h) }, area, titleH);
      if (next.x === box.x && next.y === box.y && next.w === box.w && next.h === box.h) continue;
      w.state.geometry = next;
      this.applyBox(w.root, next);
    }
  }
}
