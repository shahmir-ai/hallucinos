/**
 * HANDOFF-5 #6 — fal's latency, unexplained, and whether we are on the right model.
 *
 * IMG-LATENCY-1 measured a schnell wallpaper at 2.9 s. BAKEOFF-4 measured 8.9 s
 * median and 13.7 s worst on the same config, with 2 of 22 never arriving. One
 * of those two numbers is the model and the other is fal's queue, and nothing
 * in the tree separates them — so the whole "the reveal is slow because our
 * pictures are slow" conversation has been running on an n of one.
 *
 * This calls every text-to-image endpoint fal lists today at or below $0.006 an
 * image, with the SAME prompt and the SAME size, N times each, back to back, so
 * the difference is the model and not the weather. It also runs the fastest one
 * through `queue.fal.run` (submit, poll, fetch) as well as `fal.run` (sync), to
 * price the second path the SDK defaults to.
 *
 *   node scripts/img-latency2.mjs --n=6          # 4 models x 6, ~$0.07
 *   node scripts/img-latency2.mjs --n=2 --queue  # add the queue path
 *   node scripts/img-latency2.mjs --models=fal-ai/sana/sprint --n=3
 *
 * Cost is printed before anything is bought. fal bills per megapixel, rounded
 * up, so every call below is one billing unit at the model's own rate.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
  const i = line.indexOf('=');
  if (i < 0 || line.trim().startsWith('#')) continue;
  env[line.slice(0, i).trim()] = line
    .slice(i + 1)
    .trim()
    .replace(/^["']|["']$/g, '');
}
const KEY = env.FAL_KEY || process.env.FAL_KEY;
if (!KEY) throw new Error('no FAL_KEY');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};
const N = Number(arg('n', '6'));
const WIDTH = Number(arg('width', '768'));
const HEIGHT = Number(arg('height', '432'));

/**
 * Every t2i endpoint fal lists at <= $0.006/MP as of 2026-09-17, with its own
 * documented default step count (read from each endpoint's own OpenAPI schema,
 * `fal.ai/api/openapi/queue/openapi.json?endpoint_id=…`). All four take the
 * identical body — `image_size` as a {width,height} object, `num_inference_steps`,
 * `sync_mode`, `output_format`, `seed`, `enable_safety_checker` — which is why
 * IMG_MODEL can be a plain env variable and not a per-provider adapter.
 */
const MODELS = {
  'fal-ai/flux-1/schnell': { usd_mp: 0.003, steps: 4, note: 'what ships today (SPEC §12.5)' },
  'fal-ai/z-image/turbo': { usd_mp: 0.005, steps: 8, note: 'the brief named it' },
  'fal-ai/sana/sprint': { usd_mp: 0.0025, steps: 2, note: 'cheaper than schnell and distilled for speed' },
  'fal-ai/sana': { usd_mp: 0.001, steps: 18, note: 'the cheapest on the shelf; 18 steps is not a turbo model' },
};
const PICKED = String(arg('models', Object.keys(MODELS).join(','))).split(',').filter(Boolean);

/**
 * One prompt, frozen, for every model: the server's own wallpaper wording
 * (`prompts/images/wallpaper.md`) with the dice already rolled in. Frozen here
 * so the measurement is not also measuring a prompt change — and the same
 * reason IMG-LATENCY-1's prompts were frozen.
 */
const PROMPT =
  'desktop wallpaper, 1980s computer operating system default background, overlapping soft gradients, ' +
  'oxide, bone, signal green, no text, no people, no animals, no objects in focus, soft, low contrast';

const med = (xs) => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};
const kb = (b) => (b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(2) + ' MB' : Math.round(b / 1024) + ' KB');

const wantQueue = argv.includes('--queue');
const plan = [];
for (const id of PICKED) for (let i = 0; i < N; i++) plan.push({ id, path: 'sync', i });
if (wantQueue) for (const id of PICKED) for (let i = 0; i < N; i++) plan.push({ id, path: 'queue', i });
const bill = plan.reduce((a, r) => a + MODELS[r.id].usd_mp, 0);
process.stdout.write(
  `${plan.length} images at ${WIDTH}x${HEIGHT} = $${bill.toFixed(4)}\n` +
    PICKED.map((id) => `  ${id}  $${MODELS[id].usd_mp}/MP  ${MODELS[id].steps} steps — ${MODELS[id].note}`).join('\n') +
    '\n\n'
);

const rows = [];
for (const step of plan) {
  const r = step.path === 'queue' ? await viaQueue(step) : await viaSync(step);
  rows.push(r);
  process.stdout.write(
    `${step.id} ${step.path} ${step.i + 1}/${N}: ` +
      (r.error ? `FAIL ${r.error} (${r.total_ms} ms)\n` : `total ${r.total_ms} ms (provider ${r.provider_ms}, download ${r.fetch_ms}), ${kb(r.bytes)}${r.inline ? ' inline' : ''}\n`)
  );
}

process.stdout.write('\n| model | path | $/img | steps | n | fails | median total | p100 total | min | median bytes |\n|---|---|---|---|---|---|---|---|---|---|\n');
for (const id of PICKED) {
  for (const path of wantQueue ? ['sync', 'queue'] : ['sync']) {
    const all = rows.filter((r) => r.id === id && r.path === path);
    const ok = all.filter((r) => !r.error);
    if (!all.length) continue;
    process.stdout.write(
      `| ${id} | ${path} | $${MODELS[id].usd_mp} | ${MODELS[id].steps} | ${ok.length} | ${all.length - ok.length} | ` +
        `${med(ok.map((r) => r.total_ms))} ms | ${ok.length ? Math.max(...ok.map((r) => r.total_ms)) : 0} ms | ${ok.length ? Math.min(...ok.map((r) => r.total_ms)) : 0} ms | ` +
        `${kb(med(ok.map((r) => r.bytes)))} |\n`
    );
  }
}
process.stdout.write(`\nspent $${bill.toFixed(4)}\n`);
process.stdout.write('\n' + JSON.stringify({ n: N, size: [WIDTH, HEIGHT], models: PICKED, usd: bill, prompt: PROMPT, rows }, null, 1) + '\n');

/** The path the server uses today: POST to fal.run with sync_mode, bytes inline. */
async function viaSync({ id, i }) {
  const t0 = Date.now();
  try {
    const res = await fetch('https://fal.run/' + id, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Key ${KEY}` },
      body: body(id, i),
    });
    if (!res.ok) return fail(id, 'sync', 'http ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 90), t0);
    const json = await res.json();
    return await settle(id, 'sync', json, t0);
  } catch (err) {
    return fail(id, 'sync', String(err?.message || err).slice(0, 90), t0);
  }
}

/** The path the fal SDK defaults to: submit, poll status, fetch the response. */
async function viaQueue({ id, i }) {
  const t0 = Date.now();
  try {
    const sub = await fetch('https://queue.fal.run/' + id, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Key ${KEY}` },
      body: body(id, i, false),
    });
    if (!sub.ok) return fail(id, 'queue', 'submit ' + sub.status, t0);
    const { status_url, response_url } = await sub.json();
    for (let tries = 0; tries < 200; tries++) {
      const st = await fetch(status_url, { headers: { authorization: `Key ${KEY}` } });
      const j = await st.json().catch(() => ({}));
      if (j.status === 'COMPLETED') break;
      if (Date.now() - t0 > 60_000) return fail(id, 'queue', 'poll timeout', t0);
      await new Promise((r) => setTimeout(r, 120));
    }
    const out = await fetch(response_url, { headers: { authorization: `Key ${KEY}` } });
    if (!out.ok) return fail(id, 'queue', 'response ' + out.status, t0);
    return await settle(id, 'queue', await out.json(), t0);
  } catch (err) {
    return fail(id, 'queue', String(err?.message || err).slice(0, 90), t0);
  }
}

function body(id, i, sync = true) {
  return JSON.stringify({
    prompt: PROMPT,
    image_size: { width: WIDTH, height: HEIGHT },
    num_inference_steps: MODELS[id].steps,
    num_images: 1,
    enable_safety_checker: true,
    output_format: 'jpeg',
    ...(sync ? { sync_mode: true } : {}),
    seed: 4000 + i,
  });
}

async function settle(id, path, json, t0) {
  const provider_ms = Date.now() - t0;
  const img = Array.isArray(json?.images) ? json.images[0] : null;
  const url = img?.url || '';
  if (!url) return fail(id, path, 'no image in response', t0);
  if (url.startsWith('data:')) {
    return { id, path, total_ms: Date.now() - t0, provider_ms, fetch_ms: 0, bytes: Math.round((url.length - url.indexOf(',')) * 0.75), inline: true };
  }
  const t1 = Date.now();
  const bin = await fetch(url);
  const buf = Buffer.from(await bin.arrayBuffer());
  return { id, path, total_ms: Date.now() - t0, provider_ms, fetch_ms: Date.now() - t1, bytes: buf.byteLength, inline: false };
}

function fail(id, path, error, t0) {
  return { id, path, error, total_ms: Date.now() - t0, provider_ms: 0, fetch_ms: 0, bytes: 0 };
}
