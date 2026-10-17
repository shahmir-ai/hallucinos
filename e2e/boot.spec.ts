import { test, expect } from '@playwright/test';
import { boot, MAIN, SLOW, appFrame, openApp, clickLauncher } from './helpers.js';

test.describe('boot', () => {
  test('the boot stream carries the identity; boot + desktop are the only generations', async ({ page }) => {
    const gens: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/api/gen')) gens.push(String(r.postDataJSON()?.kind));
    });
    await boot(page);

    // INTERFACE I1: the identity rides inside the boot stream. A server that has
    // not shipped it yet is allowed exactly one `identity` round trip as a
    // fallback, and nothing else: no repair generation exists any more (SPEC §12.2).
    expect(gens[0]).toBe('boot');
    expect(gens).toContain('desktop');
    expect(gens.filter((k) => k === 'identity').length).toBeLessThanOrEqual(1);
    expect(gens).not.toContain('repair');

    // the boot screen is gone once the desktop is live
    await expect(page.locator('[data-os-boot]')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-os-contract', /ok|miss/);
  });

  test('the archetype and the clock exist, patched in place when the model forgot them', async ({ page }) => {
    await boot(page);
    // I5: [data-os-archetype] on <html> or <body>, and a clock. Either the model
    // sent them or the kernel patched them onto the mounted document — either way
    // they are there, and the desktop was never regenerated to get them.
    const archetype = await page.evaluate(
      () => document.documentElement.getAttribute('data-os-archetype') || document.body.getAttribute('data-os-archetype') || ''
    );
    expect(['taskbar', 'dock']).toContain(archetype);
    await expect(page.locator('[data-os-clock]').first()).toHaveCount(1);
    const clock = (await page.locator('[data-os-clock]').first().textContent()) || '';
    expect(clock.trim().length).toBeGreaterThan(0);
  });

  // §12.3 wants every launcher reachable without scrolling. The kernel does not
  // rearrange the model's desktop, it counts what is off screen so a prompt
  // change has a number to move.
  test('the kernel counts launchers that are off screen', async ({ page }) => {
    await boot(page);
    const off = await page.getAttribute('html', 'data-os-launchers-offscreen');
    expect(off).not.toBeNull();
    expect(Number(off)).toBe(0);
  });

  test('the desktop satisfies the shape contract', async ({ page }) => {
    await boot(page);
    for (const sel of ['[data-os-desktop]', '[data-os-windows]', '[data-os-taskbar]', 'template[data-os-window]', 'template[data-os-task]']) {
      await expect(page.locator(sel)).toHaveCount(1);
    }
    const tpl = await page.evaluate(() => {
      const t = document.querySelector('template[data-os-window]') as HTMLTemplateElement;
      return ['[data-os-title]', '[data-os-content]', '[data-os-close]', '[data-os-drag]'].map((s) => !!t.content.querySelector(s));
    });
    expect(tpl).toEqual([true, true, true, true]);

    // one launcher per manifest app
    const manifest = await (await page.request.get(MAIN + '/api/manifest')).json();
    for (const app of manifest.apps) {
      await expect(page.locator(`[data-os-app="${app.id}"]`)).toHaveCount(1);
    }
    expect(manifest.apps.length).toBe(16);
  });

  test('generated documents live in sandboxed frames that are never same-origin', async ({ page }) => {
    await boot(page);
    // a real, hit-tested click on the model's own launcher
    await clickLauncher(page, 'browser');
    await appFrame(page);
    await page.waitForTimeout(1500);
    const sandboxes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('iframe')).map((f) => f.getAttribute('sandbox') || '')
    );
    expect(sandboxes.length).toBeGreaterThan(0);
    for (const s of sandboxes) {
      expect(s).toContain('allow-scripts');
      expect(s).not.toContain('allow-same-origin');
    }
    // including the nested page frame, inside the browser app
    const nested = await (await appFrame(page)).evaluate(() =>
      Array.from(document.querySelectorAll('iframe')).map((f) => f.getAttribute('sandbox') || '')
    );
    expect(nested.length).toBe(1);
    // allow-forms is granted (a search page needs a submit event to intercept);
    // allow-same-origin never is
    expect(nested[0]).toBe('allow-scripts allow-forms');
  });

  /**
   * The kernel paints NOTHING of its own during a boot: the boot document is the
   * first pixels. All the kernel contributes is the black ground SPEC §2.1 asks
   * the page for, and the iframe the model's boot screen streams into. Its own
   * two screens (queue, error) exist only when there is no OS to show, and the
   * bake-off overlays exist only on `/bakeoff/run`.
   */
  test('nothing of the kernel is on screen while the OS boots', async ({ page }) => {
    await page.goto(SLOW + '/', { waitUntil: 'commit' });
    await page.waitForSelector('[data-os-boot] iframe', { timeout: 30_000 });
    const shape = await page.evaluate(() => {
      const overlay = document.getElementById('os-boot')!;
      const cs = getComputedStyle(document.body);
      return {
        body: Array.from(document.body.children).map((el) => el.id || el.tagName.toLowerCase()),
        overlay: Array.from(overlay.children).map((el) => el.tagName.toLowerCase()),
        overlayText: (overlay.textContent || '').trim(),
        kernelScreens: document.querySelectorAll('[data-os-kernel-screen]').length,
        docks: document.querySelectorAll('[data-os-dock],[data-os-hud],[data-os-picker]').length,
        bodyBg: cs.backgroundColor,
      };
    });
    // one black ground, one overlay, one iframe inside it, and no text of ours
    expect(shape.body.filter((t) => t !== 'script')).toEqual(['os-root', 'os-boot']);
    expect(shape.overlay).toEqual(['iframe']);
    expect(shape.overlayText).toBe('');
    expect(shape.kernelScreens).toBe(0);
    expect(shape.docks).toBe(0);
    expect(shape.bodyBg).toBe('rgb(0, 0, 0)');
  });

  test('/ has no HUD and no engine picker', async ({ page }) => {
    await boot(page);
    await expect(page.locator('[data-os-hud]')).toHaveCount(0);
    await expect(page.locator('[data-os-picker]')).toHaveCount(0);
    await expect(page.locator('[data-os-engine-select]')).toHaveCount(0);
  });

  test('nothing is cached: two boots of the same url are different machines', async ({ page }) => {
    await boot(page);
    const first = await page.locator('[data-mock-token]').first().textContent();
    await page.reload();
    await page.waitForSelector('html[data-os-ready]');
    const second = await page.locator('[data-mock-token]').first().textContent();
    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
  });
});
