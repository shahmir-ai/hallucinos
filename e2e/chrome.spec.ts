import { test, expect } from '@playwright/test';
import { MAIN, boot, openApp, appFrame } from './helpers.js';
import { routeGen, chromelessDesktop, topBarDesktop } from './fakes.js';

/**
 * SEAM T4 / the architect's defect D2 — a window nobody can close or move.
 *
 * The live boot's window had no visible title bar and no visible close,
 * minimise or maximise control: the app's own header was the top of the window.
 * Every instrument in the tree called that desktop `contract: ok`, because the
 * validator asks whether `[data-os-close]` is in the document and D2 is about
 * whether a person can see it. So the kernel measures the chrome in pixels
 * after the window is on screen, and patches ONE bare unstyled strip in when it
 * is unusable.
 *
 * `chromelessDesktop` is that desktop as a fixture: every hook present and
 * correctly spelled, the title bar `height:0;overflow:hidden`, the three
 * controls `0x0;opacity:0`.
 */

test.describe('window chrome usability (T4/D2)', () => {
  test('a title bar with no height and controls with no box get one bare strip', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? chromelessDesktop(req) : null) });
    await boot(page);

    // the reading taken at mount, before anything was opened
    await expect(page.locator('html')).toHaveAttribute('data-os-chrome-template', /bar-0px|bar-invisible/);

    await openApp(page, 'notes');
    await appFrame(page);
    const win = page.locator('[data-os-window-id]').first();
    await expect(win).toHaveAttribute('data-os-chrome', 'patched');
    await expect(win).toHaveAttribute('data-os-chrome-why', /close-/);

    const strip = win.locator('[data-os-chrome-fallback]');
    await expect(strip).toHaveCount(1);
    const box = await strip.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(20);
    expect(box!.width).toBeGreaterThan(100);

    // the title is on it, and it is the window's own title
    expect((await strip.locator('[data-os-title]').innerText()).trim().length).toBeGreaterThan(0);
    // three bare controls, each one big enough to hit
    for (const attr of ['data-os-minimize', 'data-os-maximize', 'data-os-close']) {
      const b = strip.locator(`[${attr}]`);
      await expect(b).toHaveCount(1);
      const bb = await b.boundingBox();
      expect(bb!.width, attr).toBeGreaterThanOrEqual(12);
      expect(bb!.height, attr).toBeGreaterThanOrEqual(12);
    }
    // and it is reported, not silent
    await expect(page.locator('html')).toHaveAttribute('data-os-contract-patch', /chrome/);
  });

  test('the bare close control really closes the window, by a hit-tested click', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? chromelessDesktop(req) : null) });
    await boot(page);
    await openApp(page, 'notes');
    await appFrame(page);
    await expect(page.locator('[data-os-window-id]')).toHaveCount(1);

    await page.locator('[data-os-chrome-fallback] [data-os-close]').click();
    await expect(page.locator('[data-os-window-id]')).toHaveCount(0);
  });

  test('the bare strip drags the window, which is the other half of D2', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? chromelessDesktop(req) : null) });
    await boot(page);
    await openApp(page, 'notes');
    await appFrame(page);
    const win = page.locator('[data-os-window-id]').first();
    const before = await win.boundingBox();

    const strip = await page.locator('[data-os-chrome-fallback]').boundingBox();
    // well clear of the three controls at the right end
    await page.mouse.move(strip!.x + 30, strip!.y + strip!.height / 2);
    await page.mouse.down();
    await page.mouse.move(strip!.x + 130, strip!.y + strip!.height / 2 + 60, { steps: 6 });
    await page.mouse.up();

    const after = await win.boundingBox();
    expect(Math.round(after!.x - before!.x)).toBeGreaterThan(60);
    expect(Math.round(after!.y - before!.y)).toBeGreaterThan(30);
  });

  test('a maximize a template never had: the bare control still works', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? chromelessDesktop(req) : null) });
    await boot(page);
    await openApp(page, 'notes');
    await appFrame(page);
    const win = page.locator('[data-os-window-id]').first();
    const before = await win.boundingBox();
    await page.locator('[data-os-chrome-fallback] [data-os-maximize]').click();
    await expect(win).toHaveAttribute('data-os-maximized', 'true');
    const after = await win.boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width);
  });

  test('usable chrome is never patched: no strip, and the reading says ok', async ({ page }) => {
    // the mock engine's own desktop, whose template has a real title bar
    await boot(page);
    await expect(page.locator('html')).toHaveAttribute('data-os-chrome-template', 'ok');
    await openApp(page, 'notes');
    await appFrame(page);
    const win = page.locator('[data-os-window-id]').first();
    await expect(win).toHaveAttribute('data-os-chrome', 'ok');
    await expect(win.locator('[data-os-chrome-fallback]')).toHaveCount(0);
    expect(await page.locator('html').getAttribute('data-os-contract-patch')).toBeNull();
  });

  /**
   * D2's last case, found on a live `dock` boot after the strip patch shipped:
   * chrome that is not broken and is not reachable. The window's title strip was
   * 893x28 with a 20x20 close control — real pixels, `data-os-chrome="ok"`, no
   * patch needed and no patch that could have helped — and both were UNDER the
   * machine's own top menu bar, which SPEC §12.9 raises above the windows layer.
   * The window was in the wrong place, so the fix is in the cascade's area.
   */
  test('a top menu bar does not get to sit on the first window\'s title bar', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? topBarDesktop(req) : null) });
    await boot(page, MAIN + '/');
    await openApp(page, 'notes');
    await appFrame(page);

    const r = await page.evaluate(() => {
      const bar = document.querySelector('[data-os-taskbar]') as HTMLElement;
      const w = document.querySelector('[data-os-window-id]') as HTMLElement;
      const close = w.querySelector('[data-os-close]') as HTMLElement;
      const drag = w.querySelector('[data-os-drag]') as HTMLElement;
      const reach = (el: HTMLElement) => {
        const b = el.getBoundingClientRect();
        const at = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2));
        return !!at && (at === el || el.contains(at) || at.contains(el));
      };
      return {
        barBottom: Math.round(bar.getBoundingClientRect().bottom),
        windowTop: Math.round(w.getBoundingClientRect().top),
        closeReachable: reach(close),
        dragReachable: reach(drag),
      };
    });

    // the window starts below the bar, and both of its control surfaces answer
    expect(r.barBottom).toBeGreaterThan(20);
    expect(r.windowTop).toBeGreaterThanOrEqual(r.barBottom);
    expect(r.closeReachable, 'a visitor can reach the close control').toBe(true);
    expect(r.dragReachable, 'a visitor can reach the title strip to move the window').toBe(true);
  });

  test('a top bar cannot take more than a fifth of the screen from the windows', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? topBarDesktop(req) : null) });
    await boot(page, MAIN + '/');
    await openApp(page, 'notes');
    await appFrame(page);
    const r = await page.evaluate(() => {
      const w = document.querySelector('[data-os-window-id]') as HTMLElement;
      const b = w.getBoundingClientRect();
      return { h: Math.round(b.height), vh: innerHeight, top: Math.round(b.top) };
    });
    // the inset is a bar's height, not a margin: the window still fills the screen
    expect(r.top).toBeLessThan(r.vh * 0.2);
    expect(r.h).toBeGreaterThan(r.vh * 0.5);
  });

  test('a task entry with no box is replaced by a bare one carrying the title', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? chromelessDesktop(req, { tasks: 'hidden' }) : null) });
    await boot(page);
    await openApp(page, 'notes');
    await appFrame(page);

    const entry = page.locator('[data-os-taskbar] [data-os-task-fallback]');
    await expect(entry).toHaveCount(1);
    const box = await entry.boundingBox();
    expect(box!.width).toBeGreaterThan(8);
    expect(box!.height).toBeGreaterThan(8);
    expect((await entry.innerText()).trim().length).toBeGreaterThan(0);
    await expect(page.locator('html')).toHaveAttribute('data-os-contract-patch', /task/);

    // and it is a real entry: clicking it focuses the window it belongs to
    const id = await entry.getAttribute('data-os-task-for');
    expect(id).toMatch(/^w\d+$/);
    await entry.click();
    await expect(page.locator(`[data-os-window-id="${id}"]`)).toHaveAttribute('data-os-focused', 'true');
  });

  test('a machine is not judged by the machine before it: the patch flag is per boot', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? chromelessDesktop(req) : null) });
    await boot(page);
    await openApp(page, 'notes');
    await appFrame(page);
    await expect(page.locator('html')).toHaveAttribute('data-os-contract-patch', /chrome/);

    // a reboot is a whole new machine (SPEC §4), and this one has usable chrome
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.evaluate(() => (window as any).os.reboot());
    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });
    await expect.poll(async () => page.locator('html').getAttribute('data-os-contract-patch'), { timeout: 20_000 }).toBeNull();
  });
});
