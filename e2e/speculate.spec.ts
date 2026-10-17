import { test, expect } from '@playwright/test';
import { MAIN, CRAWL, boot, appFrame, genToken, openApp } from './helpers.js';

/** INTERFACE I4 — generations that start before the click, and are shown at most once. */
test.describe('speculative generation (I4)', () => {
  test('a launcher starts generating on mousedown, and the click reuses it', async ({ page }) => {
    const apps: { id: string; at: number }[] = [];
    page.on('request', (r) => {
      if (!r.url().endsWith('/api/gen')) return;
      const b = r.postDataJSON();
      if (b?.kind === 'app') apps.push({ id: String(b?.context?.app_id), at: Date.now() });
    });
    await boot(page);

    const box = await page.locator('[data-os-app="notes"]').first().boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    // the document is already being written before the finger comes back up
    await expect.poll(() => apps.filter((a) => a.id === 'notes').length, { timeout: 10_000 }).toBe(1);
    const startedAt = apps[0].at;
    await page.waitForTimeout(150);
    await page.mouse.up();

    const frame = await appFrame(page);
    await expect.poll(async () => await genToken(frame), { timeout: 20_000 }).not.toBe('');
    // the click did NOT buy a second one
    expect(apps.filter((a) => a.id === 'notes').length).toBe(1);
    expect(Date.now() - startedAt).toBeGreaterThan(150);
  });

  test("the browser's home page generates in parallel with its chrome", async ({ page }) => {
    const marks: { kind: string; url: string; at: number }[] = [];
    let appDone = 0;
    page.on('request', (r) => {
      if (!r.url().endsWith('/api/gen')) return;
      const b = r.postDataJSON();
      marks.push({ kind: String(b?.kind), url: String(b?.context?.url || ''), at: Date.now() });
    });
    page.on('requestfinished', (r) => {
      if (r.url().endsWith('/api/gen') && r.postDataJSON()?.kind === 'app' && !appDone) appDone = Date.now();
    });

    // 250 ms a chunk: the chrome takes seconds, so "in parallel" is unmistakable
    await page.goto(CRAWL + '/');
    await page.waitForSelector('html[data-os-ready]', { timeout: 90_000 });
    await openApp(page, 'browser');

    await expect.poll(() => marks.filter((m) => m.kind === 'page').length, { timeout: 30_000 }).toBeGreaterThan(0);
    // the chrome is still arriving when the home page is already being written
    const chrome = await appFrame(page);
    const state = await chrome.evaluate(() => document.readyState).catch(() => '');
    const appReq = marks.find((m) => m.kind === 'app')!;
    const pageReq = marks.find((m) => m.kind === 'page')!;
    expect(pageReq.url).toContain('google.com');
    expect(pageReq.at - appReq.at).toBeLessThan(1000);
    expect(state, 'the chrome had finished before the home page was asked for').toBe('loading');
    expect(appDone).toBe(0);
  });

  test('a speculative document is shown at most once: reopening regenerates', async ({ page }) => {
    await boot(page);
    const press = async () => {
      const box = await page.locator('[data-os-app="notes"]').first().boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(80);
      await page.mouse.up();
    };
    await press();
    const f1 = await appFrame(page);
    await expect.poll(async () => await genToken(f1), { timeout: 20_000 }).not.toBe('');
    const first = await genToken(f1);
    await page.locator('[data-os-window-id] [data-os-close]').first().click();
    await expect(page.locator('[data-os-window-id]')).toHaveCount(0);

    await press();
    const f2 = await appFrame(page);
    await expect.poll(async () => await genToken(f2), { timeout: 20_000 }).not.toBe('');
    const second = await genToken(f2);
    // SPEC §1.1 survives speculation: nothing is ever handed out twice
    expect(second).not.toBe(first);
  });
});
