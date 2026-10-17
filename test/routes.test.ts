import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { findIdentityComment, validIdentityPayload } from '../server/identity.js';

process.env.HALLUCINOS_NO_LISTEN = '1';
process.env.MODERATION = 'local';
process.env.GEN_PER_IP_PER_HOUR = '100000';
process.env.MAX_GEN_PER_DAY = '100000';
// every request in this file comes from the same (absent) IP, so the whole file
// shares ONE session image bucket; the 30 is a money guard measured in
// test/img.test.ts against its own ImgBudget, not a route assertion. Without
// this, adding an /api/img test silently 429s the ones written after it.
process.env.IMG_PER_IP_PER_SESSION = '100000';
// defined-but-empty beats loadEnv(), which only fills what is undefined: the
// real key in .env must never reach a test.
process.env.FAL_KEY = '';
delete process.env.FAL_ENDPOINT;

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let app: any;
beforeAll(async () => {
  app = (await import('../server/index.js')).app;
});
afterEach(() => {
  delete process.env.MOCK_BREAK;
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': CHROME, ...headers },
    body: JSON.stringify(body),
  });

const boot = (extra: Record<string, unknown> = {}) => post('/api/gen', { kind: 'boot', engine: 'mock', seed: 's' + Math.random(), ...extra });

describe('I1 — the identity rides in the boot stream', () => {
  it('puts a valid identity comment first, before <!doctype>', async () => {
    const res = await boot();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.indexOf('<!--os-identity:')).toBe(0);
    const found = findIdentityComment(text)!;
    expect(validIdentityPayload(found.json)).toBe(true);
    expect(found.end).toBeLessThan(text.toLowerCase().indexOf('<!doctype'));
    expect(['taskbar', 'dock']).toContain((found.json as any).archetype);
  });

  it('injects its own when the model produces an unparseable one', async () => {
    process.env.MOCK_BREAK = 'identity-bad';
    const res = await boot();
    const text = await res.text();
    const found = findIdentityComment(text)!;
    expect(validIdentityPayload(found.json)).toBe(true);
    // exactly one, and the broken one is gone
    expect(text.split('<!--os-identity:').length - 1).toBe(1);
    const tel = JSON.parse(/<!--os-telemetry:([\s\S]*?)-->/.exec(text)![1]);
    expect(tel.identity_fallback).toBe(true);
    // the fallback's tokens are charged, not hidden
    expect(tel.tokens_out).toBeGreaterThan(0);
  });

  it('still streams the boot document after the comment', async () => {
    const text = await (await boot()).text();
    expect(text.toLowerCase()).toContain('<!doctype html>');
    expect(text).toContain('</html>');
  });

  it('does not put an identity comment on any other kind', async () => {
    const text = await (await post('/api/gen', { kind: 'page', engine: 'mock', seed: 'p', context: { url: 'https://example.com/' } })).text();
    expect(text).not.toContain('<!--os-identity:');
  });
});

describe('I6 — timing telemetry and /api/mark', () => {
  it('reports the breakdown and a gen_id in the header and the sentinel', async () => {
    const res = await post('/api/gen', { kind: 'app', engine: 'mock', seed: 'a', context: { app_id: 'notes' } });
    const genId = res.headers.get('x-os-gen-id');
    expect(genId).toBeTruthy();
    const tel = JSON.parse(/<!--os-telemetry:([\s\S]*?)-->/.exec(await res.text())![1]);
    expect(tel.gen_id).toBe(genId);
    expect(tel.moderation_ms).toBeGreaterThanOrEqual(0);
    expect(tel.server_ms).toBeGreaterThanOrEqual(0);
    expect(tel.provider_ttfb_ms).toBeGreaterThanOrEqual(0);
  });

  it('takes the two numbers only the browser can see', async () => {
    const res = await post('/api/gen', { kind: 'app', engine: 'mock', seed: 'a2', context: { app_id: 'notes' } });
    const genId = res.headers.get('x-os-gen-id')!;
    await res.text();
    const marked = await post('/api/mark', { gen_id: genId, first_paint_ms: 412, interactive_ms: 980 });
    expect(marked.status).toBe(200);
    expect(await marked.json()).toEqual({ ok: true, matched: true });
  });

  it('refuses a mark with no gen_id and shrugs at an unknown one', async () => {
    expect((await post('/api/mark', { first_paint_ms: 1 })).status).toBe(400);
    expect(await (await post('/api/mark', { gen_id: 'nope' })).json()).toEqual({ ok: true, matched: false });
  });

  /**
   * The route is unauthenticated and client gen_ids are accepted verbatim on
   * /api/gen, so a mark for an id this process never issued must not be held
   * (it would pre-poison that generation's numbers) and a field that has
   * already been measured must not be rewritable.
   */
  it('does not let a stranger overwrite the numbers on a real generation', async () => {
    const res = await post('/api/gen', { kind: 'app', engine: 'mock', seed: 'ow', context: { app_id: 'notes' } });
    const genId = res.headers.get('x-os-gen-id')!;
    await res.text();
    await post('/api/mark', { gen_id: genId, first_paint_ms: 640, interactive_ms: 700 });
    await post('/api/mark', { gen_id: genId, first_paint_ms: 0, interactive_ms: 0 });
    const { telemetry } = await import('../server/index.js');
    const line = telemetry.recent(400).find((l: any) => l.gen_id === genId)!;
    expect(line.first_paint_ms).toBe(640);
    expect(line.interactive_ms).toBe(700);
  });

  it('holds an early mark only for an id it issued', async () => {
    const { telemetry } = await import('../server/index.js');
    // an id nobody issued: dropped, never held, so it can never join a line
    expect(await (await post('/api/mark', { gen_id: 'kernel-999', first_paint_ms: 5 })).json()).toEqual({ ok: true, matched: false });
    const res = await post('/api/gen', { kind: 'app', engine: 'mock', seed: 'h', gen_id: 'kernel-999', context: { app_id: 'notes' } });
    await res.text();
    const line = telemetry.recent(400).find((l: any) => l.gen_id === 'kernel-999')!;
    expect(line.first_paint_ms).toBeUndefined();
  });
});

describe('I2 — /api/identity-seen and the never-names ring', () => {
  /** a real boot, whose gen_id is the only ticket this route accepts */
  const bootTicket = async (): Promise<string> => {
    const res = await boot();
    const id = res.headers.get('x-os-gen-id')!;
    await res.text();
    return id;
  };

  it('records a name against the boot it came out of and reports the ring size', async () => {
    const res = await post('/api/identity-seen', { name: 'TALLOW 4', gen_id: await bootTicket() });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.count).toBeGreaterThan(0);
  });

  it('refuses junk without erroring', async () => {
    const t = await bootTicket();
    expect(await (await post('/api/identity-seen', { name: '', gen_id: t })).json()).toMatchObject({ ok: false });
    expect(await (await post('/api/identity-seen', { name: 12, gen_id: t })).json()).toMatchObject({ ok: false });
    expect((await post('/api/identity-seen', {})).status).toBe(200);
  });

  /**
   * The route is global prompt state: whatever lands here is spliced into every
   * later boot prompt as {{never_names}}. Unguarded, 220 writes from one
   * stranger replaced the whole ring and added 58% to every other visitor's
   * boot prompt.
   */
  it('refuses a name with no ticket, a made-up ticket, or a ticket already spent', async () => {
    expect(await (await post('/api/identity-seen', { name: 'NO TICKET' })).json()).toMatchObject({ ok: false });
    expect(await (await post('/api/identity-seen', { name: 'FAKE', gen_id: 'g9-invented' })).json()).toMatchObject({ ok: false });
    const t = await bootTicket();
    expect(await (await post('/api/identity-seen', { name: 'ONE PER BOOT', gen_id: t })).json()).toMatchObject({ ok: true });
    // the ticket is spent: a second name on the same generation is refused
    expect(await (await post('/api/identity-seen', { name: 'TWO PER BOOT', gen_id: t })).json()).toMatchObject({ ok: false });
  });

  /**
   * Found on a real cerebras-oss120 boot: spending the ticket by DELETING the id
   * also took away /api/mark's ticket, and the identity comment arrives ~100 ms
   * before the boot document paints — so every boot lost its first-paint mark,
   * the one number SPEC §12.1 leads with.
   */
  it('spending the name does not cost the boot its mark ticket', async () => {
    const res = await boot();
    const id = res.headers.get('x-os-gen-id')!;
    await res.text();
    expect(await (await post('/api/identity-seen', { name: 'STILL A MARK TICKET', gen_id: id })).json()).toMatchObject({ ok: true });
    expect(await (await post('/api/mark', { gen_id: id, first_paint_ms: 900 })).json()).toEqual({ ok: true, matched: true });
  });

  it('will not accept a ticket from some other kind of generation', async () => {
    const res = await post('/api/gen', { kind: 'app', engine: 'mock', seed: 'a', context: { app_id: 'notes' } });
    const id = res.headers.get('x-os-gen-id')!;
    await res.text();
    expect(await (await post('/api/identity-seen', { name: 'FROM AN APP', gen_id: id })).json()).toMatchObject({ ok: false });
  });

  it('moderates the name like any other string that reaches a prompt', async () => {
    const t = await bootTicket();
    expect(await (await post('/api/identity-seen', { name: 'child porn machine', gen_id: t })).json()).toMatchObject({ ok: false });
  });

  it('is closed to bots like everything else', async () => {
    const res = await app.request('/api/identity-seen', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'python-requests/2.31' },
      body: '{"name":"X"}',
    });
    expect(res.status).toBe(403);
  });

  it('feeds the names it has seen into the next boot prompt', async () => {
    // the mock echoes nothing of the prompt, so this is asserted where it is
    // decidable: the ring is what /api/identity-seen writes, and buildPrompt
    // renders {{never_names}} from it (see test/prompts.test.ts).
    await post('/api/identity-seen', { name: 'NEVER-REUSE-ME', gen_id: await bootTicket() });
    const j = await (await post('/api/identity-seen', {})).json();
    expect(j.count).toBeGreaterThanOrEqual(1);
  });
});

describe('I3 — /api/img', () => {
  it('404s without a key so the kernel keeps its SVG fallback', async () => {
    const res = await post('/api/img', { kind: 'wallpaper', prompt: 'a wet street', seed: 's', session: 'x' });
    expect(res.status).toBe(404);
  });

  describe('with a (fake) image engine', () => {
    let server: import('node:http').Server;
    let calls = 0;
    beforeAll(async () => {
      const http = await import('node:http');
      server = http.createServer((req, res) => {
        if (req.url?.startsWith('/img')) {
          res.writeHead(200, { 'content-type': 'image/jpeg' });
          res.end(Buffer.from('ffd8ffdb', 'hex'));
          return;
        }
        calls++;
        let body = '';
        req.on('data', (d) => (body += d));
        req.on('end', () => {
          bodySpy?.(body);
          sentAll.push(body);
          /**
           * HANDOFF-7 §11.7 — a fal that fails FAST the first n times, so the
           * one retry has something to be a retry of. `failWith` sets both the
           * status and the body, because the body is what decides whether a
           * failure reads as a refusal of the content (never retried) or as a
           * provider hiccup (retried once).
           */
          if (failNext > 0) {
            failNext--;
            res.writeHead(failWith.status, { 'content-type': 'application/json' });
            res.end(failWith.body);
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ images: [{ url: `http://127.0.0.1:${port}/img.jpg`, width: 1024, height: 576 }] }));
        });
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      port = (server.address() as any).port;
      process.env.FAL_KEY = 'test-key';
      process.env.FAL_ENDPOINT = `http://127.0.0.1:${port}/fal`;
    });
    let port = 0;
    /** every body POSTed to the fake fal, so a retry's prompt can be read back */
    const sentAll: string[] = [];
    /** how many of the next calls fail fast, and with what */
    let failNext = 0;
    let failWith = { status: 500, body: JSON.stringify({ detail: 'internal' }) };
    /** capture the next body POSTed to the fake fal */
    let bodySpy: ((b: string) => void) | null = null;
    const http2Spy = (fn: (b: string) => void) => {
      bodySpy = fn;
      return () => (bodySpy = null);
    };
    afterAll(() => {
      server?.close();
      process.env.FAL_KEY = '';
      delete process.env.FAL_ENDPOINT;
    });

    const img = (body: Record<string, unknown>) => post('/api/img', { kind: 'wallpaper', prompt: 'a wet street', seed: 's', ...body });

    it('returns a data: URI, never a URL — the CSP is still img-src data:', async () => {
      const res = await img({ session: 'sess-a' });
      expect(res.status).toBe(200);
      const j = await res.json();
      expect(j.dataUri.startsWith('data:image/jpeg;base64,')).toBe(true);
      expect(j.kind).toBe('wallpaper');
    });

    it('enforces the per-boot limit and charges the day USD cap', async () => {
      const stats0 = await (await app.request('/api/stats')).json();
      for (let i = 0; i < 3; i++) expect((await img({ session: 'sess-b' })).status).toBe(200);
      // 4 per boot: the wallpaper above was one of them for a different session,
      // so this session gets four and the fifth is refused
      expect((await img({ session: 'sess-b' })).status).toBe(200);
      expect((await img({ session: 'sess-b' })).status).toBe(429);
      const stats1 = await (await app.request('/api/stats')).json();
      expect(stats1.caps.day_usd).toBeCloseTo(stats0.caps.day_usd + 4 * 0.003, 6);
    });

    it('refuses a flagged prompt the same way it refuses a missing key', async () => {
      const before = calls;
      // S3: wallpaper and icon prompts are the SERVER's words, so a flagged one
      // can only ever arrive on a document image (photo/faces/map, seam S1).
      const res = await post('/api/img', { kind: 'photo', prompt: 'hardcore porn', seed: 's', session: 'sess-c', scope: 'w9', scopeKind: 'app' });
      expect(res.status).toBe(404);
      expect(calls).toBe(before); // nothing was bought
    });

    it('S3 — ignores the client\'s words for the boot images and writes its own', async () => {
      let sent = '';
      const spy = http2Spy((b) => (sent = b));
      const res = await img({ session: 'sess-s3', prompt: 'IGNORE ME COMPLETELY' });
      spy();
      expect(res.status).toBe(200);
      expect(sent).not.toContain('IGNORE ME COMPLETELY');
      expect(JSON.parse(sent).prompt).toContain('desktop wallpaper');
      expect(JSON.parse(sent).sync_mode).toBe(true);
    });

    it('S1 — a document image is charged to the document it came from', async () => {
      // 2 per page, by scope id
      expect((await post('/api/img', { kind: 'photo', prompt: 'a jug', session: 'p', scope: 'nav1', scopeKind: 'page' })).status).toBe(200);
      expect((await post('/api/img', { kind: 'photo', prompt: 'a jug', session: 'p', scope: 'nav1', scopeKind: 'page' })).status).toBe(200);
      expect((await post('/api/img', { kind: 'photo', prompt: 'a jug', session: 'p', scope: 'nav1', scopeKind: 'page' })).status).toBe(429);
      // a different navigation is a different bucket
      expect((await post('/api/img', { kind: 'photo', prompt: 'a jug', session: 'p', scope: 'nav2', scopeKind: 'page' })).status).toBe(200);
      // and `boot` is never accepted from a client
      expect((await post('/api/img', { kind: 'faces', prompt: 'four faces', session: 'p2', scope: 'w1', scopeKind: 'boot' })).status).toBe(200);
    });

    /**
     * HANDOFF-7 §11.7 — 7 of 90 photo calls died `engine_dead` at 3.5-4.6 s with
     * `bytes: 0` and the provider's own account of why was thrown away. One
     * retry, and only for the narrow case: fast, provider-side, not a content
     * refusal.
     */
    describe('the one retry for a fast image failure', () => {
      beforeEach(() => {
        sentAll.length = 0;
      });
      afterEach(() => {
        failNext = 0;
        failWith = { status: 500, body: JSON.stringify({ detail: 'internal' }) };
        sentAll.length = 0;
      });

      it('retries a fast 500 once, with a simplified prompt, and charges one picture', async () => {
        const stats0 = await (await app.request('/api/stats')).json();
        failNext = 1;
        const res = await post('/api/img', {
          kind: 'photo',
          prompt: 'a chipped enamel jug on a windowsill, low winter light, shallow depth of field, 35mm',
          session: 'retry-a',
          scope: 'w-r1',
          scopeKind: 'app',
        });
        expect(res.status).toBe(200);
        expect(sentAll.length).toBe(2);
        const second = JSON.parse(sentAll[1]).prompt;
        expect(second).toBe('a chipped enamel jug on a windowsill, low winter light');
        // one picture arrived, so one picture is billed — not two calls' worth
        const stats1 = await (await app.request('/api/stats')).json();
        expect(stats1.caps.day_usd).toBeCloseTo(stats0.caps.day_usd + 0.003, 6);
      });

      it('never retries a refusal of the content — the same words are refused twice', async () => {
        failNext = 2;
        failWith = { status: 422, body: JSON.stringify({ detail: 'prompt rejected by the safety checker' }) };
        const res = await post('/api/img', { kind: 'photo', prompt: 'a jug, low light', session: 'retry-b', scope: 'w-r2', scopeKind: 'app' });
        expect(res.status).toBe(502);
        expect(sentAll.length).toBe(1);
      });

      it('never retries a rate limit', async () => {
        failNext = 2;
        failWith = { status: 429, body: JSON.stringify({ detail: 'too many requests' }) };
        const res = await post('/api/img', { kind: 'photo', prompt: 'a jug, low light', session: 'retry-c', scope: 'w-r3', scopeKind: 'app' });
        expect(res.status).toBe(502);
        expect(sentAll.length).toBe(1);
      });

      it('does not retry a sheet: the grid clauses do not survive the simplification', async () => {
        failNext = 2;
        const res = await post('/api/img', {
          kind: 'tiles',
          theme: 'posters',
          prompt: 'sixteen invented films',
          session: 'retry-d',
          scope: 'nav-r4',
          scopeKind: 'page',
        });
        expect(res.status).toBe(502);
        expect(sentAll.length).toBe(1);
      });

      it('gives the visitor nothing of the provider\'s words when both calls fail', async () => {
        failNext = 2;
        const res = await post('/api/img', { kind: 'photo', prompt: 'a jug, low light', session: 'retry-e', scope: 'w-r5', scopeKind: 'app' });
        expect(res.status).toBe(502);
        expect(sentAll.length).toBe(2);
        expect(await res.json()).toEqual({ error: 'image unavailable' });
      });
    });

    /**
     * T2 — the tile sheet. One 768x768 sheet, 4x4, sliced by the runtime exactly
     * as `faces` always was; the prompt is the theme's clause plus the group's
     * own description plus (for an app, never a page) the machine's palette.
     */
    it('T2 — draws a themed sheet and builds the prompt from theme + the set', async () => {
      let sent = '';
      const spy = http2Spy((b) => (sent = b));
      const res = await post('/api/img', {
        kind: 'tiles',
        theme: 'posters',
        prompt: 'the genre mix of this catalogue leans to mountaineering documentaries',
        seed: 'tl',
        session: 'tiles-a',
        scope: 'w1',
        scopeKind: 'app',
      });
      spy();
      expect(res.status).toBe(200);
      const j = await res.json();
      expect(j.kind).toBe('tiles');
      expect(j.theme).toBe('posters');
      const body = JSON.parse(sent);
      expect(body.image_size).toEqual({ width: 768, height: 768 });
      expect(body.prompt).toContain('poster');
      // the group's own description of the set reaches the provider
      expect(body.prompt).toContain('mountaineering documentaries');
      // and so do the mechanical clauses the runtime needs to slice at quarters
      expect(body.prompt).toContain('4x4');
      expect(body.prompt).toContain('no text');
    });

    it('T2 — `faces` is the old spelling of the same sheet, and is still accepted', async () => {
      let sent = '';
      const spy = http2Spy((b) => (sent = b));
      const res = await post('/api/img', { kind: 'faces', prompt: 'the regulars of this forum', session: 'tiles-b', scope: 'nav1', scopeKind: 'page' });
      spy();
      expect(res.status).toBe(200);
      const j = await res.json();
      // the client reads its own word back
      expect(j.kind).toBe('faces');
      expect(j.theme).toBe('faces');
      const body = JSON.parse(sent);
      expect(body.image_size).toEqual({ width: 768, height: 768 });
      expect(body.prompt).toContain('portrait');
      expect(body.prompt).toContain('the regulars of this forum');
    });

    it('T2 — a sheet with no set description still gets a coherent prompt', async () => {
      const res = await post('/api/img', { kind: 'tiles', theme: 'products', session: 'tiles-c', scope: 'w2', scopeKind: 'app' });
      expect(res.status).toBe(200);
    });

    it('T2 — a theme that is not one of ours is refused, not silently drawn', async () => {
      const before = calls;
      const res = await post('/api/img', { kind: 'tiles', theme: 'weapons', prompt: 'x', session: 'tiles-d', scope: 'w3', scopeKind: 'app' });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('bad theme');
      expect(calls).toBe(before); // nothing was bought
    });

    it('T2 — a page sheet carries no identity words (SPEC §3.1)', async () => {
      // give this session an identity through a boot, then ask as a page
      await post('/api/gen', { kind: 'boot', engine: 'mock', seed: 'tiles-id', session: 'tiles-id' });
      let sentApp = '';
      let spy = http2Spy((b) => (sentApp = b));
      await post('/api/img', { kind: 'tiles', theme: 'covers', prompt: 'a shelf', seed: 'tiles-id', session: 'tiles-id', scope: 'w1', scopeKind: 'app' });
      spy();
      let sentPage = '';
      spy = http2Spy((b) => (sentPage = b));
      await post('/api/img', { kind: 'tiles', theme: 'covers', prompt: 'a shelf', seed: 'tiles-id', session: 'tiles-id', scope: 'nav9', scopeKind: 'page' });
      spy();
      const appPrompt = JSON.parse(sentApp).prompt as string;
      const pagePrompt = JSON.parse(sentPage).prompt as string;
      // mock's boot fixture paints itself oxide / bone / signal green
      expect(appPrompt).toContain('oxide');
      expect(pagePrompt).not.toContain('oxide');
      // both still carry the theme and the geometry
      for (const p of [appPrompt, pagePrompt]) {
        expect(p).toContain('cover design');
        expect(p).toContain('no gutters');
      }
    });

    it('T2 — a sheet counts as ONE image against the page\'s two', async () => {
      expect((await post('/api/img', { kind: 'tiles', theme: 'thumbnails', session: 't2lim', scope: 'nav1', scopeKind: 'page' })).status).toBe(200);
      expect((await post('/api/img', { kind: 'photo', prompt: 'a jug', session: 't2lim', scope: 'nav1', scopeKind: 'page' })).status).toBe(200);
      expect((await post('/api/img', { kind: 'tiles', theme: 'faces', session: 't2lim', scope: 'nav1', scopeKind: 'page' })).status).toBe(429);
    });

    it('T2 — a tile prompt is moderated exactly like any other document prompt', async () => {
      const before = calls;
      const res = await post('/api/img', { kind: 'tiles', theme: 'faces', prompt: 'hardcore porn', session: 'tiles-mod', scope: 'w4', scopeKind: 'app' });
      expect(res.status).toBe(404);
      expect(calls).toBe(before);
    });

    it('S3 — the identity the boot stream declared reaches the wallpaper prompt', async () => {
      // the whole point of server/sessions.ts: /api/gen learns the identity out
      // of the boot stream, /api/img finds it again and writes the words
      const boot = await app.request('/api/gen', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': CHROME },
        body: JSON.stringify({ kind: 'boot', engine: 'mock', seed: 's3-int', session: 's3-int' }),
      });
      expect(await boot.text()).toContain('<!--os-identity:');
      let sent = '';
      const spy = http2Spy((b: string) => (sent = b));
      const res = await post('/api/img', { kind: 'wallpaper', session: 's3-int' });
      spy();
      expect(res.status).toBe(200);
      // mock's boot fixture paints itself oxide / bone / signal green
      expect(JSON.parse(sent).prompt).toContain('oxide');
    });

    it('BAKEOFF-2 finding 6 — an icon sheet is refused when no desktop ever started', async () => {
      const before = calls;
      const res = await post('/api/img', { kind: 'icons', session: 'no-desk', seed: 'no-desk' });
      expect(res.status).toBe(404);
      expect(calls).toBe(before);
    }, 20_000);

    it('adopts a sane client gen_id so an early mark still joins', async () => {
      const res = await app.request('/api/gen', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': CHROME },
        body: JSON.stringify({ kind: 'app', engine: 'mock', seed: 'g', gen_id: 'kernel-123', context: { app_id: 'notes' } }),
      });
      expect(res.headers.get('x-os-gen-id')).toBe('kernel-123');
      await res.text();
      expect(await (await post('/api/mark', { gen_id: 'kernel-123', first_paint_ms: 9 })).json()).toEqual({ ok: true, matched: true });
    });

    it('refuses a kind it does not know', async () => {
      expect((await post('/api/img', { kind: 'billboard', prompt: 'x', session: 's' })).status).toBe(400);
      expect((await post('/api/img', { kind: 'photo', prompt: '  ', session: 's' })).status).toBe(400);
    });
  });
});

describe('I8 — /bakeoff is a landing page', () => {
  it('lists the keyed engines with a Boot button each and boots nothing', async () => {
    const res = await app.request('/bakeoff', { headers: { 'user-agent': CHROME } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('/bakeoff/run?engine=mock');
    expect(html).not.toContain('/kernel.js');
  });

  it('/bakeoff/run is the old auto-boot page with the HUD', async () => {
    const res = await app.request('/bakeoff/run', { headers: { 'user-agent': CHROME } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-mode="bakeoff"');
    expect(html).toContain('/kernel.js');
  });

  it('/ is unchanged and carries no HUD', async () => {
    const html = await (await app.request('/', { headers: { 'user-agent': CHROME } })).text();
    expect(html).toContain('data-mode="plain"');
  });
});

/**
 * T4 through the real route: the kernel reports what it had to patch on
 * /api/mark, and /api/stats carries it per engine as a rate.
 */
describe('T4 — contract patches on /api/stats', () => {
  it('a patch reported against a desktop generation shows up as that engine\'s rate', async () => {
    const genId = 'patch-' + Math.random().toString(36).slice(2);
    const res = await post('/api/gen', {
      kind: 'desktop',
      engine: 'mock',
      seed: 'patch',
      gen_id: genId,
      identity: { name: 'X', version: '1', tagline: 't', era: '1990s', personality: 'p', boot_message: 'b' },
      context: { viewport: '1440x900' },
    });
    await res.text();
    const before = await (await app.request('/api/stats')).json();
    const mark = await post('/api/mark', { gen_id: genId, ink_ms: 120, contract_patch: ['chrome', 'label'] });
    expect((await mark.json()).matched).toBe(true);
    const after = await (await app.request('/api/stats')).json();
    expect(after.engines.mock.patches.chrome).toBe((before.engines.mock?.patches?.chrome || 0) + 1);
    expect(after.engines.mock.patches.label).toBe((before.engines.mock?.patches?.label || 0) + 1);
    expect(after.engines.mock.patch_gens).toBe((before.engines.mock?.patch_gens || 0) + 1);
    expect(after.engines.mock.contract_gens).toBeGreaterThan(0);
    expect(after.engines.mock.patch_rate).toBeGreaterThan(0);
    expect(after.contract_patches.chrome).toBeGreaterThan(0);
  });

  it('a mark for a gen_id this process never issued changes no counter', async () => {
    const before = await (await app.request('/api/stats')).json();
    const r = await post('/api/mark', { gen_id: 'never-issued-' + Math.random(), contract_patch: ['chrome'] });
    expect((await r.json()).matched).toBe(false);
    const after = await (await app.request('/api/stats')).json();
    expect(after.contract_patch_gens).toBe(before.contract_patch_gens);
  });

  it('an invented patch kind is bucketed rather than minted as a key', async () => {
    const genId = 'patch2-' + Math.random().toString(36).slice(2);
    await (
      await post('/api/gen', {
        kind: 'desktop',
        engine: 'mock',
        seed: 'patch2',
        gen_id: genId,
        identity: { name: 'X', version: '1', tagline: 't', era: '1990s', personality: 'p', boot_message: 'b' },
        context: { viewport: '1440x900' },
      })
    ).text();
    await post('/api/mark', { gen_id: genId, contract_patch: ['wallpaper-vibes'] });
    const s = await (await app.request('/api/stats')).json();
    expect(s.contract_patches.other).toBeGreaterThan(0);
    expect(s.contract_patches['wallpaper-vibes']).toBeUndefined();
  });
});
