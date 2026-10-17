/**
 * The cheapest instrument in the box: N desktop generations per engine straight
 * at POST /api/gen, no browser, no apps, no pages — just SPEC §10.3's gate
 * ("≥ 9 of 10 desktops pass the contract") and the validator's own miss list.
 *
 *   node scripts/desktop-sweep.mjs --engines=openai-small --n=10
 *   DUMP=/tmp/d node scripts/desktop-sweep.mjs --engines=anthropic-haiku --n=10
 *
 * A full bake-off boot costs 13 generations and minutes of wall clock; this
 * costs one generation per data point, which is what makes iterating on
 * prompts/system/desktop.md affordable. Three fixed identities rotate so an
 * engine is never judged on one mood. DUMP=<dir> writes every document out,
 * which is how a miss gets diagnosed rather than guessed at.
 */
import { startServer, freePort, arg, usdTotal } from './run.mjs';

const ENGINES = arg('engines', 'openai-small').split(',').filter(Boolean);
const N = Number(arg('n', '10'));
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const IDS = [
  { name: 'SMOKE 0', era: 'a municipal office, 1994', personality: 'officious and slightly wounded', palette_words: ['oxide','bone','signal green'], font_words: ['condensed grotesque'] },
  { name: 'PELAGIC', era: 'a deep-sea research hull, 2061', personality: 'patient, faintly seasick', palette_words: ['abyss','sodium','kelp'], font_words: ['humanist sans'] },
  { name: 'BRASSWORKS', era: 'a pneumatic clearing house, 1908', personality: 'proud of its ledgers', palette_words: ['brass','ink','tea'], font_words: ['fat slab serif'] },
];
const port = Number(arg('port', '0')) || (await freePort());
const srv = await startServer({ port, env: { MODERATION: 'off' } });
const out = {};
try {
  for (const engine of ENGINES) {
    let ok = 0, n = 0; const misses = [];
    for (let i = 0; i < N; i++) {
      const id = IDS[i % IDS.length];
      const res = await fetch(srv.base + '/api/gen', {
        method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': CHROME },
        body: JSON.stringify({ kind: 'desktop', engine, seed: 'sw-' + i + '-' + Math.random().toString(36).slice(2, 8),
          identity: { ...id, tagline: 'a test machine', version: '1.' + i, boot_message: 'waking up' } }),
      });
      const text = await res.text();
      const m = /<!--os-telemetry:([\s\S]*?)-->/.exec(text);
      const t = m ? JSON.parse(m[1]) : null;
      n++;
      if (t?.contract_ok) ok++; else misses.push((t?.missing || ['NO-TELEMETRY ' + text.slice(0, 200)]).join(' '));
      process.stdout.write(`${engine} ${i + 1}/${N}: ${t?.contract_ok ? 'ok' : 'MISS ' + (t?.missing || []).join(' ')}\n`);
      if (process.env.DUMP) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(`${process.env.DUMP}/${engine}-${i}.html`, text);
      }
    }
    out[engine] = { ok, n, misses };
    process.stdout.write(`\n== ${engine}: ${ok}/${n}\n`);
  }
} finally { srv.stop(); }
process.stdout.write(`spend $${usdTotal(srv.logs).toFixed(4)}\n`);
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
