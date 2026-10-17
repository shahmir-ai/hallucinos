/**
 * "Can a visitor actually see this?" — in pixels, measured off the live DOM.
 *
 * KERNEL-7. Two of the architect's live defects are the same question asked
 * about two different elements, and neither had an instrument:
 *
 *  - D2: the window had no visible title bar and no visible close control. The
 *    contract validator found `[data-os-close]` and reported the desktop as
 *    `ok`, because "the attribute is in the document" and "a visitor can click
 *    it" are different claims (KERNEL-6 said the same thing about a bar's box
 *    and its contents).
 *  - D3: the dock's launcher labels were there before the plate sheet landed
 *    and gone after it — pushed out of the dock by a line height, still
 *    present, still `innerText`, still counted by every harness in the tree.
 *
 * So: a box intersected with every ancestor that clips it and with the
 * viewport, plus the opacity accumulated up the same chain. Zero area or zero
 * opacity means nobody can see it, whatever the DOM says. No styles are
 * written here and nothing is cached; every reading is a fresh measurement of
 * the document as it is now.
 */

import { trace, traceLoud } from './trace.js';

/** rate-limit state for `rectOf`'s never-silent swallow (see below) */
let failures = 0;

export interface Seen {
  /** visible area in CSS px², after clipping and the viewport */
  area: number;
  /** product of every `opacity` from the element up to (and excluding) `stop` */
  opacity: number;
  /** the element's own rendered box, unclipped */
  w: number;
  h: number;
}

const ZERO: Seen = { area: 0, opacity: 0, w: 0, h: 0 };

/** A box that is all zeros: what an element nobody can measure is worth. */
const NO_RECT: Rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * HANDOFF-7 — measuring the model's document must never cost the window.
 *
 * `getBoundingClientRect` is a call into a document the MODEL wrote: an element
 * whose own script has redefined it, a proxy, a detached node, a cross-document
 * node. One such bar threw inside `WindowManager.area()` — inside `create()`,
 * inside the delegated click — and the visitor's click produced NO WINDOW AT
 * ALL: caught two frames up by the guard, recorded, and lost. That is
 * HANDOFF-5 issue 1's exact shape, one measurement further in.
 *
 * So every kernel measurement of a model-owned element goes through here. A
 * box that cannot be read is zero, which every caller already handles, because
 * "the model gave me nothing usable" is a case they all had to have.
 */
export function rectOf(el: Element | null | undefined): Rect {
  if (!el || typeof (el as HTMLElement).getBoundingClientRect !== 'function') return NO_RECT;
  try {
    const r = el.getBoundingClientRect();
    if (!r || !Number.isFinite(r.width) || !Number.isFinite(r.height)) return NO_RECT;
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  } catch (e) {
    /**
     * HANDOFF-7 — a swallow is only allowed if it leaves a line.
     *
     * KERNEL-6 shipped `guard()` so that a throw out of the model's geometry
     * could not abandon `openApp`, and proved it with a trace entry naming the
     * callback and carrying the stack. KERNEL-7 then routed
     * `fitBarContents` through here, which catches the same throw two frames
     * earlier — the window still fills, which is the property that matters,
     * but the exception stopped being recorded ANYWHERE. That is the exact
     * shape of HANDOFF-5 issue 1 (a fault with no line), reintroduced by the
     * instrument built to prevent it.
     *
     * So: the measurement still fails soft, and it is never silent. Rate
     * limited because `rectOf` is called per element per launcher per picture
     * and a flood would evict the ring it is trying to fill: the first few are
     * loud (HUD + ring), the next few are ring-only, after that only the
     * counter moves. `measureFailures()` is the total for an instrument to
     * read.
     */
    failures++;
    const what =
      ((el as HTMLElement).tagName || '?').toLowerCase() +
      (el.getAttribute && el.getAttribute('data-os-app') ? '[data-os-app]' : '');
    const why = String((e as any)?.message || e);
    if (failures <= 3) traceLoud('measure threw ' + what, why);
    else if (failures <= 20) trace('measure threw ' + what, why);
    return NO_RECT;
  }
}

/** How many model-owned boxes could not be measured since the last reset. */
export function measureFailures(): number {
  return failures;
}

/** Part of unmount: the next machine starts with a clean count. */
export function resetMeasureFailures(): void {
  failures = 0;
}

function vw(): number {
  return window.innerWidth || document.documentElement.clientWidth || 0;
}
function vh(): number {
  return window.innerHeight || document.documentElement.clientHeight || 0;
}

/**
 * How much of `el` is on screen, and how opaque it is.
 *
 * `display:none` and `visibility:hidden` answer zero through the box and the
 * opacity respectively; a clipped ancestor answers through the intersection.
 */
export function seen(el: Element | null | undefined, stop?: Element | null): Seen {
  if (!el) return ZERO;
  const r = rectOf(el);
  if (!(r.width > 0 && r.height > 0)) return { ...ZERO, w: Math.round(r.width), h: Math.round(r.height) };
  let l = r.left;
  let t = r.top;
  let rt = r.right;
  let b = r.bottom;
  let opacity = 1;
  let p: Element | null = el;
  while (p && p !== stop && p !== document.documentElement) {
    let cs: CSSStyleDeclaration;
    try {
      cs = getComputedStyle(p as HTMLElement);
    } catch {
      break;
    }
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse' || cs.display === 'none') opacity = 0;
    const o = parseFloat(cs.opacity);
    if (Number.isFinite(o)) opacity *= o;
    // the element's own overflow cannot clip itself, only its descendants
    if (p !== el && (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) {
      const pr = rectOf(p);
      l = Math.max(l, pr.left);
      t = Math.max(t, pr.top);
      rt = Math.min(rt, pr.right);
      b = Math.min(b, pr.bottom);
    }
    p = p.parentElement;
  }
  l = Math.max(l, 0);
  t = Math.max(t, 0);
  rt = Math.min(rt, vw());
  b = Math.min(b, vh());
  const area = Math.max(0, rt - l) * Math.max(0, b - t);
  return { area: Math.round(area), opacity: Math.round(opacity * 1000) / 1000, w: Math.round(r.width), h: Math.round(r.height) };
}

/** Is any of it on screen at all? */
export function visible(el: Element | null | undefined, minArea = 1): boolean {
  const s = seen(el);
  return s.area >= minArea && s.opacity > 0.01;
}

/**
 * The elements inside `root` that carry the text a person reads, skipping
 * `skip` and everything inside it (the icon slot, whose glyph is not a label).
 * Leaf-first: a wrapper is only returned when it has no element children of
 * its own, so one label is counted once.
 */
export function textEls(root: Element, skip?: Element | null): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (skip && (child === skip || child.contains(skip))) {
        if (child !== skip) walk(child);
        continue;
      }
      if (!(child.textContent || '').replace(/\s+/g, '')) continue;
      if (child.children.length === 0) out.push(child as HTMLElement);
      else walk(child);
    }
  };
  walk(root);
  /**
   * A launcher that is `<button data-os-app>Compass</button>` — the label as a
   * bare text node with no element of its own — is the shape `injectMissing`
   * writes and one some models write too. Its text is the root's own.
   */
  if (!out.length && (root.textContent || '').replace(/\s+/g, '') && root.children.length === 0) out.push(root as HTMLElement);
  return out;
}

/**
 * Visible pixels of text inside `root`, `skip` excluded. This is the number D3
 * is about: a label pushed out of a dock still has a box, still has text, and
 * has no pixels.
 */
export function textArea(root: Element, skip?: Element | null): number {
  let total = 0;
  for (const el of textEls(root, skip)) {
    const s = seen(el);
    if (s.opacity > 0.01) total += s.area;
  }
  return total;
}
