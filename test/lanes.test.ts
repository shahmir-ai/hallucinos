import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';

/**
 * The blocker from the safety review: /api/img reserved against the SAME
 * in-flight counter as /api/gen, so image calls holding their slots for
 * IMG_TIMEOUT_MS took the text route down site-wide. Six simultaneous
 * visitors' wallpapers were enough to serve everybody the kernel's
 * over-capacity screen while nothing was actually generating.
 */
process.env.HALLUCINOS_NO_LISTEN = '1';
process.env.MODERATION = 'local';
process.env.GEN_PER_IP_PER_HOUR = '100000';
process.env.MAX_GEN_PER_DAY = '100000';
process.env.MAX_CONCURRENT_GEN = '2';
process.env.MAX_CONCURRENT_IMG = '2';
process.env.IMG_TIMEOUT_MS = '1500';
process.env.FAL_KEY = 'test-not-real';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let app: any;
let stalling: Server;

beforeAll(async () => {
  const http = await import('node:http');
  // a fal that accepts the request and never answers
  stalling = http.createServer(() => {});
  await new Promise<void>((r) => stalling.listen(0, '127.0.0.1', r));
  process.env.FAL_ENDPOINT = `http://127.0.0.1:${(stalling.address() as any).port}/schnell`;
  app = (await import('../server/index.js')).app;
});
afterAll(() => stalling?.close());

const post = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': CHROME },
    body: JSON.stringify(body),
  });

describe('the image lane is not the text lane', () => {
  it('a stalled fal cannot make /api/gen answer 429 busy', async () => {
    // every image slot held by a call that will never come back
    const imgs = [
      post('/api/img', { kind: 'wallpaper', prompt: 'a wet street', seed: 'a', scope: 'b1' }),
      // NOT `icons`: since BAKEOFF-2 finding 6 the icon sheet waits for its
      // boot's desktop generation to start and is refused when none does, so it
      // never reaches fal and never holds a lane. A document image does.
      post('/api/img', { kind: 'photo', prompt: 'a wet street', seed: 'a', scope: 'w1', scopeKind: 'app' }),
      post('/api/img', { kind: 'wallpaper', prompt: 'another street', seed: 'b', scope: 'b2' }),
    ];
    // give them time to be admitted and start stalling
    await new Promise((r) => setTimeout(r, 150));

    const res = await post('/api/gen', { kind: 'app', engine: 'mock', seed: 'x', context: { app_id: 'notes' } });
    expect(res.status, 'text generation is refused because wallpapers are slow').toBe(200);
    expect(await res.text()).toContain('<!--os-telemetry:');

    const settled = await Promise.all(imgs);
    // the third image is the one refused — its own lane is two deep
    const busy = settled.filter((r: any) => r.status === 429);
    expect(busy.length).toBe(1);
    expect((await busy[0].json()).reason).toBe('busy');
    // and the two that stalled gave up on IMG_TIMEOUT_MS rather than hanging
    expect(settled.filter((r: any) => r.status === 504).length).toBe(2);
  }, 20_000);

  it('holds nothing against the day once the stalled calls have given up', async () => {
    const s = await (await app.request('/api/stats', { headers: { 'user-agent': CHROME } })).json();
    // a timeout before fal answers is free (nothing was rendered)
    expect(s.caps.day_usd).toBeLessThan(0.0001);
    expect(s.refusals.busy).toBe(1);
  });
});
