/**
 * §12.5 images, measured. BAKEOFF-2: "the desktop is revealed with grey empty
 * icon tiles and no wallpaper, and the pictures land 2-7 s later" — `img`
 * total_ms median 6.7-15.3 s against SPEC's assumed 0.8 s. Target: < 2.5 s.
 *
 * This calls fal directly with the OLD parameters and the NEW ones, back to
 * back, so the difference is the parameters and not the weather. Every call is
 * one billing unit ($0.003) whatever the size, so the sizes are free to change.
 *
 *   node scripts/img-latency.mjs --n=3            # 2 configs x 2 kinds x n
 *   node scripts/img-latency.mjs --n=1 --e2e      # also once through /api/img
 *
 * Cost is printed before anything is bought and is exact: n x 4 x $0.003.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, startServer, freePort } from './run.mjs';

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
const ENDPOINT = 'https://fal.run/fal-ai/flux-1/schnell';
const N = Number(arg('n', '3'));

const med = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};
const kb = (b) => (b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(2) + ' MB' : Math.round(b / 1024) + ' KB');


/**
 * The two prompts are the server's own (S3 wording), frozen here so the
 * measurement is not also measuring a prompt change.
 */
const PROMPTS = {
  wallpaper:
    'desktop wallpaper, 1980s computer operating system default background, overlapping soft gradients, ' +
    'oxide, bone, signal green, no text, no people, no animals, no objects in focus, soft, low contrast',
  icons:
    '4x4 grid of sixteen flat application icons, consistent style, 1980s, oxide, bone, signal green, ' +
    'plain background, evenly spaced, no text. One icon per cell, cells edge to edge, no gutters, no borders, no grid lines. ' +
    'Cells in reading order: 1. a web browser, 2. a photo library, 3. a recycle bin, 4. a calculator, 5. an app store, ' +
    '6. an inbox, 7. group chats, 8. a shell, 9. a task manager, 10. a map, 11. forecasts, 12. a news reader, ' +
    '13. a diary, 14. a game launcher, 15. a system updater, 16. about this computer',
};

/** SPEC §12.5 as shipped in v0.1, and v0.2's replacement. */
const CONFIGS = {
  'v0.1 (1024, 4 steps, url + download)': {
    wallpaper: { width: 1024, height: 576, steps: 4 },
    icons: { width: 1024, height: 1024, steps: 4 },
    sync: false,
  },
  'v0.2 (768, 2/4 steps, sync_mode)': {
    wallpaper: { width: 768, height: 432, steps: 2 },
    icons: { width: 768, height: 768, steps: 4 },
    sync: true,
  },
};

process.stdout.write(`buying ${N * 4} images = $${(N * 4 * 0.003).toFixed(3)}\n\n`);

const rows = [];
for (const [label, cfg] of Object.entries(CONFIGS)) {
  for (const kind of ['wallpaper', 'icons']) {
    for (let i = 0; i < N; i++) {
      const r = await one(kind, cfg, i);
      rows.push({ config: label, kind, ...r });
      process.stdout.write(
        `${label} ${kind} ${i + 1}/${N}: total ${r.total_ms} ms (provider ${r.provider_ms}, download ${r.fetch_ms}), ${kb(r.bytes)}\n`
      );
    }
  }
  process.stdout.write('\n');
}

for (const [label] of Object.entries(CONFIGS)) {
  for (const kind of ['wallpaper', 'icons']) {
    const rs = rows.filter((r) => r.config === label && r.kind === kind && !r.error);
    if (!rs.length) continue;
    process.stdout.write(
      `${label} | ${kind} | median total ${med(rs.map((r) => r.total_ms))} ms | provider ${med(rs.map((r) => r.provider_ms))} ms | download ${med(
        rs.map((r) => r.fetch_ms)
      )} ms | ${kb(med(rs.map((r) => r.bytes)))}\n`
    );
  }
}

if (process.argv.includes('--e2e')) await e2e();

process.stdout.write('\n' + JSON.stringify(rows, null, 1) + '\n');

async function one(kind, cfg, i) {
  const spec = cfg[kind];
  const t0 = Date.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Key ${KEY}` },
      body: JSON.stringify({
        prompt: PROMPTS[kind],
        image_size: { width: spec.width, height: spec.height },
        num_inference_steps: spec.steps,
        num_images: 1,
        enable_safety_checker: true,
        output_format: 'jpeg',
        ...(cfg.sync ? { sync_mode: true } : {}),
        seed: 1000 + i,
      }),
    });
    if (!res.ok) return { error: 'http ' + res.status, total_ms: Date.now() - t0, provider_ms: 0, fetch_ms: 0, bytes: 0 };
    const json = await res.json();
    const provider_ms = Date.now() - t0;
    const img = json?.images?.[0];
    const url = img?.url || '';
    if (url.startsWith('data:')) {
      // sync_mode: the bytes are already here. base64 is 4/3 of the payload.
      return { total_ms: Date.now() - t0, provider_ms, fetch_ms: 0, bytes: Math.round((url.length - url.indexOf(',')) * 0.75), inline: true };
    }
    const t1 = Date.now();
    const bin = await fetch(url);
    const buf = Buffer.from(await bin.arrayBuffer());
    return { total_ms: Date.now() - t0, provider_ms, fetch_ms: Date.now() - t1, bytes: buf.byteLength, inline: false };
  } catch (err) {
    return { error: String(err?.message || err).slice(0, 80), total_ms: Date.now() - t0, provider_ms: 0, fetch_ms: 0, bytes: 0 };
  }
}

/** Once through the real route, to prove the server path carries the win. */
async function e2e() {
  const port = Number(arg('port', '0')) || (await freePort());
  const srv = await startServer({ port, env: { MODERATION: 'off', GEN_PER_IP_PER_HOUR: '100000' } });
  try {
    const t0 = Date.now();
    const res = await fetch(srv.base + '/api/img', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 Chrome/131' },
      body: JSON.stringify({ kind: 'wallpaper', session: 'lat-e2e', seed: 'lat-e2e' }),
    });
    const j = await res.json().catch(() => ({}));
    process.stdout.write(
      `\n/api/img wallpaper: ${res.status} in ${Date.now() - t0} ms, ${j.dataUri ? kb(Math.round(j.dataUri.length * 0.75)) : 'no image'}\n`
    );
    const line = srv.logs.filter((l) => l.kind === 'img').pop();
    if (line) process.stdout.write('telemetry: ' + JSON.stringify(line) + '\n');
  } finally {
    srv.stop();
  }
}

