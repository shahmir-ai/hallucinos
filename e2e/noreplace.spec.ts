import { test, expect } from '@playwright/test';
import { MAIN, SLOW, CRAWL, boot, openApp, appFrame, pageFrame } from './helpers.js';

/**
 * SPEC §12.2 — "no visible document is ever replaced except by a user action".
 *
 * He watched screens load, sit there unclickable, and then turn into a different
 * UI. These are the tests that fail if that comes back.
 */
test.describe('nothing is replaced without a user event', () => {
  test('the boot screen stays up at least 2.5 s and the desktop is interactive when it lifts', async ({ page }) => {
    await page.goto(MAIN + '/');
    const el = await page.waitForSelector('[data-os-boot] iframe', { timeout: 30_000 });
    const frame = await el.contentFrame();
    await expect
      .poll(async () => ((await frame!.evaluate(() => document.body?.innerText || '').catch(() => '')) || '').length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    const painted = Date.now();

    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });
    const revealed = Date.now();
    // 2.5 s measured from the kernel's own paint mark, which is a shade earlier
    // than the poll above can see it — hence the 200 ms of slack.
    expect(revealed - painted).toBeGreaterThanOrEqual(2300);

    // and the desktop was already wired when the overlay came off: a launcher
    // clicked in the same tick opens a window
    await openApp(page, 'notes');
    await expect(page.locator('[data-os-window-id]')).toHaveCount(1, { timeout: 20_000 });
  });

  test('a mounted document is opened exactly once, and stays put while nobody touches it', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const w = window as any;
      w.__removed = [];
      const tracked = Array.from(document.body.children);
      new MutationObserver((recs) => {
        for (const r of recs) {
          for (const n of Array.from(r.removedNodes)) {
            if (tracked.indexOf(n as any) >= 0) w.__removed.push((n as Element).nodeName || 'node');
          }
        }
      }).observe(document.body, { childList: true });
    });

    await openApp(page, 'browser');
    const app = await appFrame(page);
    const pageF = await pageFrame(page, app);
    await expect.poll(async () => (await pageF.evaluate(() => document.body?.innerText.length || 0).catch(() => 0)), { timeout: 30_000 }).toBeGreaterThan(20);

    const opensOf = async () => ({
      app: await app.evaluate(() => (window as any).__osStats?.opens ?? -1).catch(() => -1),
      page: await pageF.evaluate(() => (window as any).__osStats?.opens ?? -1).catch(() => -1),
    });
    const before = await opensOf();
    // one document.open() per document: the repair pass that used to re-stream a
    // whole app over a painted one is gone (SPEC §12.2)
    expect(before.app).toBe(1);
    expect(before.page).toBe(1);

    // nobody touches anything for three seconds
    await page.waitForTimeout(3000);
    const after = await opensOf();
    expect(after).toEqual(before);
    expect(await page.evaluate(() => (window as any).__removed)).toEqual([]);
    await expect(page.locator('[data-os-window-id]')).toHaveCount(1);
    await expect(page.locator('[data-os-desktop]')).toHaveCount(1);
  });

  test('interactivity is attached while the document is still streaming', async ({ page }) => {
    // 250 ms per chunk: the document below is minutes from finished when it is
    // clicked. SPEC §12.2: delegation from the first chunk, not at document.close().
    await page.goto(CRAWL + '/');
    await page.waitForSelector('html[data-os-ready]', { timeout: 90_000 });
    await openApp(page, 'mail');
    const app = await appFrame(page);

    let state = '';
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const r = await app.evaluate(() => ({ ready: document.readyState, body: !!document.body })).catch(() => ({ ready: '', body: false }));
      state = r.ready;
      if (r.body) break;
      await page.waitForTimeout(20);
    }
    expect(state, 'the document had already closed — widen MOCK_DELAY_MS').toBe('loading');

    // a launcher that arrives mid-stream is live the moment it is in the DOM
    const opened = await app.evaluate(() => {
      const b = document.createElement('button');
      b.setAttribute('data-os-app', 'calculator');
      b.textContent = 'calculator';
      document.body.appendChild(b);
      b.click();
      return document.readyState;
    });
    expect(opened).toBe('loading');
    await expect(page.locator('[data-os-window-id]')).toHaveCount(2, { timeout: 30_000 });
  });
});
