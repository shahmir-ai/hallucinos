import { test, expect, type Page } from '@playwright/test';
import { CRAWL, boot, openApp, appFrame } from './helpers.js';

/**
 * BAKEOFF-4 #1 — how many requests the kernel actually holds open at once.
 *
 * The worst fault in the product is an app window that never paints, and it is
 * a `POST /api/gen` that never left the browser because Chrome's six
 * per-origin HTTP/1.1 sockets were all held. HANDOFF-4 asserted the kernel
 * "never needs more than three live generations"; BAKEOFF-4 built a three-wide
 * lane on that assertion and it deadlocked every app generation of a real
 * boot, so the assertion is false and the number was never measured.
 *
 * This measures it on the crawling mock (`MOCK_DELAY_MS=250`, so a boot's
 * streams really do overlap an app open) and records the high-water mark. The
 * assertions are the ones that cannot be a matter of the mock's timing: the
 * ledger sees the generation sockets, it never goes negative, and it empties
 * when the machine goes quiet. The peak is printed, because the peak is the
 * finding.
 */
const peak = (page: Page) => page.evaluate(() => (window as any).__osNet().peak as number);
const snap = (page: Page) =>
  page.evaluate(() => (window as any).__osNet() as { n: number; peak: number; byLane: Record<string, number>; open: string[] });

test('the kernel reports how many requests it holds open across a boot and an app open', async ({ page }, testInfo) => {
  const notes: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('connections:')) notes.push(t);
  });

  await boot(page, CRAWL + '/');
  const afterBoot = await snap(page);
  expect(afterBoot.peak).toBeGreaterThan(0);

  // a browser window is two generations of its own (the chrome and, in
  // parallel, its home page) on top of whatever the boot still has open
  await openApp(page, 'browser');
  const during: number[] = [];
  for (let i = 0; i < 24; i++) {
    during.push((await snap(page)).n);
    await page.waitForTimeout(60);
  }
  await appFrame(page);
  const withBrowser = await snap(page);

  // every sample is a real count: the ledger cannot go negative and cannot
  // exceed its own high-water mark
  for (const n of during) {
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(withBrowser.peak);
  }
  expect(withBrowser.peak).toBeGreaterThanOrEqual(afterBoot.peak);
  expect(Math.max(...during), 'the browser open really did overlap something').toBeGreaterThan(0);

  // and it empties: a socket that is never released is the bug itself
  await expect.poll(() => page.evaluate(() => (window as any).__osNet().n as number), { timeout: 30_000 }).toBe(0);

  const line = `connections — peak across boot: ${afterBoot.peak}, peak with a browser window: ${withBrowser.peak}, max sampled while it opened: ${Math.max(
    ...during
  )}`;
  await testInfo.attach('connection-ledger', { body: line + '\n' + notes.join('\n'), contentType: 'text/plain' });
  console.log('[net] ' + line);
});

test('the ledger names the lane and the generation of everything it holds', async ({ page }) => {
  await boot(page, CRAWL + '/');
  await openApp(page, 'notes');
  // catch it mid-stream: the crawling mock takes ~2 s over an app document
  const held = await page.evaluate(async () => {
    for (let i = 0; i < 40; i++) {
      const s = (window as any).__osNet();
      if (s.n > 0) return s;
      await new Promise((r) => setTimeout(r, 25));
    }
    return (window as any).__osNet();
  });
  expect(held.n).toBeGreaterThan(0);
  expect(held.open.length).toBe(held.n);
  for (const entry of held.open as string[]) expect(entry).toMatch(/^(gen|img|mark):.+ \d+ms$/);
  expect((held.byLane.gen as number) + (held.byLane.img as number) + (held.byLane.mark as number)).toBe(held.n);
  await appFrame(page);
});
