import { test, expect } from '@playwright/test';
import { boot, openApp, appFrame, pageFrame, waitForPageShape, genToken } from './helpers.js';

/** SPEC §10.2: browser → google-shaped page → search → results → click a result → page. */
test.describe('the fake internet', () => {
  test('home is search-shaped, a search gives results, a result gives a page', async ({ page }) => {
    await boot(page);
    await openApp(page, 'browser');
    const browser = await appFrame(page);

    // the browser app opens on its home page without being told to
    await waitForPageShape(page, 'search-home', browser);
    const home = await pageFrame(page, browser);
    await expect(home.locator('[data-os-url], input[name="q"]').first()).toBeVisible();

    // the address bar shows where we are
    expect(await browser.locator('[data-os-url]').inputValue()).toContain('google.com');

    // search: a plain <form> submit is intercepted and becomes a navigation
    await home.locator('input[name="q"]').fill('best pizza in town');
    await home.locator('button[type="submit"]').click();
    const results = await waitForPageShape(page, 'results', browser);
    // the form's named fields are serialised into the address the kernel navigated to
    const shown = await browser.locator('[data-os-url]').inputValue();
    expect(shown).toContain('/search?q=');
    expect(decodeURIComponent(shown)).toContain('best pizza in town');
    await expect(results.locator('[data-mock="result"]')).toHaveCount(9);

    // click a result: an <a href> is intercepted and becomes the next page
    const href = await results.locator('[data-mock="result"]').first().getAttribute('href');
    await results.locator('[data-mock="result"]').first().click();
    const site = await waitForPageShape(page, 'site', browser);
    const host = new URL(href!).hostname;
    expect(await site.evaluate(() => document.body.innerText)).toContain(host);

    // back goes back — and regenerates, because nothing is ever cached
    await expect.poll(() => genToken(site), { timeout: 20_000 }).not.toBe('');
    const before = await genToken(site);
    await browser.locator('[data-os-nav="back"]').click();
    const again = await waitForPageShape(page, 'results', browser);
    expect(await genToken(again)).not.toBe(before);
  });

  test('typing an address in [data-os-url] navigates there', async ({ page }) => {
    await boot(page);
    await openApp(page, 'browser');
    const browser = await appFrame(page);
    await waitForPageShape(page, 'search-home', browser);

    await browser.locator('[data-os-url]').fill('reddit.com/r/cats');
    await browser.locator('[data-os-url]').press('Enter');
    const sub = await waitForPageShape(page, 'subreddit', browser);
    expect(await sub.evaluate(() => document.body.innerText)).toContain('reddit.com');
  });

  /**
   * A page's own script calling os.navigate('reddit.com/r/cats') used to be
   * resolved against the page it was written on, so a click-through from
   * italianharmony.com asked the fake internet for
   * https://www.italianharmony.com/menu/reddit.com/r/cats — one nonsense URL
   * nested inside another (seen on cerebras-oss120, reviews/INTEGRATE-1.md).
   */
  test('a bare hostname passed to os.navigate is a new site, not a path on this one', async ({ page }) => {
    await boot(page);
    await openApp(page, 'browser');
    const browser = await appFrame(page);
    const home = await waitForPageShape(page, 'search-home', browser);

    await home.evaluate(() => (window as any).os.navigate('reddit.com/r/cats'));
    await waitForPageShape(page, 'subreddit', browser);
    expect(await browser.locator('[data-os-url]').inputValue()).toBe('https://reddit.com/r/cats');

    // and a real relative reference still resolves against the current page
    const site = browser.childFrames()[0];
    await site.evaluate(() => (window as any).os.navigate('/r/dogs'));
    await waitForPageShape(page, 'subreddit', browser);
    expect(await browser.locator('[data-os-url]').inputValue()).toBe('https://reddit.com/r/dogs');
  });

  test('reloading a page regenerates it: two visits to one url are two different sites', async ({ page }) => {
    await boot(page);
    await openApp(page, 'browser');
    const browser = await appFrame(page);
    const first = await waitForPageShape(page, 'search-home', browser);
    /**
     * `data-mock-shape` is an attribute of the document's opening `<main>` tag
     * and `data-mock-token` is in its tail, so the shape is knowable while the
     * rest of the document is still streaming. Reading the token the instant
     * the shape matched read `""` — the document had not got there yet. Every
     * other genToken caller in the suite polls for a non-empty token first;
     * this one did not, and failed roughly one run in three.
     */
    await expect.poll(() => genToken(first), { timeout: 20_000 }).not.toBe('');
    const a = await genToken(first);
    expect(a).toBeTruthy();

    await browser.locator('[data-os-nav="reload"]').click();
    await expect
      .poll(async () => genToken(browser.childFrames()[0]), { timeout: 30_000 })
      .not.toBe(a);
  });
});
