import { test, expect } from '@playwright/test';
import { MAIN, SLOW, boot, openApp } from './helpers.js';

/**
 * SPEC §7 + §12.6/I8: /bakeoff is a plain landing page (the server's), and
 * /bakeoff/run?engine=<id> is the OS with the picker and the HUD. The HUD exists
 * on the run route and nowhere else.
 * `scripts/bakeoff.mjs` reads both — the engine comes from `?engine=`, and the
 * HUD is the independent witness every number in a bake-off report is checked
 * against — so this is the contract that harness stands on.
 */
test.describe('the bake-off route', () => {
  test('the engine picker is on the boot screen, and only there', async ({ page }) => {
    // the slow mock server widens the boot window enough to look at it
    await page.goto(SLOW + '/bakeoff/run', { waitUntil: 'commit' });
    const picker = page.locator('[data-os-picker] select[data-os-engine-select]');
    await expect(picker).toHaveCount(1, { timeout: 30_000 });
    // it offers exactly the engines /api/engines lists (these servers have no keys)
    expect(await picker.locator('option').allTextContents()).toHaveLength(1);
    expect(await picker.inputValue()).toBe('mock');

    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });
    await expect(page.locator('[data-os-picker]')).toHaveCount(0);
  });

  test('the HUD carries the engine and the last generation, and follows it', async ({ page }) => {
    await boot(page, MAIN + '/bakeoff/run?engine=mock');
    const hud = page.locator('[data-os-hud]');
    await expect(hud).toHaveCount(1);

    const afterBoot = (await hud.textContent()) || '';
    expect(afterBoot).toContain('engine   mock');
    expect(afterBoot).toContain('last     desktop');
    expect(afterBoot).toMatch(/ttfb\s+\d+ ms/);
    expect(afterBoot).toMatch(/tok\/s\s+\d+/);
    expect(afterBoot).toMatch(/tokens\s+\d+ in \/ \d+ out/);
    expect(afterBoot).toMatch(/contract (ok|MISS)/);
    expect(afterBoot).toMatch(/session \$ [\d.]+/);

    // it is live: the next generation replaces the numbers
    await openApp(page, 'notes');
    await expect.poll(async () => (await hud.textContent()) || '', { timeout: 30_000 }).toContain('last     app');
  });

  test('?engine= picks the engine for the boot', async ({ page }) => {
    const res = await page.request.get(MAIN + '/api/engines');
    expect((await res.json()).engines.map((e: any) => e.id)).toEqual(['mock']);

    // an engine that does not exist falls back rather than hanging the boot
    await boot(page, MAIN + '/bakeoff/run?engine=nonesuch');
    expect((await page.locator('[data-os-hud]').textContent()) || '').toContain('engine   mock');
  });

  /**
   * HANDOFF-3 issue 11 / BAKEOFF-2 §8: the picker used to sit at the top left,
   * on top of the boot document's own first line — it hid the machine's banner,
   * which is exactly the line a judge wants to read. Both overlays now live in
   * one dock in the bottom-right corner, and one key hides the lot.
   */
  test('the picker and the HUD dock bottom-right, clear of the boot document, and hide on a key', async ({ page }) => {
    await page.goto(SLOW + '/bakeoff/run', { waitUntil: 'commit' });
    const dock = page.locator('[data-os-dock]');
    await expect(dock).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator('[data-os-dock] [data-os-picker]')).toHaveCount(1);
    await expect(page.locator('[data-os-dock] [data-os-hud]')).toHaveCount(1);

    const view = page.viewportSize()!;
    const box = (await dock.boundingBox())!;
    // bottom-right, and nowhere near the top-left corner where a boot screen
    // writes its name and its first messages
    expect(box.x).toBeGreaterThan(view.width / 2);
    expect(box.y).toBeGreaterThan(view.height / 2);
    expect(box.x + box.width).toBeLessThanOrEqual(view.width);
    expect(box.y + box.height).toBeLessThanOrEqual(view.height);

    // the top-left quarter of the screen is the boot document and nothing else
    const atTopLeft = await page.evaluate(() => {
      const el = document.elementFromPoint(24, 24);
      return el ? el.tagName + '/' + (el.closest('[data-os-dock]') ? 'dock' : el.id || '-') : 'none';
    });
    expect(atTopLeft).not.toContain('dock');

    await page.keyboard.press('`');
    await expect(dock).toHaveAttribute('data-os-dock-collapsed', '');
    await expect(page.locator('[data-os-dock] [data-os-hud]')).toBeHidden();
    await page.keyboard.press('`');
    await expect(page.locator('[data-os-dock] [data-os-hud]')).toBeVisible();
  });

  test('the landing page itself is not the OS: no HUD there (I8)', async ({ page }) => {
    // what /bakeoff renders is the server's business (a list of engines with a
    // Boot button each). The kernel's half of the split is this: if a kernel page
    // is served anywhere but /bakeoff/run, it carries no HUD and no picker.
    const res = await page.goto(MAIN + '/bakeoff');
    expect(res?.status()).toBe(200);
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-os-hud]')).toHaveCount(0);
    await expect(page.locator('[data-os-picker]')).toHaveCount(0);
  });
});
