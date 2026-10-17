/**
 * scripts/map-probe.mjs — where does the map picture go?
 *
 * The stress run bought a `map` image on every boot that opened `maps`
 * (633 KB, 8.1 s, no refusal in the telemetry) and the map surface on screen
 * stayed a flat paper colour. Money spent on a picture nobody sees is worse
 * than no picture, so this probe answers one question: does the data: URI reach
 * the slot element, and if it does, what is in front of it?
 *
 *   node scripts/map-probe.mjs --engine=auto --shots=map-probe
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, arg, startServer, withBrowser, bootOnce, sleep, shot, evalSafe, freePort } from './run.mjs';

const ENGINE = arg('engine', 'auto');
const DIR = resolve(ROOT, 'reviews', 'shots-' + (arg('shots', 'map-probe')));

const read = (frame) =>
  evalSafe(
    frame,
    () => {
      const el = document.querySelector('[data-os-img="map"]');
      if (!el) return { slot: null, note: 'the document declared no [data-os-img="map"]' };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      // what a visitor's eye meets at the middle of the map surface
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const stack = (document.elementsFromPoint ? document.elementsFromPoint(cx, cy) : []).slice(0, 6).map((n) => {
        const s = getComputedStyle(n);
        return {
          tag: n.tagName.toLowerCase(),
          isSlot: n === el,
          bg: (s.backgroundColor || '').slice(0, 30),
          opaque: !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor || ''),
          bgImage: /url\("data:image/.test(s.backgroundImage || '') ? 'data-uri' : (s.backgroundImage || 'none').slice(0, 40),
          z: s.zIndex,
          pos: s.position,
        };
      });
      return {
        slot: el.getAttribute('data-os-img-slot'),
        prompt: el.getAttribute('data-os-prompt'),
        filled: el.getAttribute('data-os-img-filled'),
        dataUri: /url\("data:image/.test(cs.backgroundImage || ''),
        bgImage: (cs.backgroundImage || 'none').slice(0, 60),
        bgSize: cs.backgroundSize,
        ownBg: cs.backgroundColor,
        box: { w: Math.round(r.width), h: Math.round(r.height) },
        children: el.children.length,
        stack,
      };
    },
    null,
    10_000
  );

const main = async () => {
  mkdirSync(DIR, { recursive: true });
  const port = await freePort();
  const srv = await startServer({
    port,
    env: { DEFAULT_ENGINE: 'cerebras-oss120', HEDGE_AFTER_MS_BOOT: '1200', HEDGE_AFTER_MS: '900', GEN_PER_IP_PER_HOUR: '100000' },
  });
  const out = {};
  try {
    await withBrowser(async (ctx) => {
      const page = await ctx.newPage();
      const boot = await bootOnce(page, srv.base, ENGINE);
      out.identity = boot.identity?.name || boot.failed || null;
      // one app, no load: the picture has the lane to itself
      const l = page.locator('[data-os-app="maps"]').first();
      await l.dispatchEvent('mousedown').catch(() => {});
      await l.dispatchEvent('click').catch(() => {});
      const frames = page.locator('[data-os-window-id] iframe[data-os-frame="app"]');
      let frame = null;
      for (let i = 0; i < 60 && !frame; i++) {
        if (await frames.count()) {
          const h = await frames.first().elementHandle();
          frame = await h.contentFrame().catch(() => null);
        }
        if (!frame) await sleep(500);
      }
      out.reads = [];
      for (const at of [2, 6, 10, 16, 24, 32]) {
        while (Date.now() - 0 < 0) break;
        await sleep(at === 2 ? 2000 : 4000 + (at > 16 ? 4000 : 0));
        out.reads.push({ atSeconds: at, ...(await read(frame)) });
        await shot(page, DIR, 'map-' + at + 's');
      }
      out.imgs = srv.logs.filter((x) => x.kind === 'img').map((x) => ({ k: x.img_kind, ms: x.total_ms, bytes: x.bytes, blocked: x.blocked || null, refusal: x.refusal || null }));
      await page.close();
    });
  } finally {
    srv.stop();
  }
  writeFileSync(resolve(DIR, 'map-probe.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2).slice(0, 4000));
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
