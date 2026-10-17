/**
 * Does `max_tokens` count reasoning tokens on Cerebras gpt-oss-120b?
 *
 * HANDOFF-4 #2: one boot probe in three spent its whole budget on reasoning and
 * emitted no document at all (1,681 tokens out, no `<!doctype`). engines.json
 * already records that a 20-token call with no `reasoning_effort` returns
 * `content: null`, which suggests reasoning is inside the budget — but the
 * 1,681-token probe ran under a budget of 800, which suggests the opposite.
 * Both cannot be true, and the fix (raise kind=boot to 1,600) is only worth
 * buying if the first one is.
 *
 * So: the real boot prompt, the real engine, non-streaming (identical
 * accounting, simpler to read), at both budgets, reporting
 * `completion_tokens`, `completion_tokens_details.reasoning_tokens`,
 * `finish_reason` and whether a document came back.
 *
 *   node scripts/boot-budget.mjs [--runs=3] [--budgets=800,1600]
 *
 * Cost: ~$0.0015 a call. Six calls is a cent.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const raw of existsSync(resolve(ROOT, '.env')) ? readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n') : []) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq < 0) continue;
  const k = line.slice(0, eq).trim();
  let v = line.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (process.env[k] === undefined) process.env[k] = v;
}

const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};

const runs = Number(arg('runs', '3'));
const budgets = String(arg('budgets', '800,1600')).split(',').map(Number);
const model = arg('model', 'gpt-oss-120b');
const key = process.env.CEREBRAS_API_KEY;
if (!key) {
  console.error('no CEREBRAS_API_KEY');
  process.exit(1);
}

const read = (rel) => {
  const p = resolve(ROOT, 'prompts', rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
};
const dice = JSON.parse(readFileSync(resolve(ROOT, 'data/dice.json'), 'utf8'));
const pick = (l) => l[Math.floor(Math.random() * l.length)];
const roll = {
  era_decade: pick(dice.era_decade),
  setting: pick(dice.setting),
  temperament: pick(dice.temperament),
  material_a: pick(dice.material_a),
  material_b: pick(dice.material_b),
  naming_register: pick(dice.naming_register),
  strange_detail: pick(dice.strange_detail),
  wallpaper_motif: pick(dice.wallpaper_motif),
};
const vars = { dice_json: JSON.stringify(roll), never_names: '', seed: 'budget-probe', viewport: '1440x900' };
const render = (t) => t.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, n) => vars[n] ?? '');
const system = render([read('system/voice.md'), read('system/boot.md')].filter(Boolean).join('\n\n'));
const user = render(read('user/boot.md') || 'Begin.');

const rows = [];
for (const max_tokens of budgets) {
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens,
        temperature: 1.1,
        reasoning_effort: 'low',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    const j = await res.json();
    const ms = Date.now() - t0;
    if (!res.ok) {
      rows.push({ max_tokens, ok: false, status: res.status, ms, error: String(j?.error?.message || '').slice(0, 120) });
      continue;
    }
    const ch = j.choices?.[0] || {};
    const content = ch.message?.content || '';
    const u = j.usage || {};
    rows.push({
      max_tokens,
      ok: true,
      ms,
      finish_reason: ch.finish_reason,
      prompt_tokens: u.prompt_tokens,
      completion_tokens: u.completion_tokens,
      reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? null,
      // the arithmetic that answers the question
      visible_chars: content.length,
      has_doctype: /<!doctype/i.test(content),
      has_identity: /<!--os-identity:/.test(content),
      head: content.slice(0, 90).replace(/\s+/g, ' '),
    });
  }
}

const usd = rows.reduce((a, r) => a + ((r.prompt_tokens || 0) / 1e6) * 0.25 + ((r.completion_tokens || 0) / 1e6) * 0.69, 0);
console.log(JSON.stringify({ model, runs, budgets, usd: Math.round(usd * 1e5) / 1e5, rows }, null, 2));
