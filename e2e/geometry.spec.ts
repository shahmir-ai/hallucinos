import { test, expect } from '@playwright/test';
import { boot, openApp, COLLAPSED, MAIN } from './helpers.js';

/**
 * SPEC §2.2 gives the kernel geometry. The model gives the window chrome, and a
 * template that sizes `[data-os-content]` with neither `flex` nor a height
 * collapses it to zero — the frame mounts, the document is generated and paid
 * for, and the window is a title bar with nothing under it. Every
 * `cerebras-oss120` window in BAKEOFF-1 did exactly that, so the kernel repairs
 * it (`fitContent` in kernel/windows.ts) and this is the proof.
 */
test.describe('window content geometry', () => {
  const frameBox = (page: import('@playwright/test').Page) =>
    page
      .locator('[data-os-window-id] iframe[data-os-frame="app"]')
      .last()
      .boundingBox()
      .then((b) => b || { width: 0, height: 0 });

  test('a collapsed [data-os-content] is given real height, and the app is visible in it', async ({ page }) => {
    await boot(page, COLLAPSED + '/');
    await openApp(page, 'calculator');
    const box = await frameBox(page);
    // the mock's window root is 440px tall with a ~33px title bar
    expect(box.height).toBeGreaterThan(300);
    expect(box.width).toBeGreaterThan(400);
    const inner = page.locator('[data-os-window-id] iframe[data-os-frame="app"]').last();
    await expect.poll(async () => (await inner.contentFrame()!.locator('body').innerText()).length, {
      timeout: 20_000,
    }).toBeGreaterThan(20);
  });

  test('a template that sizes itself correctly is left alone', async ({ page }) => {
    await boot(page, MAIN + '/');
    await openApp(page, 'calculator');
    const box = await frameBox(page);
    expect(box.height).toBeGreaterThan(300);
    // the kernel must not have written its absolute-fill fallback over a
    // template that was already fine
    const content = page.locator('[data-os-window-id] [data-os-content]').last();
    await expect(content).not.toHaveAttribute('style', /position:\s*absolute/);
  });
});
