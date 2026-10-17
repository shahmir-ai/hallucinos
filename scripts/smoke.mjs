/**
 * SPEC §10.3 — real-engine smoke.
 *
 *   node scripts/smoke.mjs --engines=anthropic-haiku,openai-small --desktops=10
 *
 * Per engine: one full boot, three apps, three URLs, screenshots into
 * reviews/shots-smoke/, plus N extra desktop generations so the contract-miss
 * rate SPEC §10.3 gates on ("≥ 9 of 10 desktops pass") is measured and not
 * guessed. Every number comes from the server's own telemetry lines.
 */
import { resolve } from 'node:path';
import {
  ROOT,
  arg,
  startServer,
  withBrowser,
  bootOnce,
  openAppAndWait,
  failureLines,
  exitWithFailures,
  visitUrl,
  shot,
  summarise,
  median,
  usdTotal,
  writeReport,
  sleep,
} from './run.mjs';

const ENGINES = arg('engines', 'anthropic-haiku,openai-small').split(',').filter(Boolean);
const DESKTOPS = Number(arg('desktops', '10'));
const APPS = arg('apps', 'browser,terminal,store').split(',');
const URLS = arg('urls', 'https://google.com/search?q=best+pizza+in+town,https://reddit.com/r/cats,https://en.wikipedia.org/wiki/Moon').split(',');
const SHOTS = resolve(ROOT, 'reviews/shots-smoke');
const BUDGET = Number(arg('budget', '2'));

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const results = [];
const srv = await startServer({ port: Number(arg('port', '8899')), env: { MODERATION: 'auto' } });
let spent = 0;

try {
  for (const engine of ENGINES) {
    const engines = await (await fetch(srv.base + '/api/engines')).json();
    if (!engines.engines.some((e) => e.id === engine)) {
      results.push({ engine, skipped: 'no key in .env' });
      process.stdout.write(`skip ${engine}: no key\n`);
      continue;
    }
    process.stdout.write(`\n=== ${engine}\n`);
    const mark = srv.logs.length;
    const run = { engine, apps: [], urls: [], desktops: { n: 0, ok: 0, missing: [] } };

    await withBrowser(async (ctx) => {
      const page = await ctx.newPage();
      const boot = await bootOnce(page, srv.base, engine);
      Object.assign(run, boot);
      process.stdout.write(
        `boot: paint ${boot.bootPaintMs ?? '-'}ms desktop ${boot.desktopMs}ms contract ${boot.contract} "${boot.identity?.name}"\n`
      );
      await shot(page, SHOTS, `${engine}-desktop`);

      for (const id of APPS) {
        const { frame, chars, ms, failed, windowId } = await openAppAndWait(page, id, 180_000, { engine });
        run.apps.push({ id, chars, ms, ...(failed ? { failed, windowId } : {}) });
        process.stdout.write(`app ${id}: ${chars} chars in ${ms}ms\n`);
        await sleep(600);
        await shot(page, SHOTS, `${engine}-app-${id}`);
        if (id === 'browser' && frame) {
          for (const url of URLS) {
            const r = await visitUrl(page, frame, url);
            run.urls.push({ url, ...r });
            process.stdout.write(`url ${url}: ${r.chars} chars in ${r.ms}ms\n`);
            await shot(page, SHOTS, `${engine}-page-${url.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}`);
          }
        }
      }
      await page.close();
    });

    // the contract-miss rate, measured over N desktops (SPEC §10.3's gate)
    for (let i = 0; i < DESKTOPS; i++) {
      if (usdTotal(srv.logs) + spent > BUDGET) {
        process.stdout.write('budget reached, stopping the desktop sweep\n');
        break;
      }
      const res = await fetch(srv.base + '/api/gen', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': CHROME },
        body: JSON.stringify({
          kind: 'desktop',
          engine,
          seed: 'smoke-' + i + '-' + Math.random().toString(36).slice(2, 8),
          identity: {
            name: 'SMOKE ' + i,
            tagline: 'a test machine',
            version: '1.' + i,
            era: 'a municipal office, 1994',
            personality: 'officious and slightly wounded',
            palette_words: ['oxide', 'bone', 'signal green'],
            font_words: ['condensed grotesque'],
            boot_message: 'waking up',
          },
        }),
      });
      const text = await res.text();
      const m = /<!--os-telemetry:([\s\S]*?)-->/.exec(text);
      const t = m ? JSON.parse(m[1]) : null;
      run.desktops.n += 1;
      if (t?.contract_ok) run.desktops.ok += 1;
      else if (t) run.desktops.missing.push(t.missing.join(' '));
      process.stdout.write(`desktop ${i + 1}/${DESKTOPS}: ${t?.contract_ok ? 'ok' : 'MISS ' + (t?.missing || []).join(' ')}\n`);
    }

    run.logs = srv.logs.slice(mark);
    run.usd = usdTotal(run.logs);
    spent += run.usd;
    results.push(run);
    process.stdout.write(`${engine}: $${run.usd.toFixed(4)}\n`);
  }
} finally {
  srv.stop();
}

/* ------------------------------------------------------------------ report */

const row = (k, b) =>
  `| ${k} | ${b.n} | ${median(b.ttfb)} | ${median(b.tps)} | ${Math.round(b.tin / b.n)} | ${Math.round(b.tout / b.n)} | ${
    b.ok + b.miss ? `${b.ok}/${b.ok + b.miss}` : '—'
  } | ${b.err} | $${b.usd.toFixed(4)} |`;

let md = `# SMOKE-1 — real-engine smoke (SPEC §10.3)

Run ${new Date().toISOString()} · \`node scripts/smoke.mjs --engines=${ENGINES.join(',')} --desktops=${DESKTOPS}\`
Total spend this run: **$${spent.toFixed(4)}**

Every number below is read from the server's own stdout telemetry line for that
generation (\`ttfb_ms\`, \`tok_per_s\`, \`tokens_in/out\`, \`usd\`, \`contract_ok\`);
nothing is re-derived in the harness. Screenshots: \`reviews/shots-smoke/\`.
`;

for (const r of results) {
  if (r.skipped) {
    md += `\n## ${r.engine}\n\nSkipped: ${r.skipped}.\n`;
    continue;
  }
  const by = summarise(r.logs);
  md += `
## ${r.engine}

Identity: **${r.identity?.name}** ${r.identity?.version ? `v${r.identity.version}` : ''}
Boot screen painted at **${r.bootPaintMs ?? 'n/a'} ms**, desktop live at **${r.desktopMs} ms**, contract on that boot: **${r.contract}**${
    r.injected ? ` (${r.injected} element(s) injected)` : ''
  }
Console/page errors during the boot: ${r.errors.length ? r.errors.slice(0, 5).join(' · ') : 'none'}

| kind | n | ttfb ms (med) | tok/s (med) | tok in (avg) | tok out (avg) | contract ok | errors | $ |
|---|---|---|---|---|---|---|---|---|
${Object.entries(by).map(([k, b]) => row(k, b)).join('\n')}

Desktop contract sweep: **${r.desktops.ok}/${r.desktops.n}** passed${
    r.desktops.missing.length ? `\n\nMisses: ${r.desktops.missing.map((m) => '`' + m + '`').join(', ')}` : ''
  }

Apps opened: ${r.apps.map((a) => `\`${a.id}\` (${a.chars} chars, ${a.ms} ms${a.failed ? ', **' + a.failed + '**' : ''})`).join(', ')}
URLs visited: ${r.urls.map((u) => `\`${u.url}\` (${u.chars} chars, ${u.ms} ms)`).join(', ')}
`;
}

// SPEC §10.3's gate, stated rather than left to the reader
md += `\n## Verdict against SPEC §10.3\n\nThe gate is "both engines pass the contract on ≥ 9 of 10 desktop generations".\n\n`;
for (const r of results) {
  if (r.skipped) {
    md += `- \`${r.engine}\`: not run (${r.skipped})\n`;
    continue;
  }
  const pass = r.desktops.n > 0 && r.desktops.ok / r.desktops.n >= 0.9;
  md += `- \`${r.engine}\`: **${r.desktops.ok}/${r.desktops.n}** — ${pass ? 'PASSES' : 'FAILS the gate; the desktop prompt needs work for this engine'}\n`;
}

md += failureLines();

writeReport(resolve(ROOT, 'reviews/SMOKE-1.md'), md);
process.stdout.write(`\ntotal spend $${spent.toFixed(4)}\n`);
// T3: a run that lost a window is a failed run, whatever the report says
exitWithFailures();
