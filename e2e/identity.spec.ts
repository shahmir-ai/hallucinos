import { test, expect, type Page } from '@playwright/test';
import { MAIN } from './helpers.js';

/**
 * INTERFACE I1 — the identity rides in the boot stream.
 *
 * The boot response is intercepted rather than taken from the server, so this
 * proves the KERNEL's half of the interface whatever the server is currently
 * emitting: the comment is parsed the moment its closing `-->` lands, the
 * desktop and the image calls start off it, no `kind=identity` round trip is
 * made, and the comment itself never reaches the boot document.
 */
const IDENTITY = {
  name: 'TESTMACHINE',
  tagline: 'it boots, allegedly',
  version: '9.9',
  era: '1999-adjacent',
  personality: 'terse',
  palette_words: ['oxide', 'bone'],
  font_words: ['monospace'],
  boot_message: 'waking up',
  archetype: 'dock',
};

const BOOT_BODY =
  `<!--os-identity:${JSON.stringify(IDENTITY)}-->\n` +
  '<!doctype html><html><head><title>boot</title></head><body style="color:#0f0;background:#000">' +
  '<h1 data-boot-marker>waking up</h1><pre>memory ok</pre></body></html>\n';

async function routeBoot(page: Page, body = BOOT_BODY) {
  await page.route('**/api/gen', async (route) => {
    const kind = route.request().postDataJSON()?.kind;
    if (kind !== 'boot') return route.fallback();
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body });
  });
}

test.describe('identity in the boot stream (I1)', () => {
  test('parsed from the stream: no identity round trip, archetype applied, comment not rendered', async ({ page }) => {
    const gens: string[] = [];
    const seen: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/api/gen')) gens.push(String(r.postDataJSON()?.kind));
      if (r.url().endsWith('/api/identity-seen')) seen.push(String(r.postDataJSON()?.name));
    });
    await routeBoot(page);
    await page.goto(MAIN + '/');

    // the boot document paints, and the comment is not part of it
    const el = await page.waitForSelector('[data-os-boot] iframe', { timeout: 30_000 });
    const frame = await el.contentFrame();
    await expect.poll(async () => (await frame!.evaluate(() => document.body?.innerText || '').catch(() => '')) || '').toContain(
      'waking up'
    );
    const bootHtml = await frame!.evaluate(() => document.documentElement.outerHTML);
    expect(bootHtml).not.toContain('os-identity');

    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });
    expect(gens).toEqual(['boot', 'desktop']);
    expect(gens).not.toContain('identity');

    // the model's archetype is the machine's archetype (I5)
    const archetype = await page.evaluate(
      () => document.documentElement.getAttribute('data-os-archetype') || document.body.getAttribute('data-os-archetype') || ''
    );
    expect(archetype).toBe('dock');

    // I2: the name goes into the server's never-use-these ring buffer
    expect(seen).toContain('TESTMACHINE');
  });

  test('the desktop generation starts while the boot document is still streaming', async ({ page }) => {
    const at: Record<string, number> = {};
    page.on('request', (r) => {
      if (!r.url().endsWith('/api/gen')) return;
      const kind = String(r.postDataJSON()?.kind);
      if (at[kind] === undefined) at[kind] = Date.now();
    });
    await routeBoot(page);
    await page.goto(MAIN + '/');
    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });
    // the desktop is asked for within a blink of the boot request, not after it
    expect(at.desktop - at.boot).toBeLessThan(1500);
  });

  test('a boot stream with no identity comment still boots (fallback round trip)', async ({ page }) => {
    const gens: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/api/gen')) gens.push(String(r.postDataJSON()?.kind));
    });
    await routeBoot(page, '<!doctype html><html><body><h1 data-boot-marker>no comment here</h1></body></html>');
    await page.goto(MAIN + '/');
    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });
    expect(gens[0]).toBe('boot');
    expect(gens).toContain('identity');
    expect(gens).toContain('desktop');
    await expect(page.locator('[data-os-desktop]')).toHaveCount(1);
  });
});
