import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';

/**
 * SPEC §12.1 — moderation is off the critical path. The local list runs
 * synchronously; the remote call runs BESIDE the generation, and when it flags
 * after the stream has started the server aborts the stream and ends it with an
 * <!--os-reroute--> sentinel. The kernel then starts the rerouted generation.
 *
 * Nothing about the hit is ever visible to the visitor (SPEC §1.4), so the
 * sentinel says only "moderation" and no refusal is ever rendered.
 */
process.env.HALLUCINOS_NO_LISTEN = '1';
process.env.MODERATION = 'auto';
process.env.OPENAI_API_KEY = 'test-key-not-real';
process.env.GEN_PER_IP_PER_HOUR = '100000';
process.env.MAX_GEN_PER_DAY = '100000';
process.env.MOCK_DELAY_MS = '25';
process.env.FAL_KEY = '';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let app: any;
let server: Server;
let flag = false;
let latency = 0;
let hits = 0;

beforeAll(async () => {
  const http = await import('node:http');
  server = http.createServer((req, res) => {
    hits++;
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ results: [{ categories: { sexual: flag, 'sexual/minors': false } }] }));
      }, latency);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.MODERATION_ENDPOINT = `http://127.0.0.1:${(server.address() as any).port}/moderations`;
  app = (await import('../server/index.js')).app;
});
afterAll(() => server?.close());

const page = (url: string) =>
  app.request('/api/gen', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': CHROME },
    body: JSON.stringify({ kind: 'page', engine: 'mock', seed: 'r' + Math.random(), context: { url } }),
  });

describe('SPEC §12.1 — moderation beside the generation', () => {
  it('does not wait for the remote call before streaming', async () => {
    flag = false;
    latency = 600;
    const t0 = Date.now();
    const res = await page('https://example.com/a');
    const reader = res.body!.getReader();
    await reader.read(); // first bytes
    const firstByte = Date.now() - t0;
    await reader.cancel().catch(() => {});
    expect(firstByte).toBeLessThan(500);
    expect(hits).toBeGreaterThan(0);
  });

  it('aborts the stream with an os-reroute sentinel when it flags late', async () => {
    flag = true;
    latency = 60;
    const text = await (await page('https://example.com/b')).text();
    expect(text).toContain('<!--os-reroute:');
    expect(JSON.parse(/<!--os-reroute:([\s\S]*?)-->/.exec(text)![1]).reason).toBe('moderation');
    // the half-written document must not be reported as a finished one
    expect(text).not.toContain('<!--os-telemetry:');
    // and nothing tells the visitor what happened
    expect(text.toLowerCase()).not.toContain('moderation error');
    expect(text.toLowerCase()).not.toContain('blocked');
  });

  it('finishes normally when the remote call comes back clean', async () => {
    flag = false;
    latency = 10;
    const text = await (await page('https://example.com/c')).text();
    expect(text).toContain('<!--os-telemetry:');
    expect(text).not.toContain('<!--os-reroute:');
  });
});
