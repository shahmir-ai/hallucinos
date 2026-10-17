import { test, expect } from '@playwright/test';
import { boot, openApp, appFrame, pageFrame, waitForPageShape, frameText, MAIN } from './helpers.js';

const isLocal = (url: string) => /^http:\/\/localhost:|^https?:\/\/127\.0\.0\.1|^data:|^blob:|^about:/.test(url);

/**
 * SPEC §2.2: "Zero network from generated content. Verified by a test that
 * watches for any request from an iframe." Every mock document carries a probe
 * (an external <img> plus fetch/Image/XHR to beacon.example.com), so this is a
 * live attempt on every generation, not a theoretical one.
 */
test.describe('nothing generated reaches the network', () => {
  test('a full boot, an app and a page issue no off-origin request', async ({ page }) => {
    const escaped: string[] = [];
    // Intercept every off-origin request. A request that reaches this handler has
    // left the renderer, which is the thing that must never happen. Localhost is
    // deliberately not matched: the kernel's own /api/gen streams through it.
    await page.route(
      (url) => !isLocal(url.toString()),
      async (route) => {
        escaped.push(`${route.request().frame()?.url() || '?'} -> ${route.request().url()}`);
        await route.abort();
      }
    );
    page.on('requestfinished', (r) => {
      if (!isLocal(r.url())) escaped.push('finished -> ' + r.url());
    });

    await boot(page);
    await openApp(page, 'browser');
    const browser = await appFrame(page);
    await waitForPageShape(page, 'search-home', browser);
    await openApp(page, 'photos');
    const photos = await appFrame(page);
    await expect.poll(() => frameText(photos), { timeout: 20_000 }).not.toBe('');
    await page.waitForTimeout(1000);

    expect(escaped, escaped.join('\n')).toEqual([]);
  });

  test('an external <img> becomes an inline placeholder carrying its alt text', async ({ page }) => {
    await boot(page);
    await openApp(page, 'photos');
    const photos = await appFrame(page);
    await expect.poll(() => frameText(photos), { timeout: 20_000 }).not.toBe('');
    const box = photos.locator('[data-os-hallucinated-image]').first();
    await expect(box).toHaveCount(1);
    expect(await box.getAttribute('aria-label')).toBe('a cat that does not exist');
    await expect(photos.locator('img')).toHaveCount(0);
  });

  test('every generated document carries the no-network CSP', async ({ page }) => {
    await boot(page);
    await openApp(page, 'notes');
    const notes = await appFrame(page);
    await expect.poll(() => frameText(notes), { timeout: 20_000 }).not.toBe('');
    const csp = await notes.evaluate(
      () => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') || ''
    );
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('connect-src');
  });
});

test.describe('moderation', () => {
  test('a flagged address reroutes silently — a different site, no acknowledgement', async ({ page }) => {
    await boot(page);
    await openApp(page, 'browser');
    const browser = await appFrame(page);
    await waitForPageShape(page, 'search-home', browser);

    await browser.locator('[data-os-url]').fill('https://pornhub.com/');
    await browser.locator('[data-os-url]').press('Enter');
    const rerouted = await waitForPageShape(page, 'rerouted', browser);
    const text = await frameText(rerouted);
    expect(text).toContain('Allotment');
    // no refusal, no explanation, nothing that names what happened
    for (const word of ['blocked', 'refus', 'not allowed', 'policy', 'moderat', 'inappropriate']) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });

  test('the response never tells the client that a reroute happened', async ({ page }) => {
    const res = await page.request.post(MAIN + '/api/gen', {
      data: { kind: 'page', engine: 'mock', seed: 's', context: { url: 'https://pornhub.com/' } },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['x-os-rerouted']).toBeUndefined();
    // the telemetry sentinel the kernel reads carries no reroute flag either
    const text = await res.text();
    const sentinel = JSON.parse(/<!--os-telemetry:([\s\S]*?)-->/.exec(text)![1]);
    expect(Object.keys(sentinel)).not.toContain('rerouted');
    // (the mock's own fixture labels its shape "rerouted"; that is the document
    // the visitor is meant to see, not a report of the decision)
    expect(sentinel.kind).toBe('page');
  });
});

test.describe('the engine list', () => {
  test('/api/engines lists only engines whose key env is set', async ({ page }) => {
    const j = await (await page.request.get(MAIN + '/api/engines')).json();
    const ids = j.engines.map((e: any) => e.id);
    // the e2e servers run with no provider keys at all
    expect(ids).toEqual(['mock']);
    expect(j.default).toBe('mock');
    expect(j.engines[0]).toHaveProperty('usd_in');
    expect(j.engines[0]).toHaveProperty('usd_out');
  });
});
