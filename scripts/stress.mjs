/**
 * scripts/stress.mjs — the impatient visitor.
 *
 * HANDOFF-5 #1 was one boot that lost four of four app opens; KERNEL-6 found
 * the cause (the delegation skipped `[data-os-dock]`, an attribute the MODEL
 * writes) and proved the fix on mock only. This runner is the real-engine half:
 * many boots, eight app opens each, fired the way somebody who has just seen a
 * new machine actually clicks — a press on one launcher and a click on another,
 * double clicks, an open while the last window is still streaming, an open
 * while a picture is landing.
 *
 * Differences from `scripts/run.mjs`'s `openAppAndWait`, on purpose:
 *
 *  - **Real, hit-tested mouse events** at the launcher's own coordinates, not
 *    `dispatchEvent`. KERNEL-6's remaining issue 2: the whole e2e suite
 *    dispatches clicks the kernel might refuse, so a delegation bug is
 *    invisible to it. A dispatched click cannot reproduce the bug that cost
 *    four windows. When an already-open window covers every pixel of a
 *    launcher the runner says so (`mode: "dispatched"`) instead of pretending.
 *  - **No settle between opens.** The eight opens are fired on a ~400 ms
 *    cadence whatever the windows are doing; painting is measured afterwards by
 *    polling every window's frame.
 *  - **Per open**: which window (or none), painted yes/no, ms from the click to
 *    the frame's first ink, chars, and — on any failure — the kernel's own
 *    trace ring (`window.__osTrace()`) for that window.
 *
 *   node scripts/stress.mjs --boots=6 --engine=auto --shots=stress-1
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ROOT, arg, startServer, withBrowser, bootOnce, sleep, shot, evalSafe, freePort,
  collectErrors, median, usdTotal, inspectDesktop, viewport,
  inspectWindows, probeWindowChrome, inspectTasks, inspectTiles, visitUrl, waitForPage, addressBar,
  inspectClocks, visibleWindows, reachReading,
} from './run.mjs';

const BOOTS = Number(arg('boots', '6'));
const ENGINE = arg('engine', 'auto');
const OPENS = Number(arg('opens', '8'));
const SHOTS = resolve(ROOT, 'reviews', 'shots-' + (arg('shots', '') || 'stress-' + new Date().toISOString().slice(0, 10)));
const OUT = arg('out', resolve(SHOTS, 'stress.json'));
/** ms between one open and the next — an impatient visitor, not a robot flood */
const GAP = Number(arg('gap', '420'));
/** how long a window is given to ink before it is called blank */
const INK_CEILING = Number(arg('inkceiling', '30000'));
/**
 * v0.5 — the browser walk, after the opens. SEAM T2's whole point is a page
 * that asks for a SET of pictures (a catalogue's posters, a shop's products),
 * and the only way to know whether the sheets are asked for and landed is to
 * walk the browser to pages that would want them. `--urls=off` skips it.
 */
const URLS = (arg('urls', 'netflix.com,youtube.com,brasswick-supply.shop,reddit.com/r/cats') || '')
  .split(',')
  .map((u) => u.trim())
  .filter((u) => u && u !== 'off');

/** The launchers, in document order, with the boxes needed to click them for real. */
const launchers = (page) =>
  evalSafe(
    page,
    () =>
      [...document.querySelectorAll('[data-os-app]')].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.getAttribute('data-os-app') || '',
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
          inDock: !!el.closest('[data-os-dock],[data-os-taskbar]'),
        };
      }),
    [],
    10_000
  );

/**
 * A point inside this launcher where the launcher itself is what a real click
 * would land on. A cascading window can cover part or all of it; scanning a
 * 5×5 lattice finds the visible corner if there is one, and says so if not.
 */
const hitPoint = (page, l) =>
  evalSafe(
    page,
    (b) => {
      const el = document.querySelector('[data-os-app="' + (window.CSS ? CSS.escape(b.id) : b.id) + '"]');
      if (!el) return null;
      for (let iy = 1; iy <= 7; iy++) {
        for (let ix = 1; ix <= 7; ix++) {
          const x = b.x + (b.w * ix) / 8;
          const y = b.y + (b.h * iy) / 8;
          if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;
          const top = document.elementFromPoint(x, y);
          if (top && (top === el || el.contains(top))) return { x: Math.round(x), y: Math.round(y), real: true };
        }
      }
      const cx = Math.min(innerWidth - 2, Math.max(2, b.x + b.w / 2));
      const cy = Math.min(innerHeight - 2, Math.max(2, b.y + b.h / 2));
      // WHAT is covering it. A window means the cascade ate the launcher (and a
      // shove will free it); the kernel's own HUD dock means something else
      // entirely; and a bottom dock that is not `[data-os-taskbar]` sits under
      // the windows layer by the stacking repair of SPEC §12.9, which is a
      // launcher a visitor cannot click at all.
      const top = document.elementFromPoint(cx, cy);
      const win = top && top.closest('[data-os-window-id]');
      const desc = !top
        ? 'nothing'
        : win
          ? 'window ' + win.getAttribute('data-os-window-id')
          : top.closest('[data-os-hud],[data-os-dock-hint]')
            ? 'kernel-hud'
            : top.tagName.toLowerCase() +
              (top.closest('[data-os-taskbar]') ? ' [taskbar]' : '') +
              (top.closest('[data-os-windows]') ? ' [windows-layer]' : '');
      return { x: Math.round(cx), y: Math.round(cy), real: false, coveredBy: desc };
    },
    null,
    10_000,
    l
  );

/**
 * A cascading window sits on the launcher grid within seconds of the first
 * open, and the mock rehearsal proved what that does to a coordinate click:
 * seven of eight opens landed on the window instead of the launcher. A person
 * in that position drags the window aside, so the runner does too — a real
 * mouse drag on the model's own `[data-os-drag]` handle, which is also the one
 * kernel affordance nothing else in this pass exercises.
 */
async function shoveTopWindow(page, l) {
  const w = await evalSafe(
    page,
    (b) => {
      const x = Math.min(innerWidth - 2, Math.max(2, b.x + b.w / 2));
      const y = Math.min(innerHeight - 2, Math.max(2, b.y + b.h / 2));
      const top = document.elementFromPoint(x, y)?.closest('[data-os-window-id]');
      if (!top) return null;
      const handle = top.querySelector('[data-os-drag]') || top;
      const r = handle.getBoundingClientRect();
      return {
        id: top.getAttribute('data-os-window-id'),
        from: { x: Math.round(r.x + Math.min(r.width / 2, 80)), y: Math.round(r.y + r.height / 2) },
        vw: innerWidth,
        vh: innerHeight,
      };
    },
    null,
    8000,
    l
  );
  if (!w || w.from.x < 1 || w.from.y < 1) return null;
  // away from the launcher: to the right and down when it is top-left, and the
  // other way when it is not. Clamped inside the viewport; the kernel clamps too.
  const dx = l.x < w.vw / 2 ? 260 : -260;
  const dy = l.y < w.vh / 2 ? 170 : -170;
  const to = { x: Math.min(w.vw - 12, Math.max(12, w.from.x + dx)), y: Math.min(w.vh - 12, Math.max(12, w.from.y + dy)) };
  await page.mouse.move(w.from.x, w.from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await sleep(120);
  return w.id;
}

/**
 * This launcher's box as it is RIGHT NOW. The desktop-time snapshot goes stale:
 * the wallpaper and the icon sheet land after it, a dock with hover
 * magnification moves its icons under the pointer, and the fit guard can grow a
 * bar. The mock rehearsal lost one open to exactly that — a coordinate click
 * that landed on no launcher at all, with not one line in the kernel's trace.
 */
const freshBox = (page, id) =>
  evalSafe(
    page,
    (appId) => {
      const el = document.querySelector('[data-os-app="' + (window.CSS ? CSS.escape(appId) : appId) + '"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        id: appId,
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        inDock: !!el.closest('[data-os-dock],[data-os-taskbar]'),
      };
    },
    null,
    8000,
    id
  );

/**
 * The runner's own witness, beside the kernel's trace: what element did the
 * pointer ACTUALLY land on? A lost open has two very different causes and they
 * look identical from outside — the kernel ignored a click on a launcher (the
 * KERNEL-6 bug class), or the click never landed on a launcher at all because
 * a window appeared under the cursor between the measurement and the press.
 * A capture-phase listener in the page, installed before the kernel loads,
 * distinguishes them. It reads the DOM and writes nothing to it.
 */
const CLICK_PROBE = () => {
  window.__stressPointer = [];
  const label = (el) => {
    if (!el || !el.tagName) return 'none';
    const app = el.closest && el.closest('[data-os-app]');
    const win = el.closest && el.closest('[data-os-window-id]');
    return (
      el.tagName.toLowerCase() +
      (app ? ' app=' + app.getAttribute('data-os-app') : '') +
      (win ? ' in-window=' + win.getAttribute('data-os-window-id') : '') +
      (el.closest && el.closest('[data-os-hud],[data-os-dock-hint]') ? ' kernel-hud' : '') +
      (el.closest && el.closest('[data-os-taskbar]') ? ' in-taskbar' : '') +
      (el.closest && el.closest('[data-os-desktop]') ? ' in-desktop' : '')
    );
  };
  for (const type of ['mousedown', 'click']) {
    document.addEventListener(
      type,
      (e) => {
        try {
          window.__stressPointer.push(type + ' @' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + ' -> ' + label(e.target));
          if (window.__stressPointer.length > 200) window.__stressPointer.shift();
        } catch {}
      },
      true
    );
  }
};

const pointerLog = (page) => evalSafe(page, () => window.__stressPointer || [], [], 8000);

const windowIds = (page) =>
  evalSafe(page, () => [...document.querySelectorAll('[data-os-window-id]')].map((w) => w.getAttribute('data-os-window-id')), [], 10_000);

/** Per open window: has its frame inked, and how much text is in it. */
async function windowInk(page, id) {
  const el = await page
    .locator(`[data-os-window-id="${id}"] iframe[data-os-frame="app"]`)
    .first()
    .elementHandle({ timeout: 1200 })
    .catch(() => null);
  if (!el) return { frame: false, inked: false, chars: 0, nodes: 0 };
  const f = await el.contentFrame().catch(() => null);
  if (!f) return { frame: false, inked: false, chars: 0, nodes: 0 };
  return evalSafe(
    f,
    () => {
      if (!document.body) return { frame: true, inked: false, chars: 0, nodes: 0 };
      let boxes = 0;
      for (const n of Array.from(document.body.querySelectorAll('*'))) {
        const t = n.tagName;
        if (t === 'SCRIPT' || t === 'STYLE' || t === 'LINK' || t === 'META' || t === 'TITLE') continue;
        const r = n.getBoundingClientRect();
        if (r.width > 2 && r.height > 2) boxes++;
      }
      return {
        frame: true,
        inked: boxes > 0 || (document.body.innerText || '').trim().length > 0,
        chars: (document.body.innerText || '').trim().length,
        nodes: document.body.querySelectorAll('*').length,
      };
    },
    { frame: true, inked: false, chars: 0, nodes: 0 },
    6000
  );
}

/** The app frame of one open window, by the kernel's window id. */
async function frameOf(page, id) {
  const el = await page
    .locator(`[data-os-window-id="${id}"] iframe[data-os-frame="app"]`)
    .first()
    .elementHandle({ timeout: 2000 })
    .catch(() => null);
  if (!el) return null;
  return el.contentFrame().catch(() => null);
}

/**
 * SEAM T2, live — walk the browser through pages that would want a SET of
 * pictures and read what happened, per URL:
 *
 *   asked   — the `/api/img` calls the server logged for this step, by kind and
 *             theme, with ms and bytes. A sheet is ONE call for sixteen tiles;
 *             sixteen calls would be the defect T2 exists to prevent.
 *   tiles   — the elements the document declared, per theme, and how many of
 *             them are showing a picture.
 *
 * `reddit.com/r/cats` and an invented shop domain are in the list on purpose:
 * one is a page whose content is other people's pictures, the other has no real
 * counterpart at all, so neither can be answered from a memorised layout.
 */
async function browserWalk(page, dir, browserId, logs, urls) {
  const frame = await frameOf(page, browserId);
  if (!frame) return { failed: 'no-browser-frame', steps: [] };
  const home = await waitForPage(frame, { ms: 90_000 });
  const steps = [];
  if (!home.frame) return { failed: 'no-home', steps };
  for (const url of urls) {
    const from = logs.length;
    const at = Date.now();
    const r = await visitUrl(page, frame, url, 120_000);
    // the pictures are slower than the document by a factor of four
    // (HANDOFF-6 §4), so a sheet read at settle is a sheet that has not landed
    let tiles = [];
    let waited = 0;
    for (let i = 0; i < 24; i++) {
      const f = frame.childFrames()[0];
      tiles = f ? await inspectTiles(f) : [];
      waited = Date.now() - at;
      if (tiles.length && tiles.every((g) => g.filled >= g.tiles)) break;
      if (!tiles.length && i > 6) break;
      await sleep(700);
    }
    const mine = logs.slice(from).filter((l) => l.kind === 'img');
    steps.push({
      url,
      address: await addressBar(frame),
      chars: r.chars,
      ms: r.ms,
      timedOut: r.timedOut || undefined,
      settledMs: waited,
      tiles,
      asked: mine.map((l) => ({
        kind: l.img_kind,
        theme: l.img_theme || null,
        ms: l.total_ms,
        bytes: l.bytes,
        width: l.width,
        blocked: l.blocked || null,
        refusal: l.refusal || null,
      })),
    });
    await shot(page, dir, '06-url-' + url.replace(/[^a-z0-9]+/gi, '-').slice(0, 28));
  }
  return { steps };
}

const trace = (page) => evalSafe(page, () => (window.__osTrace ? window.__osTrace() : []), [], 8000);
const net = (page) => evalSafe(page, () => (window.__osNet ? window.__osNet() : null), null, 8000);

/**
 * The ICON RULING, read off a live desktop: the model's own glyph on top of a
 * plate the sheet supplied. Per launcher slot — the glyph's text, whether it is
 * still visible (colour not transparent, opacity, visibility), and whether a
 * `data:` plate is behind it.
 */
const iconReading = (page) =>
  evalSafe(
    page,
    () =>
      [...document.querySelectorAll('[data-os-icon]')]
        .filter((el) => el.closest('[data-os-app]'))
        .map((el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return {
            app: el.closest('[data-os-app]')?.getAttribute('data-os-app') || '',
            glyph: (el.textContent || '').trim().slice(0, 8),
            plate: /url\("data:image/.test(cs.backgroundImage || ''),
            colour: cs.color,
            transparent: /rgba\(0, 0, 0, 0\)|transparent/.test(cs.color),
            visibility: cs.visibility,
            opacity: Number(cs.opacity),
            fontPx: Math.round(parseFloat(cs.fontSize) || 0),
            box: { w: Math.round(r.width), h: Math.round(r.height) },
          };
        }),
    [],
    10_000
  );

/** The point a real pointer would have to hit to close this window, right now. */
const closePoint = (page, target) =>
  evalSafe(
    page,
    (id) => {
      const w = document.querySelector('[data-os-window-id="' + (window.CSS ? CSS.escape(id) : id) + '"]');
      const c = w && w.querySelector('[data-os-close]');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      for (let iy = 1; iy <= 5; iy++)
        for (let ix = 1; ix <= 5; ix++) {
          const x = r.x + (r.width * ix) / 6;
          const y = r.y + (r.height * iy) / 6;
          if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;
          const at = document.elementFromPoint(Math.round(x), Math.round(y));
          if (at && (at === c || c.contains(at))) return { x: Math.round(x), y: Math.round(y), real: true };
        }
      return {
        x: Math.round(Math.min(innerWidth - 2, Math.max(2, r.x + r.width / 2))),
        y: Math.round(Math.min(innerHeight - 2, Math.max(2, r.y + r.height / 2))),
        real: false,
      };
    },
    null,
    8000,
    target
  );

/**
 * "Every window closeable" — proved by closing them, not by measuring them.
 *
 * A real hit-tested click on the `[data-os-close]` of the window a visitor can
 * actually see, repeated until nothing is open. On a phone this is also R1's
 * way back: closing the visible window must RESTORE one of the minimised ones,
 * so the loop should see the total fall by exactly one each time and the
 * visible count stay at one. A click that closes nothing stops the loop and is
 * reported rather than retried — a close that does not close is the finding.
 */
async function closeEveryWindow(page) {
  const steps = [];
  for (let k = 0; k < 16; k++) {
    const vw = await visibleWindows(page);
    if (!vw.total) break;
    const target = vw.top || (vw.windows.find((w) => w.visible) || {}).id || null;
    if (!target) {
      steps.push({ failed: 'nothing-visible', left: vw.total });
      break;
    }
    const p = await closePoint(page, target);
    if (!p) {
      steps.push({ target, failed: 'no-close-control', left: vw.total });
      break;
    }
    const clickIt = async (pt) => {
      if (pt.real) await page.mouse.click(pt.x, pt.y);
      else
        await page
          .locator(`[data-os-window-id="${target}"] [data-os-close]`)
          .first()
          .dispatchEvent('click')
          .catch(() => {});
      await sleep(340);
      return visibleWindows(page);
    };
    let after = await clickIt(p);
    /**
     * The first click on the close of a window that was not already focused can
     * be swallowed: pointerdown focuses it, focus runs `ensureTitleVisible` /
     * `clearTitleCollision`, the window MOVES, and mouseup lands where the
     * button no longer is. A visitor clicks again — so the runner does too,
     * after re-measuring, and records that it had to. `neededSecondClick` is a
     * finding; "the close button does not work" would have been a wrong one.
     */
    let second = false;
    if (after.total >= vw.total) {
      second = true;
      const p2 = await closePoint(page, target);
      if (p2) after = await clickIt(p2);
    }
    steps.push({
      target,
      mode: p.real ? 'real' : 'dispatched',
      before: vw.total,
      after: after.total,
      visibleAfter: after.visible,
      closed: after.total < vw.total,
      neededSecondClick: second && after.total < vw.total ? true : undefined,
      dead: after.total >= vw.total ? true : undefined,
      // a close that did not close is the one thing here that needs evidence
      at: after.total >= vw.total ? p : undefined,
      trace: after.total >= vw.total ? (await trace(page)).slice(-8) : undefined,
      pointer: after.total >= vw.total ? (await pointerLog(page)).slice(-6) : undefined,
    });
    if (after.total >= vw.total) break;
  }
  return steps;
}

async function oneBoot(ctx, base, engine, dir, logs, i) {
  mkdirSync(dir, { recursive: true });
  const startedAt = Date.now();
  const page = await ctx.newPage();
  await page.addInitScript(CLICK_PROBE);
  const errs = collectErrors(page);
  /**
   * Which of the kernel's own requests were REFUSED, by path and status. The
   * first stress run left three of six boots with no icon plates and a console
   * full of bare `429`s and one `504` with no way to tell whether the refusal
   * hit a generation (which would blank a window) or a picture (which costs the
   * boot its plates and nothing else).
   */
  const refused = [];
  page.on('response', (r) => {
    const st = r.status();
    if (st < 400) return;
    try {
      const u = new URL(r.url());
      refused.push({ path: u.pathname, status: st, at: Date.now() });
    } catch {}
  });
  const boot = await bootOnce(page, base, engine, { onPaint: () => shot(page, dir, '01-boot') });
  await shot(page, dir, '02-desktop');
  if (boot.failed) {
    const t = await trace(page);
    await page.close();
    return { boot: i, failed: boot.failed, screen: boot.screen, opens: [], trace: t.slice(-40) };
  }
  const desk = await inspectDesktop(page);
  /**
   * The plates land seconds after the desktop does (IMG-LATENCY-2: 2.4-2.9 s at
   * the median, and the lane is two wide), so a desktop photographed at
   * `data-os-ready` is a desktop with no pictures on it. The ICON RULING is an
   * eye check and needs the frame that has them: wait for the first filled icon
   * slot, then shoot.
   */
  const imgWait = Date.now();
  for (let i = 0; i < 30; i++) {
    const n = await evalSafe(page, () => document.querySelectorAll('[data-os-icon][data-os-img-filled]').length, 0, 5000);
    if (n > 0) break;
    await sleep(500);
  }
  const deskWithPlates = await inspectDesktop(page);
  const platesMs = Date.now() - imgWait;
  await shot(page, dir, '02b-desktop-plates');
  const ls = await launchers(page);
  const byId = new Map();
  for (const l of ls) if (!byId.has(l.id)) byId.set(l.id, l);
  /**
   * Eight apps, `photos` and `maps` always in (HANDOFF-5 #5: the four apps the
   * protocol used to open declare zero picture slots, so "no pictures" has
   * never meant anything; and the map surface is this pass's other eye check).
   */
  const wanted = ['photos', 'maps', 'browser', 'notes', 'store', 'calculator', 'messages', 'weather', 'news', 'mail', 'terminal', 'about'];
  const targets = [];
  for (const id of wanted) if (byId.has(id) && targets.length < OPENS) targets.push(byId.get(id));
  for (const l of ls) if (targets.length < OPENS && !targets.some((t) => t.id === l.id)) targets.push(l);

  const opens = [];
  /**
   * The ink clock has to run WHILE the opens are being fired, not after them:
   * the mock rehearsal polled only once all eight clicks were in and reported
   * 7.7 s for the first window and 1.2 s for the last, which is the poll's own
   * start time showing up as latency. So one shared poll pass, called in the
   * gaps between clicks and again at the end.
   */
  const inkAt = new Map();
  const state = new Map();
  const pollPass = async () => {
    for (const o of opens) {
      if (!o.windowId || inkAt.has(o.windowId)) continue;
      const r = await windowInk(page, o.windowId);
      state.set(o.windowId, r);
      if (r.inked) inkAt.set(o.windowId, Date.now());
    }
  };
  const pollFor = async (ms) => {
    const until = Date.now() + ms;
    do {
      await pollPass();
      const left = until - Date.now();
      if (left > 0) await sleep(Math.min(200, left));
    } while (Date.now() < until);
  };
  for (let k = 0; k < targets.length; k++) {
    const t = targets[k];
    const decoy = targets[(k + 1) % targets.length];
    // 0 plain · 1 press-elsewhere-then-click · 2 double click · 3 back-to-back
    const pattern = ['plain', 'cross', 'double', 'rapid'][k % 4];
    const before = new Set(await windowIds(page));
    const box = (await freshBox(page, t.id)) || t;
    let p = await hitPoint(page, box);
    let shoved = null;
    for (let tries = 0; tries < 2 && p && !p.real; tries++) {
      shoved = await shoveTopWindow(page, box);
      if (!shoved) break;
      p = await hitPoint(page, (await freshBox(page, t.id)) || box);
    }
    const dbox = pattern === 'cross' ? (await freshBox(page, decoy.id)) || decoy : null;
    const d = dbox ? await hitPoint(page, dbox) : null;
    const traceBefore = (await trace(page)).length;
    const pointerBefore = (await pointerLog(page)).length;
    const at = Date.now();
    try {
      if (pattern === 'cross' && d) {
        // press on one launcher, release over another: mousedown starts the
        // speculative generation for the decoy, the click never lands there
        await page.mouse.move(d.x, d.y);
        await page.mouse.down();
        await page.mouse.move(p.x, p.y, { steps: 3 });
        await page.mouse.up();
        await sleep(40);
        await page.mouse.click(p.x, p.y);
      } else if (pattern === 'double') {
        await page.mouse.dblclick(p.x, p.y, { delay: 40 });
      } else {
        await page.mouse.click(p.x, p.y);
      }
      if (p && !p.real) {
        // every pixel of the launcher is under a window even after the shove:
        // a coordinate click there is a click on the window, which is not what
        // this run is measuring, so fall back to the suite's dispatched pair
        const el = page.locator(`[data-os-app="${t.id}"]`).first();
        await el.dispatchEvent('mousedown').catch(() => {});
        await el.dispatchEvent('click').catch(() => {});
      }
    } catch (e) {
      opens.push({ app: t.id, pattern, mode: p?.real ? 'real' : 'dispatched', clickError: String(e).slice(0, 120) });
      continue;
    }
    await sleep(160);
    let after = await windowIds(page);
    let fresh = after.filter((w) => !before.has(w));
    /**
     * Did the KERNEL see this click? A pointer that lands between two icons of
     * a magnifying dock leaves no line in the trace, and that is a miss by the
     * runner, not a window that failed to fill — the two must never be scored
     * the same. One retry with a re-measured box, and a mouse parked far away
     * first so no hover transform is in effect.
     */
    const sawIt = async () => (await trace(page)).slice(traceBefore).some((l) => l.includes('launcher.click ' + t.id));
    let sawClick = await sawIt();
    let retries = 0;
    while (!sawClick && !fresh.length && retries < 3) {
      retries++;
      // park the pointer so no hover transform (a magnifying dock) is in
      // effect, free the launcher if a window has landed on it, re-measure,
      // click again — which is what a person does when a click does nothing
      await page.mouse.move(2, 2);
      await sleep(150);
      let b2 = (await freshBox(page, t.id)) || box;
      let p2 = await hitPoint(page, b2);
      if (p2 && !p2.real) {
        await shoveTopWindow(page, b2);
        b2 = (await freshBox(page, t.id)) || b2;
        p2 = await hitPoint(page, b2);
      }
      if (!p2) break;
      await page.mouse.move(p2.x, p2.y);
      await sleep(80);
      const b3 = (await freshBox(page, t.id)) || b2;
      const p3 = (await hitPoint(page, b3)) || p2;
      if (p3.real) await page.mouse.click(p3.x, p3.y);
      else {
        // still buried: a coordinate click here is a click on somebody's window
        const el = page.locator(`[data-os-app="${t.id}"]`).first();
        await el.dispatchEvent('mousedown').catch(() => {});
        await el.dispatchEvent('click').catch(() => {});
      }
      await sleep(250);
      after = await windowIds(page);
      fresh = after.filter((w) => !before.has(w));
      sawClick = await sawIt();
    }
    const retried = retries || undefined;
    opens.push({
      app: t.id,
      pattern,
      mode: p?.real ? 'real' : 'dispatched',
      shoved: shoved || undefined,
      coveredBy: p && !p.real ? p.coveredBy : undefined,
      retried,
      kernelSawClick: sawClick,
      landedOn: sawClick ? undefined : (await pointerLog(page)).slice(pointerBefore),
      inDock: box.inDock,
      clickedAt: at,
      windowId: fresh[0] || null,
      extraWindows: fresh.length > 1 ? fresh.slice(1) : undefined,
    });
    /**
     * R1, per step. "One window at the end" and "one window at every step" are
     * different claims and only the second is the ruling, so the visible count
     * is read after EVERY open, before the next click goes in.
     */
    const vwNow = await visibleWindows(page);
    opens[opens.length - 1].visibleNow = { visible: vwNow.visible, total: vwNow.total, top: vwNow.top };
    // the "rapid" pattern is the next one fired with no cadence at all
    if (pattern === 'rapid') await sleep(60);
    else await pollFor(GAP);
  }

  /**
   * Now measure. Every window that was created gets polled until it inks; the
   * clock for each starts at ITS OWN click, so an app fired seventh is not
   * charged for the six before it.
   */
  const deadline = Date.now() + INK_CEILING;
  while (Date.now() < deadline) {
    await pollPass();
    if (opens.every((o) => !o.windowId || inkAt.has(o.windowId))) break;
    await sleep(250);
  }
  // one more reading for chars after the documents have had a moment to finish
  await sleep(2500);
  for (const o of opens) if (o.windowId) state.set(o.windowId, await windowInk(page, o.windowId));

  const t = await trace(page);
  /**
   * The kernel's own ink number, not the poller's. `streamApp.enter <wid>
   * <app>` is followed by that window's `streamDoc.enter app <gen_id>`, and the
   * server's `mark` line for that gen_id carries `ink_ms` measured from the
   * instant the generation started — a quarter-second poll cannot see that and
   * a browser window's later `page` generation must not be mistaken for it.
   */
  const genOf = new Map();
  let pendingWin = null;
  for (const line of t) {
    const a = /streamApp\.enter (w\d+) /.exec(line);
    if (a) {
      pendingWin = a[1];
      continue;
    }
    const b = /streamDoc\.enter app ([^\s]+)/.exec(line);
    if (b && pendingWin) {
      if (!genOf.has(pendingWin)) genOf.set(pendingWin, b[1]);
      pendingWin = null;
    }
  }
  const markOf = new Map();
  for (const l of logs) {
    if (!l.gen_id) continue;
    // Merge EVERY line that carries this gen id. A mark that arrives before the
    // generation's own line is folded into it by `server/telemetry.ts`, so
    // `ink_ms` usually rides the `app` line and only sometimes arrives as a
    // separate `mark`; and ink and interactive are separate posts, so a later
    // line must not erase an earlier one's field.
    const prev = markOf.get(l.gen_id) || {};
    const merged = { ...prev };
    for (const k of ['ink_ms', 'first_paint_ms', 'interactive_ms', 'complete_ms', 'total_ms', 'usd', 'engine', 'aborted'])
      if (l[k] != null) merged[k] = l[k];
    markOf.set(l.gen_id, merged);
  }
  for (const o of opens) {
    const s = o.windowId ? state.get(o.windowId) : null;
    o.painted = !!(s && s.inked);
    // three outcomes, never two: a window that filled; a window that was
    // created and never filled (the blank window this pass exists to count);
    // and a click that never reached a launcher, which is the runner losing a
    // race with the cascade and is counted apart from both
    o.outcome = o.painted ? 'painted' : o.windowId ? 'blank' : 'no-window';
    o.inkMs = o.windowId && inkAt.has(o.windowId) ? inkAt.get(o.windowId) - o.clickedAt : null;
    o.chars = s ? s.chars : 0;
    o.nodes = s ? s.nodes : 0;
    o.genId = o.windowId ? genOf.get(o.windowId) || null : null;
    const m = o.genId ? markOf.get(o.genId) : null;
    o.inkMsKernel = m && m.ink_ms != null ? m.ink_ms : null;
    o.engineUsed = m && m.engine ? m.engine : undefined;
    o.interactiveMsKernel = m && m.interactive_ms != null ? m.interactive_ms : null;
    if (!o.painted) {
      // the excerpt a failure needs: every trace line that names this window,
      // plus the open-path steps around it
      const w = o.windowId;
      const anchor = t.findIndex((line) => line.includes('launcher.press ' + o.app) || line.includes('launcher.click ' + o.app));
      o.traceExcerpt =
        anchor >= 0
          ? t.slice(anchor, anchor + 30)
          : t.filter((line) => (w && line.includes(' ' + w)) || /threw|watchdog|kernelChrome/.test(line)).slice(-30);
      if (anchor < 0) o.traceNoLauncherLine = true;
    }
  }

  await shot(page, dir, '03-windows');
  /**
   * D2 / SEAM T4 — read every open window's chrome, independently of the
   * kernel's own verdict: is there a title strip a pointer can grab, and a
   * close control a pointer can reach. The architect's live window had the
   * attributes and no pixels.
   */
  const windowsStacked = await inspectWindows(page);
  const windows = await probeWindowChrome(page);
  const tasks = await inspectTasks(page);
  const icons = await iconReading(page);
  const n = await net(page);
  // the map window, focused and photographed on its own (the map surface is an
  // eye check, not a number)
  const mapOpen = opens.find((o) => o.app === 'maps' && o.windowId);
  if (mapOpen) {
    await page
      .locator(`[data-os-window-id="${mapOpen.windowId}"]`)
      .first()
      .dispatchEvent('pointerdown')
      .catch(() => {});
    await sleep(400);
    await shot(page, dir, '04-maps');
  }
  const photosOpen = opens.find((o) => o.app === 'photos' && o.windowId);
  if (photosOpen) {
    await page
      .locator(`[data-os-window-id="${photosOpen.windowId}"]`)
      .first()
      .dispatchEvent('pointerdown')
      .catch(() => {});
    await sleep(400);
    await shot(page, dir, '05-photos');
  }
  /**
   * SEAM T2 — the browser walk. Last, because it is the slowest thing in the
   * boot and because a browser window that has been sitting open through eight
   * other opens is the honest state to walk it from.
   */
  let walk = null;
  const browserOpen = opens.find((o) => o.app === 'browser' && o.windowId);
  if (URLS.length && browserOpen) {
    await page
      .locator(`[data-os-window-id="${browserOpen.windowId}"]`)
      .first()
      .dispatchEvent('pointerdown')
      .catch(() => {});
    await sleep(300);
    walk = await browserWalk(page, dir, browserOpen.windowId, logs, URLS);
  } else if (URLS.length) {
    walk = { failed: 'no-browser-window', steps: [] };
  }
  /**
   * D3 — the labels, last of all: the plates landed long ago, every app has
   * opened, and the question is the visitor's one. `deskWithPlates` was read
   * seconds after the sheet; this is read at the end of the session.
   */
  const deskLate = await inspectDesktop(page);
  /**
   * R2's count, R1's end state, and the two reach questions, all read on the
   * machine as the session leaves it — then the windows are closed one by one
   * and the launchers asked again, which is the only honest way to say
   * "reachable" about a screen a full-size window was covering.
   */
  const clocks = await inspectClocks(page);
  const visibleAtEnd = await visibleWindows(page);
  const taskReach = await reachReading(page, '[data-os-task-for]');
  await shot(page, dir, '07-before-close');
  const closing = await closeEveryWindow(page);
  await sleep(300);
  const afterClose = await visibleWindows(page);
  const launcherReach = await reachReading(page, '[data-os-app]');
  await shot(page, dir, '08-closed');
  const errors = errs.since(0);
  const cspNoise = errs.blocksSince(0).length;
  /** the server's own account of this boot: what it refused, and every picture */
  const mine = logs.filter((l) => l.ts >= new Date(startedAt - 1500).toISOString());
  const imgs = mine
    .filter((l) => l.kind === 'img')
    .map((l) => ({
      img_kind: l.img_kind,
      theme: l.img_theme || null,
      width: l.width || null,
      bytes: l.bytes,
      ms: l.total_ms,
      blocked: l.blocked || null,
      refusal: l.refusal || null,
      model: l.img_model || null,
    }));
  const refusals = {};
  for (const l of mine) {
    const why = l.blocked || l.refusal;
    if (why) refusals[l.kind + ':' + why] = (refusals[l.kind + ':' + why] || 0) + 1;
  }
  await page.close();
  return {
    boot: i,
    identity: boot.identity ? { name: boot.identity.name, version: boot.identity.version, era: boot.identity.era, archetype: boot.identity.archetype } : null,
    archetype: desk?.archetypeAttr || null,
    bootInkMs: boot.bootInkMs,
    desktopInteractiveMs: boot.desktopInteractiveMs,
    launchers: desk?.launchers ?? null,
    iconsFilled: deskWithPlates ? deskWithPlates.iconsFilled + '/' + deskWithPlates.icons : null,
    iconsFilledAtReady: desk ? desk.iconsFilled + '/' + desk.icons : null,
    platesWaitedMs: platesMs,
    wallpaper: deskWithPlates?.wallpaper ?? null,
    opens,
    windows,
    /** the same windows read without raising anything: the cascade as it stands */
    windowsStacked: windowsStacked.map((w) => ({ id: w.id, chrome: w.chrome, closeHit: w.closeHit, closeBlocked: w.closeBlocked })),
    tasks,
    walk,
    /** D2/D3/D4's numbers, from the desktop as it stands at the end of the session */
    chrome: {
      template: deskLate?.chromeTemplate ?? deskWithPlates?.chromeTemplate ?? null,
      contractPatch: deskLate?.contractPatch ?? null,
      windowsUsable: windows.filter((w) => w.usable).length + '/' + windows.length,
      windowsPatched: windows.filter((w) => w.chrome === 'patched').length,
    },
    labels: {
      atPlates: deskWithPlates ? deskWithPlates.launchersLabelled + '/' + deskWithPlates.launchers : null,
      late: deskLate ? deskLate.launchersLabelled + '/' + deskLate.launchers : null,
      inDom: deskLate?.launchersLabelInDom ?? null,
      lost: deskLate?.launchersLabelsLost ?? null,
      kept: deskLate?.labelKept ?? [],
      boxed: deskLate?.iconBoxed ?? null,
    },
    barSpacing: deskLate?.barSpacing ?? deskWithPlates?.barSpacing ?? null,
    clocks,
    solo: {
      atEnd: visibleAtEnd,
      perOpen: opens.map((o) => (o.visibleNow ? o.visibleNow.visible + '/' + o.visibleNow.total : null)),
      worst: Math.max(0, ...opens.map((o) => (o.visibleNow ? o.visibleNow.visible : 0))),
      taskReach: taskReach.filter((t) => !t.reach && !t.harness).length + '/' + taskReach.length + ' unreachable',
      taskUnderHud: taskReach.filter((t) => t.harness).length,
      taskBlocked: taskReach.filter((t) => !t.reach).slice(0, 4),
    },
    closing: {
      steps: closing,
      closedAll: afterClose.total === 0,
      left: afterClose.total,
      launchersReachable: launcherReach.filter((l) => l.reach).length + '/' + launcherReach.length,
      launchersUnderHud: launcherReach.filter((l) => l.harness).length,
      launcherBlocked: launcherReach.filter((l) => !l.reach).slice(0, 4),
    },
    icons,
    net: n,
    errors: errors.slice(0, 10),
    cspNoise,
    httpRefused: refused.map((r) => r.path + ' ' + r.status),
    imgs,
    refusals,
    trace: t.slice(-120),
  };
}

const main = async () => {
  mkdirSync(SHOTS, { recursive: true });
  const port = await freePort();
  const srv = await startServer({
    port,
    env: {
      /**
       * v0.5 / SEAM T1: the shipped per-kind triggers, which is what this run
       * is measuring. HANDOFF-6's stress run pinned `HEDGE_AFTER_MS_BOOT=1200`
       * because the code default was 0 and double-bought every DESKTOP too;
       * the desktop now has a trigger of its own (600 ms), so the boot's 0 —
       * always race both lanes for the first pixel of the product — costs one
       * extra boot generation and nothing else. Overridable, so the arms can be
       * compared without editing the runner.
       */
      DEFAULT_ENGINE: arg('default', 'cerebras-oss120'),
      ...(arg('hedgeboot', '') ? { HEDGE_AFTER_MS_BOOT: arg('hedgeboot', '') } : {}),
      ...(arg('hedgedesktop', '') ? { HEDGE_AFTER_MS_DESKTOP: arg('hedgedesktop', '') } : {}),
      ...(arg('hedge', '') ? { HEDGE_AFTER_MS: arg('hedge', '') } : {}),
      // six boots x ten generations from one address is over the production
      // per-visitor cap (60/h) by design; the cap is not what this run measures
      // and a 429 mid-run would be scored as a blank window
      GEN_PER_IP_PER_HOUR: arg('percap', '100000'),
      MARK_PER_IP_PER_HOUR: '100000',
      /**
       * The same escape for PICTURES, and it is not optional. The image session
       * bucket is keyed on the IP hash with a 30-minute window, so eight boots
       * from this machine are one visitor asking for 30 pictures: HANDOFF-7's
       * first v0.5 run lost the wallpaper and the icon sheet on boots 3-8 and
       * read like an image-engine defect. Production keeps the documented 30.
       */
      IMG_PER_IP_PER_SESSION: arg('imgcap', '100000'),
      // HANDOFF-4's trap: a mock rehearsal on a tree with FAL_KEY set buys real
      // pictures. `--images=off` is how a rehearsal costs nothing.
      ...(arg('images', 'on') === 'off' ? { FAL_KEY: '' } : {}),
      ...(ENGINE === 'mock' ? { ALLOW_MOCK: '1', DEFAULT_ENGINE: 'mock' } : {}),
    },
  });
  const boots = [];
  try {
    await withBrowser(async (ctx) => {
      for (let i = 1; i <= BOOTS; i++) {
        const dir = resolve(SHOTS, 'boot-' + i);
        const from = srv.logs.length;
        const r = await oneBoot(ctx, srv.base, ENGINE, dir, srv.logs, i);
        const mine = srv.logs.slice(from);
        r.usd = Math.round(usdTotal(mine) * 10000) / 10000;
        r.gens = mine.filter((l) => l.kind && l.kind !== 'mark').length;
        boots.push(r);
        const ok = r.opens.filter((o) => o.painted).length;
        console.log(
          `boot ${i}: ${r.identity?.name || r.failed || '?'} · ${r.archetype} · opens ${ok}/${r.opens.length} painted · ink median ${median(r.opens.map((o) => o.inkMsKernel).filter((x) => x != null))}ms · chrome ${r.chrome?.windowsUsable} usable (${r.chrome?.windowsPatched} patched) · labels ${r.labels?.late} (${r.labels?.lost} lost) · clocks ${r.clocks?.count} · solo max ${r.solo?.worst} · closed ${r.closing?.closedAll ? 'all' : r.closing?.left + ' left'} · launchers ${r.closing?.launchersReachable} · clock gap ${r.barSpacing ? r.barSpacing.min : '-'} · tiles ${(r.walk?.steps || []).reduce((a, st) => a + st.tiles.reduce((x, g) => x + g.filled, 0), 0)}/${(r.walk?.steps || []).reduce((a, st) => a + st.tiles.reduce((x, g) => x + g.tiles, 0), 0)} · $${r.usd}`
        );
        writeFileSync(OUT, JSON.stringify({ engine: ENGINE, boots }, null, 2));
      }
    });
  } finally {
    srv.stop();
  }
  const all = boots.flatMap((b) => b.opens);
  const painted = all.filter((o) => o.painted).length;
  const blank = all.filter((o) => o.outcome === 'blank').length;
  const nowin = all.filter((o) => o.outcome === 'no-window').length;
  console.log(
    `\nTOTAL ${painted}/${all.length} painted · BLANK WINDOWS ${blank} · clicks that reached no launcher ${nowin} · real clicks ${all.filter((o) => o.mode === 'real').length} · ink median poll ${median(all.map((o) => o.inkMs).filter((x) => x != null))}ms / kernel ${median(all.map((o) => o.inkMsKernel).filter((x) => x != null))}ms · $${Math.round(boots.reduce((s, b) => s + (b.usd || 0), 0) * 10000) / 10000}`
  );
  writeFileSync(OUT, JSON.stringify({ engine: ENGINE, boots }, null, 2));
  console.log('wrote ' + OUT);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
