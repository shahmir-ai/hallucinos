import { test, expect, type Frame, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { MAIN, appFrame, pageFrame, openApp } from './helpers.js';

/**
 * Kernel timings on the mock engine (SPEC §12.1's targets are for a real fast
 * engine; what this measures is the kernel's own overhead around a ~1,500 tok/s
 * stream). Writes reviews/PERF-KERNEL-1.md so the numbers are checkable rather
 * than asserted in prose.
 */
const BOOTS = 3;

async function firstText(f: Frame, deadlineMs = 60_000): Promise<number> {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    const n = await f.evaluate(() => (document.body ? document.body.innerText.length : 0)).catch(() => 0);
    if (n > 0) return Date.now();
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('never painted');
}

async function bootFramePaint(page: Page, t0: number): Promise<number> {
  const el = await page.waitForSelector('[data-os-boot] iframe', { timeout: 30_000 });
  const f = await el.contentFrame();
  const at = await firstText(f!);
  return at - t0;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

test.describe('kernel timings', () => {
  test('boot paint, desktop interactive, app and page, on the mock engine', async ({ page }) => {
    test.setTimeout(240_000);
    const rows: Record<string, number[]> = { bootPaint: [], desktopInteractive: [], desktopRevealed: [], appPaint: [], pagePaint: [] };

    for (let i = 0; i < BOOTS; i++) {
      const t0 = Date.now();
      await page.goto(MAIN + '/');
      rows.bootPaint.push(await bootFramePaint(page, t0));
      await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });
      rows.desktopRevealed.push(Date.now() - t0);
      // the kernel's own number: mount + wiring, measured from the boot request
      rows.desktopInteractive.push(Number(await page.getAttribute('html', 'data-os-desktop-ms')) || 0);

      const tApp = Date.now();
      await openApp(page, 'browser');
      const app = await appFrame(page);
      rows.appPaint.push((await firstText(app)) - tApp);

      const home = await pageFrame(page, app);
      const tPage = Date.now();
      await home.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input[name],input'));
        const q = inputs[0] as HTMLInputElement;
        q.value = 'best pizza in town';
        (q.form || document.querySelector('form'))!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      const after = await pageFrame(page, app);
      rows.pagePaint.push((await firstText(after)) - tPage);
    }

    const lines = [
      '# PERF-KERNEL-1 — kernel timings on the mock engine',
      '',
      `Measured ${new Date().toISOString()} by \`e2e/perf.spec.ts\`, ${BOOTS} boots, mock engine`,
      'at ~1,500 tok/s with no provider latency. These are **kernel overhead** numbers:',
      'SPEC §12.1 targets (boot paint < 1.0 s, desktop interactive < 4 s, app < 2.5 s,',
      'page < 2.5 s) are for the chosen fast engine and are decided by a bake-off, not here.',
      '',
      '| step | median ms | all (ms) |',
      '|---|---|---|',
      ...Object.entries(rows).map(([k, v]) => `| ${k} | ${median(v)} | ${v.join(', ')} |`),
      '',
      '- `bootPaint` — navigation start to the first painted pixel of the boot document.',
      '- `desktopInteractive` — the kernel mark: boot request start to a mounted, wired,',
      '  window-manager-owning desktop (behind the boot screen).',
      '- `desktopRevealed` — when the boot screen lifts. Floored at 2.5 s by SPEC §12.3,',
      '  so a number near 2.5 s here means the desktop was ready early and waited.',
      '- `appPaint` — launcher press to the first painted pixel of the app document.',
      '- `pagePaint` — a search submitted inside the browser to the first painted pixel of',
      '  the results document.',
      '',
    ];
    writeFileSync(new URL('../reviews/PERF-KERNEL-1.md', import.meta.url), lines.join('\n'));

    // the kernel's own overhead, not the model's: generous ceilings that only
    // fail if something structural regresses
    expect(median(rows.bootPaint)).toBeLessThan(3000);
    expect(median(rows.appPaint)).toBeLessThan(5000);
    expect(median(rows.pagePaint)).toBeLessThan(5000);
    expect(median(rows.desktopRevealed)).toBeGreaterThanOrEqual(2500);
  });
});
