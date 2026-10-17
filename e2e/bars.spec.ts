import { test, expect, type Page } from '@playwright/test';
import { MAIN, boot, clickLauncher, appFrame } from './helpers.js';
import { routeGen, routeImg, ownClockDesktop, jammedBarDesktop, menuOverLaunchersDesktop } from './fakes.js';

/**
 * KERNEL-8 — the bar, as a surface the kernel is allowed to repair:
 *
 *  - R2: adopt the clock the model drew instead of injecting a second one
 *    (HANDOFF-7 §4: two clocks on screen at once on a live boot).
 *  - R3: one thin space between two runs of text that touch (§4: `sky23:12:50`,
 *    `02:03:559/18/2026`, 1 live bar in 4).
 *  - §8: the phone's first launcher row under a fixed menu bar.
 *
 * All three are geometry or identification, never style: no colour, font,
 * margin or padding of the model's is written by any of them, and the prompts
 * still ask for the gap and for the hook.
 */

const THIN = ' ';

/** Every run of text in the bar that reads as a time, and whether a visitor can see it. */
async function clocksOnScreen(page: Page) {
  return page.evaluate(() => {
    const TIME = /(?:^|[^0-9])([01]?[0-9]|2[0-3])[:.]([0-5][0-9])(?:[:.]([0-5][0-9]))?(?![0-9])/;
    const out: { text: string; hooked: boolean; ours: boolean }[] = [];
    const els = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
    for (const el of els) {
      let own = '';
      for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) own += n.textContent || '';
      if (!own.trim() || !TIME.test(own)) continue;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight)) continue;
      out.push({
        text: own.replace(/\s+/g, ' ').trim().slice(0, 40),
        hooked: el.hasAttribute('data-os-clock'),
        ours: !!el.closest('[data-os-injected]') || el.hasAttribute('data-os-injected'),
      });
    }
    return out;
  });
}

async function runGap(page: Page) {
  return page.evaluate(() => {
    const a = document.querySelector('#run-a') as HTMLElement | null;
    const b = document.querySelector('#run-b') as HTMLElement | null;
    if (!a || !b) return null;
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const prev = b.previousSibling;
    return {
      gap: Math.round((br.left - ar.right) * 10) / 10,
      between: prev && prev.nodeType === 3 ? prev.textContent || '' : '',
      barFit: (document.querySelector('[data-os-taskbar]') as HTMLElement | null)?.getAttribute('data-os-fit-gap') || null,
      // the net writes no style onto the model's own runs
      styleA: a.getAttribute('style') || '',
      styleB: b.getAttribute('style') || '',
    };
  });
}

test.describe('R2 — one clock', () => {
  test('a desktop that draws its own ticking clock with no hook is adopted, not doubled', async ({ page }) => {
    await routeImg(page);
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? ownClockDesktop(req) : null) });
    await boot(page);

    // the hook is on the model's element, and there is exactly one of it
    await expect(page.locator('[data-os-clock]')).toHaveCount(1);
    await expect(page.locator('[data-os-clock-adopted]')).toHaveCount(1);
    await expect(page.locator('[data-os-clock][data-os-injected]')).toHaveCount(0);

    // and exactly one clock a visitor can SEE, which is the claim that matters
    const clocks = await clocksOnScreen(page);
    expect(clocks.length, JSON.stringify(clocks)).toBe(1);
    expect(clocks[0].hooked).toBe(true);
    expect(clocks[0].ours).toBe(false);

    // it really ticks (sampled 1.2 s apart by the kernel, never repaired)
    await expect(page.locator('html')).toHaveAttribute('data-os-clock-ticks', 'true');
  });

  test('a string that only looks like a time is adopted and reported as not ticking', async ({ page }) => {
    await routeImg(page);
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? ownClockDesktop(req, { static: true }) : null) });
    await boot(page);
    await expect(page.locator('[data-os-clock]')).toHaveCount(1);
    await expect(page.locator('[data-os-clock-adopted]')).toHaveCount(1);
    // still one clock on screen: a second one would be the defect this removes
    expect((await clocksOnScreen(page)).length).toBe(1);
    await expect(page.locator('html')).toHaveAttribute('data-os-clock-ticks', 'false');
  });

  test('a desktop that declares [data-os-clock] is not adopted and not patched', async ({ page }) => {
    await boot(page, MAIN + '/');
    await expect(page.locator('[data-os-clock]')).toHaveCount(1);
    await expect(page.locator('[data-os-clock-adopted]')).toHaveCount(0);
    await expect(page.locator('[data-os-clock][data-os-injected]')).toHaveCount(0);
  });
});

test.describe('R3 — the bar spacing net', () => {
  test('`sky` jammed against `23:12:50` gets one thin space', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? jammedBarDesktop(req, 'name-clock') : null) });
    await boot(page);
    const r = (await runGap(page))!;
    expect(r.between).toBe(THIN);
    expect(r.gap).toBeGreaterThan(0);
    expect(r.barFit).toBe('1');
    expect(r.styleA).toBe('');
    expect(r.styleB).toBe('');
  });

  test('`02:03:55` jammed against `9/18/2026` gets one thin space', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? jammedBarDesktop(req, 'time-date') : null) });
    await boot(page);
    const r = (await runGap(page))!;
    expect(r.between).toBe(THIN);
    expect(r.gap).toBeGreaterThan(0);
    expect(r.barFit).toBe('1');
  });

  test('a bar with a 12 px gap is left exactly as the model wrote it', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? jammedBarDesktop(req, 'spaced') : null) });
    await boot(page);
    const r = (await runGap(page))!;
    expect(r.between).toBe('');
    expect(r.barFit).toBe(null);
    expect(r.gap).toBeGreaterThanOrEqual(10);
    await expect(page.locator('[data-os-fit-gap]')).toHaveCount(0);
  });

  test('a window entry that jams the bar after it opens is spaced too', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? jammedBarDesktop(req, 'time-date') : null) });
    await boot(page);
    const before = (await runGap(page))!.barFit;
    await clickLauncher(page, 'notes');
    await appFrame(page);
    // the entry lands in a `gap:0` bar next to the clock, so the net fires again
    const after = await page.evaluate(() => {
      const bar = document.querySelector('[data-os-taskbar]') as HTMLElement;
      const runs = (Array.from(bar.querySelectorAll('*')) as HTMLElement[])
        .filter((el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim()))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
      const kept = runs.filter((x) => !runs.some((o) => o !== x && x.contains(o)));
      let tightest = Infinity;
      for (const a of kept)
        for (const b of kept) {
          if (a === b) continue;
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          if (!(br.left >= ar.right - 2)) continue;
          if (Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top) <= 2) continue;
          if (
            kept.some((c) => {
              if (c === a || c === b) return false;
              const cr = c.getBoundingClientRect();
              return cr.left >= ar.right - 2 && cr.right <= br.left + 2 && Math.min(ar.bottom, cr.bottom) - Math.max(ar.top, cr.top) > 2;
            })
          )
            continue;
          tightest = Math.min(tightest, br.left - ar.right);
        }
      return { tightest, fit: bar.getAttribute('data-os-fit-gap') };
    });
    expect(before).toBe('1');
    // no pair of runs in the bar is touching any more
    expect(after.tightest).toBeGreaterThan(0);
    expect(Number(after.fit)).toBeGreaterThanOrEqual(1);
  });
});

test.describe('the phone launcher row under a fixed bar (HANDOFF-7 §8)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the desktop is padded down by the height of the bar over it', async ({ page }) => {
    await routeImg(page);
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? menuOverLaunchersDesktop(req) : null) });
    await boot(page);

    const desk = page.locator('[data-os-desktop]');
    await expect(desk).toHaveAttribute('data-os-fit-launchers', '34');
    const r = await page.evaluate(() => {
      const bar = (document.querySelector('[data-os-taskbar]') as HTMLElement).getBoundingClientRect();
      const d = document.querySelector('[data-os-desktop]') as HTMLElement;
      let firstTop = Infinity;
      let overlap = 0;
      const seen = new Set<string>();
      document.querySelectorAll('[data-os-app]').forEach((el) => {
        const id = el.getAttribute('data-os-app') || '';
        if (!id || seen.has(id)) return;
        seen.add(id);
        const b = el.getBoundingClientRect();
        if (!(b.width > 2 && b.height > 2)) return;
        firstTop = Math.min(firstTop, b.top);
        const y = Math.min(b.bottom, bar.bottom) - Math.max(b.top, bar.top);
        const x = Math.min(b.right, bar.right) - Math.max(b.left, bar.left);
        if (y > 2 && x > 2) overlap++;
      });
      return { padTop: getComputedStyle(d).paddingTop, firstTop, overlap, barBottom: bar.bottom };
    });
    // 6 px of the model's own padding plus the 34 px bar
    expect(r.padTop).toBe('40px');
    expect(r.overlap, 'no launcher is under the menu bar any more').toBe(0);
    expect(r.firstTop).toBeGreaterThanOrEqual(r.barBottom - 1);
  });

  test('a desktop whose launchers clear the bar is not padded', async ({ page }) => {
    await boot(page, MAIN + '/');
    await expect(page.locator('[data-os-fit-launchers]')).toHaveCount(0);
  });
});
