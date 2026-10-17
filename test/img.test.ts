import { describe, it, expect } from 'vitest';
import {
  IMG_KINDS,
  IMG_MODELS,
  IMG_MODEL_DEFAULT,
  IMG_STEPS,
  IMG_USD,
  ImgBudget,
  ImgError,
  MAX_IMG_BYTES,
  falImage,
  imgEndpoint,
  imgUsd,
  isImgKind,
  isImgScope,
  resolveImgModel,
  scopeForRequest,
  seedInt,
  stepsFor,
  IMG_RETRY_MAX_MS,
  isModerationRefusal,
  shouldRetryImg,
  simplifyImgPrompt,
} from '../server/img.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

/** A fal that answers with a URL, and a CDN that answers with bytes. */
function fakeFal(opts: { status?: number; body?: unknown; bytes?: Buffer; contentType?: string } = {}) {
  const calls: { url: string; body?: any }[] = [];
  const impl = (async (url: any, init: any) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(init.body) : undefined });
    if (u.startsWith('https://fal.run')) {
      if (opts.status && opts.status !== 200) return new Response('nope', { status: opts.status });
      return new Response(JSON.stringify(opts.body ?? { images: [{ url: 'https://cdn.example/x.jpg', width: 11, height: 12 }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(new Uint8Array(opts.bytes ?? PNG), { status: 200, headers: { 'content-type': opts.contentType ?? 'image/jpeg' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('I3 — the image route pieces', () => {
  it('knows exactly the kinds SPEC §12.5 and T2 name, all under 1 MP', () => {
    expect(Object.keys(IMG_KINDS).sort()).toEqual(['faces', 'icons', 'map', 'photo', 'tiles', 'wallpaper']);
    for (const [k, v] of Object.entries(IMG_KINDS)) {
      expect(v.width * v.height, k).toBeLessThanOrEqual(1024 * 1024);
    }
    // T3's sizes. Every one is still a single billing unit (< 1 MP), so the
    // only thing a pixel costs is the time to move it — and `sync_mode`
    // (IMG-LATENCY-2) removed the second round trip that made the big
    // wallpaper expensive in v0.2.
    expect(IMG_KINDS.wallpaper).toMatchObject({ width: 1024, height: 576 });
    expect(IMG_KINDS.icons).toMatchObject({ width: 768, height: 768 });
    expect(IMG_KINDS.photo).toMatchObject({ width: 640, height: 640 });
    expect(IMG_KINDS.map).toMatchObject({ width: 768, height: 576 });
    expect(IMG_KINDS.tiles).toMatchObject({ width: 768, height: 768 });
    // both sheets the runtime slices at quarters have to be square
    expect(IMG_KINDS.tiles.width).toBe(IMG_KINDS.tiles.height);
    expect(IMG_KINDS.faces).toEqual(IMG_KINDS.tiles);
    // 16:9 for the thing that goes behind a desktop
    expect(IMG_KINDS.wallpaper.width / IMG_KINDS.wallpaper.height).toBeCloseTo(16 / 9, 2);
    // the sheet the kernel slices at quarters has to be square
    expect(IMG_KINDS.icons.width).toBe(IMG_KINDS.icons.height);
    expect(isImgKind('wallpaper')).toBe(true);
    expect(isImgKind('wallpaperr')).toBe(false);
    expect(isImgKind(7)).toBe(false);
    expect(IMG_USD).toBe(0.003);
  });

  it('asks schnell in sync_mode, jpeg, with the safety checker on, and returns a data: URI', async () => {
    const fal = fakeFal();
    const out = await falImage('wallpaper', 'a wet street', 'seed-1', { key: 'k', fetchImpl: fal.impl });
    expect(out.dataUri.startsWith('data:image/jpeg;base64,')).toBe(true);
    const body = fal.calls[0].body;
    // the measured win: no second round trip for the bytes (IMG-LATENCY-1)
    expect(body.sync_mode).toBe(true);
    expect(body.output_format).toBe('jpeg');
    expect(body.num_inference_steps).toBe(IMG_STEPS.wallpaper);
    expect(body.enable_safety_checker).toBe(true);
    expect(body.image_size).toEqual({ width: 1024, height: 576 });
    expect(body.num_images).toBe(1);
    // schnell is a 1-4 step model, and the sheet keeps the detail
    for (const [k, v] of Object.entries(IMG_STEPS)) {
      expect(v, k).toBeGreaterThanOrEqual(1);
      expect(v, k).toBeLessThanOrEqual(4);
    }
    expect(IMG_STEPS.icons).toBe(4);
    // BAKEOFF-3 finding 10: 2 steps and 4 steps were indistinguishable in
    // latency (2.9-14.1 s either way), so the picture that fills the screen
    // takes the detail.
    expect(IMG_STEPS.wallpaper).toBe(4);
    // a fal that still answers with a URL (sync_mode unsupported, or too big to
    // inline) is still handled: WE fetch the bytes, never the document
    expect(fal.calls[1].url).toBe('https://cdn.example/x.jpg');
  });

  it('returns the inline image without a second request when fal honours sync_mode', async () => {
    const dataUri = 'data:image/jpeg;base64,' + PNG.toString('base64');
    const fal = fakeFal({ body: { images: [{ url: dataUri, width: 768, height: 432 }] } });
    const out = await falImage('wallpaper', 'p', 's', { key: 'k', fetchImpl: fal.impl });
    expect(out.dataUri).toBe(dataUri);
    expect(out.fetch_ms).toBe(0);
    expect(fal.calls.length).toBe(1);
  });

  it('S1 — charges a document image to the document class, never to the boot bucket', () => {
    expect(isImgScope('page')).toBe(true);
    expect(isImgScope('bootleg')).toBe(false);
    // the kind's own default when the kernel says nothing
    expect(scopeForRequest('photo', undefined)).toBe('app');
    expect(scopeForRequest('faces', undefined)).toBe('page');
    // the kernel's declaration wins for document images: a contacts APP wants
    // faces, a listings PAGE wants photos
    expect(scopeForRequest('faces', 'app')).toBe('app');
    expect(scopeForRequest('photo', 'page')).toBe('page');
    // ...but nothing a client says can spend from the boot's four
    expect(scopeForRequest('photo', 'boot')).toBe('app');
    expect(scopeForRequest('wallpaper', 'app')).toBe('boot');
    expect(scopeForRequest('icons', 'page')).toBe('boot');
  });

  it('S1 — 4 per app document and 2 per page document, by scope id', () => {
    const b = new ImgBudget();
    for (let i = 0; i < 4; i++) expect(b.take('ip', 'photo', 'win-1', 's', 'app').allowed, String(i)).toBe(true);
    expect(b.take('ip', 'photo', 'win-1', 's', 'app').allowed).toBe(false);
    // a different window is a different document
    expect(b.take('ip', 'photo', 'win-2', 's', 'app').allowed).toBe(true);
    // a page gets two, even for the same kind
    expect(b.take('ip', 'photo', 'nav-1', 's', 'page').allowed).toBe(true);
    expect(b.take('ip', 'photo', 'nav-1', 's', 'page').allowed).toBe(true);
    expect(b.take('ip', 'photo', 'nav-1', 's', 'page').reason).toBe('scope');
  });

  it('never lets an odd content-type out as something else', async () => {
    const fal = fakeFal({ contentType: 'text/html' });
    const out = await falImage('icons', 'a sheet', 's', { key: 'k', fetchImpl: fal.impl });
    expect(out.dataUri.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('surfaces an upstream failure, an empty answer and an oversized image as ImgError', async () => {
    await expect(falImage('map', 'p', 's', { key: 'k', fetchImpl: fakeFal({ status: 402 }).impl })).rejects.toBeInstanceOf(ImgError);
    await expect(falImage('map', 'p', 's', { key: 'k', fetchImpl: fakeFal({ body: { images: [] } }).impl })).rejects.toMatchObject({ code: 'empty' });
    const big = fakeFal({ bytes: Buffer.alloc(MAX_IMG_BYTES + 1) });
    await expect(falImage('map', 'p', 's', { key: 'k', fetchImpl: big.impl })).rejects.toMatchObject({ code: 'too-big' });
  });

  /**
   * The catch used to settle every failure at $0, including the ones that
   * happen after fal has already rendered and charged for the image.
   */
  it('marks a failure billable only once fal has answered 2xx', async () => {
    const after = async (fal: ReturnType<typeof fakeFal>) => {
      try {
        await falImage('map', 'p', 's', { key: 'k', fetchImpl: fal.impl });
        return null;
      } catch (e: any) {
        return e as ImgError;
      }
    };
    // non-2xx from fal: nothing was rendered, nothing is charged
    expect(await after(fakeFal({ status: 402 }))).toMatchObject({ code: 'upstream', billable: false });
    // 2xx, then our side could not keep it: fal rendered and billed anyway
    expect(await after(fakeFal({ body: { images: [] } }))).toMatchObject({ code: 'empty', billable: true });
    expect(await after(fakeFal({ bytes: Buffer.alloc(MAX_IMG_BYTES + 1) }))).toMatchObject({ code: 'too-big', billable: true });
  });

  it('a timeout before fal answers is free, one after it is not', async () => {
    const never = (async () => new Promise<Response>(() => {})) as unknown as typeof fetch;
    await expect(falImage('photo', 'p', 's', { key: 'k', fetchImpl: never, timeoutMs: 20 })).rejects.toMatchObject({
      code: 'timeout',
      billable: false,
    });
    // fal answers, the CDN never does
    const stalledDownload = (async (url: any) =>
      String(url).startsWith('https://fal.run')
        ? new Response(JSON.stringify({ images: [{ url: 'https://cdn.example/x.jpg' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Promise<Response>(() => {})) as unknown as typeof fetch;
    await expect(falImage('photo', 'p', 's', { key: 'k', fetchImpl: stalledDownload, timeoutMs: 60 })).rejects.toMatchObject({
      code: 'timeout',
      billable: true,
    });
  });

  it('gives up rather than hanging', async () => {
    const slow = (async () => new Promise<Response>(() => {})) as unknown as typeof fetch;
    await expect(falImage('photo', 'p', 's', { key: 'k', fetchImpl: slow, timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('derives a stable non-negative seed per kind', () => {
    expect(seedInt('abc')).toBe(seedInt('abc'));
    expect(seedInt('abc')).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(seedInt('abc'))).toBe(true);
  });
});

describe('I3 — the per-session budget', () => {
  it('allows 4 per boot, 4 per app open and 2 per page, then refuses', () => {
    const b = new ImgBudget();
    for (let i = 0; i < 4; i++) expect(b.take('s1', i < 2 ? 'wallpaper' : 'icons').allowed).toBe(true);
    expect(b.take('s1', 'wallpaper')).toMatchObject({ allowed: false, reason: 'scope' });

    for (let i = 0; i < 4; i++) expect(b.take('s1', 'photo', 'win-1').allowed).toBe(true);
    expect(b.take('s1', 'photo', 'win-1').allowed).toBe(false);
    // a different app open is its own bucket
    expect(b.take('s1', 'photo', 'win-2').allowed).toBe(true);

    expect(b.take('s1', 'faces', 'nav-1').allowed).toBe(true);
    expect(b.take('s1', 'faces', 'nav-1').allowed).toBe(true);
    expect(b.take('s1', 'faces', 'nav-1').allowed).toBe(false);
  });

  it('keeps one session from draining the day through repeated app opens', () => {
    const b = new ImgBudget(30 * 60_000, () => Date.now(), 6);
    let ok = 0;
    for (let i = 0; i < 20; i++) if (b.take('s2', 'photo', 'win-' + i).allowed) ok++;
    expect(ok).toBe(6);
    expect(b.take('s2', 'photo', 'win-99')).toMatchObject({ reason: 'session' });
    // another visitor is unaffected
    expect(b.take('s3', 'photo', 'win-0').allowed).toBe(true);
  });

  /**
   * HANDOFF-7 — the starvation the first live browser walk found. A session's
   * total was first-come and app opens come first, so a visitor who opened six
   * apps and then browsed arrived at the catalogue pages with nothing left:
   * live, 15 refusals and 0 of 48 tiles shown on one boot. The total is
   * unchanged; what is reserved is who may take it.
   */
  it('keeps a session of app opens from starving the pages the visitor browses next', () => {
    const b = new ImgBudget();
    // six app opens, four pictures each: 24 of the session's 30
    let apps = 0;
    for (let w = 0; w < 6; w++) for (let i = 0; i < 4; i++) if (b.take('s9', 'photo', 'win-' + w).allowed) apps++;
    // the app scope's own share of the session is 20, so four of those are refused
    expect(apps).toBe(20);
    // and the pages the visitor browses next still have their pictures
    let pages = 0;
    for (let n = 0; n < 5; n++) for (let i = 0; i < 2; i++) if (b.take('s9', 'tiles', 'nav-' + n).allowed) pages++;
    expect(pages).toBeGreaterThanOrEqual(6);
    // the session's own total is still the ceiling it always was
    expect(b.take('s9', 'photo', 'win-99')).toMatchObject({ allowed: false });
  });

  /**
   * HANDOFF-7 — the reservation's own regression: a boot share of one boot's
   * worth made a RELOAD picture-less, which is the gesture this product invites.
   */
  it('leaves the wallpaper and the plates there when the visitor reloads', () => {
    const b = new ImgBudget();
    for (let boot = 0; boot < 5; boot++) {
      // one boot buys exactly two pictures: the wallpaper and the icon sheet
      expect(b.take('s11', 'wallpaper', 'boot-' + boot).allowed).toBe(true);
      expect(b.take('s11', 'icons', 'boot-' + boot).allowed).toBe(true);
    }
  });

  it('scales the reservations with a raised session ceiling', () => {
    const b = new ImgBudget(30 * 60_000, () => Date.now(), 300);
    let ok = 0;
    for (let w = 0; w < 60; w++) for (let i = 0; i < 4; i++) if (b.take('s12', 'photo', 'win-' + w).allowed) ok++;
    // the app share is 20 of 30, so 200 of a ceiling of 300
    expect(ok).toBe(200);
  });

  it('names a reservation refusal apart from the session total', () => {
    const b = new ImgBudget();
    let n = 0;
    while (b.take('s10', 'photo', 'win-' + n).allowed) n++;
    // 20 app pictures in, the refusal says WHICH ceiling refused it
    expect(b.take('s10', 'photo', 'win-999')).toMatchObject({ reason: 'session-scope' });
    // a page is not charged for the app's share
    expect(b.take('s10', 'tiles', 'nav-1').allowed).toBe(true);
  });

  it('does not charge the session slot for a request the scope refused', () => {
    const b = new ImgBudget(30 * 60_000, () => Date.now(), 10);
    for (let i = 0; i < 2; i++) b.take('s4', 'faces', 'p');
    for (let i = 0; i < 5; i++) expect(b.take('s4', 'faces', 'p').allowed).toBe(false);
    // the five refusals did not eat the session allowance
    expect(b.take('s4', 'wallpaper').allowed).toBe(true);
  });

  it('forgets a session once its window has passed', () => {
    let now = 1_000;
    const b = new ImgBudget(1000, () => now);
    for (let i = 0; i < 4; i++) b.take('s5', 'wallpaper');
    expect(b.take('s5', 'wallpaper').allowed).toBe(false);
    now += 5000;
    expect(b.take('s5', 'wallpaper').allowed).toBe(true);
  });
});

/**
 * The session ceiling used to be keyed on the client's own `session` string, so
 * one IP rotating it per call got 44 images (and $0.132) out of a documented
 * limit of 30. The ceiling is now charged to the ip hash; the client's string
 * survives only as a sub-key of the per-scope buckets.
 */
describe('I3 — the session ceiling cannot be rotated away', () => {
  it('charges the whole-session limit to the server-derived bucket', () => {
    const b = new ImgBudget(30 * 60_000, () => Date.now(), 5);
    let ok = 0;
    for (let i = 0; i < 40; i++) if (b.take('ip-hash-1', 'photo', 'win-' + i, 'client-session-' + i).allowed) ok++;
    expect(ok).toBe(5);
    // a different address is its own visitor
    expect(b.take('ip-hash-2', 'photo', 'win-0', 'client-session-0').allowed).toBe(true);
  });

  it('still gives two tabs on one machine their own per-scope buckets', () => {
    const b = new ImgBudget(30 * 60_000, () => Date.now(), 100);
    for (let i = 0; i < 2; i++) expect(b.take('ip', 'faces', 'nav-1', 'tab-a').allowed).toBe(true);
    expect(b.take('ip', 'faces', 'nav-1', 'tab-a')).toMatchObject({ allowed: false, reason: 'scope' });
    expect(b.take('ip', 'faces', 'nav-1', 'tab-b').allowed).toBe(true);
  });
});

describe('I3 — the budget without a scope id from the kernel', () => {
  it('falls back to a rolling window instead of dead-ending the session', () => {
    let now = 1_000_000;
    const b = new ImgBudget(30 * 60_000, () => now, 100);
    // four photos on one app open, then refused
    for (let i = 0; i < 4; i++) expect(b.take('s', 'photo').allowed).toBe(true);
    expect(b.take('s', 'photo').allowed).toBe(false);
    // a minute later — the next app open — the visitor is not locked out
    now += ImgBudget.FALLBACK_WINDOW_MS + 1;
    expect(b.take('s', 'photo').allowed).toBe(true);
  });
});

describe('IMG_MODEL — the endpoint is a variable (reviews/IMG-LATENCY-2.md)', () => {
  it('defaults to schnell and refuses to believe an unknown value', () => {
    // a typo in a Railway variable must not take the pictures away from every
    // visitor, so an unrecognised id falls back instead of throwing
    expect(resolveImgModel(undefined)).toBe(IMG_MODEL_DEFAULT);
    expect(resolveImgModel('')).toBe(IMG_MODEL_DEFAULT);
    expect(resolveImgModel('   ')).toBe(IMG_MODEL_DEFAULT);
    expect(resolveImgModel('fal-ai/flux-1/schnel')).toBe(IMG_MODEL_DEFAULT);
    expect(resolveImgModel('https://evil.test/x')).toBe(IMG_MODEL_DEFAULT);
    // and nothing off the prototype chain is an endpoint
    expect(resolveImgModel('constructor')).toBe(IMG_MODEL_DEFAULT);
    expect(resolveImgModel('__proto__')).toBe(IMG_MODEL_DEFAULT);
    expect(resolveImgModel('fal-ai/sana/sprint')).toBe('fal-ai/sana/sprint');
    expect(resolveImgModel(' fal-ai/sana ')).toBe('fal-ai/sana');
  });

  it('prices each endpoint at its own rate, all of them at or under $0.006', () => {
    for (const [id, spec] of Object.entries(IMG_MODELS)) {
      expect(spec.usd_mp, id).toBeGreaterThan(0);
      // the shelf this pass measured was defined as "at or below $0.006 an image"
      expect(spec.usd_mp, id).toBeLessThanOrEqual(0.006);
      expect(spec.default_steps, id).toBeGreaterThanOrEqual(1);
      expect(spec.default_steps, id).toBeLessThanOrEqual(spec.max_steps);
      expect(imgUsd(id)).toBe(spec.usd_mp);
    }
    // the default is still SPEC §12.5's number, which is what IMG_USD names
    expect(imgUsd(IMG_MODEL_DEFAULT)).toBe(IMG_USD);
    // an unknown model bills at the default rather than at zero: a missing
    // price that reads as free is how a day's USD cap stops being a cap
    expect(imgUsd('fal-ai/nope')).toBe(IMG_USD);
  });

  it('keeps the measured per-kind step table for schnell and nobody else', () => {
    // 4/4/3/3/3 was measured on schnell (BAKEOFF-3 finding 10) and does not
    // transfer: a 2-step distilled model and an 18-step one do not mean the
    // same thing by "3"
    for (const kind of Object.keys(IMG_KINDS) as (keyof typeof IMG_KINDS)[]) {
      expect(stepsFor(kind, IMG_MODEL_DEFAULT), kind).toBe(IMG_STEPS[kind]);
    }
    expect(stepsFor('wallpaper', 'fal-ai/sana/sprint')).toBe(2);
    expect(stepsFor('photo', 'fal-ai/sana/sprint')).toBe(2);
    expect(stepsFor('wallpaper', 'fal-ai/sana')).toBe(18);
    // clamped to the endpoint's own documented ceiling, so a per-kind number
    // can never 422 a model whose maximum is lower
    expect(stepsFor('wallpaper', 'fal-ai/z-image/turbo')).toBe(8);
    for (const [id, spec] of Object.entries(IMG_MODELS)) {
      for (const kind of Object.keys(IMG_KINDS) as (keyof typeof IMG_KINDS)[]) {
        expect(stepsFor(kind, id), id + '/' + kind).toBeLessThanOrEqual(spec.max_steps);
        expect(stepsFor(kind, id), id + '/' + kind).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('posts to fal.run/<model>, and FAL_ENDPOINT still wins for the fake', () => {
    expect(imgEndpoint('fal-ai/sana/sprint')).toBe('https://fal.run/fal-ai/sana/sprint');
    expect(imgEndpoint(IMG_MODEL_DEFAULT)).toBe('https://fal.run/fal-ai/flux-1/schnell');
    // never queue.fal.run: measured slower at all four endpoints, and it costs
    // a second round trip for the bytes that sync_mode inlines
    expect(imgEndpoint(IMG_MODEL_DEFAULT)).not.toContain('queue.');
    expect(imgEndpoint('fal-ai/sana', 'http://127.0.0.1:1/fal')).toBe('http://127.0.0.1:1/fal');
  });

  it('sends the chosen model its own steps, at the same size and in sync_mode', async () => {
    const fal = fakeFal();
    await falImage('wallpaper', 'a wet street', 'seed-1', { key: 'k', model: 'fal-ai/sana/sprint', fetchImpl: fal.impl });
    expect(fal.calls[0].url).toBe('https://fal.run/fal-ai/sana/sprint');
    expect(fal.calls[0].body.num_inference_steps).toBe(2);
    // everything else about the call is model-independent, which is what makes
    // IMG_MODEL a variable and not an adapter
    expect(fal.calls[0].body.sync_mode).toBe(true);
    expect(fal.calls[0].body.output_format).toBe('jpeg');
    expect(fal.calls[0].body.enable_safety_checker).toBe(true);
    expect(fal.calls[0].body.image_size).toEqual({ width: 1024, height: 576 });

    const bad = fakeFal();
    await falImage('wallpaper', 'a wet street', 'seed-1', { key: 'k', model: 'fal-ai/nonsense', fetchImpl: bad.impl });
    expect(bad.calls[0].url).toBe('https://fal.run/' + IMG_MODEL_DEFAULT);
    expect(bad.calls[0].body.num_inference_steps).toBe(IMG_STEPS.wallpaper);
  });
});

/** T2 — the alias table between `faces` and `{tiles, theme}`. */
describe('T2 — normalizeTiles', () => {
  it('maps the old spelling onto the sheet it always was', async () => {
    const { normalizeTiles, TILE_THEMES } = await import('../server/img.js');
    expect(normalizeTiles('faces', undefined)).toEqual({ kind: 'tiles', theme: 'faces', alias: true });
    // a client that sends both is taken at its word on the theme
    expect(normalizeTiles('faces', 'posters')).toEqual({ kind: 'tiles', theme: 'posters', alias: true });
    // ...but an old client's nonsense theme is not a reason to lose its picture
    expect(normalizeTiles('faces', 'weapons')).toEqual({ kind: 'tiles', theme: 'faces', alias: true });
    expect(TILE_THEMES).toEqual(['faces', 'posters', 'products', 'thumbnails', 'covers']);
  });

  it('defaults a themeless sheet and refuses a theme it does not know', async () => {
    const { normalizeTiles } = await import('../server/img.js');
    expect(normalizeTiles('tiles', undefined)).toEqual({ kind: 'tiles', theme: 'faces', alias: false });
    expect(normalizeTiles('tiles', '')).toEqual({ kind: 'tiles', theme: 'faces', alias: false });
    expect(normalizeTiles('tiles', 'covers')).toEqual({ kind: 'tiles', theme: 'covers', alias: false });
    // an unknown theme is an error and not a fallback: a wrong theme is a wrong
    // $0.003 picture, and this field comes from our own kernel
    expect(normalizeTiles('tiles', 'weapons')).toMatchObject({ badTheme: true });
    expect(normalizeTiles('tiles', 7)).toMatchObject({ badTheme: true });
  });

  it('leaves every other kind alone', async () => {
    const { normalizeTiles } = await import('../server/img.js');
    for (const k of ['wallpaper', 'icons', 'photo', 'map'] as const) {
      expect(normalizeTiles(k, 'posters')).toEqual({ kind: k, alias: false });
    }
  });

  it('a sheet is charged like the page picture it replaces, and an app may claim it', async () => {
    const { scopeForRequest } = await import('../server/img.js');
    expect(scopeForRequest('tiles', undefined)).toBe('page');
    expect(scopeForRequest('tiles', 'app')).toBe('app');
    expect(scopeForRequest('tiles', 'boot')).toBe('page');
  });
});

/**
 * T2 — the one thing that can silently break tile sheets: the kernel's list and
 * the server's drifting apart. Both files say "must stay identical to the
 * other"; this is the assertion that makes that true. A theme the server does
 * not know is a 400, so a kernel that adds one first loses the picture.
 */
describe('T2 — the theme list is shared with the kernel', () => {
  it('server/img.ts and kernel/protocol.ts agree, in order', async () => {
    const { TILE_THEMES, TILE_THEME_DEFAULT } = await import('../server/img.js');
    const k = await import('../kernel/protocol.js');
    expect([...k.TILE_THEMES]).toEqual([...TILE_THEMES]);
    expect(k.TILE_THEME_DEFAULT).toBe(TILE_THEME_DEFAULT);
    // and the kernel only ever asks for kinds the server accepts
    const { isImgKind } = await import('../server/img.js');
    for (const kind of k.DOC_IMG_KINDS) expect(isImgKind(kind), kind).toBe(true);
  });
});

/**
 * HANDOFF-7 §5 / §11.7 — 7 of 90 photo calls died `engine_dead` with `bytes: 0`
 * at 3.5-4.6 s. The decision of whether such a failure is worth one more call
 * lives here rather than in the route, so the table can be held still.
 */
describe('HANDOFF-7 §11.7 — the one image retry', () => {
  const err = (code: 'upstream' | 'empty' | 'too-big' | 'timeout', status: number, msg = '', billable = false) =>
    new ImgError(code, status, msg, billable);

  it('retries a fast provider failure that was never billed', () => {
    expect(shouldRetryImg(err('upstream', 500, '{"detail":"internal"}'), 3_800)).toBe(true);
    expect(shouldRetryImg(err('upstream', 0, 'fetch failed'), 900)).toBe(true);
    expect(shouldRetryImg(err('upstream', 502, 'bad gateway'), 4_600)).toBe(true);
  });

  it('never retries a slow failure: the visitor has already waited', () => {
    expect(shouldRetryImg(err('upstream', 500, 'internal'), IMG_RETRY_MAX_MS)).toBe(false);
    expect(shouldRetryImg(err('upstream', 500, 'internal'), 19_000)).toBe(false);
  });

  it('never retries a timeout, ours or the caller hanging up', () => {
    expect(shouldRetryImg(err('timeout', 504, 'image timed out'), 500)).toBe(false);
    expect(shouldRetryImg(err('timeout', 504, 'image cancelled by caller'), 400)).toBe(false);
  });

  it('never retries something already paid for', () => {
    // fal answered 2xx and rendered: a retry buys a second picture for one slot
    expect(shouldRetryImg(err('empty', 502, 'no image in response', true), 2_000)).toBe(false);
    expect(shouldRetryImg(err('too-big', 502, 'image 9000000 bytes', true), 2_000)).toBe(false);
  });

  it('never retries a rate limit, an auth failure or a refusal of the content', () => {
    expect(shouldRetryImg(err('upstream', 429, 'too many requests'), 300)).toBe(false);
    expect(shouldRetryImg(err('upstream', 401, 'unauthorized'), 300)).toBe(false);
    expect(shouldRetryImg(err('upstream', 402, 'out of credit'), 300)).toBe(false);
    expect(shouldRetryImg(err('upstream', 422, 'NSFW content detected'), 300)).toBe(false);
    expect(shouldRetryImg(err('upstream', 400, 'prompt violates our content policy'), 300)).toBe(false);
    expect(shouldRetryImg(err('upstream', 403, 'forbidden'), 300)).toBe(false);
  });

  it('reads a refusal off the status or the body, and any doubt is a refusal', () => {
    expect(isModerationRefusal(422, 'flagged by the safety checker')).toBe(true);
    expect(isModerationRefusal(400, 'sexual content')).toBe(true);
    expect(isModerationRefusal(403, '{}')).toBe(true);
    expect(isModerationRefusal(500, 'internal server error')).toBe(false);
    expect(isModerationRefusal(0, '')).toBe(false);
  });

  it('retries nothing that is not one of our own errors', () => {
    expect(shouldRetryImg(new Error('boom'), 100)).toBe(false);
    expect(shouldRetryImg(null, 100)).toBe(false);
  });

  it('simplifies a prompt to its first two clauses, plainer and shorter', () => {
    expect(simplifyImgPrompt('a chipped enamel jug on a windowsill, low winter light, shallow depth of field, 35mm')).toBe(
      'a chipped enamel jug on a windowsill, low winter light'
    );
    // the characters a provider's parser chokes on go, the words stay
    expect(simplifyImgPrompt('a "brass" (dented) lamp\non a {desk}, warm light')).toBe('a brass dented lamp on a desk, warm light');
    // already short: unchanged
    expect(simplifyImgPrompt('a jug')).toBe('a jug');
    // and a prompt that simplifies to nothing is not worth a second call
    expect(simplifyImgPrompt('   ')).toBe('');
    expect(simplifyImgPrompt('***')).toBe('');
  });

  it('clamps the simplified prompt', () => {
    const long = 'a'.repeat(400) + ', more';
    expect(simplifyImgPrompt(long).length).toBeLessThanOrEqual(140);
  });
});
