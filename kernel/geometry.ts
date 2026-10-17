/** Window geometry (SPEC §2.2). Pure functions so the rules are unit-testable. */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The region of `[data-os-windows]` a window may occupy, in coordinates
 * relative to that layer (which is what the kernel writes into `style.left/top`).
 *
 * It is NOT the viewport. The model's layer can be inset by a menu bar, cut
 * short by a dock, or taller than the screen; placing against the viewport put
 * windows under the model's own chrome and, on a layer that overflowed the fold,
 * off screen entirely. `x`/`y` are the top-left of the *visible* part of the
 * layer, `w`/`h` its size.
 */
export type Area = Box;

export const MOBILE_BREAKPOINT = 768;

export function isMobile(viewportW: number): boolean {
  return viewportW < MOBILE_BREAKPOINT;
}

/** Below the breakpoint every window fills the area it lives in and cannot be dragged. */
export function fullSize(area: Area): Box {
  return { x: area.x, y: area.y, w: area.w, h: area.h };
}

/**
 * The cascade step, down AND right.
 *
 * 36 px, not 28: a window title bar is 28-34 px tall in every desktop the
 * bake-off produced, so a 28 px step laid the second window's title text across
 * the first one's and neither could be read (BAKEOFF-2 / §12.3 legibility). One
 * step must clear a whole title bar.
 */
export const CASCADE_STEP = 36;

/**
 * How many windows the cascade walks before starting again at the top-left.
 * Six, not eight: at 36 px a step, eight would push the eighth window 252 px
 * into the layer and, on a 62%-wide default, into the clamp on every laptop.
 */
export const CASCADE_WRAP = 6;

/** Default window size, as a fraction of the windows layer (not of the screen). */
export const DEFAULT_W = 0.62;
export const DEFAULT_H = 0.68;

/** The title bar strip the kernel guarantees stays visible and legible. */
export const TITLE_STRIP = 34;

/**
 * Cascade placement inside `area`: each new window steps down-right, wrapping
 * after CASCADE_WRAP so a long session never marches off screen. The result is
 * always wholly inside `area` — SPEC §12.3 wants everything reachable without
 * scrolling, and a window whose close button is past the edge is not.
 */
export function cascade(index: number, area: Area, viewportW: number, want?: { w?: number; h?: number }): Box {
  if (isMobile(viewportW)) return fullSize(area);
  const w = Math.min(want?.w ?? Math.round(area.w * DEFAULT_W), Math.max(280, area.w - 16));
  const h = Math.min(want?.h ?? Math.round(area.h * DEFAULT_H), Math.max(200, area.h - 16));
  const step = ((index % CASCADE_WRAP) + CASCADE_WRAP) % CASCADE_WRAP;
  const x = area.x + 24 + step * CASCADE_STEP;
  const y = area.y + 20 + step * CASCADE_STEP;
  return clampInside({ x, y, w, h }, area);
}

/** Push a box wholly inside `area` (shrinking nothing; it is already sized to fit). */
export function clampInside(box: Box, area: Area): Box {
  const x = Math.round(Math.min(Math.max(box.x, area.x), Math.max(area.x, area.x + area.w - box.w)));
  const y = Math.round(Math.min(Math.max(box.y, area.y), Math.max(area.y, area.y + area.h - box.h)));
  return { ...box, x, y };
}

/**
 * The rule a dragged window obeys: its whole title bar stays inside the visible
 * area. Dragging a window's title text off the left edge or under the bottom
 * edge loses the one control surface every window has (SPEC §2.2 gives the
 * kernel geometry; a title bar you cannot reach is a geometry bug).
 *
 * A window wider or taller than the area may still overhang the far edge — it
 * has to — but never the near one.
 */
export function clampDrag(box: Box, area: Area, titleH = TITLE_STRIP): Box {
  const strip = Math.max(8, Math.min(titleH, box.h));
  const minX = box.w <= area.w ? area.x : area.x + area.w - box.w;
  const maxX = box.w <= area.w ? area.x + area.w - box.w : area.x;
  return {
    ...box,
    x: Math.round(Math.min(Math.max(box.x, minX), Math.max(minX, maxX))),
    y: Math.round(Math.min(Math.max(box.y, area.y), Math.max(area.y, area.y + area.h - strip))),
  };
}

/**
 * True when the whole title strip of `box` is inside `area`. The focused
 * window's title has to be readable in full (that is how you know which machine
 * you are looking at), so the window manager re-checks this on every focus.
 */
export function titleVisible(box: Box, area: Area, titleH = TITLE_STRIP): boolean {
  const strip = Math.max(8, Math.min(titleH, box.h));
  if (box.y < area.y || box.y + strip > area.y + area.h) return false;
  if (box.x < area.x) return false;
  return box.w <= area.w ? box.x + box.w <= area.x + area.w : true;
}

/** z-order: focusing a window puts it on top; the rest keep their relative order. */
export function raise(zs: number[], index: number): number[] {
  const max = zs.length ? Math.max(...zs) : 0;
  return zs.map((z, i) => (i === index ? max + 1 : z));
}

/* ------------------------------------------------- viewport fit (the bar guard) */

export type Edge = 'top' | 'bottom' | 'left' | 'right';

/**
 * Does a viewport-space box stick out of a `vw x vh` viewport?
 *
 * The desktop is the model's document and it can be taller than the screen: a
 * body with a `min-height`, a launcher grid that grew past the fold, a bar
 * placed at the end of the flow rather than fixed to an edge. The page's own
 * stylesheet says `html,body{height:100%;overflow:hidden}`, but the desktop's
 * styles are appended after it and win — so the bar ends up below the fold in a
 * document nobody can scroll, which is a taskbar that does not exist.
 *
 * `slack` is 2 px: a bar sitting exactly on an edge, or a sub-pixel rounding of
 * one, is not clipped.
 */
export function clipped(box: Box, vw: number, vh: number, slack = 2): boolean {
  if (box.w < 1 && box.h < 1) return false; // not rendered; not our business
  return box.x < -slack || box.y < -slack || box.x + box.w > vw + slack || box.y + box.h > vh + slack;
}

/**
 * The viewport edge a bar belongs to: along its short axis, whichever half of
 * the screen its centre is in. A wide, short bar is pinned to the top or the
 * bottom; a tall, narrow one (a side dock) to the left or the right. The
 * archetype in SPEC §12.3 allows any of the four, so this reads the model's
 * intent off the geometry rather than assuming Windows.
 */
export function nearestEdge(box: Box, vw: number, vh: number): Edge {
  if (box.w >= box.h) return box.y + box.h / 2 <= vh / 2 ? 'top' : 'bottom';
  return box.x + box.w / 2 <= vw / 2 ? 'left' : 'right';
}

/**
 * KERNEL-9 — how tall the kernel may make a bar whose own contents overflow it.
 *
 * `fitBarContents` shipped with one bound: never more than a third of the
 * screen. That was not enough. Run D of HANDOFF-8 lost **0 of 16 launchers** on
 * two of four real desktops, and the blocker was the kernel's own repair: a
 * 38 px bar carrying eight task entries grew to 70 px, the extra 32 px came out
 * of the row of launchers sitting immediately above it, and nothing re-checked
 * them. A bar repair that eats the launcher grid costs more than the entries it
 * makes legible.
 *
 * Three bounds, all of them geometry:
 *
 *  - **twice its own height** (or one strip of chrome more, whichever is
 *    larger, so BAKEOFF-4's 34 px bar can still grow to hold a 70 px entry).
 *    A bar is a strip; a bar that wants a third of the screen is a mistake, and
 *    what a bar cannot gain its contents give up (they scroll inside it).
 *  - **a third of the screen**, as before.
 *  - **`clearance`** — the room between the bar's edge and the nearest launcher
 *    that is currently clear of it, `Infinity` when nothing is in the way. This
 *    is the bound run D needed.
 *
 * Never below `origH`: shrinking the model's own bar is not a repair.
 */
export const BAR_GROW_SLACK = 48;

export function barGrowth(origH: number, need: number, vh: number, clearance = Infinity): number {
  const base = Math.max(0, Math.round(origH));
  const ceiling = Math.min(Math.max(base * 2, base + BAR_GROW_SLACK), Math.floor(vh / 3));
  const room = Math.max(base, Math.min(ceiling, Math.floor(clearance)));
  return Math.max(base, Math.min(Math.round(need), room));
}

/**
 * Do two title strips collide? (SEAM H4.)
 *
 * The focused window is raised above every other one, so nothing can paint over
 * its title bar — but two title bars in the SAME PLACE are still two illegible
 * title bars: you cannot tell which window you are looking at, and the harness
 * photographs whichever is on top (HANDOFF-4 issue 8). The cascade wraps after
 * CASCADE_WRAP windows, so the seventh window lands exactly on the first; that
 * is the case this exists for.
 *
 * A cascade overlap is NOT a collision. One 36 px step under a 46 px title bar
 * (what the mock's own window chrome measures) leaves ten pixels of one bar
 * under the edge of the next, and both titles are perfectly readable — that is
 * what a cascade looks like on every desktop ever made. So the rule is
 * proportional: the strips have to cover at least half of the shorter one, and
 * at least 12 px, before anything is moved. Nudging for ten pixels would turn
 * every second window into a double step and march the sixth into the corner.
 */
export function stripsCollide(a: Box, b: Box, minW = 24): boolean {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  if (w < minW) return false;
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return h >= Math.max(12, Math.round(Math.min(a.h, b.h) * 0.5));
}
