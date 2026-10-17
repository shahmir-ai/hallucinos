import { test, expect } from '@playwright/test';
import { CAPPED } from './helpers.js';

/**
 * Runs against the server started with GEN_PER_IP_PER_HOUR=1 (playwright.config).
 * Order matters inside this file: the API assertions use up the hour's single
 * slot, which is exactly the state the queue screen needs.
 */
test.describe.configure({ mode: 'serial' });

test.describe('caps', () => {
  test('the second generation of the hour is a 429 that says queue, not an error', async ({ page }) => {
    const body = { kind: 'page', engine: 'mock', seed: 's', context: { url: 'https://example.com/' } };
    const first = await page.request.post(CAPPED + '/api/gen', { data: body });
    expect(first.status()).toBe(200);

    const second = await page.request.post(CAPPED + '/api/gen', { data: body });
    expect(second.status()).toBe(429);
    const j = await second.json();
    expect(j.queue).toBe(true);
    expect(j.retryAfter).toBeGreaterThan(0);
    expect(j.reason).toBe('ip-hour');
    expect(second.headers()['retry-after']).toBe(String(j.retryAfter));
  });

  test('an over-capacity boot shows the kernel queue screen and nothing else', async ({ page }) => {
    await page.goto(CAPPED + '/');
    const queue = page.locator('[data-os-queue]');
    await expect(queue).toHaveCount(1, { timeout: 30_000 });
    await expect(queue).toContainText('over capacity');
    await expect(queue).toContainText('retry in');
    // the OS never came up
    await expect(page.locator('html[data-os-ready]')).toHaveCount(0);
    await expect(page.locator('[data-os-desktop]')).toHaveCount(0);
  });

  test('bots are refused outright', async ({ page }) => {
    const res = await page.request.post(CAPPED + '/api/gen', {
      headers: { 'user-agent': 'ClaudeBot/1.0' },
      data: { kind: 'page', engine: 'mock' },
    });
    expect(res.status()).toBe(403);
  });
});
