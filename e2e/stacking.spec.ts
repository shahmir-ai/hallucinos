import { test, expect, type Page } from '@playwright/test';
import { boot, openApp, appFrame, clickLauncher, INVERTED, MAIN } from './helpers.js';

/**
 * BAKEOFF-3 open issue 2: on two of nine real desktops — including the
 * best-looking machine in the run — every window painted BEHIND the launcher
 * grid. SPEC §12.3 describes the parts of a desktop and not their stacking, and
 * stacking is geometry, which §2.2 gives to the kernel: so the kernel repairs
 * it rather than the prompt asking for it.
 *
 * `MOCK_BREAK=stack-inverted` writes that desktop on purpose: the windows layer
 * is declared before the launcher area, the launcher area carries a z-index of
 * its own, and the layer keeps its pointer events (a real engine does not know
 * to drop them). Both halves are asserted here, because the obvious repair —
 * raise the layer — breaks the launchers underneath it.
 */

/** what is actually on top at this point of the screen */
async function topAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!el) return { win: '', launcher: '', tag: '' };
      return {
        win: el.closest('[data-os-window-id]')?.getAttribute('data-os-window-id') || '',
        launcher: el.closest('[data-os-app]')?.getAttribute('data-os-app') || '',
        tag: el.tagName.toLowerCase(),
      };
    },
    { x, y }
  );
}

async function winBox(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-os-window-id]') as HTMLElement;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
}

test('a window is on top of the launcher grid even when the desktop declared it underneath', async ({ page }) => {
  await boot(page, INVERTED + '/');
  // the launcher grid covers the whole desktop on this mock, so the window
  // certainly overlaps it
  await openApp(page, 'about');
  await appFrame(page);
  const b = await winBox(page);
  expect(b.w).toBeGreaterThan(200);

  const mid = await topAt(page, b.cx, b.cy);
  expect(mid.win, 'the window owns its own middle').not.toBe('');
  expect(mid.launcher).toBe('');

  // and the repair is recorded where a harness can read it
  const stacked = await page.evaluate(() => ({
    layer: document.querySelector('[data-os-windows]')?.getAttribute('data-os-stacked') || '',
    layerZ: getComputedStyle(document.querySelector('[data-os-windows]') as HTMLElement).zIndex,
    deskZ: getComputedStyle(document.querySelector('[data-os-desktop]') as HTMLElement).zIndex,
    events: getComputedStyle(document.querySelector('[data-os-windows]') as HTMLElement).pointerEvents,
  }));
  expect(stacked.layer).toBe('windows');
  expect(Number(stacked.layerZ)).toBeGreaterThan(Number(stacked.deskZ));
  expect(stacked.events).toBe('none');
});

test('the launchers under a raised windows layer are still clickable', async ({ page }) => {
  await boot(page, INVERTED + '/');
  await openApp(page, 'about');
  await appFrame(page);
  const before = await page.locator('[data-os-window-id]').count();
  // a launcher the raised layer covers but the open window does not: a window
  // over a launcher is correct, the layer over one is the bug
  const target = await page.evaluate(() => {
    const w = (document.querySelector('[data-os-window-id]') as HTMLElement).getBoundingClientRect();
    for (const el of Array.from(document.querySelectorAll('[data-os-desktop] [data-os-app]'))) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      const clear = r.right < w.left || r.left > w.right || r.bottom < w.top || r.top > w.bottom;
      if (clear) return { id: el.getAttribute('data-os-app') || '', x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  });
  expect(target, 'a launcher outside the window box').not.toBeNull();
  const over = await topAt(page, target!.x, target!.y);
  expect(over.launcher, 'the layer does not swallow the launcher').toBe(target!.id);
  await clickLauncher(page, target!.id);
  await expect.poll(async () => page.locator('[data-os-window-id]').count(), { timeout: 20_000 }).toBe(before + 1);
});

test('a desktop that already stacks correctly is left alone', async ({ page }) => {
  await boot(page, MAIN + '/');
  const before = await page.evaluate(() => {
    const l = document.querySelector('[data-os-windows]') as HTMLElement;
    return { z: l.style.zIndex, stacked: l.getAttribute('data-os-stacked'), tb: document.querySelector('[data-os-taskbar]')?.getAttribute('data-os-stacked') };
  });
  // the mock's own desktop declares the layer after the icons with no z-index
  // anywhere: nothing to repair, so nothing is touched
  expect(before.stacked).toBeNull();
  expect(before.z).toBe('');
  expect(before.tb).toBeNull();
});
