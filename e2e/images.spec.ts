import { test, expect, type Page } from '@playwright/test';
import { MAIN } from './helpers.js';
import { routeGen } from './fakes.js';

/**
 * SPEC §12.5 / INTERFACE I3 — wallpaper and icon sheet from POST /api/img.
 *
 * The route is faked here (fal costs money and the server may not have a key),
 * so what is proved is the kernel's half: two calls per boot, started off the
 * identity rather than off the desktop, applied whenever they land, and a 404
 * leaving the model's own SVG untouched.
 */
const JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

async function routeImg(page: Page, opts: { status?: number; delayMs?: number } = {}) {
  const kinds: string[] = [];
  await page.route('**/api/img', async (route) => {
    kinds.push(String(route.request().postDataJSON()?.kind));
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.status && opts.status !== 200) return route.fulfill({ status: opts.status, body: 'no' });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dataUri: JPEG }) });
  });
  return kinds;
}

test.describe('images (I3)', () => {
  test('wallpaper and icon sheet are asked for on boot and painted in', async ({ page }) => {
    const kinds = await routeImg(page);
    const before: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/api/img')) before.push(String(r.postDataJSON()?.kind));
    });
    await page.goto(MAIN + '/');
    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });

    // two calls, no more: the per-boot ceiling is four (SPEC §12.5)
    expect(kinds.sort()).toEqual(['icons', 'wallpaper']);
    expect(kinds.length).toBeLessThanOrEqual(4);

    const wall = page.locator('[data-os-img-filled="wallpaper"]');
    await expect(wall).toHaveCount(1, { timeout: 20_000 });
    expect(await wall.evaluate((el) => (el as HTMLElement).style.backgroundImage)).toContain('data:image/jpeg');

    // the sheet is sliced: one 4x4 cell per app, in manifest order
    const cells = await page.locator('[data-os-img-filled="icon"]').count();
    expect(cells).toBeGreaterThan(8);
    const positions = await page.locator('[data-os-img-filled="icon"]').evaluateAll((els) =>
      els.slice(0, 6).map((e) => (e as HTMLElement).style.backgroundPosition)
    );
    // cell 0 is the top-left cell, inset a little so flux's own grid lines and
    // its neighbours' edges stay out of the launcher (kernel/img.ts SHEET_INSET)
    expect(positions[0]).toBe('2.23% 2.23%');
    expect(new Set(positions).size).toBeGreaterThan(3);

    // the wallpaper is the kernel's injection, so it insures the legibility of
    // the model's labels on top of it
    await expect(page.locator('#os-img-legibility')).toHaveCount(1);
  });

  /**
   * HANDOFF-8 — a wallpaper that ate the whole launcher grid.
   *
   * Boot 2 of the v0.6 desktop run declared its wallpaper slot as a
   * `position:fixed` full-screen div painted after the icons, so every pixel of
   * that machine's 15 launchers was covered by it: the first open of the run —
   * before any window existed — could not be clicked for real, and a visitor
   * would have found a finished-looking desktop whose every icon was dead.
   *
   * Reproduced here by giving the mock's desktop exactly that element. A
   * wallpaper holds nothing a pointer wants, so once the kernel adopts it as a
   * picture host it stops being what a pointer hits.
   */
  test('a full-screen wallpaper element does not eat the launchers under it', async ({ page }) => {
    await routeImg(page);
    await routeGen(page, {
      patch: (text, req) =>
        req.kind === 'desktop'
          ? // the mock declares its own wallpaper slot ON the launcher grid (a
            // host that holds launchers, which the repair must leave alone —
            // that is the other half of the rule). Move it out of the way, then
            // give the document the shape boot 2 had: a dedicated, empty,
            // fixed, full-screen wallpaper element over everything.
            text
              .replace(/data-os-img="wallpaper"/g, 'data-os-was-wallpaper="1"')
              .replace(
                '</body>',
                '<div data-os-img="wallpaper" data-os-prompt="a wall" ' +
                  'style="position:fixed;left:0;top:0;right:0;bottom:0;z-index:5"></div></body>'
              )
          : text,
    });
    await page.goto(MAIN + '/');
    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });
    await expect(page.locator('[data-os-img-filled="wallpaper"]')).toHaveCount(1, { timeout: 20_000 });

    // the element is there, full screen, and over the icons in paint order
    const reach = await page.evaluate(() => {
      const out: { id: string; hit: boolean; at: string }[] = [];
      for (const el of Array.from(document.querySelectorAll('[data-os-app]')).slice(0, 6)) {
        const r = el.getBoundingClientRect();
        const at = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
        out.push({
          id: el.getAttribute('data-os-app') || '',
          hit: !!at && (at === el || el.contains(at)),
          at: at ? at.tagName.toLowerCase() + (at.hasAttribute('data-os-img') ? '[data-os-img]' : '') : 'none',
        });
      }
      return out;
    });
    expect(reach.length).toBeGreaterThan(2);
    expect(reach.filter((r) => r.hit).length, JSON.stringify(reach)).toBe(reach.length);
    // and it is hit testing that was changed, nothing else: the element keeps
    // its own position, z-index and box
    const host = page.locator('[data-os-img="wallpaper"]');
    expect(await host.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    expect(await host.evaluate((el) => getComputedStyle(el).zIndex)).toBe('5');
    expect(await host.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
  });

  test('an image that lands after the desktop is up is still applied', async ({ page }) => {
    // 4 s: well past the 2.5 s reveal, so this arrives at a desktop the user is
    // already looking at and must never cause a repaint of anything else
    await routeImg(page, { delayMs: 4000 });
    await page.goto(MAIN + '/');
    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });
    await expect(page.locator('[data-os-img-filled="wallpaper"]')).toHaveCount(0);
    await expect(page.locator('[data-os-img-filled="wallpaper"]')).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator('[data-os-window-id]')).toHaveCount(0);
  });

  /**
   * The picture fades in (an opacity transition on the kernel-applied
   * background and nothing else) and moves NOTHING. BAKEOFF-2: the desktop is
   * revealed with grey tiles and no wallpaper and the pictures land 2-7 s later,
   * on a desktop someone is already looking at — a hard cut reads as a glitch,
   * and a launcher that jumps is worse than no wallpaper at all.
   */
  test('the wallpaper fades in behind the launchers and moves none of them', async ({ page }) => {
    await routeImg(page, { delayMs: 3200 });
    await page.goto(MAIN + '/');
    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });

    // record every opacity the kernel writes on its own layer, so the fade is
    // proved rather than glimpsed
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as any).__fade = seen;
      new MutationObserver((recs) => {
        for (const r of recs) {
          const el = r.target as HTMLElement;
          if (el.nodeType === 1 && el.hasAttribute?.('data-os-img-layer')) seen.push(el.style.opacity || 'unset');
          for (const n of Array.from(r.addedNodes)) {
            const a = n as HTMLElement;
            if (a.nodeType === 1 && a.hasAttribute?.('data-os-img-layer')) seen.push('added:' + (a.style.opacity || 'unset'));
          }
        }
      }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
    });

    const boxes = () =>
      page.$$eval('[data-os-app]', (els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',');
        })
      );
    const before = await boxes();
    expect(before.length).toBeGreaterThan(8);

    await expect(page.locator('[data-os-img-filled="wallpaper"]')).toHaveCount(1, { timeout: 30_000 });
    expect(await boxes()).toEqual(before);

    const fade = (await page.evaluate(() => (window as any).__fade)) as string[];
    expect(fade.some((v) => v === '0' || v === 'added:0')).toBe(true);
    expect(fade).toContain('1');

    // the layer is out of flow, behind the model's own content, and not clickable
    const layer = await page.$eval('[data-os-img-layer="wallpaper"]', (el) => {
      const cs = getComputedStyle(el as HTMLElement);
      const host = el.parentElement as HTMLElement;
      return {
        position: cs.position,
        zIndex: cs.zIndex,
        pointerEvents: cs.pointerEvents,
        firstChild: host.firstElementChild === el,
        hostIsolation: getComputedStyle(host).isolation,
      };
    });
    expect(layer).toEqual({
      position: 'absolute',
      zIndex: '-1',
      pointerEvents: 'none',
      firstChild: true,
      hostIsolation: 'isolate',
    });
  });

  /**
   * ICON RULING (architect, 2026-09-17, verified live). The slicing was right
   * and the picture was wrong: FLUX schnell will not put sixteen *specific*
   * icons in the requested order (weather got a music note, news got the
   * cloud), while the model's own glyph in each slot was semantically perfect
   * — and the kernel was hiding it under the picture. The sheet is now sixteen
   * matching blank plates and the glyph stays on top of its plate, visible.
   */
  test('the plate goes BEHIND the glyph and the glyph is never hidden', async ({ page }) => {
    await routeImg(page, { delayMs: 1200 });
    await page.goto(MAIN + '/');
    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });

    const before = await page.$$eval('[data-os-icon]', (els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { text: (e.textContent || '').trim(), box: [Math.round(r.width), Math.round(r.height)].join(',') };
      })
    );
    expect(before.length).toBeGreaterThan(8);
    expect(before.every((i) => i.text.length > 0)).toBe(true);

    await expect(page.locator('[data-os-img-filled="icon"]').first()).toHaveCount(1, { timeout: 30_000 });
    await expect.poll(async () => page.locator('[data-os-img-filled="icon"]').count()).toBeGreaterThan(8);

    const after = await page.$$eval('[data-os-icon]', (els) =>
      els.map((e) => {
        const cs = getComputedStyle(e as HTMLElement);
        const r = e.getBoundingClientRect();
        return {
          text: (e.textContent || '').trim(),
          box: [Math.round(r.width), Math.round(r.height)].join(','),
          color: cs.color,
          visibility: cs.visibility,
          opacity: cs.opacity,
          hasPlate: cs.backgroundImage.indexOf('data:image/jpeg') >= 0,
          align: cs.textAlign,
        };
      })
    );
    // the glyph is still there, still in ink, and still exactly where it was
    for (const [i, icon] of after.entries()) {
      expect(icon.text).toBe(before[i].text);
      expect(icon.color).not.toBe('rgba(0, 0, 0, 0)');
      expect(icon.color).not.toBe('transparent');
      expect(icon.visibility).toBe('visible');
      expect(Number(icon.opacity)).toBeGreaterThan(0);
      expect(icon.box).toBe(before[i].box);
    }
    // and it is on a plate, centred
    const plated = after.filter((i) => i.hasPlate);
    expect(plated.length).toBeGreaterThan(8);
    expect(plated.every((i) => i.align === 'center')).toBe(true);
  });

  test('no FAL_KEY (404) leaves the SVG fallback exactly where it is', async ({ page }) => {
    await routeImg(page, { status: 404 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(MAIN + '/');
    await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });
    await page.waitForTimeout(500);
    await expect(page.locator('[data-os-img-filled]')).toHaveCount(0);
    await expect(page.locator('[data-os-desktop]')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
});
