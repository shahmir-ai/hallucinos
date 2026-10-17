import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../server/env.js';

process.env.HALLUCINOS_NO_LISTEN = '1';
process.env.MODERATION = 'local';
process.env.GEN_PER_IP_PER_HOUR = '100000';
process.env.MAX_GEN_PER_DAY = '100000';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let app: any;
beforeAll(async () => {
  app = (await import('../server/index.js')).app;
});

const gen = (body: unknown, headers: Record<string, string> = {}) =>
  app.request('/api/gen', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': CHROME, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** the telemetry sentinel the server appends to every HTML stream */
async function sentinel(res: Response): Promise<any> {
  const text = await res.text();
  const m = /<!--os-telemetry:([\s\S]*?)-->/.exec(text);
  return m ? { ...JSON.parse(m[1]), text } : { text };
}

describe('POST /api/gen — the input surface', () => {
  it('refuses a body bigger than the limit before it is parsed', async () => {
    const huge = JSON.stringify({ kind: 'page', engine: 'mock', context: { url: 'https://x.com/' + 'x'.repeat(200_000) } });
    const res = await gen(huge);
    expect(res.status).toBe(413);
  });

  it('does not let a client-supplied manifest become 25x the input cost', async () => {
    const attack = {
      kind: 'app',
      engine: 'mock',
      seed: 's',
      context: {
        app_id: 'notes',
        // a known id whose shape the client tried to rewrite, plus an oversized custom app
        manifest: {
          apps: [
            { id: 'notes', shape: 'X'.repeat(8000) },
            { id: 'custom:loom', shape: 'Y'.repeat(8000) },
          ],
        },
      },
    };
    const plain = await sentinel(await gen({ kind: 'app', engine: 'mock', seed: 's', context: { app_id: 'notes' } }));
    const attacked = await sentinel(await gen(attack));
    // the server's own shape replaces the client's copy; the custom shape is clamped
    expect(attacked.tokens_in).toBeLessThan(plain.tokens_in + 200);
  });

  it('clamps the url, referer, title and history that reach the prompt', async () => {
    const base = await sentinel(
      await gen({ kind: 'page', engine: 'mock', seed: 's', context: { url: 'https://example.com/' } })
    );
    const stuffed = await sentinel(
      await gen({
        kind: 'page',
        engine: 'mock',
        seed: 's',
        context: {
          url: 'https://example.com/' + 'a'.repeat(6000),
          referer_url: 'https://ref.com/' + 'r'.repeat(6000),
          referer_title: 'T'.repeat(6000),
          // 12 entries of 1,200 chars each: only the last 3, clipped to 512, may land
          history: Array.from({ length: 12 }, (_, i) => 'https://h' + i + '.com/' + 'b'.repeat(1200)),
        },
      })
    );
    // ceilings, in characters: url 2,048 (rendered twice, as {{url}} and {{path}})
    // + referer 2,048 + title 200 + three history entries of 512 = ~7.9k chars.
    // Unclamped the same request is ~38k characters of prompt.
    const clampedChars = 2048 * 2 + 2048 + 200 + 3 * 512;
    expect(stuffed.tokens_in - base.tokens_in).toBeLessThan(clampedChars / 4 + 100);
  });

  it('rejects an unknown kind and bad json', async () => {
    expect((await gen({ kind: 'nope', engine: 'mock' })).status).toBe(400);
    expect((await gen('{not json')).status).toBe(400);
  });

  it('turns bots away', async () => {
    expect((await gen({ kind: 'page', engine: 'mock' }, { 'user-agent': 'GPTBot/1.0' })).status).toBe(403);
  });
});

describe('POST /api/gen — what comes back', () => {
  it('never announces a reroute to the client (SPEC §1.4)', async () => {
    const res = await gen({ kind: 'page', engine: 'mock', seed: 's', context: { url: 'https://pornhub.com/search?q=x' } });
    expect(res.headers.get('x-os-rerouted')).toBeNull();
    const s = await sentinel(res);
    expect(JSON.stringify(s.text)).not.toContain('"rerouted"');
    // the page itself still changed — silently
    expect(s.text).toContain('data-mock-rerouted');
  });

  it('carries the per-kind contract result and the output cap flag', async () => {
    const s = await sentinel(await gen({ kind: 'desktop', engine: 'mock', seed: 's' }));
    expect(s.kind).toBe('desktop');
    expect(s.contract_ok).toBe(true);
    expect(s.truncated).toBe(false);
  });

  it('moderates a string nested inside params, not only top-level ones', async () => {
    const nested = await sentinel(
      await gen({ kind: 'app', engine: 'mock', seed: 's', params: { cmd: ['open pornhub.com'] }, context: { app_id: 'terminal' } })
    );
    // the mock only reroutes pages, so prove it via the page kind
    const page = await sentinel(
      await gen({
        kind: 'page',
        engine: 'mock',
        seed: 's',
        context: { url: 'https://cats.com/' },
        params: { deep: { q: 'hardcore porn' } },
      })
    );
    expect(page.text).toContain('data-mock-rerouted');
    expect(nested.text).toBeTruthy();
  });

  it('reroutes on a flagged referer reached by ordinary navigation', async () => {
    const s = await sentinel(
      await gen({
        kind: 'page',
        engine: 'mock',
        seed: 's',
        context: {
          url: 'https://cats.com/',
          referer_url: 'https://pornhub.com/view?q=1',
          referer_title: 'free porn videos',
          history: ['https://xvideos.com/hardcore'],
        },
      })
    );
    expect(s.text).toContain('data-mock-rerouted');
  });
});

describe('/api/engines and /api/stats', () => {
  it('lists only engines whose key env is set, and mock is always one of them', async () => {
    const j = await (await app.request('/api/engines')).json();
    const ids: string[] = j.engines.map((e: any) => e.id);
    expect(ids).toContain('mock');
    for (const e of j.engines) {
      expect(typeof e.usd_in).toBe('number');
      expect(typeof e.usd_out).toBe('number');
    }
    // the invariant, rather than a hard-coded list: whether an engine appears
    // depends on .env, which changes as keys land
    const { engines } = JSON.parse(readFileSync(resolve(ROOT, 'engines.json'), 'utf8')) as {
      engines: { id: string; keyEnv: string | null; test_only?: boolean }[];
    };
    for (const e of engines) {
      // H2's second fixture lane is offered only to the tests that race it
      if (e.test_only) continue;
      const keyed = e.keyEnv === null || !!process.env[e.keyEnv];
      expect(ids.includes(e.id), `${e.id} listed=${ids.includes(e.id)} keyed=${keyed}`).toBe(keyed);
    }
  });

  it('reports the money ceiling alongside the count caps', async () => {
    const j = await (await app.request('/api/stats')).json();
    expect(j.caps.max_usd_per_day).toBeGreaterThan(0);
    expect(typeof j.caps.day_usd).toBe('number');
  });
});
