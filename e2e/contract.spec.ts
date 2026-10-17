import { test, expect } from '@playwright/test';
import { BROKEN, REPAIRABLE, openApp, appFrame, frameText } from './helpers.js';

/**
 * The two servers playwright.config has always started for this and no test ever
 * used: MOCK_BREAK=desktop-always (8792) and MOCK_BREAK=desktop-once (8794).
 * SPEC §3.2 — one repair pass, then bare injection, and the OS still works.
 */
test.describe('the shape contract when the model forgets', () => {
  test('a desktop that never grows a taskbar gets one injected, and the boot survives', async ({ page }) => {
    await page.goto(BROKEN + '/');
    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });

    // the contract miss is recorded, not hidden
    await expect(page.locator('html')).toHaveAttribute('data-os-contract', 'miss');
    // and the missing piece is there, bare and marked as ours
    const bar = page.locator('[data-os-taskbar]');
    await expect(bar).toHaveCount(1);
    await expect(bar).toHaveAttribute('data-os-injected', '');

    // the machine is fully usable: windows open into the model's own layer
    await openApp(page, 'notes');
    const notes = await appFrame(page);
    await expect.poll(() => frameText(notes), { timeout: 20_000 }).toContain('Diary');
    await expect(page.locator('[data-os-windows] [data-os-window-id]')).toHaveCount(1);
    // the injected taskbar is a real taskbar: it gets the window's entry
    await expect(page.locator('[data-os-taskbar] [data-os-task-for]')).toHaveCount(1);
    // SPEC §12.3 wants the clock IN the bar. The patch used to run before the
    // taskbar was created, so on a desktop missing both the clock landed on the
    // wallpaper instead.
    await expect(page.locator('[data-os-taskbar] [data-os-clock]')).toHaveCount(1);
    const t1 = await page.locator('[data-os-clock]').innerText();
    await expect.poll(async () => page.locator('[data-os-clock]').innerText(), { timeout: 5000 }).not.toBe(t1);
  });

  test('a desktop that forgets a hook is patched in place, never regenerated', async ({ page }) => {
    const kinds: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/api/gen')) kinds.push(String(r.postDataJSON()?.kind));
    });
    await page.goto(REPAIRABLE + '/');
    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });

    // SPEC §12.2 killed the repair generation: the desktop on screen is the
    // desktop that was generated, with the missing piece put into it.
    expect(kinds).not.toContain('repair');
    expect(kinds.filter((k) => k === 'desktop').length).toBe(1);
    await expect(page.locator('html')).toHaveAttribute('data-os-contract', 'miss');
    const bar = page.locator('[data-os-taskbar]');
    await expect(bar).toHaveCount(1);
    await expect(bar).toHaveAttribute('data-os-injected', '');

    // and it is a working machine, not a repaired-looking one
    await openApp(page, 'notes');
    const notes = await appFrame(page);
    await expect.poll(() => frameText(notes), { timeout: 20_000 }).toContain('Diary');
  });

  /**
   * The patched hooks are appended to document.body AFTER the mount, so they
   * were not in the mount record and teardown left them behind. A reboot then
   * found the DEAD machine's injected taskbar first — the new boot's task
   * entries went into it — and, worse for the measurement, `domMissing()` saw
   * `[data-os-taskbar]` already present and recorded no miss at all for the
   * second boot. That is the exact number SPEC §10.3 and the bake-off gate on.
   */
  test('an injected hook belongs to its own boot and is gone after a reboot', async ({ page }) => {
    await page.goto(BROKEN + '/');
    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });
    await expect(page.locator('[data-os-taskbar]')).toHaveCount(1);
    // tag boot 1's injected bar so it can be recognised if it survives
    await page.evaluate(() => document.querySelector('[data-os-taskbar]')!.setAttribute('data-boot-one', ''));

    await page.evaluate(() => (window as any).os.reboot());
    await page.waitForSelector('html:not([data-os-ready])', { timeout: 20_000 });
    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });

    const bars = page.locator('[data-os-taskbar]');
    await expect(bars, 'the dead machine took its patched taskbar with it').toHaveCount(1);
    await expect(page.locator('[data-os-taskbar][data-boot-one]')).toHaveCount(0);
    // and boot 2 recorded its own miss rather than inheriting boot 1's fix
    await expect(page.locator('html')).toHaveAttribute('data-os-contract', 'miss');
    await expect(bars).toHaveAttribute('data-os-injected', '');
    await expect(page.locator('[data-os-injected][data-os-app]')).toHaveCount(0);

    // the new machine's windows go into the new machine's bar
    await openApp(page, 'notes');
    await expect(page.locator('[data-os-taskbar] [data-os-task-for]')).toHaveCount(1);
  });
});
