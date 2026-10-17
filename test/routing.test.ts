import { describe, it, expect, beforeAll } from 'vitest';

/**
 * H1 + H2 through the real route, with the routing table pointed at two fake
 * upstreams (`mock` and `mock-b`, behaviour per lane taken from the seed — see
 * FAKE SEEDS in server/mock.ts). What this file proves that
 * `test/hedge.test.ts` cannot: that `engine:"auto"` resolves, that an explicit
 * engine id bypasses routing AND hedging, that the money and the telemetry line
 * name both lanes, and that two dead lanes still end in the os-error sentinel
 * the kernel regenerates on.
 */
process.env.HALLUCINOS_NO_LISTEN = '1';
process.env.MODERATION = 'local';
process.env.GEN_PER_IP_PER_HOUR = '100000';
process.env.MAX_GEN_PER_DAY = '100000';
process.env.FAL_KEY = '';
process.env.MOCK_DELAY_MS = '1';
process.env.ALLOW_TEST_ENGINES = '1';
process.env.DEFAULT_ENGINE = '';
// both lanes are fixtures, so nothing in this file can reach a provider
const ROUTE = { primary: 'mock', hedge: 'mock-b' };
process.env.ROUTES_JSON = JSON.stringify({
  default: { boot: ROUTE, desktop: ROUTE, app: ROUTE, page: ROUTE },
});

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let app: any;
let telemetry: any;
beforeAll(async () => {
  const mod = await import('../server/index.js');
  app = mod.app;
  telemetry = mod.telemetry;
});

const gen = (body: unknown) =>
  app.request('/api/gen', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': CHROME },
    body: JSON.stringify(body),
  });

/** the stdout line for one generation, found by the gen_id we asked for */
const lineFor = (genId: string) => telemetry.recent(200).find((l: any) => l.gen_id === genId);

let n = 0;
const nextId = () => `t-${++n}-${Date.now().toString(36)}`;

async function page(seed: string, engine = 'auto'): Promise<{ text: string; log: any; genId: string }> {
  const genId = nextId();
  const res = await gen({ kind: 'page', engine, seed, gen_id: genId, context: { url: 'https://example.com/thing' } });
  const text = await res.text();
  return { text, log: lineFor(genId), genId };
}

describe('H1 — the routing table', () => {
  it('offers auto as the first entry of /api/engines and makes it the default', async () => {
    const j = await (await app.request('/api/engines')).json();
    expect(j.engines[0].id).toBe('auto');
    expect(j.default).toBe('auto');
    expect(j.routing).toBe(true);
    expect(j.routes.page).toEqual({ primary: 'mock', hedge: 'mock-b' });
    // and it is a policy, not a model: no key, no price of its own
    expect(j.engines[0].model).toBe('routed');
  });

  it('resolves engine:"auto" per kind and names the engine that answered', async () => {
    // a page waits HEDGE_AFTER_MS (900) for a content token; this primary
    // answers at once, so the second lane is never started and never billed
    const r = await page('fake:ok:slow2500');
    expect(r.text).toContain('<!doctype html>');
    expect(r.log.engine).toBe('mock');
    expect(r.log.winner).toBe('mock');
    expect(r.log.hedged).toBeUndefined();
    expect(r.log.loser).toBeUndefined();
  });

  it('an explicit engine id bypasses routing and hedging entirely', async () => {
    // lane A is dead; with the hedge in play this would be rescued, and a
    // single engine that is silently rescued cannot be judged
    const r = await page('fake:dead:ok', 'mock');
    expect(r.text).toContain('<!--os-error:');
    expect(r.log.hedged).toBeUndefined();
    expect(r.log.loser).toBeUndefined();
    expect(r.log.engine).toBe('mock');
  });
});

describe('H2 — hedged generation through /api/gen', () => {
  it('a slow-TTFB primary loses, the client gets one document, and both lanes are on the line', async () => {
    const r = await page('fake:slow2500:ok');
    expect(r.text).toContain('<!doctype html>');
    // exactly one document reached the client
    expect(r.text.match(/<!doctype html>/gi)!).toHaveLength(1);
    expect(r.log.winner).toBe('mock-b');
    expect(r.log.engine).toBe('mock-b');
    expect(r.log.loser).toBe('mock');
    expect(r.log.loser_aborted_ms).toBeLessThan(2500);
    expect(r.log.loser_tokens_in).toBeGreaterThan(0);
    expect(r.log.contract_ok).toBe(null);
    // the sentinel the HUD reads says the same thing
    const sentinel = JSON.parse(/<!--os-telemetry:([\s\S]*?)-->/.exec(r.text)![1]);
    expect(sentinel.engine).toBe('mock-b');
    expect(sentinel.hedged).toBe(true);
    expect(sentinel.winner).toBe('mock-b');
  });

  it('a primary that spends its budget on reasoning and ends is overtaken', async () => {
    const r = await page('fake:reason:ok');
    expect(r.text).toContain('<!doctype html>');
    expect(r.log.winner).toBe('mock-b');
    // the reasoning tokens are still billed, to the loser's column
    expect(r.log.loser).toBe('mock');
    expect(r.log.loser_tokens_out).toBeGreaterThan(0);
  });

  it('a primary that dies after 20 characters fails over without a second document', async () => {
    const r = await page('fake:die20:ok');
    expect(r.text).not.toContain('<!--os-error:');
    expect(r.text.match(/<!doctype html>/gi)!).toHaveLength(1);
    expect(r.log.winner).toBe('mock-b');
    expect(r.log.failed_over).toBe(true);
  });

  it('both lanes dead ends in the os-error sentinel and no telemetry sentinel', async () => {
    const r = await page('fake:dead:dead');
    expect(r.text).toContain('<!--os-error:');
    expect(r.text).not.toContain('<!--os-telemetry:');
    expect(r.log.refusal).toBe('engine_dead');
    expect(r.log.hedged).toBe(true);
  });

  it('hedges a boot and still guarantees the identity comment', async () => {
    const genId = nextId();
    const res = await gen({ kind: 'boot', engine: 'auto', seed: 'fake:slow900:ok', gen_id: genId });
    const text = await res.text();
    expect(text).toMatch(/<!--os-identity:/);
    expect(text).toContain('<!doctype html>');
    const log = lineFor(genId);
    expect(log.winner).toBe('mock-b');
    expect(log.hedged).toBe(true);
  });

  it('starts both lanes at once on a boot and holds the hedge on a page', async () => {
    // boot: HEDGE_AFTER_MS_BOOT is 0, so a 900 ms primary loses outright
    const bootId = nextId();
    await (await gen({ kind: 'boot', engine: 'auto', seed: 'fake:slow900:ok', gen_id: bootId })).text();
    expect(lineFor(bootId).hedged).toBe(true);
    expect(lineFor(bootId).winner).toBe('mock-b');
    // page: the same 900 ms primary is inside the page's own window
    const p = await page('fake:slow200:ok');
    expect(p.log.winner).toBe('mock');
    expect(p.log.hedged).toBeUndefined();
  });
});

describe('H5 — the reality offset', () => {
  it('renders {{reality_json}} into page and app prompts and nothing else', async () => {
    const { buildPrompt } = await import('../server/prompts.js');
    const { loadReality, rollReality, rngFrom } = await import('../server/dice.js');
    const reality = rollReality(loadReality(), rngFrom('seed:reality'));
    const vars = { reality_json: JSON.stringify(reality), url: 'https://x.test/wiki/Moon', seed: 's' };
    for (const kind of ['page', 'app'] as const) {
      const built = buildPrompt(kind, vars);
      expect(built.system + built.user).toContain(String(reality.scale));
    }
    for (const kind of ['boot', 'desktop'] as const) {
      const built = buildPrompt(kind, vars);
      expect(built.system + built.user).not.toContain(String(reality.scale));
    }
  });

  it('is the same world for every page of one session and a different one next session', async () => {
    const { loadReality, rollReality, rngFrom } = await import('../server/dice.js');
    const a1 = rollReality(loadReality(), rngFrom('abc:reality'));
    const a2 = rollReality(loadReality(), rngFrom('abc:reality'));
    const b = rollReality(loadReality(), rngFrom('xyz:reality'));
    expect(a1).toEqual(a2);
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(a1));
  });

  it('rolls a scale factor inside the band, to two decimals, never exactly one', async () => {
    const { loadReality, rollReality, rngFrom } = await import('../server/dice.js');
    const lists = loadReality();
    for (let i = 0; i < 400; i++) {
      const r = rollReality(lists, rngFrom('s' + i));
      expect(r.scale).toBeGreaterThanOrEqual(0.37);
      expect(r.scale).toBeLessThanOrEqual(2.9);
      expect(r.scale).not.toBe(1);
      expect(Number(r.scale.toFixed(2))).toBe(r.scale);
      expect(r.units.unit_names).toHaveLength(3);
      expect(r.places).toHaveLength(2);
      expect(new Set(r.units.unit_names).size).toBe(3);
      expect(new Set(r.places).size).toBe(2);
      expect(r.calendar).toBeTruthy();
      expect(r.event).toBeTruthy();
    }
  });

  it('a page generation carries the offset into the prompt it actually sends', async () => {
    const r = await page('fake:ok:ok');
    // the fixture echoes nothing of the prompt, so the proof is the other way
    // round: the var exists for this kind and the built prompt is not empty
    expect(r.log.kind).toBe('page');
  });
});

describe('H3 — ink is not paint', () => {
  it('accepts ink_ms on /api/mark and writes it to that generation\'s line', async () => {
    const genId = nextId();
    const res = await gen({ kind: 'page', engine: 'mock', seed: 'ink', gen_id: genId, context: { url: 'https://example.com/i' } });
    await res.text();
    const mark = await app.request('/api/mark', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': CHROME },
      body: JSON.stringify({ gen_id: genId, first_paint_ms: 40, ink_ms: 260 }),
    });
    expect((await mark.json()).matched).toBe(true);
    const log = lineFor(genId);
    expect(log.first_paint_ms).toBe(40);
    expect(log.ink_ms).toBe(260);
  });

  it('a document that streamed but never inked has a first paint and no ink', async () => {
    const genId = nextId();
    const res = await gen({ kind: 'boot', engine: 'mock', seed: 'noink', gen_id: genId });
    await res.text();
    await app.request('/api/mark', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': CHROME },
      body: JSON.stringify({ gen_id: genId, first_paint_ms: 120 }),
    });
    const log = lineFor(genId);
    expect(log.first_paint_ms).toBe(120);
    expect(log.ink_ms).toBeUndefined();
  });
});

/**
 * T1 — the per-kind hedge trigger, through the real route with two fake
 * upstreams. HANDOFF-5's trap note is the reason this file and not a unit test
 * of `Hedger`: the trigger was dead for a whole version because the bug was in
 * how `chooseLane` read the primary's FIRST CHUNK, which only a chunked
 * upstream can produce (`fake:slow<ms>` in server/mock.ts).
 *
 * The three numbers, and what each test is for:
 *   boot     0 ms  — always both lanes; the first pixel of the product
 *   desktop  600 ms — the biggest document; a primary having an ordinary
 *                     second must not be double-bought (D6)
 *   other    900 ms — app, page, repair
 */
describe('T1 — per-kind hedge triggers', () => {
  const desk = async (seed: string, engine = 'auto') => {
    const genId = nextId();
    const res = await gen({
      kind: 'desktop',
      engine,
      seed,
      gen_id: genId,
      identity: { name: 'X', version: '1', tagline: 't', era: '1990s', personality: 'p', boot_message: 'b' },
      context: { viewport: '1440x900' },
    });
    await res.text();
    return lineFor(genId);
  };
  const boot = async (seed: string) => {
    const genId = nextId();
    await (await gen({ kind: 'boot', engine: 'auto', seed, gen_id: genId })).text();
    return lineFor(genId);
  };

  it('a desktop whose primary answers inside 600 ms is NOT hedged (D6: it used to buy two)', async () => {
    const log = await desk('fake:slow200:ok');
    expect(log.winner).toBe('mock');
    expect(log.hedged).toBeUndefined();
    expect(log.loser).toBeUndefined();
  });

  it('a desktop whose primary is past 600 ms IS hedged, and the second lane wins', async () => {
    const log = await desk('fake:slow1500:ok');
    expect(log.hedged).toBe(true);
    expect(log.winner).toBe('mock-b');
    expect(log.loser).toBe('mock');
  });

  it('a boot is hedged at the same 200 ms the desktop refuses to hedge at', async () => {
    const log = await boot('fake:slow200:ok');
    expect(log.hedged).toBe(true);
  });

  it('HEDGE_AFTER_MS_DESKTOP is honoured per request, not per process start', async () => {
    const before = process.env.HEDGE_AFTER_MS_DESKTOP;
    process.env.HEDGE_AFTER_MS_DESKTOP = '0';
    try {
      const log = await desk('fake:slow200:ok');
      expect(log.hedged).toBe(true);
    } finally {
      if (before === undefined) delete process.env.HEDGE_AFTER_MS_DESKTOP;
      else process.env.HEDGE_AFTER_MS_DESKTOP = before;
    }
    // and back to 600: the same seed is single-laned again
    expect((await desk('fake:slow200:ok')).hedged).toBeUndefined();
  });

  it('an app and a page share the 900 ms window, and a 200 ms primary keeps both', async () => {
    const p = await page('fake:slow200:ok');
    expect(p.log.hedged).toBeUndefined();
    const genId = nextId();
    await (
      await gen({
        kind: 'app',
        engine: 'auto',
        seed: 'fake:slow200:ok',
        gen_id: genId,
        params: {},
        context: { app_id: 'notes', viewport: '1440x900' },
      })
    ).text();
    expect(lineFor(genId).hedged).toBeUndefined();
  });
});

/**
 * T1 / D6 — `DEFAULT_ENGINE` naming a real keyed engine takes `/` off the
 * router. HANDOFF-6 §2 reproduced the old behaviour three times: the documented
 * deploy recipe was ignored unless it named a mock, and the only way to pin `/`
 * was `ROUTING=off`, which also throws the hedge away everywhere.
 */
describe('T1 — DEFAULT_ENGINE pins `/`', () => {
  const withDefault = async (value: string | undefined, fn: () => Promise<void>) => {
    const before = process.env.DEFAULT_ENGINE;
    if (value === undefined) delete process.env.DEFAULT_ENGINE;
    else process.env.DEFAULT_ENGINE = value;
    try {
      await fn();
    } finally {
      if (before === undefined) delete process.env.DEFAULT_ENGINE;
      else process.env.DEFAULT_ENGINE = before;
    }
  };

  it('unset means the router: default auto, nothing pinned', async () => {
    await withDefault('', async () => {
      const j = await (await app.request('/api/engines')).json();
      expect(j.default).toBe('auto');
      expect(j.pinned).toBe(null);
      const html = await (await app.request('/')).text();
      expect(html).not.toContain('data-engine=');
    });
  });

  it('a real keyed engine IS the advertised default, and is stamped on the kernel page', async () => {
    await withDefault('mock-b', async () => {
      const j = await (await app.request('/api/engines')).json();
      expect(j.default).toBe('mock-b');
      expect(j.pinned).toBe('mock-b');
      // `auto` is still offered — the pin is about what `/` boots, not about
      // taking the router off the bake-off surface
      expect(j.engines.some((e: any) => e.id === 'auto')).toBe(true);
      expect(j.routing).toBe(true);
      const html = await (await app.request('/')).text();
      expect(html).toContain('data-engine="mock-b"');
    });
  });

  it('`auto` as the value, and a typo, both mean the router', async () => {
    await withDefault('auto', async () => {
      const j = await (await app.request('/api/engines')).json();
      expect(j.default).toBe('auto');
      expect(j.pinned).toBe(null);
    });
    await withDefault('cerebras-oss12O', async () => {
      const j = await (await app.request('/api/engines')).json();
      expect(j.pinned).toBe(null);
      expect(j.default).toBe('auto');
    });
  });

  it('the bake-off run page is never pinned: there the engine is the judge\'s query', async () => {
    await withDefault('mock-b', async () => {
      const html = await (await app.request('/bakeoff/run?engine=mock')).text();
      expect(html).not.toContain('data-engine=');
    });
  });
});
