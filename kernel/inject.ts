/**
 * Mounting the generated desktop, and the contract fallback injection (SPEC §3.2).
 *
 * The desktop lives in the top document — the kernel has to read its hooks and put
 * iframes inside its window template, which is impossible across an opaque origin.
 * Its no-network guarantee therefore comes from the page's own CSP header
 * (see server/index.ts PAGE_CSP) rather than from a per-document meta tag.
 */

import { barGrowth, clipped, nearestEdge, type Box, type Edge } from './geometry.js';
import { rectOf, resetMeasureFailures, seen, type Rect } from './visible.js';

export interface Mounted {
  nodes: Node[];
  styles: HTMLElement[];
  bodyAttrs: { name: string; prev: string | null }[];
  htmlAttrs?: { name: string; prev: string | null }[];
}

const MARK = 'data-os-generated';

/**
 * Everything `injectMissing` (and the fallback clock) put into the document.
 *
 * It is NOT part of the mounted desktop's node list — the patch happens after
 * the mount — so without this record `unmount()` left it behind: after a
 * reboot, `readHost()` picked the DEAD machine's injected taskbar and the new
 * boot's task entries went into it. Worse for the measurement, `domMissing()`
 * then found `[data-os-taskbar]` present and the second boot recorded no
 * taskbar miss at all, which is the exact number SPEC §10.3 and the bake-off
 * gate on.
 */
let injectedNodes: Element[] = [];

function trackInjected<T extends Element>(el: T): T {
  injectedNodes.push(el);
  return el;
}

/** Take the injected fallbacks out of the document (part of unmount). */
export function removeInjected(): void {
  for (const el of injectedNodes) el.remove();
  injectedNodes = [];
}

/* --------------------------------------------------------- viewport fit guard */

/**
 * The desktop has to fit the screen it is on — and that is geometry, which SPEC
 * §2.2 gives the kernel, not a style opinion about the machine.
 *
 * The page's own stylesheet already says `html,body{height:100%;overflow:hidden}`,
 * but the desktop's `<style>` blocks are appended to `<head>` after it and win:
 * a `body{min-height:1200px}`, a launcher grid that grew past the fold, or a bar
 * written at the end of the flow instead of fixed to an edge all end the same
 * way — the taskbar or dock is below the fold of a document that cannot be
 * scrolled, so the bar, the clock and every window entry in it simply do not
 * exist for the visitor.
 *
 * Two steps, the second only if the first was not enough:
 *
 *  1. `height:100%; overflow:hidden` inline on `<html>` and `<body>` (inline
 *     beats the model's stylesheet without `!important` and without touching a
 *     single colour, font or position of its own).
 *  2. only if a `[data-os-taskbar]` is STILL clipped: pin it `position:fixed`
 *     to the viewport edge it is nearest, along its short axis, so a bottom bar
 *     goes to the bottom and a side dock to its side.
 *
 * Everything is recorded and undone by `resetFit()` at unmount: the next
 * machine gets the document as the page served it.
 */
let fitUndo: (() => void)[] = [];
let fitted = false;
let pinnedEdge: Edge | null = null;

function setStyle(el: HTMLElement, prop: string, value: string): void {
  const prev = el.style.getPropertyValue(prop);
  const prevPriority = el.style.getPropertyPriority(prop);
  fitUndo.push(() => {
    if (prev) el.style.setProperty(prop, prev, prevPriority);
    else el.style.removeProperty(prop);
  });
  el.style.setProperty(prop, value);
}

/**
 * KERNEL-9 — the same property, written more than once.
 *
 * `setStyle` records the model's own declaration on every call, which is right
 * for a repair that happens once per machine and wrong for one that is
 * re-measured as the session goes on: the launcher inset and the bar's height
 * are now recomputed whenever a bar changes, and `setStyle` would push another
 * undo entry (and another stale "previous value", the SECOND of which is ours)
 * on every write. So the model's declaration is recorded the FIRST time the
 * kernel touches that property on that element, and never again.
 */
const styledOnce: { el: HTMLElement; prop: string; prev: string; prio: string }[] = [];

function keep(el: HTMLElement, prop: string): { el: HTMLElement; prop: string; prev: string; prio: string } {
  let rec = styledOnce.filter((s) => s.el === el && s.prop === prop)[0];
  if (rec) return rec;
  rec = { el, prop, prev: el.style.getPropertyValue(prop), prio: el.style.getPropertyPriority(prop) };
  styledOnce.push(rec);
  fitUndo.push(() => {
    if (rec.prev) el.style.setProperty(prop, rec.prev, rec.prio);
    else el.style.removeProperty(prop);
  });
  return rec;
}

function setStyleKeep(el: HTMLElement, prop: string, value: string): void {
  keep(el, prop);
  el.style.setProperty(prop, value);
}

/** Put the model's own declaration of one property back, now rather than at unmount. */
function clearStyleKeep(el: HTMLElement, prop: string): void {
  const rec = styledOnce.filter((s) => s.el === el && s.prop === prop)[0];
  if (!rec) return;
  if (rec.prev) el.style.setProperty(prop, rec.prev, rec.prio);
  else el.style.removeProperty(prop);
}

function boxOf(el: Element): Box {
  const r = rectOf(el);
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function vw(): number {
  return window.innerWidth || document.documentElement.clientWidth;
}
function vh(): number {
  return window.innerHeight || document.documentElement.clientHeight;
}

/* ------------------------------------------------------- the bars, by identity
 *
 * KERNEL-8. Three of this pass's rulings (R2 the clock, R3 the spacing net, and
 * the launcher row under a fixed bar) act "inside the bar", and the contract
 * only names one of them: `[data-os-taskbar]`. SPEC §12.3's `dock` archetype
 * draws a MENU BAR along the top as well, the prompt's own example writes it as
 * a plain `<div>`, and HANDOFF-7 §4's live defect (`02:03:55` jammed against
 * `9/18/2026`) and §8's overlapped launcher row both happened in exactly that
 * unhooked element. So a bar is found the way `topBarBottom()` in windows.ts
 * finds one — by shape, which is geometry and therefore the kernel's (SPEC
 * §2.2) — and never by class name or by what it looks like.
 *
 * A bar is: the hooked taskbar or dock, or a strip on the TOP edge at least
 * half the screen wide and no taller than a fifth of it. Windows, the wallpaper
 * area and anything inside them are never bars: a window's own title strip is a
 * top-edge strip and none of these rulings is about it.
 */
const BAR_HOOKS = '[data-os-taskbar],[data-os-dock]';
/** How deep below <body> an unhooked menu bar is looked for. */
const BAR_DEPTH = 4;

function isBarShaped(el: Element): boolean {
  const r = rectOf(el);
  if (r.width < vw() * 0.5) return false; // a floating dock is not a menu bar
  if (r.height < 8 || r.height > vh() * 0.2) return false;
  return r.top <= 2 && r.bottom > 0; // the top edge only
}

export function barRoots(): HTMLElement[] {
  const out: HTMLElement[] = [];
  const add = (el: HTMLElement) => {
    if (out.indexOf(el) < 0) out.push(el);
  };
  try {
    (Array.from(document.querySelectorAll(BAR_HOOKS)) as HTMLElement[]).forEach(add);
  } catch {}
  // the unhooked menu bar, by shape, breadth-first and depth-capped
  let level: HTMLElement[] = document.body ? (Array.from(document.body.children) as HTMLElement[]) : [];
  for (let depth = 0; depth < BAR_DEPTH && level.length; depth++) {
    const next: HTMLElement[] = [];
    for (const el of level) {
      if (!el || el.nodeType !== 1) continue;
      if (el.hasAttribute('data-os-window-id') || el.hasAttribute('data-os-windows') || el.hasAttribute('data-os-desktop')) continue;
      if (el.tagName === 'TEMPLATE' || el.tagName === 'STYLE' || el.tagName === 'SCRIPT') continue;
      if (el.querySelector('[data-os-window-id],[data-os-windows]')) {
        // a container of the windows layer is a layout wrapper, not a bar; look inside it
        next.push(...(Array.from(el.children) as HTMLElement[]));
        continue;
      }
      if (isBarShaped(el)) {
        add(el);
        continue; // the bar itself, not its rows
      }
      next.push(...(Array.from(el.children) as HTMLElement[]));
    }
    level = next;
  }
  // a bar inside another bar is one bar: keep the outermost
  return out.filter((el) => !out.some((o) => o !== el && o.contains(el)));
}

interface TextRun {
  el: HTMLElement;
  r: Rect;
  ours: boolean;
  text: string;
}

/**
 * The runs of text in a bar, measured the way `scripts/run.mjs`'s `barSpacing`
 * measures them (HANDOFF-7 §4) — deliberately the same algorithm, so what the
 * net repairs and what the instrument reports cannot disagree: an element with
 * a non-empty text child of its own, visible, not an icon glyph, and not a
 * container of another run.
 */
function textRuns(bar: HTMLElement): TextRun[] {
  let els: HTMLElement[] = [];
  try {
    els = Array.from(bar.querySelectorAll('*')) as HTMLElement[];
  } catch {
    return [];
  }
  const runs: TextRun[] = [];
  for (const el of els) {
    let own = '';
    try {
      for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) own += n.textContent || '';
    } catch {}
    if (!own.trim()) continue;
    if (el.closest('[data-os-icon]')) continue;
    const r = rectOf(el);
    if (!(r.width > 0 && r.height > 0)) continue;
    if (seen(el).area < 1) continue;
    runs.push({
      el,
      r,
      ours: !!el.closest('[data-os-injected]'),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    });
  }
  return runs.filter((x) => !runs.some((o) => o !== x && x.el.contains(o.el)));
}

/** Two runs on one line with nothing between them, tightest first. */
function adjacentPairs(runs: TextRun[]): { a: TextRun; b: TextRun; gap: number }[] {
  const pairs: { a: TextRun; b: TextRun; gap: number }[] = [];
  const sameLine = (a: Rect, b: Rect) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
  for (const a of runs) {
    for (const b of runs) {
      if (a === b) continue;
      if (!(b.r.left >= a.r.right - 2)) continue;
      if (!sameLine(a.r, b.r)) continue;
      if (runs.some((c) => c !== a && c !== b && c.r.left >= a.r.right - 2 && c.r.right <= b.r.left + 2 && sameLine(a.r, c.r))) continue;
      pairs.push({ a, b, gap: b.r.left - a.r.right });
    }
  }
  return pairs.sort((p, q) => p.gap - q.gap);
}

/* ------------------------------------------------------------ R2 — one clock */

/**
 * R2 — adopt the model's own clock rather than injecting a second one.
 *
 * HANDOFF-7 §4, measured on a live boot: the desktop drew a visible ticking
 * clock and forgot `[data-os-clock]`, so `injectMissing` appended the kernel's
 * fallback at the other end of the same bar — TWO CLOCKS on screen, which is
 * worse than the missing hook it was repairing, and it also blinded the
 * instrument (it measured ours, which is padded, and never looked at the
 * model's jammed pair).
 *
 * So before anything is injected, the bar is searched for a run of text that
 * reads as a time (HH:MM, optionally :SS) and that element is given the hook.
 * This is identifying the model's clock, not forging one: no pixel changes, the
 * element stays the model's, the attribute is taken back at unmount, and the
 * kernel's own fallback is still there for a bar with no clock in it at all.
 *
 * Whether it TICKS is a separate question and cannot be answered
 * synchronously — a static string that looks like a time is not a clock — so
 * `verifyClockTick` samples the adopted element ~1.2 s later and records the
 * answer. A non-ticking adoption is reported, never repaired: writing the time
 * into the model's element WOULD be forging it, and a second clock is the
 * defect this ruling exists to remove.
 */
const TIME_RE = /(?:^|[^0-9])([01]?[0-9]|2[0-3])[:.]([0-5][0-9])(?:[:.]([0-5][0-9]))?(?![0-9])/;

export function looksLikeTime(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 64) return false;
  return TIME_RE.test(t);
}

export function adoptClock(): { text: string; bar: boolean } | null {
  if (!document.body) return null;
  if (document.querySelector('[data-os-clock]')) return null;
  for (const bar of barRoots()) {
    const runs = textRuns(bar).filter((x) => !x.ours && looksLikeTime(x.text));
    if (!runs.length) continue;
    // the tightest text is the clock itself rather than the row that holds it:
    // `textRuns` has already dropped containers, so the shortest run that reads
    // as a time is the model's clock element
    const pick = runs.sort((a, b) => a.text.length - b.text.length)[0];
    const el = pick.el;
    el.setAttribute('data-os-clock', '');
    el.setAttribute('data-os-clock-adopted', '');
    fitUndo.push(() => {
      el.removeAttribute('data-os-clock');
      el.removeAttribute('data-os-clock-adopted');
    });
    adopted = el;
    return { text: pick.text, bar: true };
  }
  return null;
}

let adopted: HTMLElement | null = null;
let tickTimer = 0;

/**
 * Did the adopted element actually tick? Sampled once, ~1.2 s apart (a clock
 * with no seconds can take a minute to change, so `false` here means "no
 * second hand", not "not a clock" — which is why it is a reading and not a
 * repair). Recorded on `<html>` for the harness and handed to the caller for
 * the telemetry line.
 */
export function verifyClockTick(cb?: (ticks: boolean, text: string) => void, afterMs = 1200): void {
  const el = adopted;
  if (!el) return;
  const before = (el.textContent || '').trim();
  if (tickTimer) window.clearTimeout(tickTimer);
  tickTimer = window.setTimeout(() => {
    tickTimer = 0;
    if (!el.isConnected) return;
    const after = (el.textContent || '').trim();
    const ticks = after !== before;
    document.documentElement.setAttribute('data-os-clock-ticks', ticks ? 'true' : 'false');
    cb?.(ticks, after.slice(0, 40));
  }, afterMs);
}

function stopClockCheck(): void {
  if (tickTimer) window.clearTimeout(tickTimer);
  tickTimer = 0;
  adopted = null;
  document.documentElement.removeAttribute('data-os-clock-ticks');
}

/* ------------------------------------------------- R3 — the bar spacing net */

/**
 * R3 — a thin space between two runs of text that touch.
 *
 * HANDOFF-7 §4: `sky23:12:50`, `02:03:559/18/2026`, `02:20:50` 3 px from
 * `18/09/2026` — 1 bar in 4 live, and PROMPTS-4's rule asking for the gap is
 * landing at best partly. The visitor reads two values as one word.
 *
 * The net is whitespace, which is geometry and not style (SPEC §2.2): where two
 * adjacent same-line runs inside a bar have less than 4 px between them, ONE
 * thin space (U+2009) goes in between as a text node. Nothing is restyled, no
 * colour, font, margin or padding of the model's is touched, and the prompt
 * still asks for the gap — this only catches the bars where the asking did not
 * work.
 *
 * U+2009 and not a normal space on purpose: in a flex row a whitespace-only
 * text node is not rendered at all (CSS flexbox drops it), and the model's bars
 * are flex rows. A thin space is not CSS white space, so it becomes a real
 * anonymous flex item with a real width.
 *
 * Bounded and idempotent: at most `GAP_BUDGET` nodes per machine, a pair that
 * already has one of ours between it is skipped, and every node is taken out by
 * `resetFit()` at unmount.
 */
const THIN_SPACE = ' ';
const JAM_PX = 4;
const GAP_BUDGET = 12;
let gapNodes: Text[] = [];

function isOurThin(n: Node | null): boolean {
  return !!n && n.nodeType === 3 && gapNodes.indexOf(n as Text) >= 0;
}

/** Put one thin space between two disjoint elements, at the level they share. */
function insertThin(a: Element, b: Element): boolean {
  let node: Element = b;
  while (node.parentElement && !node.parentElement.contains(a)) node = node.parentElement;
  const parent = node.parentElement;
  if (!parent || node.contains(a)) return false;
  if (isOurThin(node.previousSibling)) return false;
  const text = document.createTextNode(THIN_SPACE);
  parent.insertBefore(text, node);
  gapNodes.push(text);
  fitUndo.push(() => {
    if (text.parentNode) text.parentNode.removeChild(text);
  });
  return true;
}

export function fitBarGaps(): number {
  if (!document.body) return 0;
  let inserted = 0;
  for (const bar of barRoots()) {
    // one pair at a time, re-measured: inserting a space moves everything to
    // the right of it, so a pair that was jammed before may not be after
    for (let pass = 0; pass < 6 && gapNodes.length < GAP_BUDGET; pass++) {
      const pairs = adjacentPairs(textRuns(bar)).filter((p) => p.gap < JAM_PX);
      if (!pairs.length) break;
      const p = pairs[0];
      if (!insertThin(p.a.el, p.b.el)) break;
      inserted++;
      bar.setAttribute('data-os-fit-gap', String((Number(bar.getAttribute('data-os-fit-gap')) || 0) + 1));
      fitUndo.push(() => bar.removeAttribute('data-os-fit-gap'));
    }
  }
  return inserted;
}

/* ------------------------------- the launcher row under an edge bar (§8, KERNEL-9) */

/**
 * HANDOFF-7 §8 — on the phone the desktop's first row of launchers sits UNDER
 * the fixed menu bar and the machine's name is written across the first icon.
 * The model's layout, at a width it has never been asked to think about; the
 * overlap itself is geometry, so the kernel may move the launchers out from
 * under the bar.
 *
 * KERNEL-9 — that shipped as: top padding on `[data-os-desktop]`, for a bar on
 * the TOP edge, ONCE, latched, at desktop time. Every one of those four
 * qualifiers was a hole, and run D of HANDOFF-8 fell through three of them at
 * once: on 2 of 4 real desktops **0 of 16 launchers were reachable at the end
 * of the session**, blocked by the kernel's own `[data-os-fit-bar]` — a bar at
 * the BOTTOM edge that grew DURING the session, long after this guard had
 * latched.
 *
 * So it is now: both edges, every launcher (not just the first), re-run
 * whenever a bar's geometry changes, and verified after the fact — if the
 * launchers are still covered by a bar the kernel GREW, the growth is what
 * goes (see `growBar`). The inset is recomputed from the launchers' own
 * un-inset positions every time, so running it again is idempotent rather than
 * cumulative.
 *
 * Still the least it can do: padding on the model's own launcher area, no
 * colour, no font, nothing moved that the model placed clear of its bars.
 */

/** the model's own padding on the launcher area, read before the kernel writes any */
let deskPad: { el: HTMLElement; top: number; bottom: number } | null = null;
/** what the kernel is currently adding, per edge */
let launcherInset = { top: 0, bottom: 0 };
/** the bar geometry the current inset was computed against */
let barSig = '';

interface EdgeBar {
  el: HTMLElement;
  edge: 'top' | 'bottom';
  top: number;
  bottom: number;
}

/**
 * The out-of-flow bars on the top and bottom edges — the only ones padding can
 * help against, because padding would push an in-flow bar down with the
 * launchers. A narrow floating dock is not an edge bar: it cannot cover a row
 * of launchers, and insetting the whole desktop for it would be the kernel
 * rearranging the machine.
 */
function edgeBars(desk: HTMLElement | null): EdgeBar[] {
  const out: EdgeBar[] = [];
  const els: HTMLElement[] = [];
  const add = (el: HTMLElement) => {
    if (els.indexOf(el) < 0) els.push(el);
  };
  try {
    (Array.from(document.querySelectorAll(BAR_HOOKS)) as HTMLElement[]).forEach(add);
  } catch {}
  barRoots().forEach(add);
  const h = vh();
  const w = vw();
  for (const el of els) {
    if (desk && desk.contains(el)) continue; // padding would move it too
    let pos = '';
    try {
      pos = getComputedStyle(el).position;
    } catch {}
    if (pos !== 'fixed' && pos !== 'sticky') continue;
    const r = rectOf(el);
    if (r.height < 8 || r.height > h * 0.5) continue;
    if (r.width < w * 0.5) continue; // a floating dock is not an edge bar
    if (r.top <= 2) out.push({ el, edge: 'top', top: r.top, bottom: r.bottom });
    else if (r.bottom >= h - 2) out.push({ el, edge: 'bottom', top: r.top, bottom: r.bottom });
  }
  return out;
}

/** Every launcher that has a box, once per app id, in document order. */
function launcherBoxes(): Rect[] {
  const out: Rect[] = [];
  const ids = new Set<string>();
  try {
    document.querySelectorAll('[data-os-app]').forEach((el) => {
      const id = el.getAttribute('data-os-app') || '';
      if (!id || ids.has(id)) return;
      const r = rectOf(el);
      if (!(r.width > 2 && r.height > 2)) return;
      ids.add(id);
      out.push(r);
    });
  } catch {}
  return out;
}

function overlapsBar(box: Rect, bar: Element): boolean {
  const br = rectOf(bar);
  const y = Math.min(box.bottom, br.bottom) - Math.max(box.top, br.top);
  const x = Math.min(box.right, br.right) - Math.max(box.left, br.left);
  return y > 2 && x > 2;
}

/**
 * How tall a bar on `edge` may be before it takes a launcher away.
 *
 * Measured against the bar AS THE MODEL WROTE IT (`origH`), not as the kernel
 * has since grown it: the question is what the repair may cost, and asking it
 * of the grown bar answers itself — every launcher the growth just covered
 * would read as "already under it" and the back-off could never fire.
 *
 * A launcher the MODEL put deep under its own bar is not the kernel's to
 * account for, and a dock that HOLDS the launchers contains every one of them
 * by design. "Deep" is over half the launcher, or 24 px: run D's row clipped
 * the model's own bar by 6 px and is exactly the row that must be protected.
 */
function launcherClearance(bar: HTMLElement, edge: Edge, origH: number): number {
  const br = rectOf(bar);
  const h = vh();
  const band =
    edge === 'bottom' ? { top: Math.max(br.top, h - origH), bottom: br.bottom } : { top: br.top, bottom: Math.min(br.bottom, br.top + origH) };
  let room = Infinity;
  for (const box of launcherBoxes()) {
    const x = Math.min(box.right, br.right) - Math.max(box.left, br.left);
    if (x <= 2) continue; // not in the bar's column at all
    const y = Math.min(box.bottom, band.bottom) - Math.max(box.top, band.top);
    if (y > Math.min(box.height / 2, 24)) continue; // the model's own overlap
    room = Math.min(room, edge === 'bottom' ? h - box.bottom : box.top);
  }
  return room;
}

/** The inset each edge needs, measured with the kernel's own padding taken off. */
function neededInset(desk: HTMLElement, bars: EdgeBar[]): { top: number; bottom: number } {
  const base = deskPad as { el: HTMLElement; top: number; bottom: number };
  // measure the launchers where the MODEL put them: the current inset comes
  // off first, so a second run computes the same answer instead of stacking
  // one on top of the other. Synchronous, so nothing is ever painted like this.
  const had = launcherInset.top || launcherInset.bottom;
  if (had) {
    desk.style.setProperty('padding-top', base.top + 'px');
    desk.style.setProperty('padding-bottom', base.bottom + 'px');
  }
  const boxes = launcherBoxes();
  const h = vh();
  let top = 0;
  let bottom = 0;
  for (const bar of bars) {
    const br = rectOf(bar.el);
    for (const box of boxes) {
      const x = Math.min(box.right, br.right) - Math.max(box.left, br.left);
      if (x <= 2) continue;
      const y = Math.min(box.bottom, br.bottom) - Math.max(box.top, br.top);
      if (y <= 2) continue;
      // the bar's own depth from its edge, which is where the launcher area
      // has to start (or stop): the same reading §8 shipped, at both edges
      if (bar.edge === 'top') top = Math.max(top, Math.round(br.bottom));
      else bottom = Math.max(bottom, Math.round(h - br.top));
    }
  }
  // never give the whole launcher area away: a bar that wants that much is a
  // reading to report, not a repair to make
  const cap = Math.round(h * 0.4);
  return { top: Math.min(top, cap), bottom: Math.min(bottom, cap) };
}

function applyInset(desk: HTMLElement, want: { top: number; bottom: number }): number {
  const base = deskPad as { el: HTMLElement; top: number; bottom: number };
  const edges: ('top' | 'bottom')[] = ['top', 'bottom'];
  for (const edge of edges) {
    const px = edge === 'top' ? want.top : want.bottom;
    const prop = edge === 'top' ? 'padding-top' : 'padding-bottom';
    const attr = edge === 'top' ? 'data-os-fit-launchers' : 'data-os-fit-launchers-bottom';
    const had = edge === 'top' ? launcherInset.top : launcherInset.bottom;
    if (px) {
      setStyleKeep(desk, prop, Math.round((edge === 'top' ? base.top : base.bottom) + px) + 'px');
      desk.setAttribute(attr, String(px));
      fitUndo.push(() => desk.removeAttribute(attr));
    } else if (had) {
      clearStyleKeep(desk, prop);
      desk.removeAttribute(attr);
    }
  }
  launcherInset = { top: want.top, bottom: want.bottom };
  return want.top + want.bottom;
}

export function fitLauncherRow(): number {
  if (!document.body) return 0;
  const desk = document.querySelector('[data-os-desktop]') as HTMLElement | null;
  if (!desk) return 0;
  if (!deskPad || deskPad.el !== desk) {
    let top = 0;
    let bottom = 0;
    try {
      const cs = getComputedStyle(desk);
      top = parseFloat(cs.paddingTop) || 0;
      bottom = parseFloat(cs.paddingBottom) || 0;
    } catch {}
    deskPad = { el: desk, top, bottom };
    launcherInset = { top: 0, bottom: 0 };
    barSig = '';
  }
  let bars = edgeBars(desk);
  // cheap enough to ask on every focus BECAUSE of this: the answer can only
  // change when a bar's own geometry (or the screen) does
  const sig = (list: EdgeBar[]) =>
    list
      .map((b) => b.edge + ':' + Math.round(b.top) + ':' + Math.round(b.bottom))
      .sort()
      .join('|') +
    '@' +
    vw() +
    'x' +
    vh();
  if (sig(bars) === barSig) return 0;
  barSig = sig(bars);
  let applied = applyInset(desk, neededInset(desk, bars));

  /**
   * The verification the old guard had no way to make: the launchers are STILL
   * under a bar, and it is a bar the kernel grew. Then the growth is what goes.
   * Padding can only move launchers the model laid out against the edge it pads
   * — a start-aligned grid does not come up off the bottom — so "I padded the
   * desktop" is not the same claim as "the launchers are reachable", and run D
   * is what the difference cost.
   */
  if (grownBar && grownBar.applied > grownBar.origH) {
    const el = grownBar.el;
    if (launcherBoxes().some((box) => overlapsBar(box, el))) {
      if (shrinkBarTo(launcherClearance(el, grownBar.edge, grownBar.origH))) {
        bars = edgeBars(desk);
        barSig = sig(bars);
        applied = applyInset(desk, neededInset(desk, bars));
      }
      const left = launcherBoxes().filter((box) => overlapsBar(box, el)).length;
      if (left) desk.setAttribute('data-os-fit-launchers-blocked', String(left));
      else desk.removeAttribute('data-os-fit-launchers-blocked');
      fitUndo.push(() => desk.removeAttribute('data-os-fit-launchers-blocked'));
    }
  }
  return applied;
}

/** Any bar, dock, menu bar or clock that the viewport does not contain. */
function clippedBars(sel = '[data-os-taskbar],[data-os-clock]'): HTMLElement[] {
  const w = vw();
  const h = vh();
  return (Array.from(document.querySelectorAll(sel)) as HTMLElement[]).filter((el) => clipped(boxOf(el), w, h));
}

export function fitViewport(): { fitted: boolean; pinned: Edge | null } {
  if (!document.body) return { fitted, pinned: pinnedEdge };
  if (!fitted) {
    if (!clippedBars().length) return { fitted: false, pinned: null };
    for (const el of [document.documentElement, document.body]) {
      setStyle(el, 'height', '100%');
      setStyle(el, 'overflow', 'hidden');
    }
    fitted = true;
    // the clamp changes the layout: whatever was pushed below the fold by a
    // scrollable body is inside the viewport again, and step 2 is for the bars
    // that are not
    document.documentElement.setAttribute('data-os-fit', 'clamped');
  }
  if (!pinnedEdge) {
    const stuck = clippedBars('[data-os-taskbar]')[0];
    if (stuck) {
      const edge = nearestEdge(boxOf(stuck), vw(), vh());
      setStyle(stuck, 'position', 'fixed');
      if (edge === 'top' || edge === 'bottom') {
        setStyle(stuck, 'left', '0');
        setStyle(stuck, 'right', '0');
        setStyle(stuck, edge, '0');
        setStyle(stuck, edge === 'top' ? 'bottom' : 'top', 'auto');
      } else {
        setStyle(stuck, 'top', '0');
        setStyle(stuck, 'bottom', '0');
        setStyle(stuck, edge, '0');
        setStyle(stuck, edge === 'left' ? 'right' : 'left', 'auto');
      }
      stuck.setAttribute('data-os-fit-pinned', edge);
      fitUndo.push(() => stuck.removeAttribute('data-os-fit-pinned'));
      pinnedEdge = edge;
    }
  }
  return { fitted, pinned: pinnedEdge };
}

/**
 * Step 3 — a bar the viewport contains whose CONTENTS it does not.
 *
 * BAKEOFF-4, auto boot 1: `taskbarEdge` said `bottom`, `data-os-fit` never
 * fired, and every open window's entry in the bar was a blank rounded
 * rectangle whose icon and label sat below the bottom of the screen. The bar's
 * own box was inside the viewport; its task entries were taller than the bar
 * and vertically centred on it, so half of each entry hung out the bottom.
 * "The bar is at the right edge" and "the bar is legible" are different claims
 * and only the first was measured or repaired.
 *
 * Geometry, so the kernel's (SPEC §2.2): grow the bar to contain its own
 * children and pin it to its edge. Nothing about colour, font or content is
 * touched and `resetFit()` undoes it at unmount.
 *
 * KERNEL-9 — and the growth is bounded now, because it was not, and that cost
 * run D of HANDOFF-8 every launcher on two of four real desktops. The ruling,
 * in one line: **the bar keeps its shape and its contents live inside it.**
 * `barGrowth` (geometry.ts, unit-tested) allows at most twice the bar's own
 * height, at most a third of the screen, and never past a launcher that is
 * currently clear of it; what the bar cannot gain, its contents give up —
 * `containBarContents` lets the entries shrink and scroll INSIDE the bar
 * rather than letting the bar eat the desktop. The target is recomputed on
 * every call (bounded by `BAR_WRITE_BUDGET`), so a bar that could not grow
 * before the launcher inset moved the launchers can grow after it, and a bar
 * that grew over a launcher can be walked back (see `fitLauncherRow`).
 */
let grownBar: { el: HTMLElement; origH: number; applied: number; edge: Edge } | null = null;
let barWrites = 0;
/** how many times one machine's bar height may be written; the loop is 2 passes */
const BAR_WRITE_BUDGET = 6;

/**
 * What the bar's contents want, in height, and whether any of them is outside
 * the screen. The union of every visible descendant's box with the bar's own.
 */
function barContentNeed(bar: HTMLElement, b: Box): { need: number; outside: boolean } {
  const h = vh();
  const w = vw();
  let lo = b.y;
  let hi = b.y + b.h;
  let outside = false;
  for (const el of Array.from(bar.querySelectorAll('*')) as HTMLElement[]) {
    const r = rectOf(el);
    if (r.width <= 2 || r.height <= 2) continue;
    if (r.bottom > h + 2 || r.top < -2 || r.right > w + 2 || r.left < -2) outside = true;
    lo = Math.min(lo, r.top);
    hi = Math.max(hi, r.bottom);
  }
  return { need: Math.ceil(hi - lo), outside };
}

/**
 * The half of the ruling the bar does not pay for: what will not fit in the
 * bar stays in the bar anyway.
 *
 * The bar's own overflow scrolls (horizontally — the entries are capped
 * vertically, so there is nothing to scroll down to and no scrollbar to draw),
 * a flex bar stops wrapping into new rows, and the KERNEL'S OWN task entries —
 * instances of the model's `template[data-os-task]`, which is what actually
 * overflows a bar — are capped to the bar's inner height. Applied on every
 * pass while the cap is in force, because each open adds another entry.
 */
function containBarContents(bar: HTMLElement): number {
  let padY = 0;
  let disp = '';
  try {
    const cs = getComputedStyle(bar);
    padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    disp = cs.display;
  } catch {}
  const inner = Math.max(8, Math.round((bar.clientHeight || rectOf(bar).height) - padY));
  if (disp.indexOf('flex') >= 0) setStyleKeep(bar, 'flex-wrap', 'nowrap');
  setStyleKeep(bar, 'overflow-x', 'auto');
  setStyleKeep(bar, 'overflow-y', 'hidden');
  bar.setAttribute('data-os-fit-bar-contained', String(inner));
  fitUndo.push(() => bar.removeAttribute('data-os-fit-bar-contained'));
  let capped = 0;
  for (const el of Array.from(bar.querySelectorAll('[data-os-task-for]')) as HTMLElement[]) {
    if (el.getAttribute('data-os-fit-entry') === String(inner)) continue;
    el.setAttribute('data-os-fit-entry', String(inner));
    setStyleKeep(el, 'max-height', inner + 'px');
    setStyleKeep(el, 'overflow', 'hidden');
    fitUndo.push(() => el.removeAttribute('data-os-fit-entry'));
    capped++;
  }
  return capped;
}

/**
 * Write the bar's height: the one place the bar's box is changed, so growing
 * it and walking that growth back are the same code path.
 */
function growBar(): boolean {
  const bar = document.querySelector('[data-os-taskbar]') as HTMLElement | null;
  if (!bar || !document.body) return false;
  if (grownBar && grownBar.el !== bar) return false; // a dead machine's bar
  if (barWrites >= BAR_WRITE_BUDGET) return false;
  const h = vh();
  const w = vw();
  const b = boxOf(bar);
  const origH = grownBar ? grownBar.origH : Math.round(b.h);
  const applied = grownBar ? grownBar.applied : Math.round(b.h);
  const { need, outside } = barContentNeed(bar, b);
  if (!outside && applied <= origH) return false;
  const edge = grownBar ? grownBar.edge : nearestEdge(b, w, h);
  if (edge !== 'top' && edge !== 'bottom') return false;
  const target = barGrowth(origH, Math.max(need, origH), h, launcherClearance(bar, edge, origH));
  const contain = target < need;
  /**
   * Growth only, and never for a pixel. `fitBarContents` is asked on every
   * focus and the answer is a live measurement of the model's own document: a
   * 55 px bar that re-measures as 56 on the next click would resize the bar —
   * and, on a phone, the window that fills the area under it — on every open.
   * Shrinking is a separate, deliberate act with one caller (`shrinkBarTo`,
   * for the launchers).
   */
  if (target < applied + 2) {
    // nothing to write, but a new task entry may still need capping
    if (contain) containBarContents(bar);
    return false;
  }
  barWrites++;
  writeBarHeight(bar, origH, target, edge);
  grownBar = { el: bar, origH, applied: target, edge };
  if (contain) containBarContents(bar);
  return true;
}

function writeBarHeight(bar: HTMLElement, origH: number, target: number, edge: Edge): void {
  if (target > origH) {
    setStyleKeep(bar, 'min-height', target + 'px');
    setStyleKeep(bar, 'box-sizing', 'border-box');
    setStyleKeep(bar, 'position', 'fixed');
    setStyleKeep(bar, 'left', '0');
    setStyleKeep(bar, 'right', '0');
    setStyleKeep(bar, edge, '0');
    setStyleKeep(bar, edge === 'top' ? 'bottom' : 'top', 'auto');
    bar.setAttribute('data-os-fit-bar', String(target));
    fitUndo.push(() => bar.removeAttribute('data-os-fit-bar'));
    return;
  }
  // walked all the way back: the bar exactly as it was before step 3 touched
  // it, `fitViewport`'s own pin included (that is what `keep` recorded)
  for (const prop of ['min-height', 'box-sizing', 'position', 'left', 'right', 'top', 'bottom']) clearStyleKeep(bar, prop);
  bar.removeAttribute('data-os-fit-bar');
}

/**
 * Walk the growth back, because the launchers are worth more than the entries.
 *
 * The only caller is `fitLauncherRow`, and only after its own inset has failed
 * to move the launchers out from under a bar the kernel grew: padding can move
 * launchers the model laid out against the edge it pads, and a start-aligned
 * grid does not come up off the bottom. `maxH` is the tallest the bar can be
 * and still leave those launchers alone; the model's own height is the floor,
 * because shrinking the bar the model wrote is not a repair.
 */
function shrinkBarTo(maxH: number): boolean {
  if (!grownBar) return false;
  const { el, origH, applied, edge } = grownBar;
  if (barWrites >= BAR_WRITE_BUDGET) return false;
  const target = Math.max(origH, Math.min(applied, Math.floor(maxH)));
  if (!(target < applied)) return false;
  barWrites++;
  writeBarHeight(el, origH, target, edge);
  grownBar = { el, origH, applied: target, edge };
  // what the bar has given back, its contents take on
  containBarContents(el);
  return true;
}

export function fitBarContents(): boolean {
  return growBar();
}

/** Undo every fit repair. Part of unmount: the next machine starts clean. */
export function resetFit(): void {
  for (const undo of fitUndo.splice(0).reverse()) {
    try {
      undo();
    } catch {}
  }
  fitted = false;
  pinnedEdge = null;
  // R3/R2/§8 — the spacing net's nodes and the adopted clock's attribute are
  // already in `fitUndo` (they are geometry repairs, and this is where geometry
  // repairs are taken back); what is left is the bookkeeping.
  gapNodes = [];
  styledOnce.length = 0;
  grownBar = null;
  barWrites = 0;
  deskPad = null;
  launcherInset = { top: 0, bottom: 0 };
  barSig = '';
  stopClockCheck();
  document.documentElement.removeAttribute('data-os-fit');
}

function hallucinateImages(root: ParentNode): void {
  const imgs = Array.from(root.querySelectorAll('img'));
  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    if (/^data:/i.test(src)) continue;
    // a declared image slot is waiting for the kernel's own data: URI
    // (SPEC §12.5): replacing it with an alt-text box deletes the slot
    if (img.hasAttribute('data-os-img') || img.hasAttribute('data-os-icon')) continue;
    const alt = img.getAttribute('alt') || 'an image that does not exist';
    const box = document.createElement('span');
    box.setAttribute('data-os-hallucinated-image', '');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', alt);
    box.style.cssText =
      'display:inline-flex;align-items:center;justify-content:center;text-align:center;border:1px dashed currentColor;' +
      'opacity:.75;padding:6px;font:12px/1.3 ui-monospace,monospace;min-width:40px;min-height:30px;overflow:hidden;' +
      (img.getAttribute('style') || '');
    box.textContent = alt;
    img.replaceWith(box);
  }
}

export function mountDesktop(html: string, host: HTMLElement = document.body): Mounted {
  const parsed = new DOMParser().parseFromString(html, 'text/html');

  // nothing generated ever reaches the network, and nothing generated navigates
  // the top document off-site: meta[http-equiv=refresh] survives importNode and
  // is honoured, which is the one markup path out of the sandbox (the page CSP
  // stops fetches but does not restrict top-level navigation).
  parsed.querySelectorAll('link,base,iframe[src],object,embed,meta[http-equiv],meta[name="referrer"]').forEach((el) => el.remove());
  parsed.querySelectorAll('script[src]').forEach((el) => el.remove());
  hallucinateImages(parsed);

  const styles: HTMLElement[] = [];
  parsed.querySelectorAll('style').forEach((st) => {
    const clone = document.importNode(st, true) as HTMLElement;
    clone.setAttribute(MARK, '');
    document.head.appendChild(clone);
    styles.push(clone);
  });

  const bodyAttrs: { name: string; prev: string | null }[] = [];
  for (const attr of Array.from(parsed.body.attributes)) {
    if (attr.name === 'style' || attr.name === 'class' || attr.name.startsWith('data-')) {
      bodyAttrs.push({ name: attr.name, prev: document.body.getAttribute(attr.name) });
      const prev = document.body.getAttribute(attr.name);
      document.body.setAttribute(attr.name, attr.name === 'style' && prev ? prev + ';' + attr.value : attr.value);
    }
  }
  // I5 allows [data-os-archetype] on <html> as well as <body>, and the text
  // validator accepts it there — so the mount has to carry <html>'s own
  // data-*/class/style across, or the live-DOM check disagrees with the
  // validator and patches a hook the model actually sent.
  const htmlAttrs: { name: string; prev: string | null }[] = [];
  for (const attr of Array.from(parsed.documentElement.attributes)) {
    if (attr.name === 'style' || attr.name === 'class' || attr.name.startsWith('data-')) {
      const prev = document.documentElement.getAttribute(attr.name);
      /**
       * Never let a generated document write the kernel's own state flags —
       * unconditionally, not only where one is already set. These are readings
       * a harness and a bake-off report trust (`data-os-fit` says the kernel
       * repaired this desktop's geometry; `data-os-boot-ink` says whether the
       * visitor saw anything), and a machine that declared one on `<html>`
       * would be forging them. `data-os-archetype` is deliberately NOT in this
       * list: that one is the model's to declare (I5).
       */
      if (/^data-os-(ready|contract|contract-patch|chrome-template|desktop-ms|archetype-patched|fit|boot-ink|boot-hold-ms|revealed-ms|launchers-offscreen)$/.test(attr.name))
        continue;
      htmlAttrs.push({ name: attr.name, prev });
      document.documentElement.setAttribute(
        attr.name,
        attr.name === 'style' && prev ? prev + ';' + attr.value : attr.value
      );
    }
  }

  const nodes: Node[] = [];
  for (const child of Array.from(parsed.body.childNodes)) {
    const node = document.importNode(child, true);
    host.appendChild(node);
    nodes.push(node);
  }

  // re-create scripts so the desktop's clocks and animations actually run
  for (const node of nodes) {
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const scripts: HTMLScriptElement[] = [];
    if (el.tagName === 'SCRIPT') scripts.push(el as HTMLScriptElement);
    el.querySelectorAll?.('script').forEach((s) => scripts.push(s as HTMLScriptElement));
    for (const s of scripts) {
      const fresh = document.createElement('script');
      fresh.setAttribute(MARK, '');
      fresh.textContent = s.textContent || '';
      s.replaceWith(fresh);
    }
  }

  return { nodes, styles, bodyAttrs, htmlAttrs };
}

export function unmount(m: Mounted | null): void {
  // the fallbacks go whether or not there is a mount record: they were appended
  // to document.body, not to the mounted tree
  removeInjected();
  resetFit();
  // the unreadable-box count belongs to one machine, like every other reading
  resetMeasureFailures();
  if (!m) return;
  for (const n of m.nodes) if (n.parentNode) n.parentNode.removeChild(n);
  for (const s of m.styles) if (s.parentNode) s.parentNode.removeChild(s);
  for (const a of m.bodyAttrs) {
    if (a.prev === null) document.body.removeAttribute(a.name);
    else document.body.setAttribute(a.name, a.prev);
  }
  for (const a of m.htmlAttrs || []) {
    if (a.prev === null) document.documentElement.removeAttribute(a.name);
    else document.documentElement.setAttribute(a.name, a.prev);
  }
  m.nodes = [];
  m.styles = [];
  m.bodyAttrs = [];
  m.htmlAttrs = [];
}

/**
 * Last resort after the repair pass: put the missing pieces in as bare, unstyled
 * elements. Records contract_ok=false; the OS still works, it just looks like the
 * model forgot something, which it did.
 */
export interface LauncherSpec {
  id: string;
  /** the model's own name for the app; the raw id only when it never gave one */
  label: string;
}

/**
 * Every hook the live document is missing, read from the DOM rather than from
 * the response text. This is what decides what gets injected: a string
 * validator that says "present" can still be wrong (a selector inside a
 * stylesheet, a mention in a comment), and being wrong here means the OS boots
 * without a window layer.
 */
export function domMissing(apps: LauncherSpec[], archetype?: string): string[] {
  const missing: string[] = [];
  const q = (sel: string) => document.querySelector(sel);
  for (const a of ['data-os-desktop', 'data-os-windows', 'data-os-taskbar']) {
    if (!q(`[${a}]`)) missing.push(`[${a}]`);
  }
  // SPEC §12.3 / I5: the archetype must be declared and must be the one the
  // identity picked, and the clock must exist. Both are patched in place below,
  // never regenerated.
  if (!q('[data-os-clock]')) missing.push('[data-os-clock]');
  if (archetype) {
    const decl = (document.documentElement.getAttribute('data-os-archetype') || document.body.getAttribute('data-os-archetype') || '')
      .trim()
      .toLowerCase();
    if (decl !== archetype) missing.push(`[data-os-archetype="${archetype}"]`);
  }
  const win = q('template[data-os-window]') as HTMLTemplateElement | null;
  if (!win) missing.push('template[data-os-window]');
  else {
    for (const a of ['data-os-title', 'data-os-content', 'data-os-close', 'data-os-drag']) {
      if (!win.content.querySelector(`[${a}]`)) missing.push(`template[data-os-window] [${a}]`);
    }
  }
  const task = q('template[data-os-task]') as HTMLTemplateElement | null;
  if (!task) missing.push('template[data-os-task]');
  else if (!task.content.querySelector('[data-os-title]')) missing.push('template[data-os-task] [data-os-title]');
  for (const a of apps) {
    if (!q(`[data-os-app="${cssEscape(a.id)}"]`)) missing.push(`[data-os-app="${a.id}"]`);
  }
  return missing;
}

export function injectMissing(missing: string[], apps: LauncherSpec[]): string[] {
  const injected: string[] = [];
  const q = (sel: string) => document.querySelector(sel);

  const need = (sel: string) => missing.some((m) => m === sel);

  // archetype + clock (SPEC §12.3): patched onto the live document. Nothing is
  // regenerated for these — the desktop on screen stays the desktop on screen.
  for (const m of missing) {
    const am = /^\[data-os-archetype="([a-z]+)"\]$/.exec(m);
    if (am) {
      document.documentElement.setAttribute('data-os-archetype', am[1]);
      document.documentElement.setAttribute('data-os-archetype-patched', '');
      injected.push(m);
    }
  }
  if (need('[data-os-desktop]') && !q('[data-os-desktop]')) {
    const el = document.createElement('div');
    el.setAttribute('data-os-desktop', '');
    el.setAttribute('data-os-injected', '');
    document.body.appendChild(trackInjected(el));
    injected.push('[data-os-desktop]');
  }
  if (need('[data-os-windows]') && !q('[data-os-windows]')) {
    const el = document.createElement('div');
    el.setAttribute('data-os-windows', '');
    el.setAttribute('data-os-injected', '');
    el.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0';
    document.body.appendChild(trackInjected(el));
    injected.push('[data-os-windows]');
  }
  if (need('[data-os-taskbar]') && !q('[data-os-taskbar]')) {
    const el = document.createElement('div');
    el.setAttribute('data-os-taskbar', '');
    el.setAttribute('data-os-injected', '');
    document.body.appendChild(trackInjected(el));
    injected.push('[data-os-taskbar]');
  }

  const winTpl = q('template[data-os-window]') as HTMLTemplateElement | null;
  if (!winTpl) {
    const tpl = document.createElement('template');
    tpl.setAttribute('data-os-window', '');
    tpl.setAttribute('data-os-injected', '');
    // bare and unstyled (SPEC §3.2): geometry only, no colours — the look of
    // this machine is the model's even when the model forgot to send one.
    tpl.innerHTML =
      '<div style="position:absolute;display:flex;flex-direction:column;overflow:hidden">' +
      '<div data-os-drag style="display:flex;gap:6px;padding:4px"><span data-os-title></span><span style="flex:1"></span>' +
      '<button data-os-minimize>_</button><button data-os-close>x</button></div>' +
      '<div data-os-content style="flex:1;position:relative"></div></div>';
    document.body.appendChild(trackInjected(tpl));
    injected.push('template[data-os-window]');
  } else {
    const root = winTpl.content.firstElementChild || winTpl.content.appendChild(document.createElement('div'));
    /**
     * HANDOFF-7 — where a missing control goes.
     *
     * This used to append every patched hook to the template's ROOT, i.e. after
     * `[data-os-content]`: a window whose model wrote a perfectly good title bar
     * and forgot `[data-os-close]` got its close button at the BOTTOM of the
     * window, under the app's own content. Measured on 2 of 8 live boots of
     * v0.5 (`why: close-covered` on every window of both) — and T4 then built a
     * whole bare strip on top of a bar that only ever needed one button in it.
     *
     * A title, a close, a minimise and a maximise belong in the title bar, and
     * the template says where that is: `[data-os-drag]`. Placing them there is
     * the same class of act as the rest of this function (the contract's own
     * hook, bare and unstyled, in the place the contract describes), and it
     * costs the visitor one usable bar instead of two.
     */
    const bar = () => {
      const d = winTpl.content.querySelector('[data-os-drag]') as HTMLElement | null;
      return d && d !== root && !d.hasAttribute('data-os-content') ? d : root;
    };
    const add = (attr: string, tag = 'div', text = '') => {
      if (winTpl.content.querySelector(`[${attr}]`)) return;
      const el = document.createElement(tag);
      el.setAttribute(attr, '');
      el.setAttribute('data-os-injected', '');
      if (text) el.textContent = text;
      // a control goes in the bar; a content area is the window's body
      (attr === 'data-os-content' ? root : bar()).appendChild(el);
      injected.push(`template[data-os-window] [${attr}]`);
    };
    // the bar first, so a title and a close patched after it land INSIDE it
    if (need('template[data-os-window] [data-os-drag]')) add('data-os-drag', 'div', '::');
    if (need('template[data-os-window] [data-os-title]')) add('data-os-title', 'span');
    if (need('template[data-os-window] [data-os-close]')) add('data-os-close', 'button', 'x');
    if (need('template[data-os-window] [data-os-content]')) {
      if (!winTpl.content.querySelector('[data-os-content]')) {
        const el = document.createElement('div');
        el.setAttribute('data-os-content', '');
        el.setAttribute('data-os-injected', '');
        el.style.cssText = 'flex:1;position:relative;min-height:200px';
        root.appendChild(el);
        injected.push('template[data-os-window] [data-os-content]');
      }
    }
  }

  const taskTpl = q('template[data-os-task]') as HTMLTemplateElement | null;
  if (!taskTpl) {
    const tpl = document.createElement('template');
    tpl.setAttribute('data-os-task', '');
    tpl.setAttribute('data-os-injected', '');
    tpl.innerHTML = '<button><span data-os-title></span></button>';
    document.body.appendChild(trackInjected(tpl));
    injected.push('template[data-os-task]');
  } else if (!taskTpl.content.querySelector('[data-os-title]')) {
    const el = document.createElement('span');
    el.setAttribute('data-os-title', '');
    el.setAttribute('data-os-injected', '');
    (taskTpl.content.firstElementChild || taskTpl.content).appendChild(el);
    injected.push('template[data-os-task] [data-os-title]');
  }

  /**
   * The clock comes LAST. §12.3 wants it in the bar, and startFallbackClock
   * parents it to `[data-os-taskbar]` — so on a desktop missing both hooks
   * (MOCK_BREAK=desktop-always is exactly that) patching it before the taskbar
   * block above dropped it onto the wallpaper instead of into the bar that was
   * created three lines later.
   */
  if (need('[data-os-clock]') && !q('[data-os-clock]')) {
    injected.push(startFallbackClock());
  }

  const desk = q('[data-os-desktop]') || document.body;
  for (const { id, label: name } of apps) {
    if (document.querySelector(`[data-os-app="${cssEscape(id)}"]`)) continue;
    const text = name || id;
    const existing = document.querySelector('[data-os-app]');
    let el: Element;
    if (existing) {
      el = existing.cloneNode(true) as Element;
      const label = el.querySelector('[data-os-label]') || el;
      if (label.children.length === 0) label.textContent = text;
      else {
        const spans = Array.from(el.querySelectorAll('span')).filter((s) => !s.hasAttribute('data-os-icon'));
        if (spans.length) spans[spans.length - 1].textContent = text;
        else el.appendChild(document.createTextNode(' ' + text));
      }
    } else {
      el = document.createElement('button');
      el.textContent = text;
    }
    el.setAttribute('data-os-app', id);
    el.setAttribute('data-os-injected', '');
    desk.appendChild(trackInjected(el));
    injected.push(`[data-os-app="${id}"]`);
  }

  return injected;
}

/**
 * The clock the model forgot (SPEC §12.3 requires a ticking clock and a visible
 * date). Bare and unstyled, in the taskbar/dock if there is one — a dead clock
 * would be worse than no clock, so this one ticks.
 */
let clockTimer = 0;
function startFallbackClock(): string {
  const el = document.createElement('span');
  el.setAttribute('data-os-clock', '');
  el.setAttribute('data-os-injected', '');
  el.style.cssText = 'margin-left:auto;padding:0 8px;font:inherit';
  const host = (document.querySelector('[data-os-taskbar]') || document.querySelector('[data-os-desktop]') || document.body) as HTMLElement;
  host.appendChild(trackInjected(el));
  const tick = () => {
    const d = new Date();
    el.textContent = d.toLocaleTimeString() + ' · ' + d.toLocaleDateString();
  };
  tick();
  if (clockTimer) window.clearInterval(clockTimer);
  clockTimer = window.setInterval(tick, 1000);
  return '[data-os-clock]';
}

export function stopFallbackClock(): void {
  if (clockTimer) window.clearInterval(clockTimer);
  clockTimer = 0;
  // R2 — and the adopted clock's tick sample, which belongs to the same machine
  stopClockCheck();
}

export function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

/** The windows layer must be a positioning context for absolute children. */
export function ensurePositioned(el: HTMLElement): void {
  const pos = getComputedStyle(el).position;
  if (pos === 'static' || !pos) el.style.position = 'relative';
}
