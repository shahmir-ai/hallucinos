import { describe, it, expect } from 'vitest';
import {
  cascade,
  clampDrag,
  clampInside,
  fullSize,
  isMobile,
  raise,
  titleVisible,
  barGrowth,
  BAR_GROW_SLACK,
  CASCADE_STEP,
  CASCADE_WRAP,
  DEFAULT_W,
  DEFAULT_H,
  MOBILE_BREAKPOINT,
  TITLE_STRIP,
  type Area,
} from '../kernel/geometry.js';

/** A full-viewport windows layer, which is what most desktops send. */
const full: Area = { x: 0, y: 0, w: 1440, h: 900 };
/** A layer inset by a menu bar and cut short by a dock, which is the dock archetype. */
const inset: Area = { x: 0, y: 28, w: 1440, h: 800 };

describe('geometry', () => {
  it('cascades each new window down and right by a whole title bar', () => {
    const a = cascade(0, full, 1440);
    const b = cascade(1, full, 1440);
    expect(b.x - a.x).toBe(CASCADE_STEP);
    expect(b.y - a.y).toBe(CASCADE_STEP);
    // §12.3 legibility: one step has to clear a title bar, or two windows'
    // titles are written across each other
    expect(CASCADE_STEP).toBeGreaterThanOrEqual(36);
  });

  it('wraps after six instead of marching off screen', () => {
    expect(CASCADE_WRAP).toBe(6);
    expect(cascade(CASCADE_WRAP, full, 1440)).toEqual(cascade(0, full, 1440));
    for (let i = 0; i < 40; i++) {
      const box = cascade(i, full, 1440);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(1440);
      expect(box.y + box.h).toBeLessThanOrEqual(900);
    }
  });

  it('sizes a window against the windows layer, not the screen', () => {
    const a = cascade(0, inset, 1440);
    expect(a.w).toBe(Math.round(inset.w * DEFAULT_W));
    expect(a.h).toBe(Math.round(inset.h * DEFAULT_H));
    // and it lives inside the layer: never over the model's menu bar
    expect(a.y).toBeGreaterThanOrEqual(inset.y);
    for (let i = 0; i < 20; i++) {
      const box = cascade(i, inset, 1440);
      expect(box.y).toBeGreaterThanOrEqual(inset.y);
      expect(box.y + box.h).toBeLessThanOrEqual(inset.y + inset.h);
      expect(box.x + box.w).toBeLessThanOrEqual(inset.x + inset.w);
    }
  });

  it('keeps a new window wholly inside a small layer', () => {
    const small: Area = { x: 0, y: 0, w: 520, h: 380 };
    for (let i = 0; i < 12; i++) {
      const box = cascade(i, small, 1024);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(small.w);
      expect(box.y + box.h).toBeLessThanOrEqual(small.h);
    }
  });

  it('makes every window full size under the mobile breakpoint', () => {
    expect(isMobile(MOBILE_BREAKPOINT)).toBe(false);
    expect(isMobile(MOBILE_BREAKPOINT - 1)).toBe(true);
    const area: Area = { x: 0, y: 0, w: 390, h: 780 };
    expect(cascade(3, area, 390)).toEqual(fullSize(area));
    expect(cascade(3, area, 390)).toEqual({ x: 0, y: 0, w: 390, h: 780 });
    // full size means the layer, so a dock archetype keeps its own chrome
    expect(fullSize(inset)).toEqual({ x: 0, y: 28, w: 1440, h: 800 });
  });

  it('keeps the whole title bar on screen when dragged', () => {
    const box = { x: 0, y: 0, w: 400, h: 300 };
    const far = clampDrag({ ...box, x: -5000, y: -5000 }, full);
    expect(far.x).toBe(0);
    expect(far.y).toBe(0);
    const near = clampDrag({ ...box, x: 99999, y: 99999 }, full);
    expect(near.x).toBe(1440 - 400);
    expect(near.y).toBe(900 - TITLE_STRIP);
    // inside an inset layer the near edge is the layer's, not the screen's
    expect(clampDrag({ ...box, x: -20, y: -20 }, inset).y).toBe(28);
  });

  it('lets a window wider than the layer overhang the far edge only', () => {
    const wide = { x: 0, y: 0, w: 2000, h: 300 };
    expect(clampDrag({ ...wide, x: 500 }, full).x).toBe(0);
    expect(clampDrag({ ...wide, x: -5000 }, full).x).toBe(1440 - 2000);
  });

  it('knows when a focused window s title is not fully visible', () => {
    expect(titleVisible({ x: 10, y: 10, w: 400, h: 300 }, full)).toBe(true);
    expect(titleVisible({ x: -10, y: 10, w: 400, h: 300 }, full)).toBe(false);
    expect(titleVisible({ x: 10, y: -1, w: 400, h: 300 }, full)).toBe(false);
    expect(titleVisible({ x: 10, y: 890, w: 400, h: 300 }, full)).toBe(false);
    expect(titleVisible({ x: 1100, y: 10, w: 400, h: 300 }, full)).toBe(false);
    // inside an inset layer, a window at the screen top is above the layer
    expect(titleVisible({ x: 10, y: 0, w: 400, h: 300 }, inset)).toBe(false);
  });

  it('clamps a box inside an area without resizing it', () => {
    const box = clampInside({ x: 1400, y: 880, w: 400, h: 300 }, full);
    expect(box).toEqual({ x: 1040, y: 600, w: 400, h: 300 });
  });

  /**
   * KERNEL-9 — the bound the kernel's bar repair shipped without.
   *
   * HANDOFF-8 §8 item 1: a 38 px bar carrying eight task entries grew over the
   * row of launchers above it and 0 of 16 launchers were reachable at the end
   * of the session, on 2 of 4 real desktops. The repair may not cost a
   * launcher, and a bar that wants a third of the screen is not a bar.
   */
  describe('barGrowth (KERNEL-9)', () => {
    it('grows a bar to hold contents that are taller than it', () => {
      // BAKEOFF-4's live case: a 34 px bar with 70 px task entries
      expect(barGrowth(34, 70, 860)).toBe(70);
    });

    it('never grows past twice its own height (or one strip of chrome more)', () => {
      // a wrapping bar wants three rows of 70 px; it gets a strip, not a third
      // of the desktop
      expect(barGrowth(38, 210, 900)).toBe(38 + BAR_GROW_SLACK);
      expect(barGrowth(60, 400, 900)).toBe(120);
    });

    it('never grows past a third of the screen', () => {
      expect(barGrowth(200, 600, 900)).toBeLessThanOrEqual(300);
      // and a bar already taller than that is left exactly as the model wrote it
      expect(barGrowth(400, 600, 900)).toBe(400);
    });

    it('never grows over a launcher that is clear of it — run D s defect', () => {
      // 38 px bar, entries want 70, and the launcher row ends 32 px above the
      // bottom edge: the growth is refused rather than taking the row away
      expect(barGrowth(38, 70, 900, 32)).toBe(38);
      // once the launcher inset has moved the row up, the same call grows
      expect(barGrowth(38, 70, 900, 70)).toBe(70);
      // and a clearance larger than what is needed changes nothing
      expect(barGrowth(38, 70, 900, 400)).toBe(70);
    });

    it('is a no-op when the contents already fit, and never shrinks the bar', () => {
      expect(barGrowth(40, 40, 900)).toBe(40);
      expect(barGrowth(40, 10, 900)).toBe(40);
      expect(barGrowth(40, 70, 900, 0)).toBe(40);
    });
  });

  it('raises only the focused window', () => {
    expect(raise([1, 2, 3], 0)).toEqual([4, 2, 3]);
    expect(raise([1, 2, 3], 2)).toEqual([1, 2, 3].map((z, i) => (i === 2 ? 4 : z)));
  });
});
