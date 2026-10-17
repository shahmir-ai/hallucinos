import { test, expect } from '@playwright/test';
import { boot, openApp, appFrame, genToken, frameText } from './helpers.js';
import { nextVersion } from '../kernel/contract.js';

/** SPEC §10.2: open calculator, notes, store, install one app, see it on the desktop. */
test.describe('apps', () => {
  test('the calculator and the notes app open into their own windows', async ({ page }) => {
    await boot(page);
    await openApp(page, 'calculator');
    const calc = await appFrame(page);
    await expect.poll(() => frameText(calc), { timeout: 20_000 }).toContain('Reckoner');

    await openApp(page, 'notes');
    const notes = await appFrame(page);
    await expect.poll(() => frameText(notes), { timeout: 20_000 }).toContain('Diary');

    // two windows, two taskbar entries
    await expect(page.locator('[data-os-window-id]')).toHaveCount(2);
    await expect(page.locator('[data-os-task-for]')).toHaveCount(2);
  });

  test('installing from the store puts a launcher on the desktop, labelled with the app name', async ({ page }) => {
    await boot(page);
    const before = await page.locator('[data-os-app]').count();
    await openApp(page, 'store');
    const store = await appFrame(page);
    await expect.poll(() => frameText(store), { timeout: 20_000 }).toContain('App Bazaar');

    await store.locator('[data-mock="install"]').click();
    const launcher = page.locator('[data-os-app^="custom:"]');
    await expect(launcher).toHaveCount(1, { timeout: 10_000 });
    expect(await page.locator('[data-os-app]').count()).toBe(before + 1);

    // the launcher carries the model's own name, not the raw custom:<slug> id
    const id = await launcher.getAttribute('data-os-app');
    const label = (await launcher.innerText()).trim();
    expect(id).toMatch(/^custom:/);
    expect(label).toContain('Loomwright');
    expect(label).not.toContain('custom:');

    // and it opens
    await launcher.click();
    const custom = await appFrame(page);
    await expect.poll(() => frameText(custom), { timeout: 20_000 }).not.toBe('');
  });

  test('os.state() reports the windows that are open', async ({ page }) => {
    await boot(page);
    await openApp(page, 'notes');
    await appFrame(page);
    await openApp(page, 'mail');
    const mail = await appFrame(page);
    await expect.poll(() => frameText(mail), { timeout: 20_000 }).not.toBe('');

    const state = await mail.evaluate(() => (window as any).os.state());
    expect(state.windows.map((w: any) => w.app).sort()).toEqual(['mail', 'notes']);
    expect(state.os).toBeTruthy();
  });

  test('reloading an app regenerates it', async ({ page }) => {
    await boot(page);
    await openApp(page, 'notes');
    const notes = await appFrame(page);
    await expect.poll(() => genToken(notes), { timeout: 20_000 }).not.toBe('');
    const first = await genToken(notes);

    await notes.evaluate(() => (window as any).os.reload());
    await expect.poll(() => genToken(notes), { timeout: 20_000 }).not.toBe(first);
  });

  test('the updater can reboot the machine into the next version, same name', async ({ page }) => {
    await boot(page);
    const first = await page.evaluate(() => (window as any).os.state().os);
    expect(first.name).toBeTruthy();

    await page.evaluate(() => (window as any).os.reboot());
    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });
    const after = await page.evaluate(() => (window as any).os.state().os);
    // same name lineage, version one step on
    expect(after.name).toBe(first.name);
    expect(after.version).toBe(nextVersion(first.version));
  });
});
