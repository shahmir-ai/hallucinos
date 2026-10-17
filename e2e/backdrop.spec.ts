import { test, expect, type Page } from '@playwright/test';
import { MAIN, boot, openApp, appFrame } from './helpers.js';

/**
 * KERNEL-6 / task 3 — a window body is never see-through while its document
 * streams, and the window you just opened is above the ones you did not.
 *
 * The bootstrap document every generated document is streamed into is
 * deliberately transparent (an app that sets no background should show the
 * machine's own desktop, not a kernel-coloured pane). The price is the first
 * second of every window's life: until the model's first stylesheet arrives the
 * frame is a hole, and the wallpaper and any window underneath show through a
 * window that is supposed to be loading.
 *
 * The colour is never the kernel's: it is the first opaque background the
 * model's OWN window template already declares, read off `[data-os-content]`
 * and then up to the window root, and dropped again on the first ink.
 */

/** hold every app generation open for `ms`, so a streaming window can be looked at */
async function slowApps(page: Page, ms: number) {
  await page.route('**/api/gen', async (route) => {
    let req: any = {};
    try {
      req = route.request().postDataJSON() || {};
    } catch {}
    if (req.kind !== 'app') return route.continue();
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

async function frameBg(page: Page) {
  return page.evaluate(() => {
    const win = document.querySelector('[data-os-window-id]') as HTMLElement;
    const f = win.querySelector('iframe[data-os-frame="app"]') as HTMLIFrameElement;
    const content = (win.querySelector('[data-os-content]') || win) as HTMLElement;
    return {
      frame: getComputedStyle(f).backgroundColor,
      root: getComputedStyle(win).backgroundColor,
      content: getComputedStyle(content).backgroundColor,
      attr: win.getAttribute('data-os-backdrop'),
    };
  });
}

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

test('a streaming window carries its own template’s background, not a hole', async ({ page }) => {
  await slowApps(page, 2500);
  await boot(page, MAIN + '/');
  await openApp(page, 'notes');
  await expect(page.locator('[data-os-window-id]')).toHaveCount(1);

  // while it streams: the frame is opaque, and in the template's own colour
  const during = await frameBg(page);
  expect(during.content).toBe(TRANSPARENT); // the template leaves the content box clear
  expect(during.frame).not.toBe(TRANSPARENT);
  expect(during.frame).toBe(during.root);
  expect(during.attr).toBe(during.root);

  // after the first ink the kernel gets out of the way again
  const f = await appFrame(page);
  await expect.poll(async () => f.evaluate(() => document.body?.innerText.length || 0), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.locator('[data-os-window-id]')).toHaveAttribute('data-os-backdrop', 'inked', { timeout: 15_000 });
  expect((await frameBg(page)).frame).toBe(TRANSPARENT);
});

test('a template that declares no background anywhere keeps its transparency', async ({ page }) => {
  // MOCK_BREAK is not needed: strip the template's own background on the wire
  await page.route('**/api/gen', async (route) => {
    let req: any = {};
    try {
      req = route.request().postDataJSON() || {};
    } catch {}
    if (req.kind !== 'desktop') return route.continue();
    const res = await route.fetch();
    const text = (await res.text()).replace(/background:#101016;/g, '');
    await route.fulfill({
      status: res.status(),
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      body: text,
    });
  });
  await boot(page, MAIN + '/');
  await openApp(page, 'notes');
  await expect(page.locator('[data-os-window-id]')).toHaveCount(1);
  expect(await page.locator('[data-os-window-id]').getAttribute('data-os-backdrop')).toBe(null);
});

test('the window just opened is wholly above the ones already open', async ({ page }) => {
  await boot(page, MAIN + '/');
  await openApp(page, 'notes');
  await expect(page.locator('[data-os-window-id]')).toHaveCount(1);
  await openApp(page, 'calculator');
  await expect(page.locator('[data-os-window-id]')).toHaveCount(2);

  const stack = await page.evaluate(() => {
    const wins = Array.from(document.querySelectorAll('[data-os-window-id]')) as HTMLElement[];
    const z = wins.map((w) => Number(getComputedStyle(w).zIndex) || 0);
    const top = wins[wins.length - 1];
    const r = top.getBoundingClientRect();
    // a point a few pixels inside the newest window: the cascade steps it
    // down-right, so this point is inside the older one too
    const probe = document.elementFromPoint(Math.round(r.left + 6), Math.round(r.top + 6));
    return {
      z,
      focused: wins.map((w) => w.getAttribute('data-os-focused')),
      topIsMaxZ: z[z.length - 1] === Math.max(...z) && z.filter((v) => v === z[z.length - 1]).length === 1,
      hit: !!probe && top.contains(probe),
    };
  });
  expect(stack.topIsMaxZ).toBe(true);
  expect(stack.focused).toEqual(['false', 'true']);
  expect(stack.hit).toBe(true);
});
