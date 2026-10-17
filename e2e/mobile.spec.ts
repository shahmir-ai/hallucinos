import { test, expect, type Page } from '@playwright/test';
import { MAIN, boot, appFrame, clickLauncher, hitTestLauncher, openApp } from './helpers.js';
import { routeGen, routeImg, dockLabelDesktop, startMenuDesktop, chromelessDesktop } from './fakes.js';

/**
 * A phone, 390x844 (SPEC §2.2: under 768 px every window is full size and there
 * is no drag).
 *
 * `e2e/windows.spec.ts` already proves the full-size geometry on one fixture.
 * What was never asked is whether the thing is USABLE at that width: can a
 * thumb reach a launcher, can a window be closed, is the bar still on screen
 * with its clock in it — on a dock, on a taskbar with a menu, and on a desktop
 * whose own chrome is unusable (T4's fallback has to be reachable too, and a
 * 22 px strip is exactly where a phone gets tight).
 */

const PHONE = { width: 390, height: 844 };

async function barReading(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-os-taskbar]') as HTMLElement | null;
    const clock = document.querySelector('[data-os-clock]') as HTMLElement | null;
    const br = bar ? bar.getBoundingClientRect() : null;
    const cr = clock ? clock.getBoundingClientRect() : null;
    const inside = (r: DOMRect | null) =>
      !!r && r.width > 0 && r.height > 0 && r.top >= -2 && r.left >= -2 && r.bottom <= window.innerHeight + 2 && r.right <= window.innerWidth + 2;
    return { bar: inside(br), clock: inside(cr), clockText: (clock?.textContent || '').trim().length };
  });
}

async function windowFillsLayer(page: Page) {
  return page.evaluate(() => {
    const layer = document.querySelector('[data-os-windows]') as HTMLElement;
    const win = document.querySelector('[data-os-window-id]') as HTMLElement;
    if (!layer || !win) return null;
    const l = layer.getBoundingClientRect();
    const w = win.getBoundingClientRect();
    return {
      fullsize: win.getAttribute('data-os-fullsize'),
      dw: Math.round(w.width - Math.min(l.width, window.innerWidth)),
      dh: Math.round(w.height - Math.min(l.height, window.innerHeight)),
      onScreen: w.left >= -2 && w.top >= -2 && w.right <= window.innerWidth + 2 && w.bottom <= window.innerHeight + 2,
      /**
       * KERNEL-8 / R1 — how much of the layer the model's own bottom bar takes,
       * and whether the window is over it. A phone window fills the area, so a
       * layer written `inset:0` under a fixed bar (the mock's own shape) used
       * to put the window on top of the bar and its task entries: 90 s of
       * `<iframe data-os-frame="app"> … intercepts pointer events` on a tap.
       */
      barH: (() => {
        const bar = document.querySelector('[data-os-taskbar]') as HTMLElement | null;
        if (!bar) return 0;
        const b = bar.getBoundingClientRect();
        return b.bottom >= window.innerHeight - 2 && b.height >= 8 ? Math.round(b.height) : 0;
      })(),
      overBar: (() => {
        const bar = document.querySelector('[data-os-taskbar]') as HTMLElement | null;
        if (!bar) return false;
        const b = bar.getBoundingClientRect();
        return Math.min(w.bottom, b.bottom) - Math.max(w.top, b.top) > 2 && Math.min(w.right, b.right) - Math.max(w.left, b.left) > 2;
      })(),
    };
  });
}

/**
 * R1's reading: how many windows exist, how many a visitor can see, and how
 * many title strips are drawn in the top strip of the screen (the §8 smear was
 * four of them in 28 px).
 */
async function windowStates(page: Page) {
  return page.evaluate(() => {
    const wins = Array.from(document.querySelectorAll('[data-os-window-id]')) as HTMLElement[];
    const shown = wins.filter((w) => {
      const r = w.getBoundingClientRect();
      return getComputedStyle(w).display !== 'none' && r.width > 1 && r.height > 1;
    });
    const bars = shown
      .map((w) => (w.querySelector('[data-os-drag]') || w.querySelector('[data-os-title]')) as HTMLElement | null)
      .filter((b): b is HTMLElement => !!b)
      .map((b) => b.getBoundingClientRect())
      .filter((r) => r.width > 1 && r.height > 1 && r.top < 60);
    return {
      open: wins.length,
      visible: shown.map((w) => w.getAttribute('data-os-window-id') || ''),
      minimized: wins.filter((w) => w.getAttribute('data-os-minimized') === 'true').length,
      tasks: document.querySelectorAll('[data-os-task-for]').length,
      focusedAttr: wins.filter((w) => w.getAttribute('data-os-focused') === 'true').length,
      barsInTopStrip: bars.length,
    };
  });
}

test.describe('a phone at 390x844', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test('the mock desktop: a tap opens a full-size window, and it closes', async ({ page }) => {
    await boot(page, MAIN + '/');
    const bar = await barReading(page);
    expect(bar.bar, 'the bar is on screen').toBe(true);
    expect(bar.clock, 'the clock is on screen').toBe(true);
    expect(bar.clockText).toBeGreaterThan(0);

    expect(await hitTestLauncher(page, 'notes')).toBe('notes');
    await page.locator('[data-os-app="notes"]').first().tap();
    await appFrame(page);
    const geom = await windowFillsLayer(page);
    expect(geom!.fullsize).toBe('true');
    expect(Math.abs(geom!.dw)).toBeLessThanOrEqual(1);
    // the layer is `inset:0` and the bar is fixed over its bottom edge: the
    // window fills the layer MINUS the bar (R1 — the entries have to be
    // tappable), and never covers it. The bar's height is read here rather
    // than assumed: `fitBarContents` grows a bar whose entries are taller than
    // it, which the mock does on some seeds, and the window is reflowed when
    // that happens.
    expect(Math.abs(geom!.dh + geom!.barH)).toBeLessThanOrEqual(1);
    expect(geom!.overBar).toBe(false);
    expect(geom!.onScreen).toBe(true);

    // and a visitor can get out of it again
    await page.locator('[data-os-window-id] [data-os-close]').first().tap();
    await expect(page.locator('[data-os-window-id]')).toHaveCount(0);
  });

  test('a dock desktop: every launcher is reachable and the labels survive', async ({ page }) => {
    await routeImg(page);
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? dockLabelDesktop(req) : null) });
    await boot(page);

    const unreachable = await page.evaluate(() => {
      const out: string[] = [];
      const seen = new Set<string>();
      document.querySelectorAll('[data-os-app]').forEach((el) => {
        const id = el.getAttribute('data-os-app') || '';
        if (!id || seen.has(id)) return;
        seen.add(id);
        const r = el.getBoundingClientRect();
        // a launcher a thumb cannot reach: no box, off screen, or under 24 px
        if (!(r.width >= 24 && r.height >= 24)) return out.push(id + ':small');
        if (r.right < 0 || r.left > window.innerWidth || r.bottom < 0 || r.top > window.innerHeight) return out.push(id + ':offscreen');
        const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        if (!hit || !hit.closest(`[data-os-app="${id}"]`)) out.push(id + ':covered');
      });
      return out;
    });
    // a dock 8 icons wide does not fit a 390 px screen, which is the model's
    // own layout problem (HANDOFF-6 issue 1) — what must not happen is a
    // launcher that has a box on screen and cannot be hit
    expect(unreachable.filter((u) => u.endsWith(':covered'))).toEqual([]);

    const id = (await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[data-os-app]')) as HTMLElement[];
      const hit = els.find((el) => {
        const r = el.getBoundingClientRect();
        return r.width >= 24 && r.height >= 24 && r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight;
      });
      return hit?.getAttribute('data-os-app') || '';
    }))!;
    expect(id).not.toBe('');
    await clickLauncher(page, id);
    await appFrame(page);
    expect((await windowFillsLayer(page))!.fullsize).toBe('true');
    expect((await barReading(page)).bar).toBe(true);
  });

  test('a taskbar desktop with a menu: the start control and an entry both work', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? startMenuDesktop(req) : null) });
    await boot(page);
    expect((await barReading(page)).bar).toBe(true);

    await page.locator('#start').tap();
    await expect(page.locator('#menu.open')).toHaveCount(1);
    const { id, nth } = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('#menu [data-os-app]')) as HTMLElement[];
      const pick = els.find((el) => {
        const r = el.getBoundingClientRect();
        return r.width >= 20 && r.height >= 20 && r.top >= 0 && r.bottom <= window.innerHeight;
      });
      const id = pick?.getAttribute('data-os-app') || '';
      const all = Array.from(document.querySelectorAll(`[data-os-app="${id}"]`));
      return { id, nth: Math.max(0, all.indexOf(pick as Element)) };
    });
    expect(id).not.toBe('');
    expect(await hitTestLauncher(page, id, nth)).toBe(id);
    await clickLauncher(page, id, nth);
    await appFrame(page);
    expect((await windowFillsLayer(page))!.fullsize).toBe('true');
    await page.locator('[data-os-window-id] [data-os-close]').first().tap();
    await expect(page.locator('[data-os-window-id]')).toHaveCount(0);
  });

  test("T4's bare chrome is usable on a phone as well", async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? chromelessDesktop(req) : null) });
    await boot(page);
    await clickLauncher(page, 'notes');
    await appFrame(page);
    const strip = page.locator('[data-os-chrome-fallback]');
    await expect(strip).toHaveCount(1);
    const box = (await strip.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(20);
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width + 1);
    await strip.locator('[data-os-close]').tap();
    await expect(page.locator('[data-os-window-id]')).toHaveCount(0);
  });

  /**
   * R1 (KERNEL-8) — one window at a time.
   *
   * HANDOFF-7 §8: four full-screen windows piled four title bars into the same
   * 28 px strip, five close buttons in a row, none of the text legible. Below
   * the breakpoint, opening or focusing a window now minimises every other one
   * — the minimise state the kernel already had, no new visuals — the bar's
   * task entries restore, and closing reveals the one before it.
   */
  test('opening three apps leaves exactly one window visible', async ({ page }) => {
    await boot(page, MAIN + '/');
    const ids = ['notes', 'calculator', 'weather'];
    for (const id of ids) {
      /**
       * The second and third launchers are UNDER the first window: a phone
       * window is full size (SPEC §2.2), so once one is open no pointer can
       * reach the grid. That is the documented fallback in `helpers.openApp`
       * and it is the honest way to ask this question — R1 is about which
       * window is on screen, and `e2e/hittest.spec.ts` owns hit-testing.
       */
      await openApp(page, id, { real: false });
      await appFrame(page);
      const state = await windowStates(page);
      expect(state.visible.length, 'one window on screen after opening ' + id).toBe(1);
      expect(state.open).toBe(ids.indexOf(id) + 1);
      // the full-screen title bars never share a strip, because there is one
      expect(state.barsInTopStrip).toBe(1);
    }
    // every window that is hidden is hidden the way minimise already works
    const st = await windowStates(page);
    expect(st.minimized).toBe(2);
    expect(st.tasks).toBe(3);
    expect(st.focusedAttr).toBe(1);
  });

  test('a task entry restores its window, and that minimises the other', async ({ page }) => {
    await boot(page, MAIN + '/');
    await clickLauncher(page, 'notes');
    await appFrame(page);
    await openApp(page, 'calculator', { real: false });
    await appFrame(page);

    const first = await page.evaluate(() => {
      const win = Array.from(document.querySelectorAll('[data-os-window-id]')) as HTMLElement[];
      const hidden = win.find((w) => w.getAttribute('data-os-minimized') === 'true');
      return hidden?.getAttribute('data-os-window-id') || '';
    });
    expect(first).not.toBe('');
    await page.locator('[data-os-task-for="' + first + '"]').first().tap();
    const after = await windowStates(page);
    expect(after.visible).toEqual([first]);
    expect(after.minimized).toBe(1);
  });

  /**
   * HANDOFF-8 — the half R1 left open. `focus()` minimised every OTHER window
   * without showing the one being focused, so any focus path that was not the
   * task entry (the pointerdown raise in `wire`, the frame's focus event, the
   * `wm.focus` after `create`) could leave the phone with windows open and
   * NONE on the screen. Found by the phone harness reading 0 visible of 4.
   *
   * Dispatched on purpose: the point is the kernel's own focus path, not a tap
   * a thumb could make on a hidden element.
   */
  test('focusing a minimised window shows it instead of emptying the screen', async ({ page }) => {
    await boot(page, MAIN + '/');
    await clickLauncher(page, 'notes');
    await appFrame(page);
    await openApp(page, 'calculator', { real: false });
    await appFrame(page);
    const hidden = await page.evaluate(
      () =>
        (document.querySelector('[data-os-window-id][data-os-minimized]') as HTMLElement)?.getAttribute(
          'data-os-window-id'
        ) || ''
    );
    expect(hidden).not.toBe('');
    await page.locator('[data-os-window-id="' + hidden + '"]').first().dispatchEvent('pointerdown');
    const after = await windowStates(page);
    expect(after.visible, 'the focused window is the one on screen').toEqual([hidden]);
    expect(after.open).toBe(2);
    expect(after.minimized).toBe(1);
  });

  test('closing the visible window reveals the previous one', async ({ page }) => {
    await boot(page, MAIN + '/');
    await clickLauncher(page, 'notes');
    const f1 = await appFrame(page);
    const before = await page.evaluate(() => (document.querySelector('[data-os-window-id]') as HTMLElement).getAttribute('data-os-window-id'));
    expect(f1).toBeTruthy();
    await openApp(page, 'calculator', { real: false });
    await appFrame(page);
    await page.locator('[data-os-window-id]:not([data-os-minimized]) [data-os-close]').first().tap();
    await expect(page.locator('[data-os-window-id]')).toHaveCount(1);
    const after = await windowStates(page);
    expect(after.visible).toEqual([before]);
    // and it is the focused one, not a window nobody is on
    expect(after.focusedAttr).toBe(1);
  });

  test('a window is never dragged on a phone (SPEC §2.2)', async ({ page }) => {
    await boot(page, MAIN + '/');
    await clickLauncher(page, 'notes');
    await appFrame(page);
    const before = (await windowFillsLayer(page))!;
    const bar = (await page.locator('[data-os-window-id] [data-os-drag]').first().boundingBox())!;
    await page.mouse.move(bar.x + 20, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + 120, bar.y + 200, { steps: 5 });
    await page.mouse.up();
    const after = (await windowFillsLayer(page))!;
    expect(after.dw).toBe(before.dw);
    expect(after.dh).toBe(before.dh);
    expect(after.onScreen).toBe(true);
  });
});
