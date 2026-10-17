import { test, expect, type Page } from '@playwright/test';
import { MAIN, boot } from './helpers.js';
import { routeGen, dockLaunchersDesktop } from './fakes.js';

const dockBoot = (page: Page) =>
  routeGen(page, { body: (req) => (req.kind === 'desktop' ? dockLaunchersDesktop(req) : null) });

test('dbg', async ({ page }) => {
  page.on('console', (m) => console.log('[console:' + m.type() + '] ' + m.text()));
  page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
  await dockBoot(page);
  await boot(page, MAIN + '/');
  await page.evaluate(() => {
    const bar = document.querySelector('[data-os-taskbar]') as HTMLElement;
    console.log('BAR=' + (bar ? bar.tagName : 'null'));
    Object.defineProperty(bar, 'getBoundingClientRect', {
      configurable: true,
      value() { throw new Error('KERNEL-6 injected: the bar cannot be measured'); },
    });
  });
  const id = await page.evaluate(() => document.querySelector('[data-os-dock] [data-os-app]')!.getAttribute('data-os-app'));
  const l = page.locator(`[data-os-app="${id}"]`).first();
  await l.dispatchEvent('mousedown');
  await l.dispatchEvent('click');
  await page.waitForTimeout(3000);
  const t = await page.evaluate(() => (window as any).__osTrace() as string[]);
  console.log('TRACE:\n' + t.join('\n'));
  const wins = await page.evaluate(() => document.querySelectorAll('[data-os-window-id]').length);
  console.log('WINDOWS=' + wins);
});
