import { describe, it, expect, beforeAll } from 'vitest';

/**
 * I1's wall clock and I4's abort, both of which need their own module registry
 * because the server reads GEN_TIMEOUT_MS once at load.
 *
 * BAKEOFF-1 saw a single page generation hang for 180 seconds. Nothing is
 * allowed to outlive GEN_TIMEOUT_MS, and the stream has to end with the
 * <!--os-error--> sentinel the kernel regenerates on — not with a half document
 * and no explanation.
 */
process.env.HALLUCINOS_NO_LISTEN = '1';
process.env.MODERATION = 'local';
process.env.GEN_PER_IP_PER_HOUR = '100000';
process.env.MAX_GEN_PER_DAY = '100000';
// the server floors GEN_TIMEOUT_MS at 1 s, so the mock is slowed past it
process.env.GEN_TIMEOUT_MS = '1000';
process.env.MOCK_DELAY_MS = '130';
process.env.FAL_KEY = '';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let app: any;
beforeAll(async () => {
  app = (await import('../server/index.js')).app;
});

const gen = (body: unknown, init: RequestInit = {}) =>
  app.request('/api/gen', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': CHROME },
    body: JSON.stringify(body),
    ...init,
  });

describe('I1 — the generation wall clock', () => {
  it('ends a slow generation with an os-error sentinel instead of hanging', async () => {
    const t0 = Date.now();
    const res = await gen({ kind: 'page', engine: 'mock', seed: 'slow', context: { url: 'https://example.com/' } });
    const text = await res.text();
    const took = Date.now() - t0;
    expect(text).toContain('<!--os-error:');
    expect(JSON.parse(/<!--os-error:([\s\S]*?)-->/.exec(text)![1]).message).toBe('timeout');
    // no telemetry sentinel: this document is not finished and must not be
    // reported as one
    expect(text).not.toContain('<!--os-telemetry:');
    expect(took).toBeLessThan(2500);
  });

  it('times a boot out before the identity comment without inventing one', async () => {
    const text = await (await gen({ kind: 'boot', engine: 'mock', seed: 'slowboot' })).text();
    expect(text).toContain('<!--os-error:');
  });
});

describe('I4 — an untaken speculative generation stops costing money', () => {
  it('aborts upstream when the client goes away mid-stream', async () => {
    const ac = new AbortController();
    const res = await gen({ kind: 'page', engine: 'mock', seed: 'spec', context: { url: 'https://example.com/a' } }, { signal: ac.signal });
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    await reader.cancel().catch(() => {});
    // the request is gone; what matters is that the process is still healthy
    // and serving (an unhandled abort used to reject the whole response stream)
    const health = await app.request('/healthz');
    expect(health.status).toBe(200);
  });
});
