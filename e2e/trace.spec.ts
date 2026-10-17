import { test, expect, type Page } from '@playwright/test';
import { MAIN, boot, appFrame, frameText } from './helpers.js';
import { routeGen, dockLaunchersDesktop } from './fakes.js';

/**
 * KERNEL-6 — the blank app window (HANDOFF-5 remaining issue 1) and the
 * instrument that found it.
 *
 * The bug: the desktop's click delegation skipped anything inside
 * `[data-os-dock]`, an attribute meant to identify the kernel's own bake-off
 * chrome but written in a document the MODEL owns. SPEC §12.3's `dock`
 * archetype is "a dock along the bottom holding the launchers as icons", so a
 * generated Mac-shaped desktop that named its dock `data-os-dock` had a row of
 * dead launchers — `mousedown` returned before the speculative generation and
 * `click` returned before `openApp`, so nothing was created, nothing was
 * fetched, nothing threw and nothing was logged.
 *
 * These tests are the repro (`dock-launchers`), the fix, and the trace format
 * the next diagnosis will read.
 */

/** the real gesture: press then click, which is what a pointer does (and I4). */
async function pressAndClick(page: Page, id: string) {
  const l = page.locator(`[data-os-app="${id}"]`).first();
  await l.dispatchEvent('mousedown');
  await l.dispatchEvent('click');
}

async function trace(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__osTrace() as string[]);
}

const dockBoot = (page: Page) =>
  routeGen(page, { body: (req) => (req.kind === 'desktop' ? dockLaunchersDesktop(req) : null) });

test('a launcher inside the model’s own [data-os-dock] opens a window that fills', async ({ page }) => {
  await dockBoot(page);
  await boot(page, MAIN + '/');

  // the fixture puts the first half of the manifest in the dock
  const inDock = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-os-dock] [data-os-app]')).map((el) => el.getAttribute('data-os-app') || '')
  );
  expect(inDock.length).toBeGreaterThan(0);
  const id = inDock[0];

  await pressAndClick(page, id);

  // a window exists, it is the kernel's, and its document actually paints
  await expect(page.locator('[data-os-window-id]')).toHaveCount(1);
  const f = await appFrame(page);
  await expect.poll(async () => (await frameText(f)).length, { timeout: 30_000 }).toBeGreaterThan(0);
});

test('every launcher on a dock desktop opens, in the dock and on the wallpaper', async ({ page }) => {
  await dockBoot(page);
  await boot(page, MAIN + '/');

  const ids = await page.evaluate(() => {
    const dock = Array.from(document.querySelectorAll('[data-os-dock] [data-os-app]')).map((el) => el.getAttribute('data-os-app') || '');
    const desk = Array.from(document.querySelectorAll('[data-os-desktop] [data-os-app]')).map((el) => el.getAttribute('data-os-app') || '');
    return { dock, desk };
  });
  expect(ids.dock.length).toBeGreaterThan(0);
  expect(ids.desk.length).toBeGreaterThan(0);

  // one from each side of boot A's shape: the row that was dead, and the grid
  // that always worked
  await pressAndClick(page, ids.dock[0]);
  await pressAndClick(page, ids.desk[0]);
  await expect(page.locator('[data-os-window-id]')).toHaveCount(2);
});

test('the kernel’s own bake-off chrome is still not a launcher click', async ({ page }) => {
  await dockBoot(page);
  await boot(page, MAIN + '/bakeoff/run?engine=mock');

  // the HUD dock exists and carries the same attribute the model's dock does —
  // which is exactly why the guard is identity and not a selector now
  await expect(page.locator('#os-bakeoff-dock[data-os-dock]')).toHaveCount(1);
  const before = await page.locator('[data-os-window-id]').count();
  await page.locator('#os-bakeoff-dock [data-os-dock-hint]').dispatchEvent('click');
  expect(await page.locator('[data-os-window-id]').count()).toBe(before);
  expect((await trace(page)).some((l) => l.includes('click.kernelChrome'))).toBe(true);
});

test('the trace records every step from the launcher press to the fetch', async ({ page }) => {
  await dockBoot(page);
  await boot(page, MAIN + '/');
  const id = await page.evaluate(() => document.querySelector('[data-os-dock] [data-os-app]')!.getAttribute('data-os-app'));
  await pressAndClick(page, String(id));
  await appFrame(page);

  const lines = await trace(page);
  // the format: +<ms> <step> <detail>
  for (const l of lines) expect(l).toMatch(/^\+\d+ms \S+/);

  const steps = lines.map((l) => l.split(' ')[1]);
  const order = [
    'launcher.press',
    'launcher.click',
    'openApp.enter',
    'openApp.claim',
    'openApp.created',
    'openApp.focused',
    'openApp.stream',
    'streamApp.enter',
    'streamDoc.enter',
  ];
  let at = -1;
  for (const step of order) {
    const i = steps.indexOf(step, at + 1);
    expect(steps, 'missing or out of order: ' + step).toContain(step);
    expect(i, step + ' out of order').toBeGreaterThan(at);
    at = i;
  }
  // and the request itself is in the ring, which is the line whose ABSENCE was
  // the whole of HANDOFF-5 issue 1
  expect(steps.some((s) => s === 'gen.fetch' || s === 'streamDoc.take')).toBe(true);
});

test('an exception in an onFocus callback cannot cost the window its document', async ({ page }) => {
  await dockBoot(page);
  await boot(page, MAIN + '/');
  /**
   * The two callbacks `onFocus` runs are `pushState` and `fitBarContents`, and
   * the second one measures a bar the MODEL wrote — the kernel cannot know
   * what it will find there. The throw is injected at exactly that measurement
   * (the bar's own box), which is inside the guarded callback, inside
   * `wm.focus`, inside `openApp`, inside a delegated click handler: the chain
   * HANDOFF-5 issue 1 named as suspect 2.
   */
  await page.evaluate(() => {
    const bar = document.querySelector('[data-os-taskbar]') as HTMLElement;
    Object.defineProperty(bar, 'getBoundingClientRect', {
      configurable: true,
      value() {
        throw new Error('KERNEL-6 injected: the bar cannot be measured');
      },
    });
  });
  const id = await page.evaluate(() => document.querySelector('[data-os-dock] [data-os-app]')!.getAttribute('data-os-app'));
  await pressAndClick(page, String(id));

  const f = await appFrame(page);
  await expect.poll(async () => (await frameText(f)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  /**
   * Caught, recorded, and named. HANDOFF-7: `fitBarContents` now measures the
   * model's bar through `visible.rectOf`, which fails the measurement soft so
   * one unreadable child cannot cost the whole repair — so the throw is caught
   * one frame EARLIER than KERNEL-6's `guard`, and for a while that meant it
   * was caught nowhere visible at all. Either frame may own it; what this test
   * refuses is a swallow with no line, which is HANDOFF-5 issue 1's shape.
   */
  const lines = await trace(page);
  const named = lines.filter((l) => /threw onFocus fitBarContents|measure threw/.test(l));
  expect(named.join('\n')).toContain('cannot be measured');
  expect(named.length).toBeGreaterThan(0);
});

test('a window with no generation in flight is re-asked once by the watchdog', async ({ page }) => {
  /**
   * The watchdog is the last line of defence, not the fix. To exercise it the
   * app generation has to fail without painting anything: `streamDocInner`
   * already re-asks once on an error sentinel, so the first TWO app requests
   * are refused and the third — the watchdog's — is let through.
   */
  let refused = 0;
  await page.route('**/api/gen', async (route) => {
    let req: any = {};
    try {
      req = route.request().postDataJSON() || {};
    } catch {}
    if (req.kind === 'desktop') {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        body: dockLaunchersDesktop(req),
      });
      return;
    }
    if (req.kind === 'app' && refused < 2) {
      refused += 1;
      await route.fulfill({ status: 503, body: 'no' });
      return;
    }
    await route.continue();
  });
  await boot(page, MAIN + '/');
  const id = await page.evaluate(() => document.querySelector('[data-os-dock] [data-os-app]')!.getAttribute('data-os-app'));
  await page.locator(`[data-os-app="${id}"]`).first().dispatchEvent('click');

  const f = await appFrame(page);
  await expect.poll(async () => (await frameText(f)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(refused).toBe(2);
  const lines = await trace(page);
  expect(lines.some((l) => l.includes('watchdog.fired'))).toBe(true);
});
