/**
 * scripts/desk-probe.mjs — is the desktop a machine a visitor can use?
 *
 * HANDOFF-6 measured the app-open path (64/64 painted) and asserted two things
 * its own raw rows do not carry:
 *
 *  - "plates on 5 of 8 stressed boots". `shots-stress-1` (six of those eight)
 *    inspected the desktop at `data-os-ready`, BEFORE the icon sheet can land,
 *    and recorded `0/16` for every boot — an absence of measurement, not an
 *    absence of plates. Only the two `shots-stress-2` boots waited.
 *  - nothing at all about the desktop being REACHABLE. The `auto` verification
 *    boot of `shots-final-v04` carries `contract: miss`, `injected: 8` and
 *    `launchersOffscreen: 16` — sixteen launchers in the document and not one
 *    of them on screen. A visitor of that boot sees a wallpaper and an empty
 *    bar. No open path can be stressed on a desktop with nothing to click.
 *
 * So this probe buys boots and nothing else: boot, desktop, the two pictures,
 * a wait for the plates, one inspection, one shot. No app is opened, which is
 * what makes it ~$0.02 a boot instead of ~$0.05.
 *
 * Recorded per boot: whether the identity is the kernel's `UNNAMED/xxxx`
 * fallback, the desktop contract, launchers vs launchers off screen, icon slots
 * filled (and how long the plates took), the wallpaper, and the clock.
 *
 *   node scripts/desk-probe.mjs --boots=6 --engine=cerebras-oss120 --shots=desk-probe
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ROOT, arg, startServer, withBrowser, bootOnce, sleep, shot, evalSafe, freePort,
  collectErrors, usdTotal, inspectDesktop,
} from './run.mjs';

const BOOTS = Number(arg('boots', '6'));
const ENGINE = arg('engine', 'cerebras-oss120');
const PLATE_WAIT_MS = Number(arg('platewait', '25000'));
const SHOTS = resolve(ROOT, 'reviews', 'shots-' + (arg('shots', '') || 'desk-probe'));
const OUT = resolve(SHOTS, 'desk-probe.json');

/** The kernel's own identity fallback (kernel/contract.ts): no identity at all. */
const isFallbackIdentity = (id) =>
  !id || /^UNNAMED\//.test(String(id.name || '')) || String(id.tagline || '') === 'it boots.';

async function oneBoot(ctx, base, dir, logs, n) {
  const page = await ctx.newPage();
  const errs = collectErrors(page);
  const t0 = Date.now();
  const refused = [];
  page.on('response', (r) => {
    const st = r.status();
    if (st < 400) return;
    try {
      refused.push(new URL(r.url()).pathname + ' ' + st);
    } catch {}
  });
  const boot = await bootOnce(page, base, ENGINE, { onPaint: () => shot(page, dir, '01-boot') });
  if (boot.failed) {
    await page.close();
    return { boot: n, failed: boot.failed, errors: errs.since(t0).slice(0, 6) };
  }
  const atReady = await inspectDesktop(page);
  // the sheet lands seconds after the document (IMG-LATENCY-2), so the ICON
  // RULING can only be read on a frame that has it
  const t = Date.now();
  let platesMs = null;
  while (Date.now() - t < PLATE_WAIT_MS) {
    const k = await evalSafe(page, () => document.querySelectorAll('[data-os-icon][data-os-img-filled]').length, 0, 5000);
    if (k > 0) { platesMs = Date.now() - t; break; }
    await sleep(500);
  }
  const desk = await inspectDesktop(page);
  await shot(page, dir, '02-desktop-plates');
  // the glyph the ICON RULING protects: is it still visible on top of the plate?
  const glyphs = await evalSafe(
    page,
    () => {
      let withText = 0, transparent = 0, hidden = 0, total = 0;
      for (const el of document.querySelectorAll('[data-os-icon]')) {
        total += 1;
        const cs = getComputedStyle(el);
        const txt = (el.textContent || '').trim();
        if (txt) withText += 1;
        if (/transparent|rgba\(0, 0, 0, 0\)/.test(cs.color)) transparent += 1;
        if (cs.visibility === 'hidden' || cs.opacity === '0' || cs.display === 'none') hidden += 1;
      }
      return { total, withText, transparent, hidden };
    },
    null
  );
  const contract = await evalSafe(page, () => document.documentElement.getAttribute('data-os-contract'), null);
  const offAttr = await evalSafe(page, () => document.documentElement.getAttribute('data-os-launchers-offscreen'), null);
  /**
   * WHERE the launchers went. `data-os-launchers-offscreen` is a count, and a
   * count does not say whether the model wrote a slide-out dock, a second row
   * under the bottom edge, or a container it positioned past the viewport. So
   * on any boot that loses one, record the launcher's own box and the ancestor
   * chain that put it there — the first ancestor whose box is already outside
   * the screen is the element the next prompt iteration has to talk about.
   */
  const geometry = await evalSafe(
    page,
    () => {
      const w = innerWidth, h = innerHeight;
      const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
      const out = (b) => b.y + b.h > h + 1 || b.x + b.w > w + 1 || b.y < -1 || b.x < -1;
      const rows = [];
      for (const el of document.querySelectorAll('[data-os-app]')) {
        const b = box(el);
        if (!out(b)) continue;
        const chain = [];
        let p = el.parentElement;
        while (p && p !== document.documentElement && chain.length < 6) {
          const pb = box(p);
          const cs = getComputedStyle(p);
          chain.push({
            tag: p.tagName.toLowerCase(),
            hooks: [...p.attributes].map((a) => a.name).filter((nm) => nm.startsWith('data-os-')).join(' '),
            box: pb,
            outside: out(pb),
            position: cs.position, overflow: cs.overflow, display: cs.display,
            transform: cs.transform === 'none' ? '' : cs.transform,
            left: cs.left, top: cs.top, bottom: cs.bottom, height: cs.height,
            opacity: cs.opacity, visibility: cs.visibility,
          });
          p = p.parentElement;
        }
        rows.push({ id: el.getAttribute('data-os-app'), box: b, viewport: { w, h }, chain });
      }
      return { viewport: { w, h }, offscreen: rows.slice(0, 4), scrollH: document.documentElement.scrollHeight, bodyH: document.body ? document.body.scrollHeight : null };
    },
    null
  );
  await page.close();
  return {
    boot: n,
    identity: boot.identity
      ? { name: boot.identity.name, tagline: boot.identity.tagline, era: boot.identity.era, archetype: boot.identity.archetype }
      : null,
    identityFallback: isFallbackIdentity(boot.identity),
    bootPaintMs: boot.bootPaintMs ?? null,
    contract,
    launchers: desk?.launchers ?? null,
    launchersOffscreen: desk?.launchersOffscreen ?? (offAttr == null ? null : Number(offAttr)),
    launchersOffscreenAttr: offAttr == null ? null : Number(offAttr),
    launchersLabelled: desk?.launchersLabelled ?? null,
    injected: desk?.injected ?? null,
    icons: desk?.icons ?? null,
    iconsFilled: desk?.iconsFilled ?? null,
    iconsFilledAtReady: atReady?.iconsFilled ?? null,
    platesWaitedMs: platesMs,
    wallpaper: desk?.wallpaper ?? null,
    wallpaperOn: desk?.wallpaperOn ?? null,
    clock: desk?.clock ?? null,
    glyphs,
    geometry: geometry && geometry.offscreen.length ? geometry : null,
    httpRefused: refused.slice(0, 10),
    errors: errs.since(t0).slice(0, 6),
    cspBlocks: errs.blocksSince(t0).length,
  };
}

const main = async () => {
  mkdirSync(SHOTS, { recursive: true });
  const port = await freePort();
  const srv = await startServer({
    port,
    env: {
      DEFAULT_ENGINE: 'cerebras-oss120',
      HEDGE_AFTER_MS_BOOT: '1200',
      HEDGE_AFTER_MS: '900',
      GEN_PER_IP_PER_HOUR: '100000',
      MARK_PER_IP_PER_HOUR: '100000',
      ...(arg('images', 'on') === 'off' ? { FAL_KEY: '' } : {}),
      ...(ENGINE === 'mock' ? { ALLOW_MOCK: '1', DEFAULT_ENGINE: 'mock' } : {}),
    },
  });
  const boots = [];
  try {
    await withBrowser(async (ctx) => {
      for (let i = 1; i <= BOOTS; i++) {
        const from = srv.logs.length;
        const r = await oneBoot(ctx, srv.base, resolve(SHOTS, 'boot-' + i), srv.logs, i);
        const mine = srv.logs.slice(from);
        r.usd = Math.round(usdTotal(mine) * 10000) / 10000;
        r.engineUsed = [...new Set(mine.map((l) => l.engine).filter(Boolean))].join(',');
        boots.push(r);
        console.log(
          `boot ${i}: ${r.identity?.name || r.failed || '?'} · ${r.identity?.archetype} · contract ${r.contract} · launchers ${r.launchers} (${r.launchersOffscreen} off screen, ${r.injected} injected) · plates ${r.iconsFilled}/${r.icons} after ${r.platesWaitedMs}ms · glyphs ${r.glyphs?.withText}/${r.glyphs?.total} · $${r.usd}`
        );
        writeFileSync(OUT, JSON.stringify({ engine: ENGINE, boots }, null, 2));
      }
    });
  } finally {
    srv.stop();
  }
  const usable = boots.filter((b) => !b.failed && b.launchers && b.launchersOffscreen < b.launchers).length;
  const plated = boots.filter((b) => b.iconsFilled > 0).length;
  console.log(
    `\nTOTAL boots ${boots.length} · a launcher on screen ${usable}/${boots.length} · plates landed ${plated}/${boots.length} · identity fallbacks ${boots.filter((b) => b.identityFallback).length} · contract miss ${boots.filter((b) => b.contract === 'miss').length} · $${Math.round(boots.reduce((s, b) => s + (b.usd || 0), 0) * 10000) / 10000}`
  );
  writeFileSync(OUT, JSON.stringify({ engine: ENGINE, boots }, null, 2));
  console.log('wrote ' + OUT);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
