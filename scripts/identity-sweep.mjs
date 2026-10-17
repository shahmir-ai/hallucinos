/**
 * I1 — the identity sweep. BAKEOFF-2's biggest variety bug, measured directly.
 *
 * One boot in four on `cerebras-oss120` arrived as `UNNAMED/6BXG` with generic
 * labels and no era. This is the cheapest possible instrument for that number:
 * N `kind=boot` generations straight at POST /api/gen, each read only until the
 * identity comment lands and then ABORTED, so a boot costs its head (~150
 * tokens) instead of its whole 800-token document. Twenty heads on cerebras is
 * about $0.01.
 *
 *   node scripts/identity-sweep.mjs --engines=cerebras-oss120 --n=20
 *   node scripts/identity-sweep.mjs --engines=cerebras-oss120 --n=20 --heads=/tmp/heads.json
 *
 * It reports, per engine:
 *   named        boots whose name is NOT the UNNAMED/xxxx fallback  <- the target: 20/20
 *   fallback     boots where the model's own comment was unusable and the
 *                server had to buy a kind=identity call (with the reason)
 *   full         boots where even the fallback failed (these are the UNNAMED ones)
 *
 * `--heads=<file>` writes every raw head out, pass or fail (IDENTITY_DEBUG=1
 * puts them on the telemetry line). Those heads are the sample, and they are
 * how a parser change gets a before/after on ONE set of model output instead of
 * two runs of it: `test/identity-heads.test.ts` replays whatever is in
 * `reviews/identity-heads-*.json` through the current gate, for free, forever.
 */
import { writeFileSync } from 'node:fs';
import { startServer, freePort, arg, sleep, usdTotal } from './run.mjs';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const OPEN = '<!--os-identity:';

const tally = (xs) => {
  const o = {};
  for (const x of xs) o[x] = (o[x] || 0) + 1;
  return o;
};

await live();

async function live() {
  const engines = arg('engines', 'cerebras-oss120').split(',').filter(Boolean);
  const n = Number(arg('n', '20'));
  const headsOut = arg('heads', '');
  const port = Number(arg('port', '0')) || (await freePort());
  const srv = await startServer({
    port,
    env: {
      MODERATION: 'off',
      IDENTITY_DEBUG: '1',
      // the sweep is one client making N calls; the per-IP hour cap is for
      // visitors, and BAKEOFF-2 finding 1 is what happens when a harness eats it
      GEN_PER_IP_PER_HOUR: arg('percap', '100000'),
    },
  });
  const out = {};
  const heads = [];
  try {
    for (const engine of engines) {
      const rows = [];
      for (let i = 0; i < n; i++) {
        const seed = `idsw-${i}-${Math.random().toString(36).slice(2, 8)}`;
        const row = await oneBoot(srv, engine, seed);
        rows.push(row);
        process.stdout.write(
          `${engine} ${i + 1}/${n}: ${row.name || '(none)'}${row.fallback ? ` [fallback ${row.fail || '?'} ${row.mode || ''}x${row.tries || 0}]` : ''}` +
            `${row.unnamed ? ' <-- UNNAMED' : ''}${row.error ? ' ERR ' + row.error : ''}\n` +
            (row.fallback ? `    head=${JSON.stringify((row.head || '').slice(0, 160))}\n    fb=${JSON.stringify((row.fbHead || '').slice(0, 220))}\n` : '')
        );
        // the head is the sample; keep it whatever the verdict was — including
        // the empty one, which is its own failure class (the model wrote nothing)
        if (row.head || row.fallback) heads.push({ engine, seed, head: row.head, fbHead: row.fbHead || null, name: row.name, fallback: !!row.fallback, fail: row.fail || null });
        await sleep(Number(arg('gap', '150')));
      }
      const named = rows.filter((r) => r.name && !r.unnamed).length;
      out[engine] = {
        n: rows.length,
        named,
        unnamed: rows.filter((r) => r.unnamed).length,
        fallbacks: rows.filter((r) => r.fallback).length,
        fails: tally(rows.filter((r) => r.fallback).map((r) => r.fail || 'unknown')),
        errors: tally(rows.filter((r) => r.error).map((r) => r.error)),
        names: rows.map((r) => r.name).filter(Boolean),
      };
      process.stdout.write(`\n== ${engine}: named ${named}/${rows.length}, fallback ${out[engine].fallbacks}, UNNAMED ${out[engine].unnamed}\n`);
    }
  } finally {
    srv.stop();
  }
  if (headsOut) {
    writeFileSync(headsOut, JSON.stringify(heads, null, 1));
    process.stdout.write(`heads -> ${headsOut} (${heads.length})\n`);
  }
  process.stdout.write(`spend $${usdTotal(srv.logs).toFixed(4)}\n`);
  process.stdout.write(JSON.stringify(out, null, 1) + '\n');
}

/**
 * One boot, read to the identity comment and then dropped.
 *
 * The comment is emitted by the server AFTER any fallback call has finished, so
 * aborting the moment it arrives can never race the fallback — the head is
 * whole by then.
 */
async function oneBoot(srv, engine, seed) {
  const ac = new AbortController();
  const t0 = Date.now();
  let text = '';
  let genId = '';
  try {
    const res = await fetch(srv.base + '/api/gen', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': CHROME },
      body: JSON.stringify({ kind: 'boot', engine, seed }),
      signal: ac.signal,
    });
    genId = res.headers.get('x-os-gen-id') || '';
    if (!res.ok) return { seed, error: 'http ' + res.status };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      if (text.includes(OPEN) && text.includes('-->', text.indexOf(OPEN))) break;
      if (text.length > 6000 || Date.now() - t0 > 60_000) break;
    }
    try {
      ac.abort();
    } catch {}
  } catch (err) {
    return { seed, error: String(err?.message || err).slice(0, 80) };
  }
  const id = parseComment(text);
  // the server's line for this generation carries the diagnosis and the head
  const line = await waitForLine(srv, genId, seed);
  return {
    seed,
    ms: Date.now() - t0,
    name: id?.name || '',
    era: id?.era || '',
    archetype: id?.archetype || '',
    unnamed: !id || /^UNNAMED\//.test(String(id.name || '')),
    fallback: !!line?.identity_fallback,
    fail: line?.identity_fail,
    mode: line?.identity_fallback_mode,
    tries: line?.identity_fallback_tries,
    head: line?.identity_head || '',
    fbHead: line?.identity_fb_head || '',
  };
}

function parseComment(text) {
  const at = text.indexOf(OPEN);
  if (at < 0) return null;
  const close = text.indexOf('-->', at + OPEN.length);
  if (close < 0) return null;
  try {
    return JSON.parse(text.slice(at + OPEN.length, close));
  } catch {
    return null;
  }
}

/** The telemetry line is written when the aborted stream unwinds, a beat later. */
async function waitForLine(srv, genId, seed) {
  for (let i = 0; i < 80; i++) {
    const hit = srv.logs.find((l) => (genId && l.gen_id === genId) || (l.kind === 'boot' && l.seed === seed));
    if (hit) return hit;
    await sleep(50);
  }
  return null;
}

