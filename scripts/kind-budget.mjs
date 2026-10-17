/**
 * Does `max_tokens` starve the DOCUMENT kinds the way it starved `boot`?
 *
 * HANDOFF-5 / SERVER-v03 §2 settled it for `boot`: on Cerebras gpt-oss-120b
 * `max_tokens` is a ceiling on reasoning + visible output together, so an 800
 * budget bought a boot that thought and emitted nothing. The budget went to
 * 1,600 and 53 boots later no boot has been blank. The same arithmetic has
 * never been run on `desktop` (3,500), `app` (2,500) or `page` (2,500) — and
 * HANDOFF-5 photographed one app window that hit `finish_reason=length` at
 * exactly 2,500, which is the same fault with a different number.
 *
 * So: the REAL prompts, the REAL engines, non-streaming (identical
 * accounting, simpler to read), at the current budget and at a raised one,
 * reporting `completion_tokens`,
 * `completion_tokens_details.reasoning_tokens`, `finish_reason`, and whether a
 * closed document came back.
 *
 *   node scripts/kind-budget.mjs                       # 36 calls, ~$0.09
 *   node scripts/kind-budget.mjs --kinds=app --runs=2
 *   node scripts/kind-budget.mjs --engines=cerebras-oss120
 *
 * The probe prints its own bill before it buys anything. It never starts a
 * server and never touches a port.
 *
 * WHY NOT THROUGH /api/gen: the server's telemetry does not carry
 * `reasoning_tokens` (it has `tokens_out` and `truncated`), and the whole
 * question is how the budget is split between thinking and writing. The
 * prompts below are assembled from the same files `server/prompts.ts` reads,
 * with the same variable names, so the token counts are the real ones.
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

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};

const RUNS = Number(arg('runs', '3'));
const KINDS = String(arg('kinds', 'desktop,app,page')).split(',').filter(Boolean);
const ENGINE_IDS = String(arg('engines', 'cerebras-oss120,or-oss120-groq')).split(',').filter(Boolean);
/** current budget first, raised budget second — the pair is the measurement */
const BUDGETS = {
  desktop: String(arg('desktop-budgets', '3500,5000')).split(',').map(Number),
  app: String(arg('app-budgets', '2500,4000')).split(',').map(Number),
  page: String(arg('page-budgets', '2500,4000')).split(',').map(Number),
  boot: String(arg('boot-budgets', '1600,2400')).split(',').map(Number),
};

/**
 * Which app and which url. The defaults are middling ones — `notes` is not the
 * browser (extra hooks) and not `photos` (buys pictures), and a reference page
 * is the shape that also gets the `shape_note` fragment. Override them to probe
 * the TAIL: `--app-id=browser`, `--page-url=.../search?q=...` (a results page is
 * eight to ten results and the longest page this product asks for).
 */
const APP_ID = arg('app-id', 'notes');
const PAGE_URL = new URL(arg('page-url', 'https://www.wikipedia.org/wiki/Kelder_Reach'));

const enginesFile = JSON.parse(readFileSync(resolve(ROOT, 'engines.json'), 'utf8'));
const engines = ENGINE_IDS.map((id) => {
  const e = enginesFile.engines.find((x) => x.id === id);
  if (!e) throw new Error('unknown engine ' + id);
  if (!process.env[e.keyEnv]) throw new Error('no ' + e.keyEnv);
  return e;
});

const manifest = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8'));
const dice = JSON.parse(readFileSync(resolve(ROOT, 'data/dice.json'), 'utf8'));
const readPrompt = (rel) => {
  const p = resolve(ROOT, 'prompts', rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};
const render = (tpl, vars) => tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, n) => (vars[n] === undefined || vars[n] === null ? '' : String(vars[n])));
const pick = (l) => l[Math.floor(Math.random() * l.length)];

/**
 * A real identity, in the shape `server/identity.ts` parses out of a boot
 * stream. Frozen here so the probe measures the budget and not the weather of
 * a fresh boot — and so it costs nothing to run.
 */
const IDENTITY = {
  name: 'VORTEX',
  tagline: 'Ledger of the Departed',
  version: '1.4.2-rc2',
  era: 'a 2020s funeral parlour back office',
  personality: 'apologetic, meticulous, faintly grieving',
  palette_words: ['obsidian', 'bone', 'brass', 'cold violet'],
  font_words: ['narrow grotesque', 'typewriter'],
  mascot: 'a folded paper crane',
  boot_message: 'Reconciling the register.',
  archetype: 'taskbar',
};

const reality = (() => {
  const r = dice.reality_offset;
  const sys = pick(r.unit_system);
  const pair = pick(r.place_pair);
  return {
    calendar: pick(r.calendar_quirk),
    units: { name: sys.name, unit_names: sys.units.slice(0, 3) },
    scale: 1.37,
    places: pair.slice(0, 2),
    event: pick(r.historical_event),
  };
})();

const diceRoll = {
  era_decade: pick(dice.era_decade),
  setting: pick(dice.setting),
  temperament: pick(dice.temperament),
  material_a: pick(dice.material_a),
  material_b: pick(dice.material_b),
  naming_register: pick(dice.naming_register),
  strange_detail: pick(dice.strange_detail),
  wallpaper_motif: pick(dice.wallpaper_motif),
};

/** `server/index.ts` builds one launcher line per manifest app, in manifest order. */
const appLaunchers = manifest.apps.map((a) => `data-os-app="${a.id}"`).join(' ');

/**
 * The per-kind variable sets. Same names as `PromptVars` in
 * `server/prompts.ts`; the values are the shapes the server passes.
 *
 * `app` uses `notes` — a middling app: not the browser (which has the extra
 * hooks) and not `photos` (which buys pictures). `page` uses a reference URL,
 * which is the shape that gets the longest document AND the `shape_note`
 * fragment, i.e. the worst case for the budget.
 */
const VARS = {
  desktop: () => ({
    identity_json: JSON.stringify(IDENTITY),
    manifest_json: JSON.stringify(manifest),
    app_launchers: appLaunchers,
    app_count: String(manifest.apps.length),
    archetype: IDENTITY.archetype,
    seed: 'budget-' + Math.random().toString(36).slice(2, 8),
    viewport: '1440x900',
  }),
  app: () => ({
    app_id: APP_ID,
    identity_json: JSON.stringify(IDENTITY),
    manifest_json: JSON.stringify(manifest),
    params_json: '{}',
    reality_json: JSON.stringify(reality),
    seed: 'budget-' + Math.random().toString(36).slice(2, 8),
    viewport: '1440x900',
  }),
  page: () => ({
    url: PAGE_URL.href,
    domain: PAGE_URL.host,
    path: PAGE_URL.pathname,
    query: PAGE_URL.search.replace(/^\?/, ''),
    referer_url: 'https://www.google.com/search?q=kelder+reach',
    referer_title: 'kelder reach - Search',
    history: '- https://www.google.com/',
    rerouted: 'false',
    reality_json: JSON.stringify(reality),
    seed: 'budget-' + Math.random().toString(36).slice(2, 8),
    viewport: '1440x900',
  }),
  boot: () => ({
    dice_json: JSON.stringify(diceRoll),
    never_names: '',
    seed: 'budget-' + Math.random().toString(36).slice(2, 8),
    viewport: '1440x900',
  }),
};

/** The optional user-turn fragments `buildPrompt` appends, same conditions. */
const FRAGMENTS = {
  page: (v) => (v.reality_json ? ['user/reality.md'] : []),
  app: (v) => (v.reality_json ? ['user/reality.md'] : []),
  desktop: () => [],
  boot: () => [],
};

function buildPrompt(kind, vars) {
  const all = { ...vars, kind };
  if (kind === 'app' && vars.app_id) {
    const shape = readPrompt(`apps/${vars.app_id}.md`);
    if (shape) all.app_shape = shape;
  }
  if (kind === 'page') {
    const note = readPrompt('notes/reference.md');
    if (note) all.shape_note = note.trim();
  }
  let system = readPrompt('system/voice.md') || '';
  const kindFile = readPrompt(`system/${kind}.md`) || '';
  system += (system ? '\n\n' : '') + kindFile;
  let user = readPrompt(`user/${kind}.md`) || 'Begin.';
  for (const f of FRAGMENTS[kind](all)) {
    const t = readPrompt(f);
    if (t) user += '\n\n' + t;
  }
  return { system: render(system, all), user: render(user, all) };
}

const approxTokens = (s) => Math.ceil(s.length / 3.6);

// ---- the bill, before anything is bought -----------------------------------
const plan = [];
for (const kind of KINDS) for (const engine of engines) for (const max_tokens of BUDGETS[kind]) for (let i = 0; i < RUNS; i++) plan.push({ kind, engine, max_tokens, i });
const sample = KINDS.map((k) => {
  const p = buildPrompt(k, VARS[k]());
  return { kind: k, in: approxTokens(p.system + p.user) };
});
const estUsd = plan.reduce((a, r) => {
  const inTok = sample.find((s) => s.kind === r.kind).in;
  return a + (inTok / 1e6) * r.engine.usd_in + (r.max_tokens / 1e6) * r.engine.usd_out;
}, 0);
process.stdout.write(
  `${plan.length} calls (${KINDS.join('/')} x ${ENGINE_IDS.join('/')} x ${RUNS} runs x ${KINDS.map((k) => BUDGETS[k].join('+')).join(',')}) ` +
    `— worst case $${estUsd.toFixed(3)} if every call spends its whole budget\n` +
    sample.map((s) => `  ${s.kind}: ~${s.in} prompt tokens`).join('\n') +
    '\n\n'
);

// ---- run -------------------------------------------------------------------
const rows = [];
for (const step of plan) {
  const r = await one(step);
  rows.push(r);
  process.stdout.write(
    `${r.engine} ${r.kind} @${r.max_tokens} ${step.i + 1}/${RUNS}: ` +
      (r.ok
        ? `${r.finish_reason} | out ${r.completion_tokens} (reasoning ${r.reasoning_tokens ?? '?'}, visible ~${r.visible_tokens}) | ` +
          `${r.has_doctype ? 'doc' : 'NO DOC'} ${r.closed ? 'closed' : 'UNCLOSED'} | ${r.ms} ms\n`
        : `FAIL ${r.status} ${r.error}\n`)
  );
}

// ---- summary ---------------------------------------------------------------
const med = (xs) => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};
process.stdout.write('\n| engine | kind | budget | n | finish=length | no doc | unclosed | median out | median reasoning | median visible | max out |\n|---|---|---|---|---|---|---|---|---|---|---|\n');
for (const engine of ENGINE_IDS) {
  for (const kind of KINDS) {
    for (const b of BUDGETS[kind]) {
      const rs = rows.filter((r) => r.engine === engine && r.kind === kind && r.max_tokens === b && r.ok);
      if (!rs.length) continue;
      process.stdout.write(
        `| ${engine} | ${kind} | ${b} | ${rs.length} | ${rs.filter((r) => r.finish_reason === 'length').length} | ` +
          `${rs.filter((r) => !r.has_doctype).length} | ${rs.filter((r) => !r.closed).length} | ` +
          `${med(rs.map((r) => r.completion_tokens))} | ${med(rs.map((r) => r.reasoning_tokens ?? 0))} | ${med(rs.map((r) => r.visible_tokens))} | ` +
          `${Math.max(...rs.map((r) => r.completion_tokens))} |\n`
      );
    }
  }
}

const usd = rows.reduce((a, r) => {
  const e = engines.find((x) => x.id === r.engine);
  return a + ((r.prompt_tokens || 0) / 1e6) * e.usd_in + ((r.completion_tokens || 0) / 1e6) * e.usd_out;
}, 0);
process.stdout.write(`\nspent $${usd.toFixed(4)}\n`);
process.stdout.write('\n' + JSON.stringify({ runs: RUNS, kinds: KINDS, engines: ENGINE_IDS, budgets: BUDGETS, usd: Math.round(usd * 1e5) / 1e5, rows }, null, 1) + '\n');

async function one({ kind, engine, max_tokens }) {
  const { system, user } = buildPrompt(kind, VARS[kind]());
  const t0 = Date.now();
  try {
    const res = await fetch(engine.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env[engine.keyEnv]}` },
      body: JSON.stringify({
        model: engine.model,
        max_tokens,
        temperature: enginesFile.defaults.temperature,
        ...(engine.extraBody || {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    const j = await res.json().catch(() => ({}));
    const ms = Date.now() - t0;
    if (!res.ok) return { engine: engine.id, kind, max_tokens, ok: false, status: res.status, ms, error: String(j?.error?.message || '').slice(0, 140) };
    const ch = j.choices?.[0] || {};
    const content = ch.message?.content || '';
    const u = j.usage || {};
    const reasoning = u.completion_tokens_details?.reasoning_tokens ?? null;
    return {
      engine: engine.id,
      kind,
      max_tokens,
      ok: true,
      ms,
      finish_reason: ch.finish_reason,
      prompt_tokens: u.prompt_tokens,
      completion_tokens: u.completion_tokens,
      reasoning_tokens: reasoning,
      /** what the document actually cost, independent of how the provider reports reasoning */
      visible_tokens: approxTokens(content),
      visible_chars: content.length,
      has_doctype: /<!doctype/i.test(content),
      /** a document that ran out of budget mid-markup has no closing tag */
      closed: /<\/html>\s*$/i.test(content.trim()),
      head: content.slice(0, 80).replace(/\s+/g, ' '),
    };
  } catch (err) {
    return { engine: engine.id, kind, max_tokens, ok: false, status: 0, ms: Date.now() - t0, error: String(err?.message || err).slice(0, 140) };
  }
}
