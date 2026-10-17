import { test, expect } from '@playwright/test';
import { SLOW, appFrame, openApp } from './helpers.js';

/** Runs against the slow mock (60ms per chunk) so the paint can be sampled. */
test.describe('progressive streaming', () => {
  test('the boot screen paints while tokens are still arriving', async ({ page }) => {
    await page.goto(SLOW + '/');
    const el = await page.waitForSelector('[data-os-boot] iframe', { timeout: 30_000 });
    const frame = await el.contentFrame();
    expect(frame).toBeTruthy();

    const samples: number[] = [];
    for (let i = 0; i < 14; i++) {
      samples.push(await frame!.evaluate(() => (document.body ? document.body.innerText.length : 0)).catch(() => 0));
      if (await page.evaluate(() => document.documentElement.hasAttribute('data-os-ready'))) break;
      await page.waitForTimeout(120);
    }
    const grew = samples.some((v, i) => i > 0 && v > samples[i - 1] && samples[i - 1] > 0);
    expect(grew, `boot text never grew mid-stream: ${samples.join(',')}`).toBe(true);
    // and it painted long before the document finished
    expect(Math.min(...samples.filter((v) => v > 0))).toBeLessThan(Math.max(...samples));
  });

  test('an app window paints in many small writes, not one lump', async ({ page }) => {
    await page.goto(SLOW + '/');
    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });
    await openApp(page, 'notes');
    const frame = await appFrame(page);

    const samples: number[] = [];
    for (let i = 0; i < 16; i++) {
      samples.push(await frame.evaluate(() => (document.body ? document.body.innerText.length : 0)).catch(() => 0));
      await page.waitForTimeout(100);
    }
    const nonZero = samples.filter((v) => v > 0);
    expect(nonZero.length).toBeGreaterThan(2);
    expect(Math.min(...nonZero)).toBeLessThan(Math.max(...nonZero));

    const stats = await frame.evaluate(() => (window as any).__osStats);
    expect(stats.chunks).toBeGreaterThan(10);
    expect(stats.opens).toBe(1);
    expect(stats.errors).toEqual([]);
  });
});
