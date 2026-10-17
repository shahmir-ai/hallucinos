/**
 * SPEC §7 — the judging protocol, run by a machine so the only thing left for a
 * human is taste.
 *
 *   node scripts/bakeoff.mjs                                   # every keyed non-mock engine, 5 boots
 *   node scripts/bakeoff.mjs --engines=groq-oss20 --boots=2
 *   node scripts/bakeoff.mjs --engines=mock --boots=1          # $0 rehearsal of the harness itself
 *
 * Per engine, per boot: identity → boot screen → desktop, then four apps
 * (browser, calculator, notes, store) and five URLs inside the browser
 * (google.com home, a search for "best pizza in town", the first result of that
 * search, reddit.com/r/cats, netflix.com, en.wikipedia.org/wiki/Moon).
 *
 * Every per-generation number (contract_ok, ttfb_ms, total_ms, tok_per_s,
 * tokens, usd) comes from the server's own stdout telemetry lines; the HUD is
 * read off the screen at each step as an independent witness, so a report can
 * never disagree with either. Per boot it records time to boot-screen first
 * paint, time to desktop ready, and broken-render flags (blank iframe,
 * unstyled body, JS error on load).
 *
 * Shots: reviews/shots-bakeoff/<n>/<engine>/<boot>/<step>.png — RUN-NUMBERED
 * since BAKEOFF-2 (finding 7): the old `<engine>/<boot>/` path was overwritten
 * in place, so BAKEOFF-1's shot references silently came to point at BAKEOFF-2's
 * pictures and stale files from the older run had to be deleted by hand. The
 * report's numbers were protected and its screenshots were not.
 * Report: reviews/BAKEOFF-<n>.md (never overwritten), with a funniness/variety
 * section left for a human.
 *
 * It starts its own dev server on a free port and picks the engine with
 * ?engine=, exactly as a visitor of /bakeoff would.
 */
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  ROOT,
  arg,
  startServer,
  freePort,
  withBrowser,
  bootOnce,
  openAppAndWait,
  failureLines,
  exitWithFailures,
  photographApp,
  pageStep,
  waitForPage,
  addressBar,
  searchInPage,
  clickFirstLink,
  frameHealth,
  evalSafe,
  collectErrors,
  hudSnapshot,
  inspectDesktop,
  clockTickQuick,
  clockTickLate,
  clockText,
  shot,
  summarise,
  median,
  usdTotal,
  nextReport,
  writeReport,
  sleep,
} from './run.mjs';

// --boots=5 for every engine, or --boots=5,5,3 positionally against --engines
// (the fast engines get SPEC §7's five, the slow reference pair three).
const BOOTS_ARG = arg('boots', '5');
const BOOTS_LIST = BOOTS_ARG.split(',').map((n) => Number(n.trim()) || 1);
const BOOTS = BOOTS_LIST[0];
const bootsFor = (i) => BOOTS_LIST[Math.min(i, BOOTS_LIST.length - 1)];
const APPS = arg('apps', 'browser,calculator,notes,store').split(',').filter(Boolean);
const QUERY = arg('query', 'best pizza in town');
const BUDGET = Number(arg('budget', '15'));
/**
 * Ceiling for ONE app open or page load, in seconds (`--step=60`).
 *
 * The harness used to allow 180 s per step, inherited from a time when the
 * question was "does it arrive at all". SPEC §12.1's targets are 2.5 s, so a
 * step still unfinished after a minute is a failed step whatever happens next —
 * and an engine whose browser app never arrives then costs the run ten dead
 * minutes per boot. Measured as a timeout either way; the run finishes.
 */
const STEP = Number(arg('step', '60')) * 1000;
const slug = (s) => s.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';
/**
 * The report's name is decided BEFORE the run, not after it, because the shots
 * are filed under it while the run is happening (BAKEOFF-2 finding 7).
 * --report=<basename> writes reviews/<basename>.md instead of taking the next
 * free BAKEOFF-<n>; used by rehearsals and prompt-iteration runs so a judged
 * run's number is not burned by one.
 */
const named = arg('report', '');
const { n, file } = named
  ? { n: named.replace(/^BAKEOFF-?/i, '') || named, file: resolve(ROOT, 'reviews', named.replace(/\.md$/i, '') + '.md') }
  : nextReport(resolve(ROOT, 'reviews'), 'BAKEOFF');
/** reviews/shots-bakeoff/<run>/<engine>/<boot>/ — one run never overwrites another */
const SHOTS = resolve(ROOT, 'reviews/shots-bakeoff', String(n));
const shotDir = (engine, boot) => `reviews/shots-bakeoff/${n}/${slug(engine)}/${boot}/`;

const port = Number(arg('port', '0')) || (await freePort());
// GEN_PER_IP_PER_HOUR is a production protection against one visitor, and this
// harness is not a visitor: SPEC §7's protocol is 13 generations plus 2 images
// per boot, so the default 60/hour is exhausted four boots in and every later
// boot gets the kernel's queue screen instead of an OS. It cost this run one
// whole engine before anyone noticed (see the report). Raise it for the harness
// only; the daily USD cap (§1.8) still applies and is the cap that matters.
const srv = await startServer({
  port,
  env: {
    MODERATION: arg('moderation', 'auto'),
    GEN_PER_IP_PER_HOUR: arg('percap', '100000'),
  },
});
const listed = (await (await fetch(srv.base + '/api/engines')).json()).engines.map((e) => e.id);
const ENGINES = arg('engines', listed.filter((id) => id !== 'mock').join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

process.stdout.write(`server ${srv.base} · engines available: ${listed.join(', ') || '(none)'}\n`);
if (!ENGINES.length) process.stdout.write('nothing to judge: no keyed engine in .env\n');

/** The five URL visits of SPEC §7, as steps against an already-open browser window. */
function urlSteps(browser) {
  return [
    {
      name: 'url-1-google-home',
      url: 'https://google.com/',
      // the browser app opens on its own google-shaped home; that IS the first
      // visit, and re-navigating to it would only buy a second identical page
      home: true,
    },
    {
      name: 'url-2-search',
      url: `https://google.com/search?q=${encodeURIComponent(QUERY)}`,
      run: (pageFrame) => searchInPage(browser, pageFrame, QUERY, `https://google.com/search?q=${encodeURIComponent(QUERY)}`),
    },
    { name: 'url-3-first-result', url: '(first result of the search)', run: (pageFrame) => clickFirstLink(pageFrame) },
    { name: 'url-4-reddit', url: 'https://reddit.com/r/cats' },
    { name: 'url-5-netflix', url: 'https://netflix.com/' },
    { name: 'url-6-wikipedia', url: 'https://en.wikipedia.org/wiki/Moon' },
  ];
}

const results = [];
// A judged run is expensive and slow. If it is interrupted — Ctrl-C, a deadline,
// a machine that has to be given back — the engines that did finish must still
// produce their report rather than being thrown away.
let interrupted = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    try {
      assembleResults();
    } catch {}
    process.stdout.write(`\n${sig}: writing the report with the ${results.length} engine(s) finished so far\n`);
    try {
      srv.stop();
    } catch {}
    try {
      buildAndWriteReport();
    } catch (e) {
      process.stdout.write('could not write the report: ' + String(e && e.message) + '\n');
    }
    process.exit(0);
  });
}
/**
 * --alternate interleaves the boots of the listed engines — A1, B1, A2, B2, … —
 * instead of finishing one engine before starting the next.
 *
 * It exists because a provider's speed moves by the ten-minute block (three
 * bake-offs running, and the architect measured `cerebras-oss120` at 1,100
 * tok/s in the morning and 253 tok/s the same evening). Two engines judged
 * back-to-back are judged in two different hours, and the difference between
 * them is then partly the clock. Interleaving does not remove provider drift;
 * it splits it evenly between the columns, which is the most a comparison of
 * two engines on one machine can do.
 */
const ALTERNATE = process.argv.includes('--alternate');
const buckets = new Map();
const bucketFor = (engine) => {
  let b = buckets.get(engine);
  if (!b) buckets.set(engine, (b = { engine, boots: [], logs: [] }));
  return b;
};
const JUDGED = ENGINES.filter((e) => listed.includes(e));
for (const e of ENGINES) {
  if (!listed.includes(e)) {
    results.push({ engine: e, skipped: 'no key in .env' });
    process.stdout.write(`skip ${e}: no key\n`);
  }
}
/**
 * Fold the per-engine buckets into `results`, the shape the report reads.
 * Idempotent, and callable from the signal handler: an interrupted run writes
 * the boots that finished, which in alternating mode means a partial column for
 * every engine rather than a complete one for the first.
 */
function assembleResults() {
  for (const e of ENGINES) {
    const b = buckets.get(e);
    if (!b || !b.boots.length) continue;
    const at = results.findIndex((r) => r.engine === e && !r.skipped);
    const row = { engine: e, boots: b.boots, logs: b.logs, usd: usdTotal(b.logs) };
    if (at >= 0) results[at] = row;
    else results.push(row);
  }
}

/** The run order: one flat list of (engine, boot number), so both modes share one loop. */
const PLAN = [];
if (ALTERNATE) {
  const most = Math.max(0, ...JUDGED.map((e) => bootsFor(ENGINES.indexOf(e))));
  for (let i = 1; i <= most; i++)
    for (const e of JUDGED) if (i <= bootsFor(ENGINES.indexOf(e))) PLAN.push({ engine: e, n: i });
} else {
  for (const e of JUDGED) for (let i = 1; i <= bootsFor(ENGINES.indexOf(e)); i++) PLAN.push({ engine: e, n: i });
}
process.stdout.write(
  `plan (${ALTERNATE ? 'alternating' : 'sequential'}): ${PLAN.map((j) => `${j.engine}#${j.n}`).join(' → ') || '(nothing)'}\n`
);

try {
  for (const job of PLAN) {
    const engine = job.engine;
    const i = job.n;
    if (interrupted) break;
    if (usdTotal(srv.logs) > BUDGET) {
      process.stdout.write(`budget $${BUDGET} reached, stopping\n`);
      break;
    }
    process.stdout.write(`\n=== ${engine} boot ${i}\n`);
    const bucket = bucketFor(engine);
    const boots = bucket.boots;
    const mark = srv.logs.length;
    {
      const dir = resolve(SHOTS, slug(engine), String(i));
      // One boot must never take the run down with it: a browser torn down by a
      // signal, a page that closed under us, an engine that returned nothing.
      // Whatever finished is still worth a report.
      try {
      await withBrowser(async (ctx) => {
        const page = await ctx.newPage();
        const errs = collectErrors(page);
        const b = { n: i, apps: [], urls: [], hud: [] };

        const boot = await bootOnce(page, srv.base, engine, { onPaint: () => shot(page, dir, 'boot-screen') });
        Object.assign(b, boot);
        await shot(page, dir, 'desktop');
        b.hud.push({ step: 'desktop', ...(await hudSnapshot(page)) });
        if (boot.failed) {
          process.stdout.write(`boot ${i}: NO BOOT (${boot.failed}) — ${String(boot.screen || '').replace(/\s+/g, ' ').slice(0, 120)}\n`);
          b.desk = null;
          boots.push(b);
          await page.close();
          return;
        }
        // §12.3 is a structural ruling, so the archetype is judged against the
        // live desktop (where the bar sits, whether the launchers are a grid of
        // labelled icons, whether the clock is real) and not by taking the
        // attribute's word for it.
        b.desk = await inspectDesktop(page);
        b.clock = await clockTickQuick(page);
        b.clockAt = Date.now();
        process.stdout.write(
          `boot ${i}: paint ${b.bootPaintMs ?? '-'}ms · interactive ${b.desktopInteractiveMs ?? '-'}ms · revealed ${b.desktopMs}ms · ` +
            `contract ${b.contract} · ${b.desk?.archetypeAttr || 'no-archetype'}${b.desk?.archetypePatched ? '(patched)' : ''} · ` +
            `${b.desk?.launchers ?? 0} launchers ${b.desk?.grid ? 'grid' : `${b.desk?.launcherCols}x${b.desk?.launcherRows}`}` +
            `${b.desk?.launchersOffscreen ? ` (${b.desk.launchersOffscreen} clipped)` : ''} · "${b.identity?.name}"\n`
        );

        for (const id of APPS) {
          const tApp = Date.now();
          const appOpen = await openAppAndWait(page, id, STEP, { engine });
          const { frame, chars, ms } = appOpen;
          const health = await frameHealth(frame);
          const jsErrors = errs.since(tApp);
          const blocked = errs.blocksSince(tApp).length;
          b.apps.push({
            id,
            ms,
            chars,
            blank: health.blank,
            unstyled: health.unstyled,
            jsErrors: jsErrors.length,
            blocked,
            broken: health.blank || health.unstyled || jsErrors.length > 0,
          });
          // HANDOFF-4 #3 and #8: the window is focused before it is
          // photographed, and photographed again 4 s later, which is the only
          // window in which a fal picture can land
          const appShots = await photographApp(page, dir, `app-${slug(id)}`, appOpen);
          Object.assign(b.apps[b.apps.length - 1], appShots);
          b.hud.push({ step: `app-${id}`, ...(await hudSnapshot(page)) });
          process.stdout.write(
            `  app ${id}: ${chars} chars in ${ms}ms · pics ${appShots.imgFilledLate}/${appShots.imgSlots}` +
              `${appShots.imgLastFillMs == null ? '' : ` last @${appShots.imgLastFillMs}ms`}` +
              `${appShots.focused ? '' : ' UNFOCUSED'}${health.blank ? ' BLANK' : ''}${health.unstyled ? ' UNSTYLED' : ''}${
                jsErrors.length ? ' JS-ERR' : ''
              }\n`
          );

          if (id !== 'browser' || !frame) {
            await sleep(250);
            continue;
          }

          for (const step of urlSteps(frame)) {
            const tStep = Date.now();
            let pf = frame.childFrames()[0] || null;
            let took = 0;
            let timedOut = false;
            let via = 'home';
            if (step.home) {
              // the kernel navigates a fresh browser window to its own home;
              // wait for that document rather than photographing an empty frame
              const res = await waitForPage(frame, { ms: STEP });
              pf = res.frame;
              took = res.ms;
              timedOut = res.timedOut;
            } else {
              const res = await pageStep(frame, async () => {
                via = step.run
                  ? await step.run(pf)
                  : (await evalSafe(frame, (u) => window.os.navigate(u), null, 15_000, step.url), 'navigate');
              }, { ms: STEP });
              pf = res.frame;
              took = res.ms;
              timedOut = res.timedOut;
            }
            const health = await frameHealth(pf);
            const jsErrors = errs.since(tStep);
            const blocked = errs.blocksSince(tStep).length;
            const shown = await addressBar(frame);
            b.urls.push({
              step: step.name,
              url: step.url,
              shown,
              via,
              ms: took,
              timedOut,
              chars: health.chars,
              blank: health.blank,
              unstyled: health.unstyled,
              jsErrors: jsErrors.length,
              blocked,
              broken: timedOut || health.blank || health.unstyled || jsErrors.length > 0,
            });
            await shot(page, dir, step.name);
            b.hud.push({ step: step.name, ...(await hudSnapshot(page)) });
            process.stdout.write(
              `  ${step.name}: ${health.chars} chars in ${took}ms → ${shown || '(no address)'}${timedOut ? ' TIMEOUT' : ''}${
                health.blank ? ' BLANK' : ''
              }${health.unstyled ? ' UNSTYLED' : ''}${jsErrors.length ? ' JS-ERR' : ''}\n`
            );
          }
        }

        // A minute-resolution clock could not be judged in the seconds after
        // mount; the boot has since taken minutes, so the second reading is free.
        if (b.clock && b.clock.ticked === null) {
          b.clock = clockTickLate(b.clock, await clockText(page), b.clockAt);
        }
        b.deskLate = await inspectDesktop(page);
        await shot(page, dir, 'desktop-after');
        b.jsErrorsTotal = errs.all.filter((e) => !e.csp).length;
        b.blockedTotal = errs.all.filter((e) => e.csp).length;
        b.jsErrorSamples = errs.all.filter((e) => !e.csp).slice(0, 6).map((e) => e.m);
        boots.push(b);
        await page.close();
      });
      } catch (err) {
        process.stdout.write(`  boot ${i} of ${engine} ended early: ${String(err && err.message).slice(0, 160)}\n`);
      }
    }
    // Per BOOT, not per engine: in alternating mode an engine's telemetry is not
    // one contiguous slice of the server's stdout, so each boot's slice is
    // appended to its engine's bucket as it finishes.
    const slice = srv.logs.slice(mark);
    bucket.logs.push(...slice);
    process.stdout.write(`${engine}: ${boots.length} boots so far, $${usdTotal(bucket.logs).toFixed(4)}\n`);
  }
} finally {
  srv.stop();
}
assembleResults();

/* ------------------------------------------------------------------ report */

/**
 * Built as a function so the signal handler can call it: a run that is stopped
 * part-way still writes the engines that finished, and waiting for a killed
 * browser to unwind gracefully is not something to depend on.
 */
function buildAndWriteReport() {
  // the flag lives on the function so the signal handler, which can fire before
  // this point in the module has executed, is not caught by a TDZ
  if (buildAndWriteReport.done) return;
  buildAndWriteReport.done = true;

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const renders = (r) => r.boots.flatMap((b) => [...b.apps, ...b.urls]);
const contractOf = (r) =>
  Object.values(summarise(r.logs)).reduce((s, b) => ({ ok: s.ok + b.ok, miss: s.miss + b.miss }), { ok: 0, miss: 0 });
const imgLogs = (r) => r.logs.filter((l) => l.kind === 'img');
const imgUsd = (r) => imgLogs(r).reduce((s, l) => s + (l.usd || 0), 0);
const genUsd = (r) => r.logs.filter((l) => l.kind !== 'img' && l.kind !== 'mark').reduce((s, l) => s + (l.usd || 0), 0);
const ok = (v, target) => (v == null ? '—' : v < target ? `**${(v / 1000).toFixed(2)} s** PASS` : `${(v / 1000).toFixed(2)} s MISS`);
/** medians of the wall-clock app/page numbers, which is what §12.1 states its targets in */
const appMs = (r) => median(r.boots.flatMap((b) => b.apps.map((a) => a.ms)).filter(Boolean));
const pageMs = (r) => median(r.boots.flatMap((b) => b.urls.map((u) => u.ms)).filter((n) => n && n < 170_000));
/**
 * The generation's own first paint.
 *
 * A mark that arrives AFTER its generation's line gets a `mark` line of its
 * own, and the harness joins the two on gen_id. A mark that arrives BEFORE it
 * (every boot: the boot document paints ~200 ms before its own stream ends) is
 * held by the server and folded into that generation's line, which is printed
 * afterwards — so it is read straight off the line. Both paths are covered
 * below; neither is guaranteed to be the one that fires.
 */
const paintMap = (r) => {
  const m = new Map();
  for (const l of r.logs) if (l.kind === 'mark' && l.gen_id && Number.isFinite(l.first_paint_ms)) m.set(l.gen_id, l.first_paint_ms);
  return m;
};
const paintOf = (r, kind) => {
  const m = paintMap(r);
  return median(
    r.logs.filter((l) => l.kind === kind).map((l) => l.first_paint_ms ?? (l.gen_id ? m.get(l.gen_id) : null)).filter(Boolean)
  );
};
const booted = (r) => r.boots.filter((b) => !b.failed);

let md = `# BAKEOFF-${n} (SPEC §7)

Run ${new Date().toISOString()}
\`node scripts/bakeoff.mjs --engines=${ENGINES.join(',') || '(none)'} --boots=${BOOTS_ARG}${named ? ` --report=${named}` : ''}\`

${ENGINES.map((e, i) => `${bootsFor(i)}×\`${e}\``).join(', ')} boots. Per boot: identity → boot screen → desktop, then ${APPS.length} apps
(\`${APPS.join('`, `')}\`) and 5 URL visits inside the browser (google.com home, a search for
"${QUERY}", the first result of that search, reddit.com/r/cats, netflix.com,
en.wikipedia.org/wiki/Moon).

A step (one app open, one page load) is abandoned as a timeout after ${STEP / 1000} s.

Every per-generation number is read from the server's own stdout telemetry line
(\`contract_ok\`, \`ttfb_ms\`, \`total_ms\`, \`tok_per_s\`, \`tokens_in/out\`, \`usd\`); the
HUD was photographed at every step as an independent witness. A render counts as
**broken** if the frame was blank, if its body carried no CSS at all, if a JS
error fired while it loaded, or if it never arrived. Shots:
\`reviews/shots-bakeoff/${n}/<engine>/<boot>/<step>.png\`.

| engine | boots | contract miss | boot paint ms | desktop interactive ms | desktop revealed ms | ttfb ms | tok/s | broken renders | $/session (gen + img) |
|---|---|---|---|---|---|---|---|---|---|
`;

for (const r of results) {
  if (r.skipped) {
    md += `| \`${r.engine}\` | — | — | — | — | — | — | — | skipped: ${r.skipped} |\n`;
    continue;
  }
  const c = contractOf(r);
  const rs = renders(r);
  const ttfb = r.logs.filter((l) => l.kind !== 'img' && l.kind !== 'mark').map((l) => l.ttfb_ms).filter(Boolean);
  const tps = r.logs.map((l) => l.tok_per_s).filter(Boolean);
  const n = Math.max(1, booted(r).length || r.boots.length);
  md += `| \`${r.engine}\` | ${r.boots.length}${booted(r).length !== r.boots.length ? ` (${booted(r).length} up)` : ''} | ${pct(
    c.miss,
    c.ok + c.miss
  )}% (${c.miss}/${c.ok + c.miss}) | ${median(r.boots.map((b) => b.bootPaintMs).filter(Boolean))} | ${median(
    r.boots.map((b) => b.desktopInteractiveMs).filter(Boolean)
  )} | ${median(booted(r).map((b) => b.desktopMs))} | ${median(ttfb)} | ${median(tps)} | ${pct(
    rs.filter((x) => x.broken).length,
    rs.length
  )}% (${rs.filter((x) => x.broken).length}/${rs.length}) | $${(genUsd(r) / n).toFixed(4)} + $${(imgUsd(r) / n).toFixed(
    4
  )} = **$${(r.usd / n).toFixed(4)}** |\n`;
}

/* ------------------------------------------------ §12.1, the actual targets */
md += `\n## §12.1 targets\n\nBoot-screen paint < 1.0 s · desktop interactive < 4.0 s · app content < 2.5 s · page < 2.5 s.
Boot paint and desktop-interactive are the kernel's own numbers (\`data-os-desktop-ms\`
is stamped when the desktop is wired, before the boot overlay's §12.3 2.5 s floor
lifts). App and page are wall clock from the click to the document going quiet,
which carries ~1.0-1.5 s of this harness's own settle polling — so they are an
upper bound; the generations' own first-paint marks are in the second pair of
columns.\n\n| engine | boot paint (<1s) | desktop interactive (<4s) | app (<2.5s) | page (<2.5s) | app first paint | page first paint | boot provider ttfb |\n|---|---|---|---|---|---|---|---|\n`;
for (const r of results) {
  if (r.skipped || !booted(r).length) continue;
  md += `| \`${r.engine}\` | ${ok(median(r.boots.map((b) => b.bootPaintMs).filter(Boolean)), 1000)} | ${ok(
    median(r.boots.map((b) => b.desktopInteractiveMs).filter(Boolean)),
    4000
  )} | ${ok(appMs(r), 2500)} | ${ok(pageMs(r), 2500)} | ${paintOf(r, 'app') || '—'} ms | ${paintOf(r, 'page') || '—'} ms | ${
    median(r.logs.filter((l) => l.kind === 'boot').map((l) => l.provider_ttfb_ms).filter(Boolean)) || '—'
  } ms |\n`;
}

/* ------------------------------------- H3, the boot frame: ink, not chunks */
md += `\n## H3 — the boot screen, per boot\n\nTwo instruments, deliberately independent. **ink (harness)** is this runner
polling the boot iframe from outside for any element with a box — it knows
nothing about the runtime's report. **ink (kernel)** is \`data-os-boot-ink\`, the
runtime's own first-element-with-a-box message, and \`none\` there is the blank
boot of HANDOFF-4's headline: a generation that emitted the identity comment and
no document. **hold** is how long §12.3's 2.5 s floor actually held after that
ink (0 on a frame that never inked — the point of the seam), **revealed** is
when the overlay came off. A blank boot is only a *visible* fault if hold > 0.\n
\n| engine | boot | ink (harness) | ink (kernel) | interactive | hold | revealed | blank boot |\n|---|---|---|---|---|---|---|---|\n`;
for (const r of results) {
  if (r.skipped) continue;
  for (const b of r.boots) {
    md += `| \`${r.engine}\` | ${b.n} | ${b.bootPaintMs ?? '**none**'} | ${
      b.bootInkNone ? '**none**' : (b.bootInkMs ?? '—')
    } | ${b.desktopInteractiveMs ?? '—'} | ${b.bootHoldMs ?? '—'} | ${b.bootRevealedMs ?? b.desktopMs ?? '—'} | ${
      b.bootInkNone || (b.bootPaintMs == null && !b.failed) ? '**yes**' : 'no'
    } |\n`;
  }
}
for (const r of results) {
  if (r.skipped) continue;
  const blanks = r.boots.filter((b) => b.bootInkNone).length;
  const noHarnessPixel = r.boots.filter((b) => b.bootPaintMs == null && !b.failed).length;
  const inks = r.boots.map((b) => b.bootInkMs).filter(Boolean);
  const harnessInks = r.boots.map((b) => b.bootPaintMs).filter(Boolean);
  md += `\n- \`${r.engine}\`: **${blanks}/${r.boots.length} blank boots** (kernel said \`none\`), ${noHarnessPixel}/${
    r.boots.length
  } with no pixel the harness could see · median ink ${median(inks) || '—'} ms (kernel) / ${
    median(harnessInks) || '—'
  } ms (harness) · worst ${Math.max(0, ...harnessInks) || '—'} ms (harness)\n`;
}

/* ------------------------------------------- the bar, measured not eyeballed */
md += `\n## The bar, inside the viewport\n\n\`bar edge\` above says where the bar sits; this says whether what is IN it can be
read. **outside** is bar descendants clipped by the screen, **past bar** is
descendants hanging out of the bar's own box (an entry taller than the bar,
centred on it — the shape of the fault), **overflow** is how far past the bottom
edge the worst one reaches. **tasks** is §12.3's one-entry-per-open-window,
legible / present: an entry whose box is off screen or which carries neither
text nor an icon is not an entry a user can use. **fit** is the kernel's own
guard (\`data-os-fit\` / \`-pinned\`) firing.\n
\n| engine | boot | bar edge | kids | outside | past bar | overflow | tasks legible | clock inside | fit |\n|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of results) {
  if (r.skipped) continue;
  for (const b of r.boots) {
    const d = b.deskLate || b.desk;
    if (!d) continue;
    const f = d.barFit;
    md += `| \`${r.engine}\` | ${b.n} | ${d.taskbarEdge || '**no bar**'} | ${f ? f.kids : '—'} | ${
      f ? (f.outside ? `**${f.outside}**` : 0) : '—'
    } | ${f ? (f.overflowsBar ? `**${f.overflowsBar}**` : 0) : '—'} | ${f ? (f.overflowBottom ? `**${f.overflowBottom}px**` : 0) : '—'} | ${
      d.tasks == null ? '—' : `${d.tasksLegible}/${d.tasks}${d.tasks && d.tasksLegible < d.tasks ? ' **clipped**' : ''}`
    } | ${d.clockInside == null ? '—' : d.clockInside ? 'yes' : '**no**'} | ${d.fitGuard || '—'} |\n`;
  }
}

/* ---------------------------------------- the pictures inside app documents */
md += `\n## Pictures inside app windows\n\nBAKEOFF-3 issue 5 and HANDOFF-4 #3. **early** is the fill count when the
document went quiet; **late** is after this runner waited for the pictures to
stop arriving (up to 10 s, stopping 3 s after the last one) — the previous
fixed 4 s wait was shorter than the kernel's second wave of two and reported
every second wave as lost. **last @** is when the final picture landed, measured
from the first photograph. \`slots\` is what the model asked for; §12.5 caps an
app at four, so a document that declares eight is not owed eight.\n
\n| engine | boot | app | slots | early | late | last @ | focused |\n|---|---|---|---|---|---|---|---|\n`;
for (const r of results) {
  if (r.skipped) continue;
  for (const b of r.boots)
    for (const a of b.apps) {
      if (!a.imgSlots) continue;
      md += `| \`${r.engine}\` | ${b.n} | ${a.id} | ${a.imgSlots} | ${a.imgFilled ?? '—'} | ${a.imgFilledLate ?? '—'} | ${
        a.imgLastFillMs == null ? '**never**' : a.imgLastFillMs + ' ms'
      } | ${a.focused ? 'yes' : '**no**'} |\n`;
    }
}
for (const r of results) {
  if (r.skipped) continue;
  const withSlots = r.boots.flatMap((b) => b.apps).filter((a) => a.imgSlots);
  const asked = withSlots.reduce((t, a) => t + Math.min(a.imgSlots, 4), 0);
  const got = withSlots.reduce((t, a) => t + (a.imgFilledLate || 0), 0);
  const delivered = r.logs.filter((l) => l.kind === 'img' && l.img_scope === 'app' && !l.blocked && !l.error).length;
  md += `\n- \`${r.engine}\`: **${got}/${asked}** app pictures on screen (capped at four per document) out of ${delivered} the server actually delivered${
    delivered > got ? ` — ${delivered - got} were paid for and never reached a slot` : ''
  } · ${withSlots.filter((a) => !a.focused).length}/${withSlots.length} photographed unfocused\n`;
}

/* --------------------------------------------------- H2, the hedge, per kind */
md += `\n## H2 — the hedge\n\nWhich engine actually wrote each generation. \`hedged\` means a second lane was
started (for \`boot\` and \`desktop\` \`HEDGE_AFTER_MS_BOOT\` is 0, so both start at
once); the loser is aborted at the winner's 64-character commit point and its
billed input is already inside the \`$/session\` column above. An explicit engine
id bypasses routing and hedging entirely, so an unhedged column here is the
control, not a failure.\n\n| engine | kind | n | hedged | winners | median loser abort ms | loser input tokens |\n|---|---|---|---|---|---|---|\n`;
for (const r of results) {
  if (r.skipped) continue;
  for (const kind of ['boot', 'desktop', 'app', 'page']) {
    const ls = r.logs.filter((l) => l.kind === kind && !l.blocked);
    if (!ls.length) continue;
    const hedged = ls.filter((l) => l.hedged);
    const wins = {};
    for (const l of ls) {
      const w = l.winner || l.engine || '?';
      wins[w] = (wins[w] || 0) + 1;
    }
    md += `| \`${r.engine}\` | ${kind} | ${ls.length} | ${hedged.length} | ${Object.entries(wins)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')} | ${median(hedged.map((l) => l.loser_aborted_ms).filter((n) => Number.isFinite(n))) || '—'} | ${hedged.reduce(
      (t, l) => t + (l.loser_tokens_in || 0),
      0
    )} |\n`;
  }
}
for (const r of results) {
  if (r.skipped) continue;
  const gens = r.logs.filter((l) => ['boot', 'desktop', 'app', 'page'].includes(l.kind) && !l.blocked);
  const nb = Math.max(1, r.boots.filter((b) => !b.failed).length || r.boots.length);
  const loserTok = gens.reduce((t, l) => t + (l.loser_tokens_in || 0), 0);
  const failovers = gens.filter((l) => l.failed_over).length;
  md += `\n- \`${r.engine}\`: ${gens.filter((l) => l.hedged).length}/${gens.length} generations hedged · ${(
    loserTok / nb
  ).toFixed(0)} loser input tokens per session · ${failovers} failover${failovers === 1 ? '' : 's'}\n`;
}

/* ------------------------------ §12.3 archetype compliance, from the live DOM */
md += `\n## §12.3 archetype compliance\n\nJudged on the mounted desktop, not on the attribute: where the bar actually sits,
whether the launchers form a grid of labelled icons rather than a list, whether a
clock is there and ticks. "patched" means the kernel had to inject the hook, which
is a contract miss the model made good on paper. "clipped" is launchers off the
screen; "overlap" is launchers written across each other (BAKEOFF-3 open issue 3,
unmeasured until now); "icons filled" counts only the slots inside a launcher,
with any surplus slots elsewhere in the document — menus, task templates, which
the sheet was never bought for — in brackets (open issue 8).\n\n| engine | boot | archetype | bar edge | clock | ticks | launchers | layout | clipped | overlap | icons filled | wallpaper |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of results) {
  if (r.skipped) continue;
  for (const b of r.boots) {
    const d = b.deskLate || b.desk;
    if (!d) {
      md += `| \`${r.engine}\` | ${b.n} | — (no boot: ${b.failed || 'failed'}) | — | — | — | — | — | — | — | — | — |\n`;
      continue;
    }
    md += `| \`${r.engine}\` | ${b.n} | ${d.archetypeAttr || '**none**'}${d.archetypePatched ? ' (patched)' : ''} | ${
      d.taskbarEdge || '**no bar**'
    } | ${d.clock ? (d.clockPatched ? 'patched' : 'yes') : '**no**'} | ${
      b.clock
        ? b.clock.ticked
          ? `yes (${b.clock.resolution})`
          : `${b.clock.ticked === null ? 'undecided' : '**no**'} ("${(b.clock.from || '').slice(0, 18)}" → "${(b.clock.to || '').slice(0, 18)}")`
        : '—'
    } | ${d.launchersLabelled}/${d.launchers} labelled | ${d.launcherCols}×${d.launcherRows}${d.grid ? ' grid' : ' **line**'} | ${
      d.launchersOffscreen || 0
    } | ${d.launchersOverlapping ? `**${d.launchersOverlapping}** (${d.launcherWorstOverlap})` : 0} | ${d.iconsFilled}/${d.icons}${
      d.iconSlotsElsewhere ? ` (+${d.iconSlotsElsewhere} elsewhere)` : ''
    } | ${d.wallpaper ? d.wallpaperOn : '**none**'} |\n`;
  }
}

/* ------------------------------------------------- §12.4 identity variety */
md += `\n## §12.4 identity variety\n\nEvery machine this run invented, in order. A repeated name or a repeated
archetype-plus-era across boots of the same engine is the failure §12.4's dice
exist to prevent.\n\n| engine | boot | name | version | era | archetype | tagline |\n|---|---|---|---|---|---|---|\n`;
for (const r of results) {
  if (r.skipped) continue;
  for (const b of r.boots) {
    const id = b.identity || {};
    md += `| \`${r.engine}\` | ${b.n} | **${id.name || '—'}** | ${id.version || '—'} | ${id.era || '—'} | ${
      id.archetype || '—'
    } | ${String(id.tagline || '').replace(/\|/g, '/').slice(0, 70)} |\n`;
  }
}
for (const r of results) {
  if (r.skipped) continue;
  const names = booted(r).map((b) => (b.identity?.name || '').toLowerCase()).filter(Boolean);
  const dupes = names.filter((x, i) => names.indexOf(x) !== i);
  const firstWords = names.map((n) => n.split(/[\s-]+/)[0]);
  const stemDupes = firstWords.filter((x, i) => firstWords.indexOf(x) !== i);
  const arch = booted(r).map((b) => b.identity?.archetype);
  md += `\n- \`${r.engine}\`: ${new Set(names).size}/${names.length} distinct names${
    dupes.length ? ` — **repeats: ${[...new Set(dupes)].join(', ')}**` : ''
  }${stemDupes.length ? ` · **repeated first word: ${[...new Set(stemDupes)].join(', ')}**` : ''} · archetypes ${
    arch.join(', ') || '—'
  }\n`;
}

/* ------------------------------------------------------- §12.5 the images */
md += `\n## §12.5 images\n\n| engine | image calls | per boot | $ images | $ per image | blocked/failed |\n|---|---|---|---|---|---|\n`;
for (const r of results) {
  if (r.skipped) continue;
  const il = imgLogs(r);
  const bad = il.filter((l) => l.error || l.blocked).length;
  md += `| \`${r.engine}\` | ${il.length} | ${(il.length / Math.max(1, booted(r).length)).toFixed(1)} | $${imgUsd(r).toFixed(
    4
  )} | $${il.length ? (imgUsd(r) / il.length).toFixed(4) : '—'} | ${bad} |\n`;
}
// BAKEOFF-3: "13 of 24 failed" is not a usable number without the reason. The
// server already says which kind it was and why it did not arrive; this prints
// it, so an image finding never needs the run repeated to be diagnosed.
md += `\n| engine | img kind | n | ok | median ms | not delivered (reason × n) |\n|---|---|---|---|---|---|\n`;
for (const r of results) {
  if (r.skipped) continue;
  const il = imgLogs(r);
  for (const kind of [...new Set(il.map((l) => l.img_kind || '?'))]) {
    const ls = il.filter((l) => (l.img_kind || '?') === kind);
    const bad = ls.filter((l) => l.error || l.blocked);
    const why = {};
    for (const l of bad) {
      const k = l.blocked ? `blocked:${l.blocked}` : String(l.error).slice(0, 40);
      why[k] = (why[k] || 0) + 1;
    }
    md += `| \`${r.engine}\` | ${kind} | ${ls.length} | ${ls.length - bad.length} | ${median(
      ls.filter((l) => !l.error && !l.blocked).map((l) => l.total_ms).filter(Boolean)
    )} | ${Object.entries(why).map(([k, n]) => `${k} × ${n}`).join(', ') || '—'} |\n`;
  }
}

md += `\nWhether the wallpaper fits the era and whether the icon sheet is legible at 64 px
is a human's call on the shots — see the taste section at the end.\n`;

md += `\n"$/session" is one boot with its apps and pages — what one visitor costs. A console
error that is the CSP refusing a generated document's network call is counted
separately ("network blocked by CSP" below): that is the sandbox working, not a
broken render, though a high number says the model keeps reaching for the web.\n`;

for (const r of results) {
  if (r.skipped) {
    md += `\n## \`${r.engine}\`\n\nSkipped: ${r.skipped}.\n`;
    continue;
  }
  const by = summarise(r.logs);
  md += `\n## \`${r.engine}\`\n\n| kind | n | ttfb ms (med) | total ms (med) | tok/s (med) | tok in (avg) | tok out (avg) | contract ok | errors | $ |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const [k, b] of Object.entries(by)) {
    const totals = r.logs.filter((l) => l.kind === k).map((l) => l.total_ms).filter(Boolean);
    md += `| ${k} | ${b.n} | ${median(b.ttfb)} | ${median(totals)} | ${median(b.tps)} | ${Math.round(b.tin / b.n)} | ${Math.round(
      b.tout / b.n
    )} | ${b.ok + b.miss ? `${b.ok}/${b.ok + b.miss}` : '—'} | ${b.err} | $${b.usd.toFixed(4)} |\n`;
  }

  md += `\n### Per boot\n\n| boot | machine | boot paint ms | interactive ms | revealed ms | contract | injected | blank | unstyled | JS errors | network blocked by CSP |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const b of r.boots) {
    const rs = [...b.apps, ...b.urls];
    md += `| ${b.n} | ${b.failed ? `— (${b.failed})` : b.identity?.name || '—'} | ${b.bootPaintMs ?? '—'} | ${
      b.desktopInteractiveMs ?? '—'
    } | ${b.desktopMs} | ${b.contract ?? '—'} | ${b.injected || 0} | ${rs.filter((x) => x.blank).length} | ${
      rs.filter((x) => x.unstyled).length
    } | ${b.jsErrorsTotal || 0} | ${b.blockedTotal || 0} |\n`;
  }

  md += `\n### Renders\n\nWall-clock ms, measured from the click to the document going quiet; it carries about
1.5 s of the harness's own settle polling, so compare engines with it, not the
generation times in the table above.\n\n| boot | step | ms | chars | how | flags | address shown |\n|---|---|---|---|---|---|---|\n`;
  for (const b of r.boots) {
    for (const a of b.apps)
      md += `| ${b.n} | app \`${a.id}\` | ${a.ms} | ${a.chars} | launcher | ${
        [a.blank && 'blank', a.unstyled && 'unstyled', a.jsErrors && `${a.jsErrors} js`].filter(Boolean).join(', ') || 'ok'
      } | — |\n`;
    for (const u of b.urls)
      md += `| ${b.n} | ${u.step} | ${u.ms} | ${u.chars} | ${u.via} | ${
        [u.timedOut && 'never arrived', u.blank && 'blank', u.unstyled && 'unstyled', u.jsErrors && `${u.jsErrors} js`]
          .filter(Boolean)
          .join(', ') || 'ok'
      } | \`${u.shown || ''}\` |\n`;
  }

  const errs = [...new Set(r.logs.filter((l) => l.error).map((l) => `${l.kind}: ${String(l.error).slice(0, 160)}`))];
  if (errs.length) md += `\nEngine/server errors, as telemetry recorded them:\n\n${errs.map((e) => '- `' + e + '`').join('\n')}\n`;
  const misses = r.logs.filter((l) => l.contract_ok === false).map((l) => (l.missing || []).join(' ')).filter(Boolean);
  if (misses.length) md += `\nContract misses, as the validator saw them: ${[...new Set(misses)].map((m) => '`' + m + '`').join(', ')}\n`;
  const errSamples = r.boots.flatMap((b) => b.jsErrorSamples || []);
  md += `\nJS errors (first few): ${errSamples.length ? errSamples.slice(0, 8).map((e) => '`' + e + '`').join(' · ') : 'none'}\n`;
  const hud = r.boots.at(-1)?.hud?.at(-1);
  if (hud?.text) md += `\nHUD at the end of the last boot:\n\n\`\`\`\n${hud.text}\n\`\`\`\n`;
}

/* The one thing a harness must not pretend to have measured. */
md += `\n---\n\n## Funniness and variety — for a human\n\nThis harness does not score taste. Open the shots and fill this in.\n`;
for (const r of results) {
  if (r.skipped) continue;
  md += `\n### \`${r.engine}\`\n\nMachines it invented:\n\n`;
  for (const b of r.boots)
    md += `- boot ${b.n}: **${b.identity?.name || '—'}** ${b.identity?.version ? `v${b.identity.version}` : ''} (${
      b.identity?.archetype || '?'
    }, ${b.identity?.era || '?'}) — _${b.identity?.tagline || 'no tagline'}_ · shots \`${shotDir(r.engine, b.n)}\`\n`;
  md += `\nFunny? _____ / 5 · Varied across boots? _____ / 5 · Would you screenshot it? _____\n\nNotes:\n\n> \n`;
}

md += `\n## Verdict\n\nPick the top two or three by contract-miss rate, desktop time and $/session; then play with them on \`/bakeoff\` (or \`/bakeoff/run?engine=<id>\` directly) before deciding. Taste breaks ties, numbers do not.\n`;

md += failureLines();

writeReport(file, md);

// The raw telemetry, next to the shots. BAKEOFF-3 had to re-run the harness to
// answer "which image calls failed, and why"; the answer was in the server's
// stdout and nothing kept it. One JSONL per run, and every number above can be
// recomputed from it.
{
  const lines = [];
  for (const r of results) for (const l of r.logs || []) lines.push(JSON.stringify({ engine: r.engine, ...l }));
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(resolve(SHOTS, 'telemetry.jsonl'), lines.join('\n') + '\n');
  process.stdout.write(`wrote ${resolve(SHOTS, 'telemetry.jsonl')} (${lines.length} lines)\n`);
}
process.stdout.write(`\ntotal spend $${results.reduce((s, r) => s + (r.usd || 0), 0).toFixed(4)}\n`);
}


buildAndWriteReport();
// T3: an app open that produced no usable window fails the run, loudly
exitWithFailures();
