import { test, expect } from '@playwright/test';
import { boot, appFrame, clickLauncher, hitTestLauncher, openAppFallbacks } from './helpers.js';
import { routeGen, dockLaunchersDesktop, startMenuDesktop } from './fakes.js';

/**
 * KERNEL-6 #2 / HANDOFF-6 #7 — the hole the suite had at its centre.
 *
 * `helpers.openApp` used to dispatch a `click` event at the launcher, which
 * bypasses hit-testing entirely. HANDOFF-5's boot A lost four windows to a
 * kernel guard that swallowed real clicks inside a `[data-os-dock]` — and 102
 * e2e tests stayed green through it, because not one of them clicked anything.
 * The only hit-tested clicker in the tree was `scripts/stress.mjs`, which needs
 * a paid engine to run.
 *
 * So: one real, hit-tested, mouse-driven open per way a launcher can be
 * reached, per archetype, on the mock engine, for free. A real click is also
 * the production path in a second way — `mousedown` starts the speculative
 * generation (SPEC §12.1 / I4) and the click that follows claims it — which a
 * dispatched event never exercised at all.
 */

test.describe('a real pointer opens an app (both archetypes, three routes)', () => {
  test.beforeEach(() => {
    openAppFallbacks.length = 0;
  });

  test('dock archetype: a launcher inside the model\'s own dock', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? dockLaunchersDesktop(req) : null) });
    await boot(page);

    // the dock half of the fixture is the first half of the manifest
    const inDock = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-os-dock] [data-os-app]')).map((el) => el.getAttribute('data-os-app'))
    );
    expect(inDock.length).toBeGreaterThan(3);
    const id = inDock[0]!;
    // the pointer really lands on the launcher and not on something over it
    expect(await hitTestLauncher(page, id)).toBe(id);
    await clickLauncher(page, id);
    const frame = await appFrame(page);
    await expect.poll(() => frame.evaluate(() => (document.body ? document.body.innerText.length : 0)), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(page.locator('[data-os-window-id]')).toHaveCount(1);
    expect(openAppFallbacks).toEqual([]);
  });

  test('dock archetype: a desktop icon on the wallpaper', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? dockLaunchersDesktop(req) : null) });
    await boot(page);
    const onDesk = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-os-desktop] [data-os-app]')).map((el) => el.getAttribute('data-os-app'))
    );
    expect(onDesk.length).toBeGreaterThan(3);
    const id = onDesk[0]!;
    expect(await hitTestLauncher(page, id)).toBe(id);
    await clickLauncher(page, id);
    await appFrame(page);
    await expect(page.locator('[data-os-window-id]')).toHaveCount(1);
  });

  test('taskbar archetype: a start-menu entry, then a grid icon', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? startMenuDesktop(req) : null) });
    await boot(page);

    /**
     * The menu first, and deliberately: a window opened over the launcher area
     * covers the model's own menu (it is `position:fixed` with no z-index of
     * its own, and §12.9 puts the windows layer above the desktop), which is
     * the model's stacking and not the kernel's to repair. HANDOFF-6's trap
     * applies — a harness that clicks a covered launcher is measuring the
     * window on top of it.
     */
    await page.locator('#start').click();
    await expect(page.locator('#menu.open')).toHaveCount(1);
    const menu = await page.evaluate(() => {
      const el = document.querySelector('#menu [data-os-app]') as HTMLElement | null;
      const id = el?.getAttribute('data-os-app') || '';
      const all = Array.from(document.querySelectorAll(`[data-os-app="${id}"]`));
      return { id, nth: Math.max(0, all.indexOf(el as Element)) };
    });
    expect(menu.id).not.toBe('');
    expect(await hitTestLauncher(page, menu.id, menu.nth)).toBe(menu.id);
    await clickLauncher(page, menu.id, menu.nth);
    await expect(page.locator('[data-os-window-id]')).toHaveCount(1);
    const first = await appFrame(page);
    await expect.poll(() => first.evaluate(() => (document.body ? document.body.innerText.length : 0)), { timeout: 20_000 }).toBeGreaterThan(0);

    // out of the way again, by its own close control, hit-tested
    await page.locator('[data-os-window-id] [data-os-close]').first().click();
    await expect(page.locator('[data-os-window-id]')).toHaveCount(0);

    // then the grid, which is where `#os-root` used to take the click
    const gridId = (await page.evaluate(
      () => document.querySelector('[data-os-desktop] [data-os-app]')?.getAttribute('data-os-app') || ''
    ))!;
    expect(gridId).not.toBe('');
    expect(await hitTestLauncher(page, gridId)).toBe(gridId);
    await clickLauncher(page, gridId);
    await appFrame(page);
    await expect(page.locator('[data-os-window-id]')).toHaveCount(1);
    expect(openAppFallbacks).toEqual([]);
  });

  /**
   * The defect these tests found on their first run, and the reason they exist.
   *
   * `#os-root` is the kernel page's own empty `position:fixed;inset:0` div, and
   * a positioned box paints above the in-flow content beside it — so on every
   * desktop whose launcher area is in normal flow (a `display:grid` section on
   * the wallpaper, which is what the desktop prompt asks for) it was the topmost
   * element at every launcher and took the click. A dispatched event never
   * noticed; a real pointer cannot miss it.
   */
  test('the kernel\'s own empty full-screen div never takes a click', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? startMenuDesktop(req) : null) });
    await boot(page);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('os-root')!).pointerEvents)).toBe('none');
    // and the launcher underneath it is what the pointer finds
    const id = (await page.evaluate(
      () => document.querySelector('[data-os-desktop] [data-os-app]')?.getAttribute('data-os-app') || ''
    ))!;
    expect(await hitTestLauncher(page, id)).toBe(id);
  });

  test('a real press starts the speculative generation the click then claims', async ({ page }) => {
    const asked = await routeGen(page, { body: (req) => (req.kind === 'desktop' ? dockLaunchersDesktop(req) : null) });
    await boot(page);
    const before = asked.filter((a) => a.kind === 'app').length;
    const id = (await page.evaluate(
      () => document.querySelector('[data-os-dock] [data-os-app]')?.getAttribute('data-os-app') || ''
    ))!;

    const box = (await page.locator(`[data-os-app="${id}"]`).first().boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // the press alone buys the document (I4), before the click completes
    await expect
      .poll(() => asked.filter((a) => a.kind === 'app').length, { timeout: 10_000 })
      .toBe(before + 1);
    await page.mouse.up();
    await appFrame(page);
    await expect(page.locator('[data-os-window-id]')).toHaveCount(1);
    // and the click claimed the press's generation rather than buying a second
    expect(asked.filter((a) => a.kind === 'app').length).toBe(before + 1);
    const trace = (await page.evaluate(() => (window as any).__osTrace())) as string[];
    expect(trace.some((l) => l.indexOf('launcher.press') >= 0)).toBe(true);
    expect(trace.some((l) => /openApp\.claim .* hit /.test(l))).toBe(true);
  });
});
