import { test, expect, type Page } from '@playwright/test';
import { boot, openApp, MAIN } from './helpers.js';
import { CASCADE_STEP, CASCADE_WRAP, DEFAULT_W, DEFAULT_H } from '../kernel/geometry.js';

/**
 * Window-manager legibility (SPEC §2.2 gives the kernel geometry, §12.3 wants a
 * desktop that reads as a desktop).
 *
 * What BAKEOFF-2 and the v0.1 shots showed: windows stepped 28 px, which is less
 * than a title bar, so the second window's title text was written across the
 * first one's and neither could be read; and the default size and the maximize
 * were measured against the viewport rather than against the model's own
 * `[data-os-windows]` layer.
 */
interface Rect {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  titleTop: number;
  titleBottom: number;
  titleLeft: number;
  titleRight: number;
  textTop: number;
  textBottom: number;
}

async function rects(page: Page): Promise<Rect[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-os-window-id]')).map((el) => {
      const r = el.getBoundingClientRect();
      const bar = (el.querySelector('[data-os-drag]') || el.querySelector('[data-os-title]') || el) as HTMLElement;
      const b = bar.getBoundingClientRect();
      const t = el.querySelector('[data-os-title]') as HTMLElement | null;
      return {
        id: el.getAttribute('data-os-window-id') || '',
        title: (t?.textContent || '').trim(),
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
        titleTop: Math.round(b.top),
        titleBottom: Math.round(b.bottom),
        titleLeft: Math.round(b.left),
        titleRight: Math.round(b.right),
        textTop: Math.round((t || bar).getBoundingClientRect().top),
        textBottom: Math.round((t || bar).getBoundingClientRect().bottom),
      };
    })
  );
}

async function layerBox(page: Page) {
  return page.evaluate(() => {
    const r = (document.querySelector('[data-os-windows]') as HTMLElement).getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });
}

test.describe('window manager legibility', () => {
  test('cascade clears a title bar, wraps after six, and never leaves the layer', async ({ page }) => {
    await boot(page);
    const layer = await layerBox(page);
    const order = ['calculator', 'notes', 'about', 'weather', 'news', 'trash', 'mail'];
    for (const app of order) await openApp(page, app);
    const all = await rects(page);
    expect(all).toHaveLength(order.length);

    const view = page.viewportSize()!;
    for (let i = 0; i < all.length; i++) {
      const w = all[i];
      // wholly on screen: a window whose close button is past the edge is not
      // reachable without scrolling, which §12.3 forbids
      expect(w.x).toBeGreaterThanOrEqual(Math.min(layer.x, 0));
      expect(w.y).toBeGreaterThanOrEqual(layer.y - 1);
      expect(w.x + w.w).toBeLessThanOrEqual(view.width + 1);
      expect(w.y + w.h).toBeLessThanOrEqual(view.height + 1);
      // and its title is inside the viewport, in full
      expect(w.titleTop).toBeGreaterThanOrEqual(layer.y - 1);
      expect(w.titleBottom).toBeLessThanOrEqual(view.height + 1);
      expect(w.titleLeft).toBeGreaterThanOrEqual(-1);
      expect(w.titleRight).toBeLessThanOrEqual(view.width + 1);
    }

    // consecutive windows step at least a whole title bar, down AND right, so no
    // two title texts overlap
    for (let i = 1; i < Math.min(all.length, CASCADE_WRAP); i++) {
      const prev = all[i - 1];
      const cur = all[i];
      expect(cur.y - prev.y).toBe(CASCADE_STEP);
      expect(cur.x - prev.x).toBe(CASCADE_STEP);
      expect(CASCADE_STEP).toBeGreaterThanOrEqual(36);
      // the rule: the later window's chrome starts BELOW the earlier window's
      // title text, so no two titles are ever written over each other. (28 px,
      // the v0.1 step, put them on top of each other on every desktop in
      // BAKEOFF-2; the mock's own title bar is 46 px tall and its text ends
      // 33 px down.)
      expect(cur.titleTop).toBeGreaterThanOrEqual(prev.textBottom);
      expect(cur.titleLeft).toBeGreaterThan(prev.titleLeft);
    }
    /**
     * The seventh window's PLACEMENT starts the cascade again rather than
     * marching onwards — `cascade(CASCADE_WRAP) === cascade(0)`, which is pure
     * geometry and pinned in `test/geometry.test.ts`. What it must not do is
     * stay there: window one is still open, so the two title bars would be the
     * same strip, and SEAM H4 says the focused window's title bar is never left
     * sharing one. So the kernel nudges it off, records the steps it took, and
     * the assertion is that the title bars are all distinct — every window is
     * still wholly inside the layer, which the loop above has already checked.
     */
    const seventh = page.locator('[data-os-window-id]').nth(CASCADE_WRAP);
    await expect(seventh).toHaveAttribute('data-os-nudged', /\d+/);
    const strips = all.map((w) => ({ x: w.titleLeft, y: w.titleTop, w: w.titleRight - w.titleLeft, h: w.titleBottom - w.titleTop }));
    const collide = (a: (typeof strips)[0], b: (typeof strips)[0]) => {
      const ow = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (ow < 24) return false;
      const oh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      return oh >= Math.max(12, Math.round(Math.min(a.h, b.h) * 0.5));
    };
    for (let i = 0; i < strips.length; i++) {
      for (let j = i + 1; j < strips.length; j++) {
        expect(collide(strips[i], strips[j]), `title bars ${i} and ${j} share a strip`).toBe(false);
      }
    }
  });

  test('the default window is sized against the windows layer', async ({ page }) => {
    await boot(page);
    const layer = await layerBox(page);
    await openApp(page, 'calculator');
    const [w] = await rects(page);
    expect(w.w).toBe(Math.round(layer.w * DEFAULT_W));
    expect(w.h).toBe(Math.round(layer.h * DEFAULT_H));
  });

  test('double-clicking the title bar maximizes and restores', async ({ page }) => {
    await boot(page);
    const layer = await layerBox(page);
    await openApp(page, 'notes');
    const [before] = await rects(page);
    const bar = page.locator('[data-os-window-id] [data-os-drag]').last();

    await bar.dblclick({ position: { x: 6, y: 6 } });
    await expect(page.locator('[data-os-window-id][data-os-maximized]')).toHaveCount(1);
    const [max] = await rects(page);
    // maximize fills the model's layer, not the screen: a window over the
    // model's own dock or menu bar is not maximized, it is broken
    expect(max.w).toBe(layer.w);
    expect(max.h).toBe(layer.h);
    expect(max.y).toBe(layer.y);

    await bar.dblclick({ position: { x: 6, y: 6 } });
    await expect(page.locator('[data-os-window-id][data-os-maximized]')).toHaveCount(0);
    const [back] = await rects(page);
    expect([back.x, back.y, back.w, back.h]).toEqual([before.x, before.y, before.w, before.h]);
  });

  test('the maximize control still works, and the frame fills the window', async ({ page }) => {
    await boot(page);
    await openApp(page, 'about');
    await page.locator('[data-os-window-id] [data-os-maximize]').last().click();
    await expect(page.locator('[data-os-window-id][data-os-maximized]')).toHaveCount(1);
    const frame = await page.locator('[data-os-window-id] iframe[data-os-frame="app"]').last().boundingBox();
    const [max] = await rects(page);
    expect(frame!.width).toBeGreaterThan(max.w - 40);
    expect(frame!.height).toBeGreaterThan(max.h - 80);
  });

  /**
   * HANDOFF-8 — a real mouse click on the close of a window that is not yet
   * focused must close it, first time.
   *
   * The cascade guarantees the collision: window two's title strip overlaps
   * window one's, so focusing one used to run `clearTitleCollision` and move it
   * a cascade step (+36,+36) between mousedown and mouseup. The click event
   * never fired, and clicking again moved it again — the window could not be
   * closed by mouse at all. Every close in this suite until now was
   * `dispatchEvent`, which cannot reproduce it, so the click here is a REAL
   * hit-tested mouse click at the button's own coordinates.
   */
  test('a real click closes an unfocused window the first time', async ({ page }) => {
    await boot(page);
    await openApp(page, 'calculator');
    await openApp(page, 'notes');
    await expect(page.locator('[data-os-window-id]')).toHaveCount(2);
    // the FIRST window: the second one is on top and has focus
    const first = page.locator('[data-os-window-id]').first();
    const id = await first.getAttribute('data-os-window-id');
    const pt = await page.evaluate((wid) => {
      const w = document.querySelector('[data-os-window-id="' + wid + '"]')!;
      const c = w.querySelector('[data-os-close]') as HTMLElement | null;
      if (!c) return null;
      const r = c.getBoundingClientRect();
      for (let iy = 1; iy <= 5; iy++)
        for (let ix = 1; ix <= 5; ix++) {
          const x = r.x + (r.width * ix) / 6;
          const y = r.y + (r.height * iy) / 6;
          const at = document.elementFromPoint(Math.round(x), Math.round(y));
          if (at && (at === c || c.contains(at))) return { x: Math.round(x), y: Math.round(y) };
        }
      return null;
    }, id);
    expect(pt, 'the close control is reachable by a pointer').not.toBeNull();
    await page.mouse.click(pt!.x, pt!.y);
    await expect(page.locator('[data-os-window-id]')).toHaveCount(1);
    await expect(page.locator('[data-os-window-id="' + id + '"]')).toHaveCount(0);
  });

  test('focusing a window that has drifted off the edge brings its title back', async ({ page }) => {
    await boot(page);
    await openApp(page, 'calculator');
    await openApp(page, 'notes');
    // shove one window's title off the left and under the bottom edge, the way a
    // viewport resize or a desktop script that moved the layer can
    await page.evaluate(() => {
      const el = document.querySelector('[data-os-window-id]') as HTMLElement;
      el.style.left = '-400px';
      el.style.top = '2000px';
    });
    await page.locator('[data-os-window-id]').first().dispatchEvent('pointerdown');
    const view = page.viewportSize()!;
    await expect
      .poll(async () => (await rects(page))[0].titleLeft, { timeout: 5000 })
      .toBeGreaterThanOrEqual(-1);
    const w = (await rects(page))[0];
    expect(w.titleBottom).toBeLessThanOrEqual(view.height + 1);
    expect(w.titleRight).toBeLessThanOrEqual(view.width + 1);
  });

  /**
   * KERNEL-8 / R1 — "fills the layer" is now "fills the layer minus the
   * model's own bottom bar", below the breakpoint only.
   *
   * The mock's windows layer is `inset:0` and its 34 px bar is `position:fixed`
   * over the bottom of it, so a window that filled the layer exactly covered
   * the bar — and with it every `[data-os-task-for]` entry, which is the only
   * way back to a minimised window (R1 minimises the others, so there is
   * always something in there to get back to). Measured: a tap on a task entry
   * retried for 90 s against `<iframe data-os-frame="app"> … intercepts
   * pointer events`. Above the breakpoint nothing changed: a cascaded window
   * can be moved and the desktop half of this is a ruling, not a guess.
   */
  test('under the mobile breakpoint a window fills the layer minus its bottom bar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await boot(page, MAIN + '/');
    const layer = await layerBox(page);
    await openApp(page, 'calculator');
    const [w] = await rects(page);
    const bar = await page.evaluate(() => {
      const el = document.querySelector('[data-os-taskbar]') as HTMLElement | null;
      if (!el) return 0;
      const b = el.getBoundingClientRect();
      return b.bottom >= window.innerHeight - 2 && b.height >= 8 ? Math.round(b.height) : 0;
    });
    expect(bar).toBeGreaterThan(0);
    expect(w.w).toBe(layer.w);
    expect(w.h).toBe(layer.h - bar);
    // and it is not over the bar at all
    expect(w.y + w.h).toBeLessThanOrEqual(780 - bar + 1);
    await expect(page.locator('[data-os-window-id][data-os-fullsize]')).toHaveCount(1);
  });
});
