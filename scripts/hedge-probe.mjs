/**
 * H2's verification on the real providers: N routed boots, heads only.
 *
 * It starts its own server (so the stdout telemetry lines can be read back
 * against each generation), asks for `kind=boot` with `engine=auto` N times,
 * and records for each one: which lane won, the client's own time to the first
 * content byte, the winner's provider TTFB, when the loser was aborted, and
 * what the pair cost. No desktop, no app, no page, no images — the boot stream
 * is the whole question.
 *
 *   node scripts/hedge-probe.mjs [--n=10] [--port=8793] [--kind=boot]
 *                                 [--triggers=0,1200] [--out=reviews/hedge-1.json]
 *
 * `--engine`, `--kind` and `--triggers` each take a COMMA LIST, and the plan is
 * then ALTERNATED across them: `--engine=auto,cerebras-oss120 --kind=boot,page
 * --n=10` is 10 boots and 10 pages on each engine, interleaved one at a time.
 * That matters because a provider's TTFB moved by a factor of six inside one
 * afternoon (HEDGE-2), so two runs half an hour apart measure the hour and not
 * the engine. Alternating makes both arms share the same weather.
 *
 * `--triggers` (T1/D1) alternates the HEDGE TRIGGER rather than the engine, and
 * it is the only arm that cannot be a request parameter: the trigger is
 * configuration, so each value gets its OWN server process on its own port
 * (`--port`, `--port+1`, …) and the requests alternate between them one at a
 * time. `--triggers=0,1200 --kind=boot` is the D1 experiment: does racing both
 * lanes from 0 ms actually cut time-to-first-content against waiting 1,200 ms,
 * at this hour, on this provider.
 *
 * Never uses port 8799 and never touches dist/play.js (the owner's snapshot).
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};

const n = Number(arg('n', '10'));
const port = Number(arg('port', '8793'));
const kinds = String(arg('kind', 'boot')).split(',').filter(Boolean);
const outFile = arg('out', '');
const engineIds = String(arg('engine', 'auto')).split(',').filter(Boolean);
/** T1/D1 — one server per trigger value; '' means "whatever the environment says". */
const triggers = String(arg('triggers', '')).split(',').filter((t) => t !== '');
const triggerArms = triggers.length ? triggers : [''];
/**
 * One entry per generation, alternating engines AND triggers within each kind
 * so every arm sees the same minute of the provider's mood.
 */
const plan = [];
for (const kind of kinds)
  for (let i = 0; i < n; i++)
    for (const engine of engineIds) for (const trigger of triggerArms) plan.push({ kind, engine, i, trigger });
for (let i = 0; i < triggerArms.length; i++) if (port + i === 8799) throw new Error('8799 is the owner snapshot server');
if (port === 8799) throw new Error('8799 is the owner snapshot server');

const baseEnv = {
  ...process.env,
  FAL_KEY: '',
  MODERATION: 'local',
  GEN_PER_IP_PER_HOUR: '1000',
  MAX_GEN_PER_DAY: '1000',
  MAX_USD_PER_DAY: arg('usd', '0.5'),
  CAPS_STATE_FILE: '',
  NAMES_RING_FILE: '',
  DEFAULT_ENGINE: '',
};
delete baseEnv.HALLUCINOS_NO_LISTEN;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** One server, its port and its own telemetry lines. */
async function spawnServer(p, extraEnv) {
  const logs = [];
  const child = spawn(process.execPath, [resolve(ROOT, 'dist/server.js')], {
    env: { ...baseEnv, PORT: String(p), ...extraEnv },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try {
        logs.push(JSON.parse(line));
      } catch {
        /* not a telemetry line */
      }
    }
  });
  const base = `http://localhost:${p}`;
  let up = false;
  for (let i = 0; i < 150 && !up; i++) {
    try {
      up = (await fetch(base + '/healthz')).ok;
    } catch {}
    if (!up) await sleep(100);
  }
  if (!up) {
    child.kill('SIGTERM');
    throw new Error('server did not come up on ' + p);
  }
  return { child, logs, base, port: p };
}

/** trigger value -> the server that carries it */
const servers = new Map();
for (let i = 0; i < triggerArms.length; i++) {
  const t = triggerArms[i];
  // the trigger is configuration, not a request field: one process per arm
  servers.set(t, await spawnServer(port + i, t === '' ? {} : { HEDGE_AFTER_MS_BOOT: String(t) }));
  process.stderr.write(`arm ${t === '' ? '(env)' : 'HEDGE_AFTER_MS_BOOT=' + t} on ${port + i}\n`);
}
const stopAll = () => {
  for (const s of servers.values()) {
    try {
      s.child.kill('SIGTERM');
    } catch {}
  }
};

const first = servers.get(triggerArms[0]);
const engines = await (await fetch(first.base + '/api/engines')).json();

const rows = [];
for (let idx = 0; idx < plan.length; idx++) {
  const { kind, engine, i, trigger } = plan[idx];
  const srv = servers.get(trigger);
  const base = srv.base;
  const logs = srv.logs;
  const genId = `hedge-${kind}-${engine}-${i}-${Math.random().toString(36).slice(2, 8)}`;
  const t0 = Date.now();
  let firstByte = null;
  let firstInk = null;
  let chars = 0;
  let text = '';
  let err = null;
  try {
    const res = await fetch(base + '/api/gen', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({
        kind,
        engine,
        seed: 'probe-' + genId,
        gen_id: genId,
        session: genId,
        context: { viewport: '1440x900', ...(kind === 'page' ? { url: 'https://en.wikipedia.org/wiki/Moon' } : {}) },
      }),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const s = dec.decode(value, { stream: true });
      if (firstByte === null) firstByte = Date.now() - t0;
      chars += s.length;
      text += s;
      // the first byte of the DOCUMENT, as opposed to the identity comment:
      // the honest analogue of H3's ink for a headless probe
      if (firstInk === null && /<!doctype|<html/i.test(text)) firstInk = Date.now() - t0;
    }
  } catch (e) {
    err = String(e?.message || e);
  }
  const total = Date.now() - t0;
  // give the server a moment to write its line
  await sleep(120);
  const log = logs.filter((l) => l.gen_id === genId).pop() || null;
  const sentinel = (() => {
    const m = /<!--os-telemetry:([\s\S]*?)-->/.exec(text);
    try {
      return m ? JSON.parse(m[1]) : null;
    } catch {
      return null;
    }
  })();
  rows.push({
    i,
    kind,
    arm: engine,
    trigger: trigger === '' ? null : Number(trigger),
    winner: log?.winner ?? log?.engine ?? null,
    hedged: !!log?.hedged,
    loser: log?.loser ?? null,
    failed_over: !!log?.failed_over,
    client_first_byte_ms: firstByte,
    client_first_doc_ms: firstInk,
    provider_ttfb_ms: log?.provider_ttfb_ms ?? null,
    server_ttfb_ms: log?.ttfb_ms ?? null,
    loser_aborted_ms: log?.loser_aborted_ms ?? null,
    total_ms: total,
    tokens_in: log?.tokens_in ?? null,
    tokens_out: log?.tokens_out ?? null,
    loser_tokens_in: log?.loser_tokens_in ?? null,
    loser_tokens_out: log?.loser_tokens_out ?? null,
    usd: log?.usd ?? null,
    truncated: !!log?.truncated,
    identity_fallback: !!log?.identity_fallback,
    has_identity: /<!--os-identity:/.test(text),
    has_doctype: /<!doctype/i.test(text),
    doc_chars: chars,
    error: err || log?.error || null,
    contract_ok: sentinel?.contract_ok ?? null,
  });
  const r = rows[idx];
  process.stderr.write(
    `#${idx} ${kind}/${engine}${trigger === '' ? '' : '@' + trigger} winner=${r.winner} hedged=${r.hedged} ` +
      `first_byte=${r.client_first_byte_ms}ms first_doc=${r.client_first_doc_ms}ms ttfb=${r.provider_ttfb_ms}ms $${(r.usd || 0).toFixed(5)}\n`
  );
}

const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
/** the p90 the brief asks for: nearest-rank, which is the honest one at n=10 */
const p90 = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)];
};
const statsFor = (rs) => {
  const nums = (k) => rs.map((r) => r[k]).filter((v) => typeof v === 'number');
  return {
    n: rs.length,
    hedged: rs.filter((r) => r.hedged).length,
    wins: rs.reduce((a, r) => ({ ...a, [r.winner || 'none']: (a[r.winner || 'none'] || 0) + 1 }), {}),
    failed_over: rs.filter((r) => r.failed_over).length,
    median_first_byte_ms: med(nums('client_first_byte_ms')),
    p90_first_byte_ms: p90(nums('client_first_byte_ms')),
    median_first_doc_ms: med(nums('client_first_doc_ms')),
    p90_first_doc_ms: p90(nums('client_first_doc_ms')),
    p100_first_doc_ms: nums('client_first_doc_ms').length ? Math.max(...nums('client_first_doc_ms')) : null,
    p90_provider_ttfb_ms: p90(nums('provider_ttfb_ms')),
    median_provider_ttfb_ms: med(nums('provider_ttfb_ms')),
    median_total_ms: med(nums('total_ms')),
    usd_total: Math.round(nums('usd').reduce((a, b) => a + b, 0) * 1e5) / 1e5,
    usd_each: rs.length ? Math.round((nums('usd').reduce((a, b) => a + b, 0) / rs.length) * 1e6) / 1e6 : null,
    no_document: rs.filter((r) => !r.has_doctype).length,
    truncated: rs.filter((r) => r.truncated).length,
    identity_fallback: rs.filter((r) => r.identity_fallback).length,
  };
};
const arms = {};
for (const kind of kinds)
  for (const engine of engineIds)
    for (const trigger of triggerArms) {
      const key = `${kind}/${engine}${trigger === '' ? '' : '@' + trigger}`;
      arms[key] = statsFor(
        rows.filter((r) => r.kind === kind && r.arm === engine && (trigger === '' ? true : r.trigger === Number(trigger)))
      );
    }
const summary = {
  when: new Date().toISOString(),
  kinds,
  engines: engineIds,
  triggers: triggerArms,
  hedge_after_ms: process.env.HEDGE_AFTER_MS ?? null,
  hedge_after_ms_boot: process.env.HEDGE_AFTER_MS_BOOT ?? null,
  default_engine: engines.default,
  routes: engines.routes,
  arms,
  ...statsFor(rows),
};
const payload = { summary, rows };
console.log(JSON.stringify(payload, null, 2));
if (outFile) writeFileSync(resolve(ROOT, outFile), JSON.stringify(payload, null, 2) + '\n');

stopAll();
await sleep(200);
process.exit(0);
