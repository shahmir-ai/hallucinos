import { test, expect, type Page } from '@playwright/test';
import { MAIN, boot, openApp, appFrame } from './helpers.js';
import { routeGen, overflowDesktop, barContentsOverflowDesktop, growingBarDesktop } from './fakes.js';

/**
 * The viewport fit guard: the desktop has to fit the screen it is on.
 *
 * The page's own stylesheet says `html,body{height:100%;overflow:hidden}`, but a
 * generated desktop's `<style>` blocks are appended to `<head>` after it and
 * win. Give the desktop area a fixed 1,700 px height, write the bar after it in
 * the normal flow, and the bar — with its clock and every window entry the
 * kernel appends to it — is below the fold of a document nobody can scroll.
 *
 * This is geometry, which SPEC §2.2 gives the kernel, and not a style opinion:
 * two steps, `height:100%;overflow:hidden` inline on `<html>`/`<body>` first,
 * and `position:fixed` on a `[data-os-taskbar]` that is still clipped after it.
 * `desktop-overflow` in `e2e/fakes.ts` writes that desktop on purpose.
 */

async function barBox(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-os-taskbar]') as HTMLElement;
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
      h: r.height,
      vh: window.innerHeight,
      vw: window.innerWidth,
      position: getComputedStyle(el).position,
      pinned: el.getAttribute('data-os-fit-pinned'),
    };
  });
}

test('a desktop whose bar is below the fold is clamped and the bar is pinned', async ({ page }) => {
  await routeGen(page, { body: (req) => (req.kind === 'desktop' ? overflowDesktop(req) : null) });
  await boot(page, MAIN + '/');

  // step 1 happened, and is recorded where a harness can read it
  await expect(page.locator('html')).toHaveAttribute('data-os-fit', 'clamped');
  const clamp = await page.evaluate(() => ({
    htmlOverflow: document.documentElement.style.overflow,
    bodyOverflow: document.body.style.overflow,
    htmlHeight: document.documentElement.style.height,
    bodyHeight: document.body.style.height,
    scroll: document.documentElement.scrollHeight <= window.innerHeight + 2,
  }));
  expect(clamp.htmlOverflow).toBe('hidden');
  expect(clamp.bodyOverflow).toBe('hidden');
  expect(clamp.htmlHeight).toBe('100%');
  expect(clamp.bodyHeight).toBe('100%');

  // step 2: the bar was still 1,700 px down the flow, so it is pinned to the
  // edge it belongs to — and it is now wholly on screen
  const bar = await barBox(page);
  expect(bar.pinned).toBe('bottom');
  expect(bar.position).toBe('fixed');
  expect(bar.bottom).toBeLessThanOrEqual(bar.vh + 2);
  expect(bar.top).toBeGreaterThan(0);
  expect(bar.h).toBeGreaterThan(20);
  expect(bar.left).toBeLessThanOrEqual(2);
  expect(bar.right).toBeGreaterThanOrEqual(bar.vw - 2);

  // the clock the bar carries is on screen too, which is the point of all this
  const clock = await page.evaluate(() => {
    const r = (document.querySelector('[data-os-clock]') as HTMLElement).getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, vh: window.innerHeight };
  });
  expect(clock.bottom).toBeLessThanOrEqual(clock.vh + 2);
  expect(clock.top).toBeGreaterThan(0);
});

test('a window entry lands in the pinned bar and is reachable', async ({ page }) => {
  await routeGen(page, { body: (req) => (req.kind === 'desktop' ? overflowDesktop(req) : null) });
  await boot(page, MAIN + '/');
  await openApp(page, 'notes');
  await appFrame(page);

  const task = page.locator('[data-os-task-for]').first();
  await expect(task).toHaveCount(1);
  const box = await task.boundingBox();
  expect(box, 'the task entry has a box').not.toBeNull();
  const vh = await page.evaluate(() => window.innerHeight);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vh + 2);
  // and it is the thing on top at its own centre, i.e. really clickable
  const hit = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      return el?.closest('[data-os-task-for]')?.getAttribute('data-os-task-for') || '';
    },
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
  );
  expect(hit).not.toBe('');
});

test('a desktop that already fits is not touched', async ({ page }) => {
  await boot(page, MAIN + '/');
  // the mock's own bar is fixed to the bottom edge: nothing to clamp, nothing
  // to pin, and no inline style of ours on html or body
  await expect(page.locator('html')).not.toHaveAttribute('data-os-fit', /.*/);
  const untouched = await page.evaluate(() => ({
    pinned: document.querySelector('[data-os-taskbar]')?.getAttribute('data-os-fit-pinned'),
    htmlOverflow: document.documentElement.style.overflow,
    bodyOverflow: document.body.style.overflow,
  }));
  expect(untouched.pinned).toBeNull();
  expect(untouched.htmlOverflow).toBe('');
  expect(untouched.bodyOverflow).toBe('');
});

/**
 * Step 3 of the fit guard, which shipped in BAKEOFF-4 with no test at all: a
 * bar that fits the screen and whose CONTENTS do not. "The bar is at the right
 * edge" and "the bar is legible" are different claims and only the first one
 * was ever checked — `auto` boot 1 of BAKEOFF-4 passed the first and failed the
 * second, with every task entry a blank rectangle hanging off the bottom of the
 * screen.
 */
test('a bar whose entries hang off the screen is grown to contain them', async ({ page }) => {
  await routeGen(page, { body: (req) => (req.kind === 'desktop' ? barContentsOverflowDesktop(req) : null) });
  await boot(page, MAIN + '/');

  // the bar's own box fits, so steps 1 and 2 must NOT fire: this is a fault
  // that the old guard was blind to by construction
  await expect(page.locator('html')).not.toHaveAttribute('data-os-fit', /.*/);
  const before = await barBox(page);
  expect(before.bottom).toBeLessThanOrEqual(before.vh + 2);
  expect(before.h).toBeLessThan(40);

  await openApp(page, 'notes');
  await appFrame(page);

  // step 3 fired, and recorded the height it needed where a harness can read it
  const bar = page.locator('[data-os-taskbar]');
  await expect(bar).toHaveAttribute('data-os-fit-bar', /^\d+$/);
  const after = await barBox(page);
  expect(after.h).toBeGreaterThan(before.h);
  expect(after.position).toBe('fixed');
  expect(after.bottom).toBeLessThanOrEqual(after.vh + 2);

  // the point of all of it: every entry, its icon and its label are on screen
  const entries = await page.evaluate(() => {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    return Array.from(document.querySelectorAll('[data-os-task-for]')).map((el) => {
      const r = el.getBoundingClientRect();
      const kids = Array.from(el.querySelectorAll('*')).map((k) => {
        const b = k.getBoundingClientRect();
        return { bottom: b.bottom, top: b.top, h: b.height };
      });
      return {
        id: el.getAttribute('data-os-task-for'),
        inside: r.bottom <= vh + 2 && r.top >= -2 && r.left >= -2 && r.right <= vw + 2,
        kidsInside: kids.every((k) => k.h <= 2 || (k.bottom <= vh + 2 && k.top >= -2)),
        title: (el.textContent || '').trim(),
      };
    });
  });
  expect(entries.length).toBe(1);
  expect(entries[0].inside, 'the task entry is wholly inside the viewport').toBe(true);
  expect(entries[0].kidsInside, 'its icon and its label are too').toBe(true);
  expect(entries[0].title.length).toBeGreaterThan(0);
});

test('the grown bar is undone when the machine unmounts', async ({ page }) => {
  await routeGen(page, { body: (req) => (req.kind === 'desktop' ? barContentsOverflowDesktop(req) : null) });
  await boot(page, MAIN + '/');
  await openApp(page, 'notes');
  await appFrame(page);
  await expect(page.locator('[data-os-taskbar]')).toHaveAttribute('data-os-fit-bar', /^\d+$/);

  // a reboot is the unmount that matters: the next machine's bar starts clean
  await page.evaluate(() => (window as any).os.reboot());
  await page.waitForFunction(() => !document.querySelector('[data-os-taskbar][data-os-fit-bar]'), null, {
    timeout: 20000,
  });
  expect(await page.locator('[data-os-taskbar][data-os-fit-bar]').count()).toBe(0);
});

/**
 * KERNEL-9 — the kernel's own bar repair growing a bar over the launcher grid.
 *
 * HANDOFF-8 §8 item 1, the worst thing in that report: on 2 of 4 real desktops
 * (run D boots 3 and 4) **0 of 16 launchers were reachable at the end of the
 * session**, and the blocker carried the kernel's own attributes —
 * `div[data-os-taskbar data-os-stacked data-os-fit-bar]`. Boot 4's FIRST open
 * was a real hit-tested click and its last was not, which dates the change to
 * during the session: `fitBarContents` grew a 38 px bar to hold eight task
 * entries and the 32 px it took came out of the row of launchers above it.
 * §8's `fitLauncherRow` was blind to it by construction — it padded for a
 * fixed TOP bar, once, latched, at desktop time.
 *
 * Nothing in the tree could see this: every e2e test opened one or two windows,
 * and the only instrument that opened eight needed a paid engine. So: ten
 * windows on mock, on a desktop shaped like boot 4, and then the two questions
 * a visitor would ask — can I still start anything, and can I close what I
 * opened.
 */
test.describe('a bar that grows during the session keeps its hands off the launchers', () => {
  /** every launcher, and what a pointer at the middle of its box actually hits */
  const launcherReach = (page: Page) =>
    page.evaluate(() => {
      const ids = new Set<string>();
      const out: { id: string; hit: string; inside: boolean }[] = [];
      document.querySelectorAll('[data-os-app]').forEach((el) => {
        const id = el.getAttribute('data-os-app') || '';
        if (!id || ids.has(id)) return;
        ids.add(id);
        const r = el.getBoundingClientRect();
        if (!(r.width > 2 && r.height > 2)) {
          out.push({ id, hit: 'no-box', inside: false });
          return;
        }
        const x = Math.round(r.left + r.width / 2);
        const y = Math.round(r.top + r.height / 2);
        const at = document.elementFromPoint(x, y);
        const own = !!at && (at === el || el.contains(at));
        out.push({
          id,
          hit: own
            ? 'self'
            : !at
              ? 'nothing'
              : at.tagName.toLowerCase() +
                Array.from(at.attributes)
                  .map((a) => a.name)
                  .filter((n) => n.indexOf('data-os-') === 0)
                  .map((n) => '[' + n + ']')
                  .join(''),
          inside: r.bottom <= window.innerHeight + 2 && r.top >= -2,
        });
      });
      return out;
    });

  const barBox2 = (page: Page) =>
    page.evaluate(() => {
      const bar = document.querySelector('[data-os-taskbar]') as HTMLElement;
      const r = bar.getBoundingClientRect();
      const over: string[] = [];
      const ids = new Set<string>();
      document.querySelectorAll('[data-os-app]').forEach((el) => {
        const id = el.getAttribute('data-os-app') || '';
        if (!id || ids.has(id)) return;
        ids.add(id);
        const b = el.getBoundingClientRect();
        if (!(b.width > 2 && b.height > 2)) return;
        const y = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
        const x = Math.min(b.right, r.right) - Math.max(b.left, r.left);
        if (y > 2 && x > 2) over.push(id);
      });
      const entries = Array.from(document.querySelectorAll('[data-os-task-for]')).map((el) => {
        const b = el.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, h: b.height };
      });
      return {
        h: Math.round(r.height),
        top: Math.round(r.top),
        grown: bar.getAttribute('data-os-fit-bar'),
        contained: bar.getAttribute('data-os-fit-bar-contained'),
        over,
        entries,
        insetBottom: document.querySelector('[data-os-desktop]')?.getAttribute('data-os-fit-launchers-bottom') || null,
        vh: window.innerHeight,
      };
    });

  test('ten windows: every launcher is still hit-testable and every window closes', async ({ page }) => {
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? growingBarDesktop(req) : null) });
    await boot(page, MAIN + '/');

    /**
     * The model's bar is 38 px and its launcher row hangs 18 px into it, which
     * is the shape run D boot 4 wrote. So §8's inset has work to do before a
     * single window is open — at the BOTTOM edge, which is the edge it could
     * not see.
     */
    const atBoot = await barBox2(page);
    // 38 px of bar plus its own 1 px border
    expect(atBoot.h).toBe(39);
    expect(atBoot.insetBottom, 'the launcher area is inset for the bottom bar').toBe(String(atBoot.h));
    expect(atBoot.over, 'no launcher is under the bar before anything is opened').toEqual([]);

    const ids = (await page.evaluate(() =>
      Array.from(new Set(Array.from(document.querySelectorAll('[data-os-app]')).map((el) => el.getAttribute('data-os-app') || ''))).filter(Boolean)
    )) as string[];
    expect(ids.length).toBeGreaterThanOrEqual(10);

    // ten distinct apps, ten task entries, on a bar that holds three of them
    // per row at best. The dispatch is deliberate: by window three the
    // launchers are under the windows layer and this test is about the state
    // the session leaves behind, not about hit-testing the opens (hittest.spec).
    for (let i = 0; i < 10; i++) {
      await openApp(page, ids[i], { real: false });
      await expect.poll(() => page.locator('[data-os-window-id]').count(), { timeout: 30_000 }).toBe(i + 1);
    }
    await expect(page.locator('[data-os-task-for]')).toHaveCount(10);

    /**
     * The bound. `barGrowth`: twice the bar's own height, or one strip of
     * chrome more, whichever is larger — and never over a launcher that was
     * clear of it. Ten 64 px entries wrapping in a 38 px bar want more than
     * three rows; what the bar cannot gain, its entries give up.
     */
    const loaded = await barBox2(page);
    expect(loaded.h, 'the bar is a strip, not a third of the desktop').toBeLessThanOrEqual(atBoot.h + 48);
    expect(loaded.over, 'the grown bar is over no launcher').toEqual([]);
    expect(Number(loaded.insetBottom), 'the inset tracked the bar as it grew').toBeGreaterThanOrEqual(atBoot.h);
    // and the entries are inside the screen, which is what growing the bar was for
    for (const e of loaded.entries) expect(e.bottom).toBeLessThanOrEqual(loaded.vh + 2);

    /**
     * Every window closes, by a real hit-tested click on the close control of
     * the window a visitor can see — the same instrument `scripts/stress.mjs`
     * uses, because "measured the button" and "the button works" came apart
     * once already (HANDOFF-8 §2).
     */
    for (let left = 10; left > 0; left--) {
      const target = await page.evaluate(() => {
        const live = Array.from(document.querySelectorAll('[data-os-window-id]')).filter(
          (el) => !el.hasAttribute('data-os-minimized') && (el as HTMLElement).offsetWidth > 0
        ) as HTMLElement[];
        live.sort((a, b) => Number(b.style.zIndex || 0) - Number(a.style.zIndex || 0));
        const top = live[0];
        if (!top) return null;
        const c = top.querySelector('[data-os-close]') as HTMLElement | null;
        if (!c) return { id: top.getAttribute('data-os-window-id'), real: false, x: 0, y: 0 };
        const r = c.getBoundingClientRect();
        for (let iy = 1; iy <= 5; iy++)
          for (let ix = 1; ix <= 5; ix++) {
            const x = Math.round(r.left + (r.width * ix) / 6);
            const y = Math.round(r.top + (r.height * iy) / 6);
            if (x < 1 || y < 1 || x > window.innerWidth - 1 || y > window.innerHeight - 1) continue;
            const at = document.elementFromPoint(x, y);
            if (at && (at === c || c.contains(at))) return { id: top.getAttribute('data-os-window-id'), real: true, x, y };
          }
        return { id: top.getAttribute('data-os-window-id'), real: false, x: 0, y: 0 };
      });
      expect(target, 'a window a visitor can see').not.toBeNull();
      expect(target!.real, 'its close control is where a pointer can reach it: ' + target!.id).toBe(true);
      await page.mouse.click(target!.x, target!.y);
      await expect.poll(() => page.locator('[data-os-window-id]').count(), { timeout: 10_000 }).toBe(left - 1);
    }

    // and the thing run D lost: sixteen launchers, all of them clickable again
    const reach = await launcherReach(page);
    expect(reach.length).toBe(16);
    expect(
      reach.filter((l) => l.hit !== 'self'),
      'every launcher is what the pointer finds at its own centre'
    ).toEqual([]);
    expect(reach.filter((l) => !l.inside), 'and every one of them is on screen').toEqual([]);
  });
});
