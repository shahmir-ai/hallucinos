import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Every 429 path of /api/gen and /api/img used to return before
 * telemetry.record(), so a refused generation left no trace on stdout and none
 * in /api/stats. That is the blindness that voided BAKEOFF-1: the harness was
 * hitting GEN_PER_IP_PER_HOUR and being served queue screens, and two engines
 * looked dead for it.
 */
process.env.HALLUCINOS_NO_LISTEN = '1';
process.env.MODERATION = 'local';
process.env.GEN_PER_IP_PER_HOUR = '3';
process.env.MAX_GEN_PER_DAY = '100000';
process.env.FAL_KEY = '';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let app: any;
beforeAll(async () => {
  app = (await import('../server/index.js')).app;
});

const gen = (seed: string) =>
  app.request('/api/gen', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': CHROME },
    body: JSON.stringify({ kind: 'app', engine: 'mock', seed, context: { app_id: 'notes' } }),
  });

const stats = async () => (await (await app.request('/api/stats', { headers: { 'user-agent': CHROME } })).json()) as any;

describe('a refusal is written down', () => {
  it('logs the per-IP cap refusal and counts it in /api/stats', async () => {
    const lines: any[] = [];
    const { telemetry } = await import('../server/index.js');
    (telemetry as any).sink = (l: string) => lines.push(JSON.parse(l));

    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await gen('r' + i);
      codes.push(res.status);
      if (res.status === 200) await res.text();
    }
    expect(codes.filter((c) => c === 200).length).toBe(3);
    expect(codes.filter((c) => c === 429).length).toBe(3);

    const refusals = lines.filter((l) => l.blocked === 'ip-hour');
    expect(refusals.length, 'one line per refusal, on stdout').toBe(3);
    expect(refusals[0]).toMatchObject({ engine: '-', usd: 0, contract_ok: null });
    expect(refusals[0].ip_hash).toBeTruthy();

    const s = await stats();
    expect(s.refused).toBeGreaterThanOrEqual(3);
    expect(s.refusals['ip-hour']).toBeGreaterThanOrEqual(3);
    // the refusals did not inflate the generation count
    expect(s.gens).toBe(3);
  });
});
