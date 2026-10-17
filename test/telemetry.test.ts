import { describe, it, expect } from 'vitest';
import { Telemetry, type GenLog } from '../server/telemetry.js';

const line = (over: Partial<GenLog> = {}): GenLog => ({
  ts: '2026-09-17T10:00:00.000Z',
  kind: 'page',
  engine: 'mock',
  ip_hash: 'abc',
  tokens_in: 100,
  tokens_out: 900,
  ttfb_ms: 10,
  total_ms: 500,
  tok_per_s: 1800,
  usd: 0.001,
  contract_ok: null,
  ...over,
});

describe('telemetry', () => {
  it('writes one JSON line per generation with every field the spec lists', () => {
    const out: string[] = [];
    const t = new Telemetry((l) => out.push(l));
    t.record(line());
    const parsed = JSON.parse(out[0]);
    for (const k of ['ts', 'kind', 'engine', 'ip_hash', 'tokens_in', 'tokens_out', 'ttfb_ms', 'total_ms', 'tok_per_s', 'usd', 'contract_ok']) {
      expect(parsed).toHaveProperty(k);
    }
  });

  it('aggregates the day per engine', () => {
    const t = new Telemetry(() => {});
    t.record(line());
    t.record(line({ engine: 'openai-small', usd: 0.01, kind: 'desktop', contract_ok: true }));
    t.record(line({ engine: 'openai-small', usd: 0.01, error: 'boom' }));
    const s = t.stats();
    expect(s.gens).toBe(3);
    expect(s.usd).toBeCloseTo(0.021);
    expect(s.engines['openai-small'].gens).toBe(2);
    expect(s.engines['openai-small'].errors).toBe(1);
    expect(s.engines['mock'].tokens_out).toBe(900);
  });

  it('rolls over at midnight', () => {
    const t = new Telemetry(() => {});
    t.record(line());
    t.record(line({ ts: '2026-09-18T00:00:01.000Z' }));
    expect(t.stats().gens).toBe(1);
    expect(t.stats().day).toBe('2026-09-18');
  });

  // I6 / SPEC §12.1: the boot document paints before its own stream ends, so its
  // first-paint mark arrives before there is a line to patch. It must not be lost.
  it('folds a mark that arrived before the generation finished into the line', () => {
    const out: string[] = [];
    const t = new Telemetry((l) => out.push(l));
    expect(t.mark('g1', { first_paint_ms: 900 })).toBe(false);
    t.record(line({ kind: 'boot', gen_id: 'g1' }));
    const boot = t.recent(1).at(-1)!;
    expect(boot.first_paint_ms).toBe(900);
    expect(JSON.parse(out[out.length - 1]).first_paint_ms).toBe(900);
  });

  it('still patches a mark that arrives after the line, and says which happened', () => {
    const out: string[] = [];
    const t = new Telemetry((l) => out.push(l));
    t.record(line({ gen_id: 'g2' }));
    expect(t.mark('g2', { interactive_ms: 120 })).toBe(true);
    expect(t.recent(1).at(-1)!.interactive_ms).toBe(120);
    expect(JSON.parse(out[out.length - 1]).matched).toBe(true);
  });

  it('keeps the recent tail bounded', () => {
    const t = new Telemetry(() => {});
    for (let i = 0; i < 600; i++) t.record(line());
    expect(t.recent(1000).length).toBeLessThanOrEqual(500);
  });
});

/**
 * A refusal used to return before telemetry.record() on every 429 path, so a
 * refused generation left no trace on stdout or /api/stats — the same blindness
 * that voided BAKEOFF-1 (two engines looked dead and were only rate-limited).
 */
describe('refusals are observable', () => {
  it('logs a line, counts the reason, and stays out of the per-engine totals', () => {
    const out: string[] = [];
    const t = new Telemetry((l) => out.push(l));
    t.record(line({ kind: 'gen', engine: '-', usd: 0, tokens_in: 0, tokens_out: 0, blocked: 'ip-hour' }));
    t.record(line({ kind: 'gen', engine: '-', usd: 0, tokens_in: 0, tokens_out: 0, blocked: 'busy' }));
    t.record(line({ kind: 'gen', engine: '-', usd: 0, tokens_in: 0, tokens_out: 0, blocked: 'busy' }));
    t.record(line());
    const s = t.stats();
    expect(JSON.parse(out[0]).blocked).toBe('ip-hour');
    expect(s.refused).toBe(3);
    expect(s.refusals).toEqual({ 'ip-hour': 1, busy: 2 });
    // one real generation, and no phantom '-' engine in the aggregates
    expect(s.gens).toBe(1);
    expect(s.engines['-']).toBeUndefined();
  });

  it('still aggregates a refusal that had already been paid for', () => {
    const t = new Telemetry(() => {});
    // the image whose late moderation hit AFTER fal had rendered and billed
    t.record(line({ kind: 'img', engine: 'fal-schnell', usd: 0.003, tokens_in: 0, tokens_out: 0, blocked: 'moderation-late' }));
    const s = t.stats();
    expect(s.refused).toBe(1);
    expect(s.usd).toBeCloseTo(0.003);
    expect(s.engines['fal-schnell'].usd).toBeCloseTo(0.003);
  });
});

/**
 * /api/mark is unauthenticated, so a field that has already been measured must
 * not be rewritable: posting zeros over a real generation's numbers was enough
 * to erase SPEC §12.1's headline measurements.
 */
describe('marks are written once', () => {
  it('keeps the first value for each field, on a line and on a held early mark', () => {
    const t = new Telemetry(() => {});
    t.record(line({ gen_id: 'm1' }));
    t.mark('m1', { first_paint_ms: 300 });
    t.mark('m1', { first_paint_ms: 0, interactive_ms: 310 });
    expect(t.recent(1).at(-1)!.first_paint_ms).toBe(300);
    expect(t.recent(1).at(-1)!.interactive_ms).toBe(310);

    t.mark('m2', { first_paint_ms: 700 });
    t.mark('m2', { first_paint_ms: 0, complete_ms: 900 });
    t.record(line({ gen_id: 'm2' }));
    const l = t.recent(1).at(-1)!;
    expect(l.first_paint_ms).toBe(700);
    expect(l.complete_ms).toBe(900);
  });

  it('logs only a mark that landed on a real line', () => {
    const out: string[] = [];
    const t = new Telemetry((l) => out.push(l));
    expect(t.mark('early', { first_paint_ms: 5 })).toBe(false);
    expect(out.length, 'an early mark is held silently, never logged').toBe(0);
    t.record(line({ gen_id: 'early' }));
    expect(t.mark('early', { complete_ms: 50 })).toBe(true);
    expect(JSON.parse(out[out.length - 1])).toMatchObject({ kind: 'mark', matched: true, complete_ms: 50 });
  });
});

/**
 * T4 — the kernel's contract PATCHES, counted per engine so a chrome patch is a
 * rate and not an anecdote. The patch itself is the kernel's (a window with no
 * usable title bar gets a bare unstyled strip, D2); this is the bookkeeping.
 */
describe('T4 — contract_patch counters', () => {
  it('normalises whatever arrives on the wire', async () => {
    const { normalizePatchKinds, CONTRACT_PATCH_MAX } = await import('../server/telemetry.js');
    expect(normalizePatchKinds(['chrome'])).toEqual(['chrome']);
    expect(normalizePatchKinds('chrome')).toEqual(['chrome']);
    expect(normalizePatchKinds(['CHROME', ' task '])).toEqual(['chrome', 'task']);
    // deduplicated
    expect(normalizePatchKinds(['chrome', 'chrome'])).toEqual(['chrome']);
    // an unknown kind is bucketed, never minted as a key: this arrives over HTTP
    expect(normalizePatchKinds(['wallpaper-vibes'])).toEqual(['other']);
    expect(normalizePatchKinds([])).toEqual([]);
    expect(normalizePatchKinds(undefined)).toEqual([]);
    expect(normalizePatchKinds(7)).toEqual([]);
    expect(normalizePatchKinds([1, 2, null])).toEqual([]);
    // forty copies of one kind are one kind: the cap is on DISTINCT kinds
    expect(normalizePatchKinds(new Array(40).fill('chrome').concat(['task']))).toEqual(['chrome', 'task']);
    expect(
      normalizePatchKinds(['chrome', 'task', 'label', 'hooks', 'archetype', 'clock', 'other', 'a', 'b', 'c'])
    ).toHaveLength(CONTRACT_PATCH_MAX - 1);
  });

  it('counts a patched generation per engine, against the contract-checked ones', async () => {
    const t = new Telemetry(() => {});
    // two desktops on one engine, one of them patched
    t.record(line({ kind: 'desktop', engine: 'e1', gen_id: 'g1', contract_ok: true, contract_patch: ['chrome'] }));
    t.record(line({ kind: 'desktop', engine: 'e1', gen_id: 'g2', contract_ok: true }));
    // a page is not contract-checked and must not dilute the rate
    t.record(line({ kind: 'page', engine: 'e1', gen_id: 'g3', contract_ok: null }));
    const s = t.stats();
    expect(s.engines.e1.contract_gens).toBe(2);
    expect(s.engines.e1.patch_gens).toBe(1);
    expect(s.engines.e1.patches).toEqual({ chrome: 1 });
    expect(s.engines.e1.patch_rate).toBe(0.5);
    expect(s.contract_patches).toEqual({ chrome: 1 });
    expect(s.contract_patch_rate).toBe(0.5);
  });

  it('a mark that arrives after the line patches it and counts once', async () => {
    const t = new Telemetry(() => {});
    t.record(line({ kind: 'desktop', engine: 'e2', gen_id: 'g9', contract_ok: true }));
    expect(t.mark('g9', { contract_patch: ['chrome'] })).toBe(true);
    // the chrome check runs at mount and again on the first window: the kinds
    // union, and the per-generation counter moves only once
    expect(t.mark('g9', { contract_patch: ['chrome', 'label'] })).toBe(true);
    const s = t.stats();
    expect(s.engines.e2.patch_gens).toBe(1);
    expect(s.engines.e2.patches).toEqual({ chrome: 1, label: 1 });
    expect(t.recent(5).find((l) => l.gen_id === 'g9')!.contract_patch).toEqual(['chrome', 'label']);
  });

  it('a mark that arrives BEFORE the line is held and folded in', async () => {
    const t = new Telemetry(() => {});
    expect(t.mark('early', { ink_ms: 300, contract_patch: ['task'] })).toBe(false);
    t.record(line({ kind: 'desktop', engine: 'e3', gen_id: 'early', contract_ok: false }));
    const l = t.recent(5).find((x) => x.gen_id === 'early')!;
    expect(l.ink_ms).toBe(300);
    expect(l.contract_patch).toEqual(['task']);
    const s = t.stats();
    expect(s.engines.e3.patch_gens).toBe(1);
    expect(s.engines.e3.patches).toEqual({ task: 1 });
    expect(s.engines.e3.patch_rate).toBe(1);
  });

  it('an engine with nothing contract-checked has a null rate, not 0%', async () => {
    const t = new Telemetry(() => {});
    t.record(line({ kind: 'page', engine: 'e4', contract_ok: null }));
    expect(t.stats().engines.e4.patch_rate).toBe(null);
    expect(t.stats().contract_patch_rate).toBe(null);
  });
});
