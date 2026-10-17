import { test, expect, type Page } from '@playwright/test';
import { boot, openApp, appFrame, pageFrame } from './helpers.js';
import { routeImg, FAKE_JPEG } from './fakes.js';
import { sheetSlice } from '../kernel/sheet.js';
import { TILE_THEMES } from '../kernel/protocol.js';

/**
 * SEAM T2 — the tile sheet: one 768x768 picture, 4x4, sixteen small pictures of
 * one set, sliced by the runtime.
 *
 * `faces` was the first theme and stays accepted verbatim (the server maps it to
 * `kind: "tiles", theme: "faces"`), so a page written against v0.4 keeps its
 * pictures. Nothing in the arithmetic was ever about faces: a catalogue of
 * posters, a shop's products, a feed's thumbnails and a shelf of covers are the
 * same one-call-for-sixteen trade, and without it each of them is either
 * sixteen calls — which the ceiling of 2-4 per document forbids — or nothing.
 *
 * What is the kernel's here and therefore what is tested: the grouping (one
 * request per theme, however many tiles declare it), the shared prompt on the
 * group's first element, the slicing, and the ceiling counting a sheet once.
 * The prompt's wording is the server's (`server/imgprompt.ts`).
 */

/** Replace the mock engine's document for one kind and leave the rest alone. */
async function routeDoc(page: Page, kind: 'app' | 'page', html: string) {
  await page.route('**/api/gen', async (route) => {
    const body = route.request().postDataJSON();
    if (body?.kind !== kind) return route.fallback();
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
}

const tile = (theme: string, i: number, prompt?: string) =>
  `<span data-os-img="tiles" data-os-theme="${theme}" data-os-tile="${i}"${prompt ? ` data-os-prompt="${prompt}"` : ''} ` +
  `data-t="${theme}${i}" style="display:inline-block;width:56px;height:56px"></span>`;

const APP_DOC = `<!doctype html><html><head><title>Repertory</title></head><body style="margin:0">
<main data-mock="app" style="padding:8px">
<h1>Repertory</h1>
<section>${[0, 1, 2, 15].map((i) => tile('posters', i, i === 0 ? 'the season&apos;s programme, mixed genres' : undefined)).join('')}</section>
<section>${[0, 1].map((i) => tile('products', i, i === 0 ? 'the front counter, small hardware' : undefined)).join('')}</section>
<div data-os-img="photo" data-os-prompt="the foyer at closing time" data-t="p1" style="width:90px;height:70px"></div>
<p data-mock-token>tiles-app</p>
</main></body></html>`;

const PAGE_DOC = `<!doctype html><html><head><title>Neighbours</title></head><body style="margin:0;background:#fff">
<main data-mock="page" data-mock-shape="site" style="padding:8px">
<h1>Neighbours</h1>
<div data-os-img="faces" data-os-prompt="sixteen portraits of people who do not exist" data-t="f-sheet" style="width:1px;height:1px"></div>
<span data-os-face="0" data-t="face0" style="display:inline-block;width:40px;height:40px"></span>
<span data-os-face="7" data-t="face7" style="display:inline-block;width:40px;height:40px"></span>
<span data-os-face="99" data-t="face99" style="display:inline-block;width:40px;height:40px"></span>
<section>${[0, 3].map((i) => tile('covers', i, i === 0 ? 'the reading shelf, paperback spines' : undefined)).join('')}</section>
<section>${[0, 1].map((i) => tile('thumbnails', i, i === 0 ? 'the evening listings, one frame each' : undefined)).join('')}</section>
<p data-mock-token>tiles-page</p>
</main></body></html>`;

/** What the runtime wrote onto one element, read from inside the frame. */
async function slices(frame: any, sel: string) {
  return frame.evaluate((s: string) =>
    Array.from(document.querySelectorAll(s)).map((el) => {
      const cs = getComputedStyle(el as HTMLElement);
      return {
        t: el.getAttribute('data-t') || '',
        filled: el.getAttribute('data-os-img-filled') || '',
        slot: el.getAttribute('data-os-img-slot') || '',
        size: cs.backgroundSize,
        position: cs.backgroundPosition,
        hasImage: /url\("?data:image/.test(cs.backgroundImage),
      };
    }), sel);
}

test.describe('tile sheets (T2)', () => {
  test('an app document gets ONE picture per theme, from the group\'s first prompt', async ({ page }) => {
    const calls = await routeImg(page);
    await routeDoc(page, 'app', APP_DOC);
    await boot(page);
    const bootCalls = calls.length;

    await openApp(page, 'photos');
    const frame = await appFrame(page);
    await expect.poll(async () => frame.locator('[data-os-img-filled]').count(), { timeout: 30_000 }).toBeGreaterThan(5);

    const doc = calls.slice(bootCalls).filter((c) => c.scopeKind === 'app');
    // two sheets and one photo: six tiles are not six pictures
    expect(doc.map((c) => c.kind)).toEqual(['tiles', 'tiles', 'photo']);
    expect(doc.map((c) => c.theme)).toEqual(['posters', 'products', '']);
    expect(doc[0].prompt).toBe("the season's programme, mixed genres");
    expect(doc[1].prompt).toBe('the front counter, small hardware');
    // one bucket, named by the window, exactly as a photo is
    expect(new Set(doc.map((c) => c.scope)).size).toBe(1);
    expect(doc[0].scope).toMatch(/^w\d+$/);

    // every tile of a group shows its own cell of its own group's sheet
    const posters = await slices(frame, '[data-os-theme="posters"]');
    expect(posters.map((p: any) => p.t)).toEqual(['posters0', 'posters1', 'posters2', 'posters15']);
    expect(new Set(posters.map((p: any) => p.slot)).size).toBe(1);
    for (const p of posters) {
      const i = Number(p.t.replace('posters', ''));
      expect(p.hasImage, p.t).toBe(true);
      expect(p.filled, p.t).toMatch(/^tiles?$/);
      expect(p.position.replace(/\s+/g, ' '), p.t).toBe(sheetSlice(i).position.replace(/\s+/g, ' '));
    }
    const products = await slices(frame, '[data-os-theme="products"]');
    expect(new Set(products.map((p: any) => p.slot)).size).toBe(1);
    // and the two groups are two different sheets, not one shared slot
    expect(products[0].slot).not.toBe(posters[0].slot);
  });

  test('a page counts a sheet as one picture against its ceiling of two', async ({ page }) => {
    const calls = await routeImg(page);
    await routeDoc(page, 'page', PAGE_DOC);
    await boot(page);
    const bootCalls = calls.length;

    await openApp(page, 'browser');
    const app = await appFrame(page);
    const pf = await pageFrame(page, app);
    await expect.poll(async () => pf.locator('[data-os-img-filled]').count(), { timeout: 30_000 }).toBeGreaterThan(2);

    const doc = calls.slice(bootCalls).filter((c) => c.scopeKind === 'page');
    // three sheets are declared; SPEC §12.5 allows a page two pictures
    expect(doc).toHaveLength(2);
    expect(doc.map((c) => c.kind)).toEqual(['tiles', 'tiles']);
    // `faces` is still the spelling a v0.4 page uses, and it still means a theme
    expect(doc[0].theme).toBe('faces');
    expect(doc[1].theme).toBe('covers');

    // the legacy faces elements still slice
    const faces = await slices(pf, '[data-os-face]');
    expect(faces.map((f: any) => f.t)).toEqual(['face0', 'face7', 'face99']);
    for (const f of faces) expect(f.hasImage, f.t).toBe(true);
    expect(faces[1].position.replace(/\s+/g, ' ')).toBe(sheetSlice(7).position.replace(/\s+/g, ' '));
    // 99 is not a cell: it is clamped into the sheet rather than dropped
    expect(faces[2].hasImage).toBe(true);
    // the third group was never bought, so its tiles keep whatever was drawn
    const thumbs = await slices(pf, '[data-os-theme="thumbnails"]');
    expect(thumbs.every((t: any) => !t.hasImage)).toBe(true);
  });

  /**
   * The defect a real catalogue page found (HANDOFF-7). The group whose ask is
   * the LAST one the per-document ceiling allows must still fill EVERY tile of
   * itself: the ceiling counts pictures, and sixteen tiles of one sheet are one
   * picture. Live, a page declaring a products grid and then a poster wall
   * bought both sheets and showed **1 of 24 posters**, because the marking of a
   * group's members used to happen inside the loop the ceiling bounded — so the
   * last group's members were never marked and the fill could not find them.
   *
   * Written with the SECOND group large on purpose: every fixture until now had
   * one group per document, or a small one last, which is the one shape that
   * cannot see it.
   */
  test("the last group the ceiling allows still fills all of itself", async ({ page }) => {
    const calls = await routeImg(page);
    const doc =
      '<!doctype html><html><head><title>Catalogue</title></head><body style="margin:0;background:#fff">' +
      '<main data-mock="page" data-mock-shape="site" style="padding:8px"><h1>Catalogue</h1>' +
      // group one: two products, asked first
      '<section>' + [0, 1].map((i) => tile('products', i, i === 0 ? 'the front counter, small hardware' : undefined)).join('') + '</section>' +
      // group two: twelve posters, and it is the page's second and last picture
      '<section>' +
      Array.from({ length: 12 }, (_, i) => tile('posters', i, i === 0 ? "the season's programme, mixed genres" : undefined)).join('') +
      '</section>' +
      '<p data-mock-token>tiles-last</p></main></body></html>';
    await routeDoc(page, 'page', doc);
    await boot(page);
    const bootCalls = calls.length;
    await openApp(page, 'browser');
    const app = await appFrame(page);
    const pf = await pageFrame(page, app);
    await expect.poll(async () => pf.locator('[data-os-img-filled]').count(), { timeout: 30_000 }).toBeGreaterThan(12);

    const asked = calls.slice(bootCalls).filter((c) => c.scopeKind === 'page');
    expect(asked.map((c) => c.theme)).toEqual(['products', 'posters']);

    const posters = await slices(pf, '[data-os-theme="posters"]');
    expect(posters).toHaveLength(12);
    // all twelve, not just the one that carried the prompt
    expect(posters.filter((p: any) => p.hasImage)).toHaveLength(12);
    expect(new Set(posters.map((p: any) => p.slot)).size).toBe(1);
    for (const p of posters) {
      const i = Number(p.t.replace('posters', ''));
      expect(p.position.replace(/\s+/g, ' '), p.t).toBe(sheetSlice(i).position.replace(/\s+/g, ' '));
    }
    const products = await slices(pf, '[data-os-theme="products"]');
    expect(products.filter((p: any) => p.hasImage)).toHaveLength(2);
  });

  test('every theme the server knows is a theme the kernel will ask for', async ({ page }) => {
    const calls = await routeImg(page);
    const doc =
      '<!doctype html><html><head><title>All</title></head><body style="margin:0"><main data-mock="app">' +
      TILE_THEMES.map((t, i) => tile(t, i, 'a set of ' + t)).join('') +
      '<p data-mock-token>tiles-all</p></main></body></html>';
    await routeDoc(page, 'app', doc);
    await boot(page);
    const bootCalls = calls.length;
    await openApp(page, 'photos');
    const frame = await appFrame(page);
    await expect.poll(async () => frame.locator('[data-os-img-filled]').count(), { timeout: 30_000 }).toBeGreaterThan(3);
    const asked = calls.slice(bootCalls).filter((c) => c.scopeKind === 'app');
    // five themes, an app's ceiling is four: the first four in document order
    expect(asked).toHaveLength(4);
    expect(asked.map((c) => c.theme)).toEqual(TILE_THEMES.slice(0, 4));
    expect(asked.every((c) => c.kind === 'tiles')).toBe(true);
  });

  test('a tile group with no prompt anywhere is not a request', async ({ page }) => {
    const calls = await routeImg(page);
    const doc =
      '<!doctype html><html><head><title>Mute</title></head><body style="margin:0"><main data-mock="app">' +
      [0, 1, 2].map((i) => tile('posters', i)).join('') +
      '<p data-mock-token>tiles-mute</p></main></body></html>';
    await routeDoc(page, 'app', doc);
    await boot(page);
    const bootCalls = calls.length;
    await openApp(page, 'photos');
    const frame = await appFrame(page);
    await frame.waitForSelector('[data-mock-token]');
    await page.waitForTimeout(1200);
    expect(calls.slice(bootCalls).filter((c) => c.scopeKind === 'app')).toHaveLength(0);
  });

  test('the theme reaches the document it was asked for, and nothing else', async ({ page }) => {
    // one sheet, and a second group that is never bought: the fill must find
    // its own group's tiles by slot and leave the other group alone
    const calls = await routeImg(page);
    await routeDoc(page, 'app', APP_DOC);
    await boot(page);
    await openApp(page, 'photos');
    const frame = await appFrame(page);
    await expect.poll(async () => frame.locator('[data-os-img-filled="tiles"]').count(), { timeout: 30_000 }).toBe(2);
    const askers = await frame.evaluate(() =>
      Array.from(document.querySelectorAll('[data-os-img-filled="tiles"]')).map((el) => el.getAttribute('data-os-img-theme'))
    );
    expect(askers).toEqual(['posters', 'products']);
    expect(calls.some((c) => c.theme === 'posters' && c.kind === 'tiles')).toBe(true);
    // the picture is the fake jpeg and it arrived as a data: URI, so the CSP
    // (img-src data:) is unchanged by T2
    const bg = await frame.evaluate(() => getComputedStyle(document.querySelector('[data-os-tile="1"]') as HTMLElement).backgroundImage);
    expect(bg).toContain(FAKE_JPEG.slice(0, 40));
  });
});
