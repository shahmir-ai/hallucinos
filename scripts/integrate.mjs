/**
 * scripts/integrate.mjs — the seam runner (SPEC §12 / interfaces I1–I8).
 *
 * One boot per engine through /bakeoff/run, watched end to end in a real
 * browser, with the checks the three builders could not make on their own side
 * of the wire:
 *
 *   I1  the identity comment came out of the boot stream and named the machine
 *   I3  the wallpaper and the icon sheet actually landed in the DOM as data:
 *       URIs, and the boot spent no more than four image calls (§12.5)
 *   I5  [data-os-archetype] matches the identity's archetype and the clock ticks
 *   I6  /api/mark reported a first paint for every generation the kernel mounted
 *   §12.1 boot paint / desktop interactive / app / page, measured
 *
 * Numbers come from the server's own telemetry lines (never re-derived) plus
 * the kernel's marks; the DOM checks are this runner's own.
 *
 *   node scripts/integrate.mjs --engines=cerebras-oss120 --budget=2
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ROOT, arg, startServer, withBrowser, bootOnce, openAppAndWait, sleep, shot, evalSafe, openFailures, failureLines,
  frameHealth, collectErrors, freePort, waitForPage, searchInPage, clickFirstLink, pageStep,
  median, usdTotal, writeReport, inspectDesktop as sharedInspectDesktop,
  photographApp, focusWindowFor, imgSlots,
} from './run.mjs';

const ENGINES = (arg('engines', 'cerebras-oss120') || '').split(',').map((s) => s.trim()).filter(Boolean);
const APPS = (arg('apps', 'browser,calculator,notes,store') || '').split(',').map((s) => s.trim()).filter(Boolean);
const BUDGET = Number(arg('budget', '3'));
const QUERY = arg('query', 'best pizza in town');
/**
 * Shots go in a run-scoped directory, because they used to go straight into
 * `reviews/shots-v01/<engine>/` under fixed filenames: a later run overwrote
 * INTEGRATE-1's pictures in place while its report went on referencing them
 * (README flags the same hazard for the bake-off's shots). `--shots=` names the
 * run; the default is dated.
 */
const SHOTS = resolve(ROOT, 'reviews', 'shots-' + (arg('shots', '') || 'integrate-' + new Date().toISOString().slice(0, 10)));
const OUT = arg('out', resolve(SHOTS, 'integrate.json'));

/**
 * The live desktop, from `scripts/run.mjs` — the ONE copy.
 *
 * It used to be a second copy of the same idea here, and that copy still read
 * the wallpaper off the host element's own `background-image` after KERNEL-4
 * moved the picture onto a kernel-owned child layer. BAKEOFF-3 caught exactly
 * that drift in the bake-off's copy and fixed it there; this file kept the bug,
 * which would have reported "wallpaper: none" on the verification boot for the
 * second time. Two copies of an instrument is one copy too many (HANDOFF-4).
 */
const inspectDesktop = sharedInspectDesktop;

/** What this runner adds to the shared reading: whether the desktop scrolls. */
const inspectExtras = (page) =>
  evalSafe(
    page,
    () => ({ scrollY: document.documentElement.scrollHeight - document.documentElement.clientHeight }),
    { scrollY: 0 },
    8_000
  );

/**
 * SPEC §12.3 wants a clock that ticks. A clock showing seconds proves it in
 * three; one showing only hours and minutes can need a full minute, so the
 * window depends on what the model drew — a 40 s window reported a perfectly
 * good minute-resolution clock as dead.
 */
const clockTicks = async (page) => {
  const read = () =>
    evalSafe(page, () => (document.querySelector('[data-os-clock]')?.textContent || '').trim(), '', 8000);
  const a = await read();
  const seconds = /\d{1,2}:\d{2}:\d{2}/.test(a);
  const budget = seconds ? 6_000 : 66_000;
  const t = Date.now();
  while (Date.now() - t < budget) {
    await sleep(1000);
    const b = await read();
    if (b && b !== a) return { ticked: true, resolution: seconds ? 'seconds' : 'minutes', from: a, to: b, ms: Date.now() - t };
  }
  return { ticked: false, resolution: seconds ? 'seconds' : 'minutes', from: a, to: await read(), ms: Date.now() - t };
};

async function runEngine(ctx, base, engine, logs) {
  const dir = resolve(SHOTS, engine);
  mkdirSync(dir, { recursive: true });
  const page = await ctx.newPage();
  const errs = collectErrors(page);
  const mark = (from) => logs.filter((l) => l.kind === 'mark' && l.ts >= from);
  const t0 = Date.now();

  const boot = await bootOnce(page, base, engine, { onPaint: () => shot(page, dir, '01-boot') });
  await shot(page, dir, '02-desktop');
  if (boot.failed) {
    const mine0 = logs.filter((l) => l.ts >= new Date(t0 - 2000).toISOString());
    await page.close();
    return {
      engine,
      failed: boot.failed,
      screen: boot.screen,
      bootPaintMs: boot.bootPaintMs,
      gens: mine0.map((l) => ({ kind: l.kind, err: l.error || null, total: l.total_ms })),
      usd: usdTotal(mine0),
    };
  }
  const desk = { ...(await inspectDesktop(page)), ...(await inspectExtras(page)) };
  // fal is not the 0.8 s SPEC §12.5 assumed: the pictures land well after the
  // desktop is on screen, so when they land is its own number.
  const imgWatch = (async () => {
    const t = Date.now();
    for (let i = 0; i < 120; i++) {
      const n = await evalSafe(page, () => document.querySelectorAll('[data-os-img-filled]').length, 0, 5000);
      if (n > 0) return { firstFilledMs: Date.now() - t, n };
      await sleep(500);
    }
    return { firstFilledMs: null, n: 0 };
  })();
  const tick = await clockTicks(page);
  await shot(page, dir, '03-desktop-settled');

  const apps = [];
  for (const id of APPS) {
    const t = Date.now();
    const r = await openAppAndWait(page, id, 90_000, { engine });
    const h = await frameHealth(r.frame);
    // HANDOFF-4 #3 + #8: focus the window first, photograph it, then
    // photograph it again 4 s later — the only window in which a fal picture
    // can land — and report the slots it filled in each shot.
    const shots = await photographApp(page, dir, `04-app-${id}`, r);
    apps.push({ id, ms: r.ms, chars: h.chars, nodes: h.nodes, blank: h.blank, unstyled: h.unstyled, ...shots });
    if (Date.now() - t > 120_000) break;
  }

  // the browser window: its own home, a search, a result click, two URLs
  const pages = [];
  const browserFrameEl = await page
    .locator('[data-os-window-id] iframe[data-os-frame="app"]')
    .first()
    .elementHandle()
    .catch(() => null);
  const browserFrame = browserFrameEl ? await browserFrameEl.contentFrame() : null;
  let browserFocusSeen = null;
  if (browserFrame) {
    // every page shot below is of the browser's own window, so it is focused
    // once here and again before each shot (a later app open steals focus)
    const focusBrowser = async () => {
      const f = await focusWindowFor(page, browserFrameEl);
      if (f) browserFocusSeen = { id: f.id, focused: f.focused === 'true', top: !!f.top };
      return f;
    };
    await focusBrowser();
    const home = await waitForPage(browserFrame, { ms: 90_000 });
    if (home.frame) {
      const h = await frameHealth(home.frame);
      pages.push({ what: 'home (google-shaped)', ms: home.ms, chars: h.chars, blank: h.blank });
      await focusBrowser();
        await shot(page, dir, '05-page-home');
      let how = '?';
      const res = await pageStep(
        browserFrame,
        async () => {
          how = await searchInPage(browserFrame, home.frame, QUERY, 'google.com/search?q=' + encodeURIComponent(QUERY));
        },
        { ms: 90_000 }
      );
      if (res.frame) {
        const rh = await frameHealth(res.frame);
        pages.push({ what: `search results (${how})`, ms: res.ms, chars: rh.chars, blank: rh.blank });
        await focusBrowser();
        await shot(page, dir, '06-page-results');
        let clicked = null;
        const hit = await pageStep(
          browserFrame,
          async () => {
            clicked = await clickFirstLink(res.frame);
          },
          { ms: 90_000 }
        );
        if (hit.frame) {
          const hh = await frameHealth(hit.frame);
          pages.push({ what: `clicked result ${clicked || '(none)'}`, ms: hit.ms, chars: hh.chars, blank: hh.blank });
          await focusBrowser();
        await shot(page, dir, '07-page-result');
        }
      }
      for (const url of ['reddit.com/r/cats', 'en.wikipedia.org/wiki/Moon']) {
        const r = await pageStep(browserFrame, () => evalSafe(browserFrame, (u) => window.os.navigate(u), null, 15_000, url), { ms: 90_000 });
        const ph = r.frame ? await frameHealth(r.frame) : { chars: 0, blank: true };
        pages.push({ what: url, ms: r.ms, chars: ph.chars, blank: ph.blank });
        await focusBrowser();
        await shot(page, dir, '08-page-' + url.replace(/[^a-z0-9]+/gi, '-'));
      }
    }
  }

  const imgLanded = await imgWatch;
  const deskLate = { ...(await inspectDesktop(page)), ...(await inspectExtras(page)) };
  await shot(page, dir, '09-desktop-images');
  const mine = logs.filter((l) => l.ts >= new Date(t0 - 2000).toISOString());
  const imgs = mine.filter((l) => l.kind === 'img');
  /**
   * BAKEOFF-4 #1: read at the END of the boot, so the peak covers the apps and
   * the pages too — `net.peak` is the most requests the kernel held open at
   * once across this whole session, which is the number the blank-window bug
   * turns on (Chrome gives an origin six HTTP/1.1 sockets).
   */
  const net = await evalSafe(page, () => (window.__osNet ? window.__osNet() : null), null);
  const out = {
    engine,
    identity: boot.identity,
    net,
    netAfterBoot: boot.net,
    bootPaintMs: boot.bootPaintMs,
    desktopInteractiveMs: await evalSafe(page, () => Number(document.documentElement.getAttribute('data-os-desktop-ms')) || null, null),
    desktopRevealedMs: boot.desktopMs,
    contract: boot.contract,
    desktop: desk,
    desktopAfterImages: deskLate,
    imagesLanded: imgLanded,
    clock: tick,
    apps,
    pages,
    // HANDOFF-4 #8: which window each page shot was actually of
    browserWindowFocused: browserFocusSeen,
    images: {
      calls: imgs.length,
      usd: imgs.reduce((s, l) => s + (l.usd || 0), 0),
      kinds: imgs.map((l) => l.img_kind + (l.blocked ? ':' + l.blocked : '')),
    },
    marks: mark(new Date(t0 - 2000).toISOString()).map((m) => ({
      gen: m.gen_id,
      fp: m.first_paint_ms,
      // H3: ink is the honest first paint — the first element with a box, as
      // opposed to the first chunk written (HANDOFF-4's headline)
      ink: m.ink_ms,
      ia: m.interactive_ms,
      done: m.complete_ms,
      matched: m.matched,
    })),
    gens: mine.filter((l) => ['boot', 'desktop', 'app', 'page', 'identity'].includes(l.kind)).map((l) => ({
      kind: l.kind, ttfb: l.ttfb_ms, total: l.total_ms, tps: l.tok_per_s, tout: l.tokens_out,
      usd: l.usd, contract: l.contract_ok, err: l.error || null, truncated: !!l.truncated, fb: !!l.identity_fallback,
      // H1/H2: which lane answered, and what the other one cost
      engine: l.engine, hedged: !!l.hedged, winner: l.winner ?? null, loser: l.loser ?? null,
      loser_aborted_ms: l.loser_aborted_ms ?? null, failed_over: !!l.failed_over,
      ink_ms: l.ink_ms ?? null,
      // I6: proof the kernel's marks landed ON the line, early ones included
      first_paint_ms: l.first_paint_ms ?? null, interactive_ms: l.interactive_ms ?? null,
    })),
    errors: errs.since(t0).slice(0, 12),
    cspBlocks: errs.blocksSince(t0).length,
    usd: usdTotal(mine),
  };
  await page.close();
  return out;
}

const main = async () => {
  const port = await freePort();
  const srv = await startServer({ port, env: { DEFAULT_ENGINE: ENGINES[0], NAMES_RING_FILE: resolve(ROOT, 'data/names-ring.json') } });
  const results = [];
  try {
    await withBrowser(async (ctx) => {
      for (const engine of ENGINES) {
        process.stdout.write(`\n=== ${engine} ===\n`);
        const r = await runEngine(ctx, srv.base, engine, srv.logs);
        results.push(r);
        process.stdout.write(
          r.failed
            ? `NO BOOT (${r.failed}): ${String(r.screen || '').replace(/\s+/g, ' ').slice(0, 160)} · $${r.usd.toFixed(4)}\n`
            : `boot paint ${r.bootPaintMs}ms · interactive ${r.desktopInteractiveMs}ms · revealed ${r.desktopRevealedMs}ms · ` +
                `imgs ${r.images.calls} ($${r.images.usd.toFixed(3)}) · ` +
                `app pics ${r.apps.reduce((a, x) => a + (x.imgFilledLate || 0), 0)}/${r.apps.reduce((a, x) => a + (x.imgSlots || 0), 0)} ` +
                `(at settle ${r.apps.reduce((a, x) => a + (x.imgFilled || 0), 0)}) · ` +
                `focused ${r.apps.filter((x) => x.focused).length}/${r.apps.length} · ` +
                `conns peak ${r.net?.peak ?? '?'} (boot ${r.netAfterBoot?.peak ?? '?'}) · $${r.usd.toFixed(4)}\n`
        );
        if (usdTotal(srv.logs) > BUDGET) {
          process.stdout.write('budget reached\n');
          break;
        }
      }
    });
  } finally {
    srv.stop();
  }
  mkdirSync(resolve(ROOT, 'reviews'), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      { at: new Date().toISOString(), results, usd: usdTotal(srv.logs), failures: openFailures },
      null,
      2
    )
  );
  process.stdout.write(`\nwrote ${OUT} · total $${usdTotal(srv.logs).toFixed(4)}\n`);
  if (openFailures.length) {
    // T3: the same rule as the judged runs — a lost window fails the run
    process.stdout.write(failureLines());
    process.exitCode = 1;
  }
};

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + '\n');
  process.exit(1);
});
