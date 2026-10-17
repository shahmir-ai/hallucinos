import { test, expect, type Page } from '@playwright/test';
import { MAIN, boot } from './helpers.js';
import { routeGen, routeImg, dockLabelDesktop, boxlessIconDesktop, hoverLabelDesktop, overflowDesktop } from './fakes.js';

/**
 * The architect's defect D3 — the dock's launcher labels were visible before
 * the plate sheet landed and gone after it.
 *
 * The cause was the kernel's own glyph centring: a `line-height` the height of
 * the icon slot, written onto the element carrying `[data-os-icon]`. On the
 * shape §12.3's prompt asks for (one glyph in a 48 px box, the label in a
 * sibling) that is harmless. On a launcher that carries `data-os-icon` itself
 * the glyph's line box grows inside it, everything after the glyph is pushed
 * down, and the dock's own `overflow:hidden` takes the label away. The guard
 * that was supposed to prevent this measured the target's OWN box, which a
 * dock icon's pinned height cannot change.
 *
 * What is asserted here is the visitor's reading and not the DOM's: the LABEL'S
 * VISIBLE PIXELS, intersected with every clipping ancestor and the viewport.
 * `innerText` was 16 of 16 on every boot in HANDOFF-6's probes while this
 * defect was live, which is why no instrument in the tree caught it.
 */

interface LabelRead {
  id: string;
  area: number;
  text: string;
}

/**
 * Every launcher's label, measured the way `kernel/visible.ts` measures it.
 * Deliberately a separate implementation from the kernel's: a test that shares
 * the code it is testing proves the code agrees with itself.
 */
async function labels(page: Page): Promise<LabelRead[]> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const out: { id: string; area: number; text: string }[] = [];
    const seenIds = new Set<string>();
    document.querySelectorAll('[data-os-app]').forEach((lau) => {
      const id = lau.getAttribute('data-os-app') || '';
      if (!id || seenIds.has(id)) return;
      seenIds.add(id);
      const icon = lau.querySelector('[data-os-icon]');
      // the label: the text of the launcher that is not the icon's glyph
      const parts: Element[] = [];
      const walk = (el: Element) => {
        Array.from(el.children).forEach((c) => {
          if (icon && (c === icon || c.contains(icon))) {
            if (c !== icon) walk(c);
            return;
          }
          if (!(c.textContent || '').trim()) return;
          if (c.children.length === 0) parts.push(c);
          else walk(c);
        });
      };
      walk(lau);
      if (!parts.length && lau.children.length === 0 && (lau.textContent || '').trim()) parts.push(lau);
      let area = 0;
      let text = '';
      for (const p of parts) {
        const r = p.getBoundingClientRect();
        let l = r.left;
        let t = r.top;
        let rt = r.right;
        let b = r.bottom;
        let op = 1;
        let a: Element | null = p;
        while (a && a !== document.documentElement) {
          const cs = getComputedStyle(a as HTMLElement);
          if (cs.visibility !== 'visible' || cs.display === 'none') op = 0;
          op *= parseFloat(cs.opacity) || 0;
          if (a !== p && (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) {
            const ar = a.getBoundingClientRect();
            l = Math.max(l, ar.left);
            t = Math.max(t, ar.top);
            rt = Math.min(rt, ar.right);
            b = Math.min(b, ar.bottom);
          }
          a = a.parentElement;
        }
        l = Math.max(l, 0);
        t = Math.max(t, 0);
        rt = Math.min(rt, vw);
        b = Math.min(b, vh);
        if (op > 0.01) area += Math.max(0, rt - l) * Math.max(0, b - t);
        text += (p.textContent || '').trim();
      }
      out.push({ id, area: Math.round(area), text });
    });
    return out;
  });
}

/** Every launcher whose icon slot the sheet actually filled. */
async function platesLanded(page: Page): Promise<number> {
  return page.locator('[data-os-app] [data-os-img-filled="icon"], [data-os-app][data-os-img-filled="icon"]').count();
}

test.describe('launcher labels survive the pictures (D3 / T4)', () => {
  test('a dock whose launchers ARE their icon slots keeps every label', async ({ page }) => {
    const imgs = await routeImg(page);
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? dockLabelDesktop(req) : null) });
    await boot(page);

    const before = await labels(page);
    expect(before.length).toBeGreaterThan(8);
    expect(before.every((l) => l.area > 0)).toBe(true);

    // the sheet and the wallpaper land on a desktop that is already on screen
    await expect.poll(() => platesLanded(page), { timeout: 20_000 }).toBeGreaterThan(8);
    await expect.poll(() => page.locator('[data-os-img-filled="wallpaper"]').count(), { timeout: 20_000 }).toBe(1);
    await page.waitForTimeout(700); // past the fade

    const after = await labels(page);
    const lost = after.filter((l) => l.area <= 0).map((l) => l.id);
    expect(lost, 'launchers whose label has no visible pixels after the pictures').toEqual([]);
    // and not merely present: readable, i.e. most of what it was
    for (const b of before) {
      const a = after.find((x) => x.id === b.id)!;
      expect(a.area, b.id).toBeGreaterThanOrEqual(Math.round(b.area * 0.5));
      expect(a.text, b.id).toBe(b.text);
    }
    expect(imgs.filter((c) => c.kind === 'icons').length).toBe(1);
  });

  test('a taskbar grid keeps every label too', async ({ page }) => {
    await routeImg(page);
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? overflowDesktop(req) : null) });
    await boot(page);
    const before = await labels(page);
    await expect.poll(() => platesLanded(page), { timeout: 20_000 }).toBeGreaterThan(8);
    await page.waitForTimeout(700);
    const after = await labels(page);
    expect(after.filter((l) => l.area <= 0).map((l) => l.id)).toEqual([]);
    expect(after.map((l) => l.text)).toEqual(before.map((l) => l.text));
  });

  test("T4's net: the kernel takes its own styles back rather than cost a label", async ({ page }) => {
    await routeImg(page);
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? boxlessIconDesktop(req) : null) });
    await boot(page);

    const before = await labels(page);
    expect(before.every((l) => l.area > 0)).toBe(true);
    await expect.poll(() => platesLanded(page), { timeout: 20_000 }).toBeGreaterThan(8);
    await page.waitForTimeout(700);

    const after = await labels(page);
    expect(after.filter((l) => l.area <= 0).map((l) => l.id)).toEqual([]);
    // the net fired: a boxless slot's 44 px box would have pushed every label
    // out of a launcher that clips at 48 px, so the styles were taken back
    const kept = await page.locator('[data-os-label-kept]').count();
    expect(kept).toBeGreaterThan(0);
  });

  test('a label the MODEL hid is left exactly as it was', async ({ page }) => {
    await routeImg(page);
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? hoverLabelDesktop(req) : null) });
    await boot(page);
    await expect.poll(() => platesLanded(page), { timeout: 20_000 }).toBeGreaterThan(8);
    await page.waitForTimeout(700);

    // hover-only labels: zero visible pixels before and after, and the kernel
    // neither undid anything nor wrote a style onto them
    const after = await labels(page);
    expect(after.every((l) => l.area === 0)).toBe(true);
    expect(await page.locator('[data-os-label-kept]').count()).toBe(0);
    const styled = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-os-app] .lab')).filter((el) => (el.getAttribute('style') || '').length > 0).length
    );
    expect(styled).toBe(0);

    // and the model's own design still works: hovering shows the name
    await page.locator('[data-os-app="notes"]').first().hover();
    await page.waitForTimeout(150);
    const hovered = (await labels(page)).find((l) => l.id === 'notes')!;
    expect(hovered.area).toBeGreaterThan(0);
  });

  test('the legibility insurance reaches a dock, not only [data-os-desktop]', async ({ page }) => {
    await routeImg(page);
    await routeGen(page, { body: (req) => (req.kind === 'desktop' ? dockLabelDesktop(req) : null) });
    await boot(page);
    await expect.poll(() => page.locator('[data-os-img-filled="wallpaper"]').count(), { timeout: 20_000 }).toBe(1);
    // the kernel injected the wallpaper, so the words on top of it are its
    // insurance — including the launchers in the dock, which are not inside
    // [data-os-desktop] in this archetype at all
    const shadowed = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-os-app]')).map((el) => getComputedStyle(el as HTMLElement).textShadow)
    );
    expect(shadowed.length).toBeGreaterThan(8);
    expect(shadowed.every((s) => !!s && s !== 'none')).toBe(true);
  });
});
