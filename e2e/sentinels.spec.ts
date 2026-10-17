import { test, expect } from '@playwright/test';
import { LATEMOD, HALFAPP, boot, openApp, appFrame, pageFrame, waitForPageShape } from './helpers.js';

/**
 * The two stream sentinels, from the kernel's side.
 *
 * `<!--os-reroute-->` (SPEC §12.1) and `<!--os-error-->` (I1) are the only two
 * things the server can say after a document has started arriving, and the
 * kernel has to do opposite things with them: throw the rerouted document away
 * whatever state it is in, and KEEP the errored one if the visitor is already
 * looking at it (SPEC §12.2).
 */
test.describe('os-reroute (SPEC §12.1)', () => {
  test('a document flagged mid-stream is discarded and re-asked with rerouted:true', async ({ page }) => {
    const pages: { url: string; rerouted: boolean }[] = [];
    page.on('request', (r) => {
      if (!r.url().endsWith('/api/gen')) return;
      const b = r.postDataJSON();
      if (b?.kind === 'page') pages.push({ url: String(b?.context?.url || ''), rerouted: b?.rerouted === true });
    });

    await boot(page, LATEMOD + '/');
    await openApp(page, 'browser');
    const app = await appFrame(page);
    await pageFrame(page, app); // the browser's own home first

    // the fake moderation server flags this one, 250 ms in — long after the
    // first chunks of a 120 ms-per-chunk document have painted
    await app.evaluate(() => (window as any).os.navigate('https://reroute-me.example.com/hello'));

    // the page the visitor ends up on is the WHOLESOME one, not the flagged one
    const f = await waitForPageShape(page, 'rerouted', app);
    expect(await f.evaluate(() => document.querySelector('[data-mock-rerouted]')?.getAttribute('data-mock-rerouted'))).toBe('true');

    const flagged = pages.filter((p) => p.url.includes('reroute-me'));
    expect(flagged.length, 'the flagged document was discarded and a second generation asked for').toBe(2);
    expect(flagged[0].rerouted).toBe(false);
    expect(flagged[1].rerouted, 'the retry carries the flag, or the server loses the same race again').toBe(true);
  });
});

test.describe('os-error over a painted document (SPEC §12.2)', () => {
  test('a truncated app document that the visitor can already see is kept, not reset', async ({ page }) => {
    const apps: string[] = [];
    page.on('request', (r) => {
      if (!r.url().endsWith('/api/gen')) return;
      const b = r.postDataJSON();
      if (b?.kind === 'app') apps.push(String(b?.context?.app_id));
    });

    await boot(page, HALFAPP + '/');
    // the first app generation on this server dies 60% of the way through and
    // the server ends the stream with <!--os-error--> after what it had sent
    await openApp(page, 'notes');
    const frame = await appFrame(page);
    await expect.poll(async () => frame.evaluate(() => document.body?.innerText.length || 0).catch(() => 0), { timeout: 30_000 }).toBeGreaterThan(20);

    // the half document is still the document: one open, never re-opened
    const opens = await frame.evaluate(() => ((window as any).__osStats || {}).opens || 0);
    expect(opens, 'document.open() ran once: a painted document is never reset').toBe(1);
    expect(await frame.evaluate(() => !!document.querySelector('[data-mock="app"]'))).toBe(true);
    // and nothing bought a replacement for it
    await page.waitForTimeout(1500);
    expect(apps.filter((a) => a === 'notes').length, 'no second generation for a document already on screen').toBe(1);
    expect(await page.locator('[data-os-window-id]').count()).toBe(1);
  });
});
