import { describe, it, expect } from 'vitest';
import { Hedger, type StreamFn } from '../server/hedge.js';
import type { EngineDef, GenChunk, GenCtx } from '../server/engines.js';

/**
 * H2 — the hedge, against two fake upstreams.
 *
 * The four cases the seam names, plus the two the reconciliation in
 * `server/hedge.ts` introduces (a lane that produces content and then stalls
 * under the commit threshold; one lane only, where nothing may be held back).
 */

const eng = (id: string, usd_in = 1, usd_out = 2): EngineDef => ({
  id,
  label: id,
  kind: 'openai',
  model: id,
  keyEnv: null,
  usd_in,
  usd_out,
});

const ctx = (): GenCtx => ({
  kind: 'boot',
  vars: {},
  seed: 's',
  system: 'sys',
  user: 'usr',
  maxTokens: 800,
  temperature: 1,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fake upstream. `reasoning` tokens are simply never yielded, as in the real client. */
interface Fake {
  /** ms before the first content token */
  ttfb?: number;
  /** content to emit, in chunks */
  chunks?: string[];
  /** ms between chunks */
  gap?: number;
  /** die after this many content characters (0 = die before any) */
  dieAfter?: number;
  /** end cleanly having emitted no content at all, reporting usage (the reasoning-only case) */
  reasoningOnly?: boolean;
  usage?: { in: number; out: number };
}

const DOC = '<!doctype html>\n<html><head><style>body{background:#000}</style></head><body><h1>a machine</h1></body></html>';

function fakes(map: Record<string, Fake>): { stream: StreamFn; started: string[]; aborted: string[] } {
  const started: string[] = [];
  const aborted: string[] = [];
  const stream: StreamFn = async function* (engine, _c: GenCtx, signal?: AbortSignal) {
    const f = map[engine.id] || {};
    started.push(engine.id);
    signal?.addEventListener('abort', () => aborted.push(engine.id), { once: true });
    if (f.ttfb) await sleep(f.ttfb);
    if (signal?.aborted) return;
    if (f.reasoningOnly) {
      yield { usage: f.usage || { in: 10, out: 1681 } } as GenChunk;
      yield { finish: 'length' } as GenChunk;
      return;
    }
    if (f.dieAfter === 0) throw new Error(engine.id + ' died before any content');
    let sent = 0;
    for (const ch of f.chunks || [DOC]) {
      if (signal?.aborted) return;
      if (f.gap) await sleep(f.gap);
      yield { text: ch };
      sent += ch.length;
      if (f.dieAfter !== undefined && sent >= f.dieAfter) throw new Error(engine.id + ' died after ' + sent);
    }
    yield { usage: f.usage || { in: 10, out: 100 } } as GenChunk;
  };
  return { stream, started, aborted };
}

async function drain(h: Hedger): Promise<{ text: string; chunks: GenChunk[]; err?: unknown }> {
  let text = '';
  const chunks: GenChunk[] = [];
  try {
    for await (const ch of h.run()) {
      chunks.push(ch);
      if (ch.text) text += ch.text;
    }
  } catch (err) {
    return { text, chunks, err };
  }
  return { text, chunks };
}

describe('H2 — hedged generation', () => {
  it('a slow-TTFB primary loses to the hedge, and the primary is aborted upstream', async () => {
    const { stream, started, aborted } = fakes({
      slow: { ttfb: 400 },
      fast: { ttfb: 5 },
    });
    const h = new Hedger(eng('slow'), eng('fast'), ctx(), undefined, { hedgeAfterMs: 0, stream });
    const out = await drain(h);
    const rep = h.report();
    expect(out.err).toBeUndefined();
    expect(out.text).toBe(DOC);
    expect(rep.winner).toBe('fast');
    expect(rep.hedged).toBe(true);
    expect(rep.loser).toBe('slow');
    expect(started).toEqual(['slow', 'fast']);
    expect(aborted).toContain('slow');
    expect(rep.loser_aborted_ms).toBeLessThan(400);
    // the loser's input tokens are billed even though nothing came back
    expect(rep.loser_tokens_in).toBeGreaterThan(0);
    expect(rep.loser_usd).toBeGreaterThan(0);
  });

  it('holds the hedge for HEDGE_AFTER_MS when the primary answers inside it', async () => {
    const { stream, started } = fakes({ p: { ttfb: 10 }, h: {} });
    const h = new Hedger(eng('p'), eng('h'), ctx(), undefined, { hedgeAfterMs: 400, stream });
    const out = await drain(h);
    expect(out.text).toBe(DOC);
    expect(h.report().winner).toBe('p');
    expect(h.report().hedged).toBe(false);
    expect(started).toEqual(['p']);
  });

  /**
   * The regression the v0.3 verification measured on the real providers: every
   * boot hedged at HEDGE_AFTER_MS_BOOT=700 AND at 60,000, because the primary's
   * first chunk is a handful of tokens and the old trigger read "has content
   * but not 64 characters of it" as "the primary is done for". A real engine
   * streams in small chunks, so the trigger was inoperative — which is the
   * whole cost lever for `auto` (BAKEOFF-4 #3, +55% on the bill).
   */
  it('a primary streaming in small chunks does NOT start the hedge before the trigger', async () => {
    const small = DOC.match(/[\s\S]{1,12}/g)!; // 12-character chunks, as a fast provider sends
    const { stream, started } = fakes({ p: { ttfb: 5, chunks: small, gap: 6 }, h: {} });
    const h = new Hedger(eng('p'), eng('h'), ctx(), undefined, { hedgeAfterMs: 5000, stream });
    const out = await drain(h);
    expect(out.text).toBe(DOC);
    expect(h.report().winner).toBe('p');
    expect(h.report().hedged, 'the trigger held: no second lane was bought').toBe(false);
    expect(started).toEqual(['p']);
  });

  it('a primary dribbling content under the threshold is committed on commitMs, not hedged', async () => {
    // 15 characters, then a long silence, then the rest: `leader()` commits it
    // commitMs after its first content rather than buying a lane that cannot
    // overtake it. This is the case the old trigger was reaching for and got
    // wrong by firing on the first chunk instead of on the stall.
    const rest = DOC.slice(15);
    const { stream, started } = fakes({ p: { ttfb: 5, chunks: [DOC.slice(0, 15), rest], gap: 200 }, h: {} });
    const h = new Hedger(eng('p'), eng('h'), ctx(), undefined, { hedgeAfterMs: 5000, commitMs: 120, stream });
    const out = await drain(h);
    expect(out.text).toBe(DOC);
    expect(h.report().winner).toBe('p');
    expect(h.report().hedged).toBe(false);
    expect(started).toEqual(['p']);
  });

  it('a primary that spends its whole budget on reasoning and ends is overtaken', async () => {
    // HANDOFF-4 #2: one cerebras boot probe in three, 1,681 tokens, no document
    const { stream, started } = fakes({
      p: { reasoningOnly: true, usage: { in: 900, out: 1681 } },
      h: { ttfb: 20 },
    });
    const h = new Hedger(eng('p'), eng('h'), ctx(), undefined, { hedgeAfterMs: 5000, stream });
    const out = await drain(h);
    const rep = h.report();
    expect(out.text).toBe(DOC);
    expect(rep.winner).toBe('h');
    // it did not wait out the 5 s: a primary that ENDED is a primary that lost
    expect(rep.hedged).toBe(true);
    expect(started).toEqual(['p', 'h']);
    // the reasoning tokens are still billed to the loser
    expect(rep.loser_tokens_out).toBe(1681);
  });

  it('a primary that dies after 20 characters fails over, and the client sees ONE document', async () => {
    const { stream } = fakes({
      p: { chunks: ['<!doctype html><htm'], dieAfter: 19 },
      h: { ttfb: 30 },
    });
    const h = new Hedger(eng('p'), eng('h'), ctx(), undefined, { hedgeAfterMs: 0, stream });
    const out = await drain(h);
    const rep = h.report();
    expect(out.err).toBeUndefined();
    // the dead lane's 19 characters never reached the consumer: they were held
    // under the 64-character commit point
    expect(out.text).toBe(DOC);
    expect(out.text.indexOf('<!doctype')).toBe(out.text.lastIndexOf('<!doctype'));
    expect(rep.winner).toBe('h');
    expect(rep.failed_over).toBe(true);
  });

  it('both dead: the error reaches the caller, which is the os-error path', async () => {
    const { stream } = fakes({ p: { dieAfter: 0 }, h: { dieAfter: 0 } });
    const h = new Hedger(eng('p'), eng('h'), ctx(), undefined, { hedgeAfterMs: 0, stream });
    const out = await drain(h);
    expect(out.text).toBe('');
    expect(String((out.err as Error)?.message)).toMatch(/died before any content/);
  });

  it('one lane only holds nothing back: the first chunk goes straight out', async () => {
    const { stream, started } = fakes({ p: { chunks: ['<!do', 'ctype html>'] } });
    const h = new Hedger(eng('p'), null, ctx(), undefined, { hedgeAfterMs: 0, stream });
    const out = await drain(h);
    expect(out.text).toBe('<!doctype html>');
    expect(h.report().hedged).toBe(false);
    expect(h.report().winner).toBe('p');
    expect(started).toEqual(['p']);
  });

  it('one lane that emits no content at all still hands its usage back to be booked', async () => {
    const { stream } = fakes({ p: { reasoningOnly: true, usage: { in: 900, out: 1681 } } });
    const h = new Hedger(eng('p'), null, ctx(), undefined, { hedgeAfterMs: 0, stream });
    const out = await drain(h);
    expect(out.err).toBeUndefined();
    expect(out.text).toBe('');
    expect(out.chunks.some((c) => c.usage?.out === 1681)).toBe(true);
  });

  it('a lane that inks and then stalls under the commit point is committed anyway', async () => {
    const { stream } = fakes({
      p: { chunks: ['<!doctype ', DOC], gap: 120 },
      h: { ttfb: 10_000 },
    });
    const h = new Hedger(eng('p'), eng('h'), ctx(), undefined, { hedgeAfterMs: 0, commitMs: 60, stream });
    const t0 = Date.now();
    const out = await drain(h);
    expect(h.report().winner).toBe('p');
    expect(out.text.startsWith('<!doctype ')).toBe(true);
    // it did not wait for the 10 s lane
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('the winner\'s TTFB is its own, not the race\'s', async () => {
    const { stream } = fakes({ p: { ttfb: 300 }, h: { ttfb: 20 } });
    const h = new Hedger(eng('p'), eng('h'), ctx(), undefined, { hedgeAfterMs: 150, stream });
    await drain(h);
    const rep = h.report();
    expect(rep.winner).toBe('h');
    // first_content_ms is measured from the race; winner_ttfb_ms from the
    // winner's own request, which started 150 ms late
    expect(rep.first_content_ms!).toBeGreaterThanOrEqual(rep.winner_ttfb_ms!);
    expect(rep.winner_ttfb_ms!).toBeLessThan(200);
  });

  it('a client that goes away stops both lanes', async () => {
    const ac = new AbortController();
    const { stream, aborted } = fakes({ p: { ttfb: 500 }, h: { ttfb: 500 } });
    const h = new Hedger(eng('p'), eng('h'), ctx(), ac.signal, { hedgeAfterMs: 0, stream });
    const run = drain(h);
    await sleep(30);
    ac.abort();
    await run;
    await sleep(20);
    expect(aborted.sort()).toEqual(['h', 'p']);
  });
});

/**
 * T1 — the three per-kind triggers, read from the environment at call time.
 * The behavioural proof (a desktop that is not double-bought) is in
 * `test/routing.test.ts`, through the real route against two chunked fake
 * upstreams; this is the table itself.
 */
describe('T1 — hedgeTriggers', () => {
  const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

  it('defaults: boot 0, desktop 600, everything else 900', async () => {
    const { hedgeTriggers, hedgeAfterFor } = await import('../server/hedge.js');
    expect(hedgeTriggers(env({}))).toEqual({ boot: 0, desktop: 600, other: 900 });
    expect(hedgeAfterFor('boot', env({}))).toBe(0);
    expect(hedgeAfterFor('desktop', env({}))).toBe(600);
    for (const k of ['app', 'page', 'repair', 'identity'] as const) expect(hedgeAfterFor(k, env({}))).toBe(900);
  });

  it('each kind reads its own variable and nobody else\'s', async () => {
    const { hedgeAfterFor } = await import('../server/hedge.js');
    const e = env({ HEDGE_AFTER_MS_BOOT: '1200', HEDGE_AFTER_MS_DESKTOP: '0', HEDGE_AFTER_MS: '2500' });
    expect(hedgeAfterFor('boot', e)).toBe(1200);
    expect(hedgeAfterFor('desktop', e)).toBe(0);
    expect(hedgeAfterFor('page', e)).toBe(2500);
  });

  it('an empty, negative or unparseable value is the default, not zero', async () => {
    const { hedgeTriggers } = await import('../server/hedge.js');
    // this matters more here than anywhere else in the config: 0 means "always
    // buy two lanes", so a typo that read as 0 would double every bill
    expect(hedgeTriggers(env({ HEDGE_AFTER_MS_DESKTOP: '' })).desktop).toBe(600);
    expect(hedgeTriggers(env({ HEDGE_AFTER_MS_DESKTOP: 'soon' })).desktop).toBe(600);
    expect(hedgeTriggers(env({ HEDGE_AFTER_MS_DESKTOP: '-5' })).desktop).toBe(600);
    expect(hedgeTriggers(env({ HEDGE_AFTER_MS: 'NaN' })).other).toBe(900);
    // and an explicit 0 is honoured, because for boot it is the point
    expect(hedgeTriggers(env({ HEDGE_AFTER_MS_BOOT: '0' })).boot).toBe(0);
  });
});
