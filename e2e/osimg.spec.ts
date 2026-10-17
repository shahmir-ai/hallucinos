import { test, expect, type Page } from '@playwright/test';
import { boot, openApp, appFrame, pageFrame } from './helpers.js';
import { sheetSlice } from '../kernel/sheet.js';
import { PAGE_IMG_DWELL_MS } from '../kernel/protocol.js';

/**
 * SEAM S1 — images inside generated documents.
 *
 * A generated app or page declares what it wants with
 * `data-os-img="photo|faces|map"` + `data-os-prompt="<short description>"`; its
 * runtime collects the slots once the document closes, the kernel buys the
 * picture and posts a `data:` URI back, the runtime paints it in. `faces` is one
 * 4x4 sheet sliced by CSS into `[data-os-face]` elements.
 *
 * Both halves are faked here, and for different reasons: `/api/img` because fal
 * costs money (and the e2e servers have no `FAL_KEY` at all), `/api/gen` for the
 * app and page documents because the mock engine's fixtures carry no image
 * slots and `server/**` belongs to another builder this session. Everything
 * between the two fakes — collection, ordering, the per-document ceiling, the
 * scope the money is charged to, the slicing, the fill — is the kernel's own.
 */
const JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

interface ImgCall {
  kind: string;
  theme?: string;
  prompt: string;
  scope: string;
  scopeKind: string;
  session: string;
}

/** Fake POST /api/img and record every call the kernel makes. */
async function routeImg(page: Page): Promise<ImgCall[]> {
  const calls: ImgCall[] = [];
  await page.route('**/api/img', async (route) => {
    const b = route.request().postDataJSON() || {};
    calls.push({
      kind: String(b.kind || ''),
      theme: String(b.theme || ''),
      prompt: String(b.prompt || ''),
      scope: String(b.scope || ''),
      scopeKind: String(b.scopeKind || ''),
      session: String(b.session || ''),
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dataUri: JPEG }) });
  });
  return calls;
}

/** Replace the mock engine's document for one `kind` and leave the rest alone. */
async function routeDoc(page: Page, kind: 'app' | 'page', html: string) {
  await page.route('**/api/gen', async (route) => {
    const body = route.request().postDataJSON();
    if (body?.kind !== kind) return route.fallback();
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
}

const APP_DOC = `<!doctype html><html><head><title>Gallery</title></head><body style="margin:0">
<main data-mock="app" style="padding:8px">
<h1>Gallery</h1>
<div data-os-img="photo" data-os-prompt="a harbour that does not exist" data-t="p1" style="width:90px;height:70px"></div>
<img data-os-img="photo" data-os-prompt="a kettle on a windowsill" data-t="p2" alt="a kettle" width="70" height="60">
<div data-os-img="map" data-os-prompt="a city that does not exist, top down" data-t="m1" style="width:120px;height:80px"></div>
<div data-os-img="photo" data-os-prompt="a stairwell with no ceiling" data-t="p4" style="width:60px;height:60px"></div>
<div data-os-img="photo" data-os-prompt="the fifth one, over the ceiling" data-t="p5" style="width:60px;height:60px"></div>
<div data-os-img="wallpaper" data-os-prompt="not a documents picture to ask for" data-t="w1" style="width:60px;height:60px"></div>
<div data-os-img="photo" data-t="noprompt" style="width:60px;height:60px"></div>
<p data-mock-token>osimg-app</p>
</main></body></html>`;

const PAGE_DOC = `<!doctype html><html><head><title>Neighbours</title></head><body style="margin:0;background:#fff">
<main data-mock="page" data-mock-shape="site" style="padding:8px">
<h1>Neighbours</h1>
<div data-os-img="faces" data-os-prompt="sixteen portraits of people who do not exist" data-t="f-sheet" style="width:1px;height:1px"></div>
<span data-os-face="0" data-t="face0" style="display:inline-block;width:40px;height:40px"></span>
<span data-os-face="1" data-t="face1" style="display:inline-block;width:40px;height:40px"></span>
<span data-os-face="15" data-t="face15" style="display:inline-block;width:40px;height:40px"></span>
<span data-os-face="99" data-t="face99" style="display:inline-block;width:40px;height:40px"></span>
<div data-os-img="photo" data-os-prompt="a communal bin store at dusk" data-t="pp1" style="width:90px;height:70px"></div>
<div data-os-img="photo" data-os-prompt="a third picture, past the page ceiling" data-t="pp2" style="width:90px;height:70px"></div>
<p data-mock-token>osimg-page</p>
</main></body></html>`;

test.describe('os.img inside generated documents (S1)', () => {
  test('an app document gets four pictures, in document order, charged to its window', async ({ page }) => {
    const calls = await routeImg(page);
    await routeDoc(page, 'app', APP_DOC);
    await boot(page);
    const bootCalls = calls.length; // wallpaper + icons, whatever the timing gave us

    await openApp(page, 'photos');
    const frame = await appFrame(page);
    await expect
      .poll(async () => frame.locator('[data-os-img-filled]').count(), { timeout: 30_000 })
      .toBeGreaterThan(3);

    const doc = calls.slice(bootCalls).filter((c) => c.scopeKind === 'app');
    // SPEC §12.5: four per app open, and the fifth slot is simply not bought
    expect(doc).toHaveLength(4);
    expect(doc.map((c) => c.kind)).toEqual(['photo', 'photo', 'map', 'photo']);
    expect(doc.map((c) => c.prompt)).toEqual([
      'a harbour that does not exist',
      'a kettle on a windowsill',
      'a city that does not exist, top down',
      'a stairwell with no ceiling',
    ]);
    // the money bucket is this window, and the session is named
    expect(new Set(doc.map((c) => c.scope)).size).toBe(1);
    expect(doc[0].scope).toMatch(/^w\d+$/);
    expect(doc[0].session).not.toBe('');

    // a document may not spend the boot's budget, and a slot with no prompt is
    // not a request
    expect(calls.slice(bootCalls).some((c) => c.kind === 'wallpaper' || c.kind === 'icons')).toBe(false);
    expect(calls.some((c) => c.prompt.indexOf('not a documents picture') >= 0)).toBe(false);

    const filled = await frame.evaluate(() =>
      Array.from(document.querySelectorAll('[data-os-img-filled]')).map((el) => ({
        t: el.getAttribute('data-t'),
        tag: el.tagName,
        kind: el.getAttribute('data-os-img-filled'),
        src: (el as HTMLImageElement).getAttribute('src') || '',
        bg: (el as HTMLElement).style.backgroundImage,
      }))
    );
    expect(filled.map((f) => f.t)).toEqual(['p1', 'p2', 'm1', 'p4']);
    // a <div> slot is filled as a background, an <img> slot as its src — and it
    // is still an <img>, not the alt-text box every other external image becomes
    const img = filled.find((f) => f.t === 'p2')!;
    expect(img.tag).toBe('IMG');
    expect(img.src.startsWith('data:image/jpeg')).toBe(true);
    for (const f of filled.filter((x) => x.tag !== 'IMG')) expect(f.bg).toContain('data:image/jpeg');
    // and the fifth slot kept whatever the model drew in it
    expect(await frame.locator('[data-t="p5"][data-os-img-filled]').count()).toBe(0);
  });

  test('the four pictures of one document are asked for two at a time', async ({ page }) => {
    /**
     * BAKEOFF-3: fifteen of sixteen app pictures never arrived, all of them
     * killed by the server's image timeout, while the boot's own two (never
     * more than two in flight) came back. Four parallel asks queue at fal and
     * age out together. This holds the lane at two — measured by making every
     * call hang until the test lets it go, so the count is the kernel's own
     * concurrency and not a race.
     */
    let inFlight = 0;
    let peak = 0;
    let held = true;
    const release: (() => void)[] = [];
    await page.route('**/api/img', async (route) => {
      const kind = String((route.request().postDataJSON() || {}).kind || '');
      if (kind === 'wallpaper' || kind === 'icons') {
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      }
      inFlight++;
      peak = Math.max(peak, inFlight);
      if (held) await new Promise<void>((res) => release.push(res));
      inFlight--;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dataUri: JPEG }) });
    });
    await routeDoc(page, 'app', APP_DOC);
    await boot(page);
    await openApp(page, 'photos');
    const frame = await appFrame(page);

    // two asks are outstanding and the other two are waiting behind them
    await expect.poll(() => inFlight, { timeout: 30_000 }).toBe(2);
    expect(peak).toBe(2);
    held = false;
    while (release.length) release.shift()!();

    // and all four still land: the lane delays pictures, it never drops them
    await expect
      .poll(async () => frame.locator('[data-os-img-filled]').count(), { timeout: 30_000 })
      .toBe(4);
    expect(peak).toBe(2);
  });

  test('a page gets two, and `faces` is one sheet sliced into [data-os-face]', async ({ page }) => {
    const calls = await routeImg(page);
    await routeDoc(page, 'page', PAGE_DOC);
    await boot(page);
    const bootCalls = calls.length;

    await openApp(page, 'browser');
    const app = await appFrame(page);
    const pf = await pageFrame(page, app);
    await expect.poll(async () => pf.locator('[data-os-img-filled]').count(), { timeout: 30_000 }).toBeGreaterThan(4);

    const doc = calls.slice(bootCalls).filter((c) => c.scopeKind === 'page');
    // SPEC §12.5: two per page. The third slot is not bought.
    expect(doc).toHaveLength(2);
    /**
     * T2 — the DOCUMENT still writes `data-os-img="faces"` and this test is
     * about that spelling continuing to work. What goes on the wire is now the
     * general kind: `tiles` + `theme: "faces"`, which the server maps back
     * (`normalizeTiles`), same size, same slicing, same bucket. See
     * `e2e/tiles.spec.ts` for the themes that spelling could never reach.
     */
    expect(doc.map((c) => c.kind)).toEqual(['tiles', 'photo']);
    expect(doc[0].theme).toBe('faces');
    expect(doc[0].prompt).toBe('sixteen portraits of people who do not exist');
    // the bucket is the navigation, not the window: a session walking the fake
    // internet must not spend one page's budget on the next
    expect(new Set(doc.map((c) => c.scope)).size).toBe(1);
    expect(doc[0].scope).not.toMatch(/^w\d+$/);
    expect(await pf.locator('[data-t="pp2"][data-os-img-filled]').count()).toBe(0);

    const faces = await pf.evaluate(() =>
      Array.from(document.querySelectorAll('[data-os-face]')).map((el) => ({
        t: el.getAttribute('data-t'),
        pos: (el as HTMLElement).style.backgroundPosition,
        size: (el as HTMLElement).style.backgroundSize,
        bg: (el as HTMLElement).style.backgroundImage,
        filled: el.getAttribute('data-os-img-filled'),
      }))
    );
    expect(faces).toHaveLength(4);
    for (const f of faces) {
      expect(f.bg).toContain('data:image/jpeg');
      expect(f.size).toBe(sheetSlice(0).size);
      expect(f.filled).toBe('face');
    }
    // one sheet, four different cells; an out-of-range index clamps to the last
    expect(faces.find((f) => f.t === 'face0')!.pos).toBe(sheetSlice(0).position);
    expect(faces.find((f) => f.t === 'face1')!.pos).toBe(sheetSlice(1).position);
    expect(faces.find((f) => f.t === 'face15')!.pos).toBe(sheetSlice(15).position);
    expect(faces.find((f) => f.t === 'face15')!.pos).toBe(faces.find((f) => f.t === 'face99')!.pos);
    expect(new Set(faces.map((f) => f.pos)).size).toBe(3);
    // every face came off ONE image call (T2: one sheet, theme `faces`)
    expect(doc.filter((c) => c.kind === 'tiles' && c.theme === 'faces')).toHaveLength(1);
  });

  test("an app's picture outlives the next generation in its own window, a page's does not", async ({ page }) => {
    /**
     * BAKEOFF-3: fifteen of sixteen app pictures came back "img timeout", and
     * the server's clock was not what ran out — the kernel had hung up. An app
     * picture was riding the window's GENERATION controller, which every later
     * generation into that window aborts, while the app document that asked is
     * still on screen. The browser is where that happens on every single open:
     * its chrome is an app document, and its home page navigation begins a new
     * generation in the same window a moment later.
     */
    const asked: string[] = [];
    const cancelled: string[] = [];
    await page.route('**/api/img', async (route) => {
      const b = route.request().postDataJSON() || {};
      const kind = String(b.kind || '');
      if (kind === 'wallpaper' || kind === 'icons') {
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      }
      const tag = String(b.scopeKind || '') + ':' + String(b.prompt || '').slice(0, 12);
      asked.push(tag);
      // long enough that the browser's home page has certainly started
      await new Promise((r) => setTimeout(r, 4000));
      try {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dataUri: JPEG }) });
      } catch {
        cancelled.push(tag);
      }
    });
    await routeDoc(page, 'app', APP_DOC);
    await boot(page);
    await openApp(page, 'browser');
    const frame = await appFrame(page);
    await expect
      .poll(async () => frame.locator('[data-os-img-filled]').count(), { timeout: 30_000 })
      .toBe(4);
    expect(cancelled).toEqual([]);
  });

  test('a document that asks for nothing costs nothing, and a 404 leaves it alone', async ({ page }) => {
    const calls: string[] = [];
    await page.route('**/api/img', async (route) => {
      calls.push(String(route.request().postDataJSON()?.kind));
      await route.fulfill({ status: 404, body: 'no' });
    });
    await routeDoc(page, 'app', APP_DOC);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await boot(page);
    await openApp(page, 'photos');
    const frame = await appFrame(page);
    await expect.poll(async () => frame.locator('[data-os-img-slot]').count(), { timeout: 30_000 }).toBeGreaterThan(3);
    await page.waitForTimeout(600);
    // asked, refused, nothing painted, no exception anywhere
    expect(calls.filter((k) => k === 'photo' || k === 'map').length).toBe(4);
    expect(await frame.locator('[data-os-img-filled]').count()).toBe(0);
    expect(errors).toEqual([]);

    // the mock's own app documents declare no slots at all: no image call
    await page.unroute('**/api/gen');
    const before = calls.length;
    await openApp(page, 'notes');
    await appFrame(page, -1);
    await page.waitForTimeout(800);
    expect(calls.length).toBe(before);
  });
  test('a page is not worth a picture until it has been looked at (open issue 4)', async ({ page }) => {
    /**
     * BAKEOFF-3: zero of four page pictures survived — every one was cancelled
     * by a navigation about two seconds later, which is correct behaviour and
     * still money spent on a picture nobody would see, plus a reserved empty
     * block where the visitor was looking. The ruling: a page waits
     * PAGE_IMG_DWELL_MS to be looked at before it is worth buying for, and a
     * page left inside the dwell is never bought for at all.
     *
     * Measured against the moment the page document was served, which is this
     * test's own fulfil: no polling race decides it.
     */
    const stamps: number[] = [];
    await page.route('**/api/img', async (route) => {
      const b = route.request().postDataJSON() || {};
      if (String(b.scopeKind) === 'page') stamps.push(Date.now());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dataUri: JPEG }) });
    });
    let servedAt = 0;
    await page.route('**/api/gen', async (route) => {
      const body = route.request().postDataJSON();
      if (body?.kind !== 'page') return route.fallback();
      servedAt = Date.now();
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE_DOC });
    });

    await boot(page);
    await openApp(page, 'browser');
    const app = await appFrame(page);
    const pf = await pageFrame(page, app);
    // the picture does arrive — the dwell delays it, it does not cancel it
    await expect.poll(async () => pf.locator('[data-os-img-filled]').count(), { timeout: 30_000 }).toBeGreaterThan(0);
    expect(stamps.length).toBeGreaterThan(0);
    expect(servedAt).toBeGreaterThan(0);
    // and it was not asked for until the page had been on screen for the dwell
    expect(stamps[0] - servedAt).toBeGreaterThanOrEqual(PAGE_IMG_DWELL_MS * 0.8);
  });

  test('a page left inside the dwell is never bought for (open issue 4)', async ({ page }) => {
    const calls = await routeImg(page);
    // only the FIRST page document carries slots; the pages after it are the
    // mock's own, which declare none
    let served = 0;
    await page.route('**/api/gen', async (route) => {
      const body = route.request().postDataJSON();
      if (body?.kind !== 'page' || served++ > 0) return route.fallback();
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE_DOC });
    });

    await boot(page);
    await openApp(page, 'browser');
    const app = await appFrame(page);
    const pf = await pageFrame(page, app);
    await expect.poll(async () => pf.locator('[data-os-img]').count(), { timeout: 30_000 }).toBeGreaterThan(0);

    // leave at once, inside the dwell, and keep leaving
    for (let i = 0; i < 3; i++) {
      await app.evaluate((n) => (window as any).os.navigate('https://example.test/next' + n), i);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(PAGE_IMG_DWELL_MS + 900);
    expect(calls.filter((c) => c.scopeKind === 'page')).toEqual([]);
  });
});
