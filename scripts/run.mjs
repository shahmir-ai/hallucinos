/**
 * Shared harness for the two judged runs:
 *   scripts/smoke.mjs   — SPEC §10.3, one boot per engine, 3 apps, 3 URLs
 *   scripts/bakeoff.mjs — SPEC §7, five boots per engine, 4 apps, 5 URLs
 *
 * Both drive the real kernel in a real browser against a real engine, read the
 * numbers out of the server's own stdout telemetry lines (never re-derived
 * here), and write a markdown report plus screenshots.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
}

/** Start dist/server.js and collect every telemetry line it prints. */
export async function startServer({ port = 8899, env = {} } = {}) {
  if (!existsSync(resolve(ROOT, 'dist/server.js'))) throw new Error('run `npm run build` first');
  const logs = [];
  const child = spawn(process.execPath, [resolve(ROOT, 'dist/server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const j = JSON.parse(line);
        if (j.kind) logs.push(j);
        if (process.env.VERBOSE) process.stdout.write(line + '\n');
      } catch {
        process.stdout.write(line + '\n');
      }
    }
  });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(base + '/healthz');
      if (r.ok) return { child, logs, base, stop: () => child.kill('SIGTERM') };
    } catch {}
    await sleep(250);
  }
  child.kill('SIGKILL');
  throw new Error('server did not come up');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * T3 — `--viewport`. Default 1440x900, `mobile` is 390x844 (an iPhone-shaped
 * portrait), and `WxH` is taken literally. SPEC §2.2 gives every window the
 * full screen below 768 px and turns dragging off, and §12.3's launcher grid is
 * where a dock's arithmetic goes wrong (HANDOFF-6 remaining issue 1) — neither
 * has ever been judged anywhere but at desktop width, because the harness had
 * the size baked in.
 */
export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

export function viewportFrom(spec) {
  const raw = String(spec || '').trim().toLowerCase();
  if (!raw) return VIEWPORTS.desktop;
  if (VIEWPORTS[raw]) return VIEWPORTS[raw];
  const m = /^(\d{3,5})\s*[x*×]\s*(\d{3,5})$/.exec(raw);
  if (!m) throw new Error(`--viewport: expected WxH, "mobile" or "desktop", got "${spec}"`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** The viewport this process was asked for, honoured by every run that uses withBrowser. */
export const viewport = () => viewportFrom(arg('viewport', 'desktop'));

export async function withBrowser(fn, { viewport: vp = viewport() } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    userAgent: CHROME_UA,
    viewport: vp,
    // a phone-sized viewport that is not a phone measures neither: below 768 px
    // the kernel is in its mobile geometry and a model may be too
    ...(vp.width < 768 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  // Playwright's default action timeout is 0 — unlimited. A locator call against
  // something the model did not draw (a browser app with no [data-os-url], say)
  // then hangs the whole run with no output, which is how two bake-off runs
  // stopped dead. Nothing this harness does should ever wait longer than this.
  ctx.setDefaultTimeout(20_000);
  try {
    return await fn(ctx);
  } finally {
    await ctx.close();
    await browser.close();
  }
}

/** One boot: identity, boot screen, desktop, with the timings the kernel actually produced. */
export async function bootOnce(page, base, engine, { onPaint } = {}) {
  const t0 = Date.now();
  let bootPaint = null;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });
  // SPEC §12.6 / I8: /bakeoff is a landing page now; /bakeoff/run is the boot.
  await page.goto(`${base}/bakeoff/run?engine=${encodeURIComponent(engine)}`, { waitUntil: 'commit' });

  // when did the boot screen first have pixels in it? (sandboxed frames are
  // opaque to the parent document, so this has to go through the frame API)
  /**
   * HANDOFF-4: this used to be `frameChars(...) > 0`, i.e. TEXT in the boot
   * frame, and the verification boot of 2026-09-17 reported `bootPaintMs: null`
   * on a boot screen that had certainly painted — the kernel's own mark for
   * that generation says 4,176 ms. `innerText` returns nothing for a boot
   * screen made of CSS and SVG, and nothing for text that is still hidden by
   * the machine's own fade-in, which is a very ordinary way to write one. Both
   * were scored as "never painted".
   *
   * Pixels, then, not characters: any element in the frame's body that has a
   * box, with `<script>` and `<style>` — which the bootstrap document carries
   * before the first model byte — excluded by name.
   */
  const bootPainted = async () => {
    const el = await page
      .locator('[data-os-boot] iframe')
      .first()
      .elementHandle({ timeout: 1500 })
      .catch(() => null);
    if (!el) return false;
    const f = await el.contentFrame().catch(() => null);
    if (!f) return false;
    return evalSafe(
      f,
      () => {
        if (!document.body) return false;
        if ((document.body.innerText || '').trim().length > 0) return true;
        for (const node of Array.from(document.body.querySelectorAll('*'))) {
          const tag = node.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META' || tag === 'TITLE') continue;
          const r = node.getBoundingClientRect();
          if (r.width > 2 && r.height > 2) return true;
        }
        return false;
      },
      false
    );
  };

  const paintPoll = (async () => {
    // A wall-clock deadline, not an iteration count: an iteration's cost depends
    // on whether the selector exists, and the poll must never outlive the
    // outcome race below.
    const until = Date.now() + 130_000;
    while (Date.now() < until) {
      const painted = await bootPainted();
      if (painted) {
        const at = Date.now() - t0;
        // the boot screen is the one thing that is gone by the time the desktop
        // is up, so whoever wants a picture of it has to be handed it here
        if (onPaint) await onPaint().catch(() => {});
        return at;
      }
      // Stop on either ending: the desktop is up, or the kernel drew its own
      // error/queue screen — in which case there is no boot iframe to wait for
      // and every further poll is pure cost.
      const done = await evalSafe(
        page,
        () =>
          document.documentElement.hasAttribute('data-os-ready') ||
          !!document.querySelector('[data-os-error],[data-os-queue]'),
        false,
        5000
      );
      if (done) return null;
      await sleep(50);
    }
    return null;
  })();

  // Either the OS came up, or the kernel drew its own error/queue screen. An
  // engine that answers 403 (Inception did, 2026-09-17) used to cost the full
  // 120 s per boot and report nothing but a Playwright timeout.
  const outcome = await Promise.race([
    page.waitForSelector('html[data-os-ready]', { timeout: 120_000 }).then(() => 'ready'),
    page.waitForSelector('[data-os-error],[data-os-queue]', { timeout: 120_000 }).then(() => 'error'),
  ]).catch(() => 'timeout');
  const desktopMs = Date.now() - t0;
  if (outcome !== 'ready') {
    const screen = await evalSafe(page, () => document.body.innerText.slice(0, 300), '', 8000);
    bootPaint = await paintPoll;
    if (onPaint) await onPaint().catch(() => {});
    /**
     * T3 — the kernel's trace on any boot failure. A boot that ends in the
     * kernel's own error or queue screen, or that never reaches
     * `data-os-ready`, used to be three words (`failed: "timeout"`) and a
     * screenshot of black; the ring buffer says which step it got to.
     */
    const trace = await osTrace(page);
    recordOpenFailure({ app: 'boot', reason: outcome, windowId: null, chars: 0, ms: desktopMs, trace, engine });
    return {
      desktopMs,
      bootPaintMs: bootPaint,
      contract: null,
      injected: 0,
      identity: null,
      errors,
      failed: outcome,
      screen,
      trace,
    };
  }
  bootPaint = await paintPoll;
  const contract = await page.getAttribute('html', 'data-os-contract');
  const injected = await page.locator('[data-os-injected]').count();
  const identity = await evalSafe(page, () => window.os?.state()?.os || null, null, 15_000);
  // os.state() is deliberately a three-field snapshot (name/version/tagline);
  // §12.4 is a ruling about era, archetype and personality, so the whole
  // identity is read out of the kernel's own sessionStorage record instead of
  // widening the runtime API that generated documents can see.
  const identityFull = await evalSafe(
    page,
    () => {
      try {
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.indexOf('hallucinos:session:') === 0) {
            const v = JSON.parse(sessionStorage.getItem(k) || 'null');
            if (v && v.identity) return v.identity;
          }
        }
      } catch {}
      return null;
    },
    null,
    8000
  );
  // §12.1's "desktop interactive" is not the same instant as the reveal:
  // data-os-ready fires when the boot overlay lifts (it has a 2.5 s floor,
  // §12.3), and the kernel stamps the earlier, wired-and-clickable time on
  // data-os-desktop-ms. Judging the target against the reveal charges the
  // engine for a deliberate wait.
  const desktopInteractiveMs = await evalSafe(
    page,
    () => Number(document.documentElement.getAttribute('data-os-desktop-ms')) || null,
    null,
    8000
  );
  /**
   * SEAM H3, read from the kernel rather than re-derived: `data-os-boot-ink` is
   * the kernel's own ink time (or the string `none` when the boot frame never
   * had an element with a box), `data-os-boot-hold-ms` is how long the §12.3
   * floor actually held after that ink, and `data-os-revealed-ms` is when the
   * overlay came off. The harness's `bootPaintMs` above stays as the
   * independent witness: it polls the boot frame from outside and knows nothing
   * about the runtime's report.
   */
  const inkAttrs = await evalSafe(
    page,
    () => {
      const h = document.documentElement;
      return {
        ink: h.getAttribute('data-os-boot-ink'),
        hold: h.getAttribute('data-os-boot-hold-ms'),
        revealed: h.getAttribute('data-os-revealed-ms'),
      };
    },
    { ink: null, hold: null, revealed: null },
    8000
  );
  /**
   * BAKEOFF-4 #1 — the connection ledger (`window.__osNet`). `peak` is the most
   * requests the kernel held open at once on this page; HANDOFF-4's invariant
   * ("never more than three live generations") is either true here or it is not.
   */
  const net = await evalSafe(page, () => (window.__osNet ? window.__osNet() : null), null, 8000);
  const num = (v) => (v == null || v === 'none' || v === '' ? null : Number(v));
  /**
   * T3 — a desktop that came up but whose boot frame never inked is the failure
   * HANDOFF-6 §9 saw once (`UNNAMED/0OHK`, no `01-boot.png` to shoot). It is
   * not fatal — the OS is usable — so it does not fail the run, but the trace
   * goes into the record where the next pass can read it.
   */
  const trace = inkAttrs.ink === 'none' ? await osTrace(page) : undefined;
  return {
    ...(trace ? { trace } : {}),
    net,
    desktopMs,
    desktopInteractiveMs,
    bootPaintMs: bootPaint,
    // null when the kernel says the frame never inked; `bootInkNone` keeps that
    // apart from "the attribute was missing", which is a harness bug, not a
    // blank boot
    bootInkMs: num(inkAttrs.ink),
    bootInkNone: inkAttrs.ink === 'none',
    bootHoldMs: num(inkAttrs.hold),
    bootRevealedMs: num(inkAttrs.revealed),
    contract,
    injected,
    identity: identityFull || identity,
    errors,
  };
}

/**
 * Open an app and wait for its document to FINISH streaming — not for its first
 * byte. A slow engine writes an app over tens of seconds, and measuring "chars"
 * at the first chunk reports 16 characters for a full screen of output.
 */
/**
 * `frame.evaluate` has no default timeout: on a frame that is mid-replacement it
 * can hang forever rather than reject, which is how a bake-off run stops dead
 * with no output. Every poll of a generated document goes through this.
 */
export async function evalSafe(frame, fn, fallback, ms = 10_000, arg) {
  if (!frame) return fallback;
  let timer;
  try {
    return await Promise.race([
      arg === undefined ? frame.evaluate(fn) : frame.evaluate(fn, arg),
      new Promise((res) => {
        timer = setTimeout(() => res(fallback), ms);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A generated document is streamed in with document.write() and finished with
 * document.close() by the injected runtime, so `readyState === 'complete'` is
 * the kernel's own "this generation is over" signal — far better than watching
 * innerText stop growing, which plateaus for seconds whenever the model is
 * streaming a long <style> block and reports a half-painted page as finished.
 * Text-stability stays as the fallback for a frame that never closes.
 */
export async function settleDoc(frame, deadline, { stableTicks = 3, tick = 400 } = {}) {
  let last = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    const st = await evalSafe(
      frame,
      () => ({ ready: document.readyState, len: document.body ? document.body.innerText.trim().length : 0 }),
      null
    );
    if (!st) return { chars: Math.max(0, last), closed: false };
    if (st.ready === 'complete' && st.len === last) return { chars: st.len, closed: true };
    if (st.len > 0 && st.len === last) {
      if (++stable >= stableTicks) return { chars: st.len, closed: false };
    } else stable = 0;
    last = st.len;
    await sleep(tick);
  }
  return { chars: Math.max(0, last), closed: false };
}

/**
 * T3 — the failures this harness used to swallow.
 *
 * `openAppAndWait` returned `{frame: null, chars: 0}` for an app open that
 * produced no window at all, and every caller printed "0 chars" and carried on;
 * HANDOFF-5's verification boot A lost four of four windows that way and the run
 * exited 0. Now: the failure is recorded here with the kernel's own trace, every
 * caller's report carries a line for it, and the run exits non-zero.
 *
 * KERNEL-6 §3's `window.__osTrace()` is what makes it diagnosable rather than
 * merely loud — the open path's steps are in it, and a click that reached no
 * launcher leaves no `launcher.click` line at all.
 */
export const openFailures = [];

/** The kernel's own trace ring, newest N lines. Never throws; `[]` if absent. */
export async function osTrace(page, n = 60) {
  const lines = await evalSafe(page, () => (window.__osTrace ? window.__osTrace() : []), [], 8000);
  return Array.isArray(lines) ? lines.slice(-n) : [];
}

/** Does this document have anything with a box in it? (Same test as the boot frame's.) */
async function inkedIn(frame) {
  return evalSafe(
    frame,
    () => {
      if (!document.body) return false;
      if ((document.body.innerText || '').trim().length > 0) return true;
      for (const node of Array.from(document.body.querySelectorAll('*'))) {
        const tag = node.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META' || tag === 'TITLE') continue;
        const r = node.getBoundingClientRect();
        if (r.width > 2 && r.height > 2) return true;
      }
      return false;
    },
    false,
    8000
  );
}

export function recordOpenFailure(f) {
  openFailures.push(f);
  process.stdout.write(`FAIL open ${f.app}: ${f.reason} (windowId ${f.windowId ?? 'null'}, ${f.ms} ms)\n`);
  for (const line of (f.trace || []).slice(-12)) process.stdout.write(`      ${line}\n`);
  return f;
}

/** The markdown every runner appends to its report, and the reason for its exit code. */
export function failureLines() {
  if (!openFailures.length) return '';
  let md = `\n## Failures — ${openFailures.length} app open(s) produced no usable window\n\n`;
  md += 'A window that never exists, or exists and never inks, is the defect that cost\n';
  md += 'HANDOFF-5 four windows while the harness reported "0 chars" and exited 0.\n';
  md += 'The trace is the kernel\'s own ring buffer (`window.__osTrace()`).\n\n';
  for (const f of openFailures) {
    md += `### \`${f.app}\` — ${f.reason}\n\n`;
    md += `- window id: \`${f.windowId ?? 'null'}\` · waited ${f.ms} ms · engine \`${f.engine || '?'}\`\n`;
    md += `- chars in the frame: ${f.chars ?? 0}\n\n`;
    md += '```\n' + ((f.trace || []).slice(-24).join('\n') || '(the kernel trace was empty or absent)') + '\n```\n';
  }
  return md;
}

/**
 * Exit the process the way a judged run should: 0 only when every app open
 * produced a window that inked. `extra` lets a runner add its own failures.
 */
export function exitWithFailures(extra = 0) {
  const n = openFailures.length + extra;
  if (n) process.stdout.write(`\nFAILED: ${n} failure(s) — see the report\n`);
  process.exit(n ? 1 : 0);
}

export async function openAppAndWait(page, id, ms = 180_000, { engine = '', loud = true } = {}) {
  const launcher = page.locator(`[data-os-app="${id}"]`).first();
  // dispatched, not hit-tested: an open window can sit over the launcher grid,
  // and where the model put things is not this harness's business.
  // mousedown first, then click, because that is what a real pointer does and
  // because §12.1's speculative generation hangs off mousedown — a click-only
  // harness measures a path no visitor takes, and the kernel's first-paint mark
  // for an app only carries a gen id on the speculative path.
  await launcher.dispatchEvent('mousedown', undefined, { timeout: 15_000 }).catch(() => {});
  await launcher.dispatchEvent('click', undefined, { timeout: 15_000 }).catch(() => {});
  const frames = page.locator('[data-os-window-id] iframe[data-os-frame="app"]');
  const t0 = Date.now();
  const deadline = t0 + ms;
  let frame = null;
  while (Date.now() < deadline) {
    const n = await frames.count();
    if (n) {
      const handle = await frames.nth(n - 1).elementHandle();
      frame = await handle.contentFrame();
      if (frame) {
        const { chars } = await settleDoc(frame, deadline);
        const windowId = await page
          .evaluate((el) => el.closest('[data-os-window-id]')?.getAttribute('data-os-window-id') || null, handle)
          .catch(() => null);
        const inked = chars > 0 ? true : await inkedIn(frame);
        const out = { frame, el: handle, chars, ms: Date.now() - t0, windowId, inked };
        /**
         * A window with no id is a window the kernel never registered, and a
         * window that never inks is HANDOFF-5's blank window. Both are failures
         * even though a frame exists, and neither used to be reported.
         */
        if (loud && (!windowId || !inked)) {
          out.failed = !windowId ? 'window-id-null' : 'never-inked';
          out.trace = await osTrace(page);
          recordOpenFailure({ app: id, reason: out.failed, windowId, chars, ms: out.ms, trace: out.trace, engine });
        }
        // the element handle goes back with the frame: focusing and
        // re-photographing a window both start from its <iframe>
        return out;
      }
    }
    await sleep(300);
  }
  const trace = await osTrace(page);
  const out = { frame, chars: 0, ms: Date.now() - t0, windowId: null, inked: false, failed: 'no-window', trace };
  if (loud) recordOpenFailure({ app: id, reason: 'no-window', windowId: null, chars: 0, ms: out.ms, trace, engine });
  return out;
}

/**
 * HANDOFF-4 issue 8 — focus the window before photographing it.
 *
 * The harness used to screenshot whatever was on top, which on verification
 * boot B was the calculator sitting over the browser for every page shot. It is
 * also the honest thing to measure now that SEAM H4 exists: `data-os-focused`
 * is a state the machine styles, so a shot of an unfocused window is a shot of
 * the wrong state.
 *
 * `pointerdown` is DISPATCHED on the window root rather than clicked at a
 * coordinate: the kernel raises on `pointerdown` in the capture phase
 * (kernel/windows.ts `wire`), a dispatched event is not hit-tested — so an
 * overlapping window cannot swallow it — and no `pointermove` follows, so
 * nothing drags. Returns what the kernel then says about focus.
 */
export async function focusWindowFor(page, frameEl) {
  if (!frameEl) return null;
  const root = await page
    .evaluateHandle((el) => el.closest('[data-os-window-id]'), frameEl)
    .catch(() => null);
  const rootEl = root ? root.asElement() : null;
  if (!rootEl) return null;
  const bar = await rootEl
    .$('[data-os-drag], [data-os-title]')
    .catch(() => null);
  await (bar || rootEl).dispatchEvent('pointerdown', undefined, { timeout: 10_000 }).catch(() => {});
  await sleep(120);
  return page
    .evaluate((el) => {
      const r = el.closest('[data-os-window-id]');
      if (!r) return null;
      const id = r.getAttribute('data-os-window-id');
      const task = document.querySelector(`[data-os-task-for="${id}"]`);
      return {
        id,
        focused: r.getAttribute('data-os-focused'),
        taskActive: !!task && task.hasAttribute('data-os-active'),
        z: Number(getComputedStyle(r).zIndex) || 0,
        top: (() => {
          const zs = Array.from(document.querySelectorAll('[data-os-window-id]')).map(
            (w) => Number(getComputedStyle(w).zIndex) || 0
          );
          return (Number(getComputedStyle(r).zIndex) || 0) >= Math.max(...zs);
        })(),
      };
    }, frameEl)
    .catch(() => null);
}

/**
 * HANDOFF-4 #3 — whether a document's pictures ARRIVED.
 *
 * Every image finding in the last two passes came from telemetry lines read by
 * hand, because a harness that photographs an app when its document goes quiet
 * (~2 s) photographs it before a fal call has returned (3-14 s). So: the slots
 * the model declared, and the ones the kernel has filled, inside the frame.
 */
export async function imgSlots(frame) {
  return evalSafe(
    frame,
    () => ({
      slots: document.querySelectorAll('[data-os-img]').length,
      filled: document.querySelectorAll('[data-os-img-filled]').length,
    }),
    { slots: 0, filled: 0 },
    8000
  );
}

/**
 * Focus a window, photograph it, wait for its pictures, photograph it again.
 *
 * `late` is the second shot's numbers: the same frame `settleMs` later, which is
 * the only window in which a fal image can land. Both shots are kept — the
 * first is what a visitor sees when the text stops moving, the second is what
 * the window finally looks like.
 */
export async function photographApp(page, dir, name, r, { settleMs = 10_000, quietMs = 3_000 } = {}) {
  const focus = await focusWindowFor(page, r?.el);
  const early = r?.frame ? await imgSlots(r.frame) : { slots: 0, filled: 0 };
  await shot(page, dir, name);
  /**
   * BAKEOFF-4: a fixed 4 s wait was measuring the lane, not the pictures.
   * An app asks for up to four (SPEC §12.5) and the kernel's lane is two wide,
   * so they arrive in two waves of ~3 s each (IMG-LATENCY-1) — wave two lands
   * at ~6 s and a photograph at 4 s reported "two of four never arrive" for
   * three passes running. So: poll until the count has been still for `quietMs`
   * or `settleMs` is up, and record WHEN the last one landed.
   */
  let late = early;
  let lastFillAt = early.filled ? 0 : null;
  const t0 = Date.now();
  let quietSince = Date.now();
  while (Date.now() - t0 < settleMs) {
    await sleep(400);
    const now = r?.frame ? await imgSlots(r.frame) : late;
    if (now.filled > late.filled) {
      lastFillAt = Date.now() - t0;
      quietSince = Date.now();
    }
    late = now;
    if (late.slots && late.filled >= Math.min(late.slots, 4)) break; // §12.5 caps an app at four
    if (Date.now() - quietSince >= quietMs && lastFillAt !== null) break;
  }
  await shot(page, dir, name + '-late');
  if (!focus?.id && r?.frame && !r?.failed) {
    // the window exists as a frame but the kernel does not know it by id
    recordOpenFailure({
      app: name,
      reason: 'window-id-null',
      windowId: null,
      chars: r?.chars ?? 0,
      ms: r?.ms ?? 0,
      trace: await osTrace(page),
    });
  }
  return {
    focused: focus?.focused === 'true',
    taskActive: !!focus?.taskActive,
    windowId: focus?.id || null,
    imgSlots: Math.max(early.slots, late.slots),
    imgFilled: early.filled,
    imgFilledLate: late.filled,
    /** ms after the first photograph at which the last picture landed (null: none ever did) */
    imgLastFillMs: lastFillAt,
    imgWaitedMs: Date.now() - t0,
  };
}

/**
 * innerText length of the first frame matching `sel`, through the frame API.
 *
 * The element timeout has to be short and explicit: the context default is 20 s,
 * and a poll that calls this in a loop against a selector that does not exist
 * (a boot that failed has no boot iframe at all) then takes 20 s per iteration
 * and never finishes. That is how a bake-off run sat for six minutes on one
 * dead engine with nothing to show for it.
 */
export async function frameChars(page, sel, timeout = 1500) {
  const el = await page.locator(sel).first().elementHandle({ timeout }).catch(() => null);
  if (!el) return 0;
  const f = await el.contentFrame().catch(() => null);
  if (!f) return 0;
  return evalSafe(f, () => (document.body ? document.body.innerText.trim().length : 0), 0);
}

/** Navigate the browser window that is already open, and wait for the page to paint. */
export async function visitUrl(page, browserFrame, url, ms = 180_000) {
  const r = await pageStep(browserFrame, () => evalSafe(browserFrame, (u) => window.os.navigate(u), null, 15_000, url), { ms });
  return { chars: r.frame ? (await frameHealth(r.frame)).chars : 0, ms: r.ms, timedOut: r.timedOut };
}

export function shot(page, dir, name) {
  mkdirSync(dir, { recursive: true });
  return page.screenshot({ path: resolve(dir, name + '.png'), fullPage: false, timeout: 20_000 }).catch(() => null);
}

/** Numbers straight out of the server's telemetry lines, per kind. */
export function summarise(logs) {
  const by = {};
  for (const l of logs) {
    const b = (by[l.kind] = by[l.kind] || { n: 0, ttfb: [], tps: [], tin: 0, tout: 0, usd: 0, ok: 0, miss: 0, err: 0, refused: 0 });
    // A refused generation is not a generation: it now writes a telemetry line
    // (a cap, the money ceiling, the in-flight ceiling — nothing used to write
    // one, which is what voided BAKEOFF-1), and counting it as one would put a
    // zero into every median in this table.
    if (l.blocked) {
      b.refused += 1;
      continue;
    }
    b.n += 1;
    if (l.ttfb_ms) b.ttfb.push(l.ttfb_ms);
    if (l.tok_per_s) b.tps.push(l.tok_per_s);
    b.tin += l.tokens_in || 0;
    b.tout += l.tokens_out || 0;
    b.usd += l.usd || 0;
    if (l.contract_ok === true) b.ok += 1;
    if (l.contract_ok === false) b.miss += 1;
    if (l.error) b.err += 1;
  }
  return by;
}

export const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
export const usdTotal = (logs) => logs.reduce((s, l) => s + (l.usd || 0), 0);

export function writeReport(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  process.stdout.write('wrote ' + file + '\n');
}

/* ------------------------------------------------------------------ extras
 * Added for the bake-off runner (SPEC §7). Kept here rather than in
 * bakeoff.mjs because smoke.mjs wants the same primitives the day it grows a
 * broken-render column.
 */
import { createServer } from 'node:net';
import { readdirSync } from 'node:fs';

/** An actually-free port, asked of the OS rather than guessed. */
export function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

/**
 * Console/page errors with timestamps, so a step can be told which errors
 * happened during it. Sandboxed opaque frames report no location, so the frame
 * an error came from is not knowable — the window it happened in is.
 */
export function collectErrors(page) {
  const all = [];
  const push = (s) => {
    const m = String(s).slice(0, 240);
    all.push({ t: Date.now(), m, csp: isSandboxNoise(m) });
  };
  page.on('pageerror', (e) => push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') push(m.text());
  });
  const at = (t, csp) => all.filter((e) => e.t >= t && !!e.csp === csp).map((e) => e.m);
  return {
    all,
    /** real script failures during a step — what "JS error on load" means */
    since: (t) => at(t, false),
    /** the sandbox doing its job; a signal about the model, not a broken render */
    blocksSince: (t) => at(t, true),
  };
}

/**
 * A generated document that tries to reach the network is stopped by the CSP,
 * and Chrome reports that as a console error. It is the system working: it must
 * not count as a broken render, or every engine scores 100% broken.
 */
export function isSandboxNoise(m) {
  return (
    /Content Security Policy/i.test(m) ||
    /^Refused to /i.test(m) ||
    /net::ERR_BLOCKED/i.test(m) ||
    /Blocked autofocusing/i.test(m) ||
    /sandboxed and the 'allow-(scripts|forms|same-origin)' /i.test(m)
  );
}

/** Is this document actually a rendered thing, or a blank/unstyled failure? */
export async function frameHealth(frame) {
  if (!frame) return { chars: 0, nodes: 0, blank: true, unstyled: true };
  const h = await evalSafe(frame, () => {
      const b = document.body;
      const text = b ? (b.innerText || '').trim() : '';
      const cs = b ? getComputedStyle(b) : null;
      return {
        chars: text.length,
        nodes: b ? b.querySelectorAll('*').length : 0,
        sheets: document.querySelectorAll('style,link[rel="stylesheet"]').length,
        inline: document.querySelectorAll('[style]').length,
        svg: document.querySelectorAll('svg').length,
        bg: cs ? cs.backgroundColor : '',
        family: cs ? cs.fontFamily : '',
      };
    }, null);
  if (!h) return { chars: 0, nodes: 0, blank: true, unstyled: true };
  // "unstyled body": the model shipped markup with no CSS of any kind, so the
  // browser's own default stylesheet is the whole design.
  h.unstyled = h.sheets === 0 && h.inline === 0;
  h.blank = h.chars < 40 && h.nodes < 4;
  return h;
}

/** What the HUD says right now (SPEC §7's own numbers, read off the screen). */
export async function hudSnapshot(page) {
  const text = await page
    .locator('[data-os-hud]')
    .first()
    .textContent({ timeout: 8000 })
    .catch(() => '');
  const m = /session \$\s*([0-9.]+)/.exec(text || '');
  return { text: (text || '').trim(), sessionUsd: m ? Number(m[1]) : null };
}

/**
 * Run `trigger` and wait for the browser window's page frame to be a NEW
 * document that has stopped growing. The old document is stamped first: after
 * the kernel's reset the stamp is gone, which is how a fresh page is told from
 * a stale one whose text happens to be stable.
 */
export async function pageStep(browserFrame, trigger, { ms = 180_000 } = {}) {
  const t0 = Date.now();
  const before = browserFrame.childFrames()[0];
  if (before) await evalSafe(before, () => document.documentElement.setAttribute('data-h-old', ''), null, 5000);
  // the trigger is itself an evaluate into a frame that is about to be replaced,
  // so it can hang rather than reject; pageStep's deadline only ever covered
  // the polling that follows it
  // The trigger is bounded by the step's own ceiling, not by a flat 30 s: on a
  // dead engine every page step otherwise pays for the trigger AND the poll.
  await Promise.race([Promise.resolve(trigger()).catch(() => {}), sleep(Math.min(30_000, ms))]);

  let fresh = null;
  while (Date.now() - t0 < ms) {
    const c = browserFrame.childFrames()[0];
    if (c) {
      const stale = await evalSafe(c, () => document.documentElement.hasAttribute('data-h-old'), true, 5000);
      if (!stale) {
        fresh = c;
        break;
      }
    }
    await sleep(120);
  }
  if (!fresh) return { frame: null, ms: Date.now() - t0, timedOut: true };

  await settleDoc(fresh, t0 + ms);
  return { frame: fresh, ms: Date.now() - t0, timedOut: false };
}

/**
 * Wait for the page a browser window loaded *by itself* — its google-shaped
 * home, which the kernel navigates to as soon as the window opens. There is no
 * trigger to run and no previous document to stamp, so pageStep cannot do it:
 * without this the home page is measured the instant the app frame settles,
 * ~20 s before it exists, and every engine scores a blank first render.
 */
export async function waitForPage(browserFrame, { ms = 180_000 } = {}) {
  const t0 = Date.now();
  let f = null;
  while (Date.now() - t0 < ms) {
    const c = browserFrame.childFrames()[0];
    if (c) {
      const hasBody = await evalSafe(c, () => !!document.body && document.body.childNodes.length > 0, false, 5000);
      if (hasBody) {
        f = c;
        break;
      }
    }
    await sleep(150);
  }
  if (!f) return { frame: null, ms: Date.now() - t0, timedOut: true };
  await settleDoc(f, t0 + ms);
  return { frame: f, ms: Date.now() - t0, timedOut: false };
}

/** The address the kernel thinks the browser window is showing. */
export async function addressBar(browserFrame) {
  return browserFrame
    .locator('[data-os-url]')
    .first()
    .inputValue({ timeout: 8000 })
    .catch(() => '');
}

/**
 * Type a query into whatever the model built as a search box and submit it.
 * Falls back to os.navigate on the search URL, and says which path it took —
 * "the home page had no usable search box" is itself a bake-off finding.
 */
export async function searchInPage(browserFrame, pageFrame, query, searchUrl) {
  const filled = await evalSafe(
    pageFrame,
    function (q) {
      const inputs = [...document.querySelectorAll('input')].filter((i) => {
        const t = (i.type || 'text').toLowerCase();
        return t === 'text' || t === 'search' || t === '';
      });
      const box = inputs.find((i) => /q|query|search/i.test(i.name + ' ' + i.id + ' ' + (i.placeholder || ''))) || inputs[0];
      if (!box) return false;
      box.focus();
      box.value = q;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      const form = box.closest('form');
      const btn = form && form.querySelector('button,input[type="submit"]');
      if (btn) btn.click();
      else if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    },
    false,
    15_000,
    query
  );
  if (filled) return 'form';
  await evalSafe(browserFrame, (u) => window.os.navigate(u), null, 15_000, searchUrl);
  return 'fallback-navigate';
}

/** Click the first plausible result link in a results page. */
export async function clickFirstLink(pageFrame) {
  return evalSafe(
    pageFrame,
    () => {
      const a = [...document.querySelectorAll('a[href]')].find((x) => {
        const h = x.getAttribute('href') || '';
        return h && h !== '#' && !h.startsWith('javascript:') && !h.startsWith('mailto:');
      });
      if (!a) return null;
      const href = a.getAttribute('href');
      a.click();
      return href;
    },
    null,
    15_000
  );
}

/** reviews/<PREFIX>-<n>.md, next free n. Reports are never overwritten. */
export function nextReport(dir, prefix) {
  let max = 0;
  try {
    for (const f of readdirSync(dir)) {
      const m = new RegExp('^' + prefix + '-(\\d+)\\.md$').exec(f);
      if (m) max = Math.max(max, Number(m[1]));
    }
  } catch {}
  return { n: max + 1, file: resolve(dir, `${prefix}-${max + 1}.md`) };
}


/* --------------------------------------------------- §12.3 desktop structure
 * What the live desktop actually contains: the archetype it declared, whether
 * the bar/dock and clock are really there, whether the launchers are icons in a
 * grid rather than a list, and whether the kernel's images landed. Shared with
 * scripts/integrate.mjs's own copy of this idea; the bake-off needs it to judge
 * archetype compliance rather than take the attribute's word for it.
 */
export const inspectDesktop = (page) =>
  evalSafe(
    page,
    () => {
      const vw = innerWidth;
      const vh = innerHeight;
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const bgOf = (el) => (el ? getComputedStyle(el).backgroundImage || '' : '');
      const wallEl = document.querySelector('[data-os-img="wallpaper"]') || document.querySelector('[data-os-desktop]');
      // The kernel paints the wallpaper onto its OWN child layer, not onto the
      // host's background-image (KERNEL-4: a background image cannot be faded
      // in), so a host-only test reports "none" on every boot. BAKEOFF-3 found
      // this the hard way. Look at the layer wherever the kernel put it.
      const wallLayer =
        document.querySelector('[data-os-img-layer="wallpaper"]') ||
        document.querySelector('[data-os-img-filled="wallpaper"]');
      /**
       * BAKEOFF-3 open issue 8: `data-os-icon` slots outnumbered the sheet's
       * sixteen cells on every boot (16/20, 16/17, 16/24) because the model
       * declares icon slots in menus and taskbar templates too, and those
       * surplus slots stay empty for good. The sheet is bought for the
       * LAUNCHERS, so the launchers are what is counted; the surplus is
       * reported separately instead of being scored as a miss.
       */
      const iconSlots = [...document.querySelectorAll('[data-os-icon]')];
      const icons = iconSlots.filter((el) => el.closest('[data-os-app]'));
      const iconsElsewhere = iconSlots.length - icons.length;
      const isFilled = (el) => /url\("data:image/.test(getComputedStyle(el).backgroundImage || '');
      const filled = icons.filter(isFilled);
      const clock = document.querySelector('[data-os-clock]');
      const bar = document.querySelector('[data-os-taskbar]');
      const launchers = [...document.querySelectorAll('[data-os-app]')];
      const lb = launchers.map(box);
      // icons in a grid: more than one distinct column AND more than one
      // distinct row among the launchers. One column = a list, one row = a dock
      // strip (which is what the dock archetype wants, and is judged there).
      const cols = new Set(lb.map((b) => Math.round(b.x / 24))).size;
      const rows = new Set(lb.map((b) => Math.round(b.y / 24))).size;
      /**
       * KERNEL-7 §1/§10.1 — this line used to be
       *   launchers.filter((el) => (el.innerText || '').trim().length > 0)
       * and it reported `16 labelled` on every boot of every probe while D3 was
       * live: `innerText` is indifferent to CLIPPING, so a label pushed out
       * through a dock's `overflow:hidden` still reads as text. The instrument
       * that says "the labels are fine" has to be the visitor's question —
       * pixels on screen — so:
       *
       *   labelText(el)  = the launcher's text that is NOT the glyph, i.e. text
       *                    outside any [data-os-icon] subtree (a dock launcher
       *                    whose only text is an emoji has no label)
       *   visibleArea(n) = that text's client rects intersected with every
       *                    clipping ancestor and the viewport, dropped to 0 by
       *                    display:none / visibility:hidden / opacity 0
       *
       * Reported as three numbers rather than one, because they are three
       * different claims: has a label in the document, that label has pixels,
       * and — the D3 shape — has one and has no pixels.
       */
      const clipOf = (el) => {
        let l = 0;
        let t = 0;
        let r = vw;
        let b = vh;
        for (let p = el.parentElement; p; p = p.parentElement) {
          const cs = getComputedStyle(p);
          const ov = (cs.overflow || '') + (cs.overflowX || '') + (cs.overflowY || '');
          if (/hidden|clip|scroll|auto/.test(ov)) {
            const pr = p.getBoundingClientRect();
            l = Math.max(l, pr.left);
            t = Math.max(t, pr.top);
            r = Math.min(r, pr.right);
            b = Math.min(b, pr.bottom);
          }
        }
        return { l, t, r, b };
      };
      const drawn = (el) => {
        for (let p = el; p; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
        }
        return true;
      };
      /** text nodes of `el` that are not inside the glyph slot */
      const labelNodes = (el) => {
        const out = [];
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (!(n.textContent || '').trim()) continue;
          const host = n.parentElement;
          if (!host || host.closest('[data-os-icon]')) continue;
          out.push(n);
        }
        return out;
      };
      const labelPixels = (el) => {
        let area = 0;
        for (const n of labelNodes(el)) {
          const host = n.parentElement;
          if (!host || !drawn(host)) continue;
          const clip = clipOf(host);
          const rg = document.createRange();
          rg.selectNodeContents(n);
          for (const r of rg.getClientRects()) {
            const w = Math.min(r.right, clip.r) - Math.max(r.left, clip.l);
            const h = Math.min(r.bottom, clip.b) - Math.max(r.top, clip.t);
            if (w > 0 && h > 0) area += w * h;
          }
        }
        return Math.round(area);
      };
      const labelReads = launchers.map((el) => ({
        text: labelNodes(el).length > 0,
        px: labelPixels(el),
      }));
      const labelled = labelReads.filter((r) => r.px > 0).length;
      const labelInDom = labelReads.filter((r) => r.text).length;
      const labelsLost = labelReads.filter((r) => r.text && r.px === 0).length;
      /**
       * T4's net, as the kernel recorded it: `data-os-label-kept="<before>><after>><restored>"`
       * on any launcher whose visible label pixels dropped when a picture
       * landed. Zero of these on a boot is the claim "no label needed saving";
       * a non-zero count with `labelsLost: 0` is the net working.
       */
      const labelKept = [...document.querySelectorAll('[data-os-label-kept]')].map((el) =>
        el.getAttribute('data-os-label-kept')
      );
      const iconBoxed = document.querySelectorAll('[data-os-img-boxed]').length;
      /**
       * D4 — "sky23:12:50". The clock jammed against the OS name with no space.
       * Measured as pixels between the clock's own text and the nearest other
       * run of text on the same line of the bar: a run whose vertical band
       * overlaps the clock's, to its left or right. `null` = nothing else is on
       * that line, which is not a defect.
       */
      const barSpacing = (() => {
        if (!bar) return null;
        /**
         * HANDOFF-7 — this instrument was anchored on `[data-os-clock]` and
         * reported `jammed: false` on the very bar that reproduced D4. Two
         * reasons, both fatal:
         *
         *  - on a desktop that never declared `[data-os-clock]`, the element it
         *    measured was the KERNEL's injected clock, which the kernel pads;
         *    the model's own jammed pair ("02:03:55" immediately followed by
         *    "9/18/2026", boot 1 of the v0.5 desktop run) was never looked at.
         *  - it only ever measured the two neighbours of ONE run. D4 is a
         *    property of the bar: any two runs of text with no space between
         *    them read as one word, wherever they are.
         *
         * So: every pair of text runs that share a line, adjacent with nothing
         * between them, and the tightest gap wins. The kernel's own injected
         * runs are measured separately (`ours`) so a defect of ours and a
         * defect of the model's can never be confused for each other.
         */
        const runs = [...bar.querySelectorAll('*')]
          .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim()))
          .filter((el) => drawn(el) && !el.closest('[data-os-icon]'))
          .map((el) => ({
            el,
            r: el.getBoundingClientRect(),
            ours: !!el.closest('[data-os-injected]'),
            text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24),
          }))
          .filter((x) => x.r.width > 0 && x.r.height > 0)
          // a run that contains another run is a container, not a run of text
          .filter((x, _i, all) => !all.some((o) => o !== x && x.el.contains(o.el)));
        const pairs = [];
        for (const a of runs) {
          for (const b of runs) {
            if (a === b) continue;
            if (!(b.r.left >= a.r.right - 2)) continue;
            const sameLine = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top) > 2;
            if (!sameLine) continue;
            // adjacent: nothing else of the bar's text sits between them
            if (runs.some((c) => c !== a && c !== b && c.r.left >= a.r.right - 2 && c.r.right <= b.r.left + 2 &&
                Math.min(a.r.bottom, c.r.bottom) - Math.max(a.r.top, c.r.top) > 2)) continue;
            pairs.push({ gap: b.r.left - a.r.right, ours: a.ours || b.ours, a: a.text, b: b.text });
          }
        }
        const pick = (list) => (list.length ? list.reduce((m, p) => (p.gap < m.gap ? p : m)) : null);
        const model = pick(pairs.filter((p) => !p.ours));
        const ours = pick(pairs.filter((p) => p.ours));
        /** the visitor's reading: two runs of text with fewer than 4 px between them read as one word */
        const JAM = 4;
        return {
          pairs: pairs.length,
          min: model ? Math.round(model.gap) : null,
          jammed: !!model && model.gap < JAM,
          tightest: model ? model.a + '|' + Math.round(model.gap) + 'px|' + model.b : null,
          oursMin: ours ? Math.round(ours.gap) : null,
          oursJammed: !!ours && ours.gap < JAM,
          clock: clock ? { patched: clock.hasAttribute('data-os-injected'), inBar: !!(bar && bar.contains(clock)) } : null,
          text: (bar.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        };
      })();
      /**
       * BAKEOFF-3 open issue 3: launcher labels and icons written across each
       * other on two of nine desktops. The off-screen rule was measured and
       * therefore got fixed; this one was not measured and therefore did not.
       * Pairwise overlap of the launcher boxes, in the two forms that matter:
       * how many launchers are covered by another at all, and the worst overlap
       * as a fraction of the smaller box (a 1 px kiss is not a collision).
       */
      const area = (b) => Math.max(0, b.w) * Math.max(0, b.h);
      const overlapOf = (a, b) => {
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        return w > 0 && h > 0 ? w * h : 0;
      };
      let overlapping = 0;
      let worstOverlap = 0;
      const solid = lb.filter((b) => b.w > 4 && b.h > 4);
      for (let i = 0; i < solid.length; i++) {
        let hit = 0;
        for (let j = 0; j < solid.length; j++) {
          if (i === j) continue;
          const ov = overlapOf(solid[i], solid[j]);
          if (!ov) continue;
          const frac = ov / Math.max(1, Math.min(area(solid[i]), area(solid[j])));
          if (frac > 0.08) {
            hit = 1;
            worstOverlap = Math.max(worstOverlap, frac);
          }
        }
        overlapping += hit;
      }
      const barBox = bar ? box(bar) : null;
      const clockBox = clock ? box(clock) : null;
      /**
       * BAKEOFF-4: "the bar is at the bottom edge" is not the same claim as
       * "the bar is legible". On one desktop this run the taskbar's own box sat
       * inside the viewport while its task entries stuck out of it top and
       * bottom, so every open window's name in the bar was cut off below the
       * screen — a bar with the right edge and unreadable contents.
       *
       * So: the bar's descendants, measured against the viewport and against
       * the bar's own box. `outside` is the count clipped by the screen,
       * `overflowBottom` is how far past the bottom the worst one goes, and
       * `overflowsBar` is the count hanging out of the bar itself (which is how
       * it happens: an entry taller than the bar, vertically centred on it).
       */
      const barFit = (() => {
        if (!bar || !barBox) return null;
        const kids = [...bar.querySelectorAll('*')].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 2 && r.height > 2;
        });
        let outside = 0;
        let overflowsBar = 0;
        let overflowBottom = 0;
        for (const el of kids) {
          const r = el.getBoundingClientRect();
          if (r.bottom > vh + 2 || r.top < -2 || r.right > vw + 2 || r.left < -2) outside++;
          if (r.bottom > barBox.y + barBox.h + 2 || r.top < barBox.y - 2) overflowsBar++;
          overflowBottom = Math.max(overflowBottom, Math.round(r.bottom - vh));
        }
        return { kids: kids.length, outside, overflowsBar, overflowBottom: Math.max(0, overflowBottom) };
      })();
      /** §12.3's "one entry per open window": are those entries readable where they sit? */
      const tasks = [...document.querySelectorAll('[data-os-task-for]')];
      const taskLegible = tasks.filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom > vh + 2 || r.top < -2) return false;
        return (el.innerText || '').trim().length > 0 || !!el.querySelector('[data-os-icon],img,svg');
      }).length;
      return {
        archetypeAttr:
          document.documentElement.getAttribute('data-os-archetype') ||
          document.body.getAttribute('data-os-archetype') ||
          (document.querySelector('[data-os-archetype]')?.getAttribute('data-os-archetype') ?? null),
        archetypePatched: document.documentElement.hasAttribute('data-os-archetype-patched'),
        viewport: { vw, vh },
        taskbar: !!bar,
        taskbarBox: barBox,
        // where the bar sits: a taskbar wants the bottom edge, a dock's menu bar the top
        taskbarEdge: barBox
          ? barBox.y + barBox.h > vh - 0.15 * vh
            ? 'bottom'
            : barBox.y < 0.15 * vh
              ? 'top'
              : barBox.x < 0.15 * vw
                ? 'left'
                : barBox.x + barBox.w > vw - 0.15 * vw
                  ? 'right'
                  : 'floating'
          : null,
        barFit,
        tasks: tasks.length,
        tasksLegible: taskLegible,
        clockInside: clockBox ? clockBox.y >= -2 && clockBox.y + clockBox.h <= vh + 2 && clockBox.x + clockBox.w <= vw + 2 : null,
        fitGuard: document.documentElement.hasAttribute('data-os-fit')
          ? document.documentElement.hasAttribute('data-os-fit-pinned')
            ? 'pinned'
            : 'fit'
          : null,
        clock: !!clock,
        clockText: clock ? (clock.textContent || '').trim().slice(0, 60) : '',
        clockPatched: clock ? clock.hasAttribute('data-os-injected') : false,
        clockInBar: !!(clock && bar && bar.contains(clock)),
        clockEdge: clockBox ? (clockBox.y < 0.15 * vh ? 'top' : clockBox.y + clockBox.h > vh - 0.15 * vh ? 'bottom' : 'middle') : null,
        launchers: launchers.length,
        launchersLabelled: labelled,
        // KERNEL-7 §10.1: the three claims, not one
        launchersLabelInDom: labelInDom,
        launchersLabelsLost: labelsLost,
        labelKept,
        iconBoxed,
        barSpacing,
        /**
         * SEAM T4, as the kernel published it at mount and per window:
         * whether the window TEMPLATE's chrome was usable before anything was
         * opened, and every contract patch the kernel had to make.
         */
        chromeTemplate: document.documentElement.getAttribute('data-os-chrome-template'),
        contractPatch: document.documentElement.getAttribute('data-os-contract-patch'),
        launcherCols: cols,
        launcherRows: rows,
        grid: cols > 1 && rows > 1,
        launchersOffscreen: Number(document.documentElement.getAttribute('data-os-launchers-offscreen') || 0),
        launchersOverlapping: overlapping,
        launcherWorstOverlap: Math.round(worstOverlap * 100) / 100,
        icons: icons.length,
        iconsFilled: filled.length,
        // slots outside a launcher (menus, task templates): paid for nothing
        iconSlotsElsewhere: iconsElsewhere,
        iconSlotsElsewhereFilled: iconSlots.filter((el) => !el.closest('[data-os-app]')).filter(isFilled).length,
        wallpaper: /url\("data:image/.test(bgOf(wallLayer)) || /url\("data:image/.test(bgOf(wallEl)),
        wallpaperOn: !wallLayer
          ? 'none'
          : wallLayer.closest('[data-os-img="wallpaper"]')
            ? 'slot'
            : wallLayer.closest('[data-os-desktop]')
              ? 'desktop-fallback'
              : 'body',
        windowTemplate: !!document.querySelector('template[data-os-window]'),
        injected: document.querySelectorAll('[data-os-injected]').length,
      };
    },
    null,
    15_000
  );

/** The clock's current face, for the tick check. */
export const clockText = (page) =>
  evalSafe(page, () => (document.querySelector('[data-os-clock]')?.textContent || '').trim().slice(0, 60), '', 8000);

/**
 * SPEC §12.3 wants a clock that ticks. A clock with seconds proves it in six;
 * one with only hours and minutes can need a full minute, which is why this
 * returns "undecided" rather than "dead" when the face has no seconds — the
 * caller re-reads it at the end of the boot, by which time a minute has passed
 * for free.
 */
export async function clockTickQuick(page, seconds = 7) {
  const a = await clockText(page);
  const hasSeconds = /\d{1,2}:\d{2}:\d{2}/.test(a);
  // An empty face seconds after mount is a clock whose script has not run yet,
  // not a dead clock: BAKEOFF-3 read two clocks as dead that were showing the
  // time in the very next screenshot. Undecided, and the late read decides.
  if (!a) return { ticked: null, resolution: 'empty', from: a, to: a };
  if (!hasSeconds) return { ticked: null, resolution: 'minutes', from: a, to: a };
  const t = Date.now();
  while (Date.now() - t < seconds * 1000) {
    await sleep(700);
    const b = await clockText(page);
    if (b && b !== a) return { ticked: true, resolution: 'seconds', from: a, to: b };
  }
  return { ticked: false, resolution: 'seconds', from: a, to: await clockText(page) };
}

/**
 * The late half of the tick test, for the faces `clockTickQuick` left
 * undecided: an empty one (script had not run) and a minute-resolution one
 * (which needs a minute to prove anything). Called at the end of a boot, when
 * a minute has usually passed for free — and when it has not, the answer is
 * "undecided", never "dead". Returns the clock record to store.
 */
export function clockTickLate(quick, late, startedAt) {
  const from = quick.from || '';
  const to = late || '';
  if (to && to !== from) return { ...quick, to, ticked: true, resolution: quick.resolution === 'empty' ? 'late' : quick.resolution, lateRead: true };
  if (!to) return { ...quick, to, ticked: false, resolution: 'none', lateRead: true };
  // Same face. Only call it dead if a minute actually elapsed between the reads.
  const elapsed = Date.now() - (startedAt || 0);
  return { ...quick, to, ticked: elapsed > 65_000 ? false : null, lateRead: true, elapsed_ms: elapsed };
}

/**
 * SEAM T4 / D2 — "a visitor cannot close or move that window."
 *
 * The kernel publishes its own verdict (`data-os-chrome="ok|patched"`), and this
 * reads the WINDOW instead, independently, because the claim under test is not
 * "the kernel thinks it patched" but "a person can close and move this window":
 *
 *   closeHit  — elementFromPoint at the middle of [data-os-close] returns that
 *               control (or something inside it). The live test's window had the
 *               attribute and 0×0 pixels, which is exactly what a box-only
 *               reading cannot tell apart from a working button.
 *   dragHit   — the same question of the title strip, which is how a window moves.
 *   usable    — both of those, plus the T4 thresholds (strip ≥ 20 px tall,
 *               close ≥ 16×16 after clipping).
 *
 * `patched` is the kernel's answer to a window that was not usable; `usable`
 * must be true on every window either way, and `usableUnpatched` is the rate
 * before the net catches anything — the before/after D2 wants.
 */
export const inspectWindows = (page, only = null) =>
  evalSafe(
    page,
    (only) => {
      const vis = (el) => {
        let l = 0;
        let t = 0;
        let r = innerWidth;
        let b = innerHeight;
        for (let p = el.parentElement; p; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (/hidden|clip|scroll|auto/.test((cs.overflow || '') + (cs.overflowX || '') + (cs.overflowY || ''))) {
            const pr = p.getBoundingClientRect();
            l = Math.max(l, pr.left);
            t = Math.max(t, pr.top);
            r = Math.min(r, pr.right);
            b = Math.min(b, pr.bottom);
          }
          if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return { w: 0, h: 0 };
        }
        const box = el.getBoundingClientRect();
        return {
          w: Math.max(0, Math.min(box.right, r) - Math.max(box.left, l)),
          h: Math.max(0, Math.min(box.bottom, b) - Math.max(box.top, t)),
        };
      };
      /**
       * Can a pointer reach it, and if not, WHAT is in the way. A window that
       * is behind another window has an unreachable title bar and that is
       * window stacking, not a defect — so the reading has to name the blocker
       * (`another window` vs `its own content` vs `nothing, it has no pixels`)
       * and the caller has to raise the window before believing a `false`.
       */
      const hits = (el, self) => {
        if (!el) return { hit: false, why: 'absent' };
        const box = el.getBoundingClientRect();
        if (box.width < 1 || box.height < 1) return { hit: false, why: 'no-box' };
        const pts = [
          [box.left + box.width / 2, box.top + box.height / 2],
          [box.left + box.width * 0.3, box.top + box.height * 0.5],
          [box.left + box.width * 0.7, box.top + box.height * 0.5],
        ];
        let blocker = 'offscreen';
        for (const [x, y] of pts) {
          if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
          const at = document.elementFromPoint(Math.round(x), Math.round(y));
          if (at && (at === el || el.contains(at) || at.contains(el))) return { hit: true, why: '' };
          if (!at) blocker = 'nothing';
          else {
            const ow = at.closest('[data-os-window-id]');
            if (ow) blocker = ow === self ? 'own-content' : 'other-window';
            else {
              /**
               * Not a window. Name it, because "a div" is not a finding and
               * "the machine's own menu bar is over this window's title bar"
               * is: §12.9 raises the bar above the windows layer, so a window
               * the cascade put under a top bar has chrome with real pixels
               * that no pointer can reach.
               */
              const known = at.closest('[data-os-taskbar],[data-os-dock],[data-os-desktop],[data-os-menu]');
              const name = known
                ? (known.hasAttribute('data-os-taskbar')
                    ? 'taskbar'
                    : known.hasAttribute('data-os-dock')
                      ? 'dock'
                      : known.hasAttribute('data-os-menu')
                        ? 'menu'
                        : 'desktop')
                : at.id
                  ? '#' + at.id
                  : at.tagName.toLowerCase() +
                    (at.className && typeof at.className === 'string' ? '.' + at.className.trim().split(/\s+/)[0] : '');
              const cs = getComputedStyle(at);
              blocker = name + '[' + cs.position + ' z' + (cs.zIndex || 'auto') + ']';
            }
          }
        }
        return { hit: false, why: blocker };
      };
      // the window ROOT the kernel created, not `template[data-os-window]`
      return [...document.querySelectorAll('[data-os-window-id]')]
        .filter((w) => !only || w.getAttribute('data-os-window-id') === only)
        .map((w) => {
          const close = w.querySelector('[data-os-close]');
          const min = w.querySelector('[data-os-minimise], [data-os-minimize]');
          const max = w.querySelector('[data-os-maximise], [data-os-maximize]');
          const drag = w.querySelector('[data-os-drag]');
          const cv = close ? vis(close) : { w: 0, h: 0 };
          const dv = drag ? vis(drag) : { w: 0, h: 0 };
          const closeHit = hits(close, w);
          const dragHit = hits(drag, w);
          const bigEnough = cv.w >= 16 && cv.h >= 16;
          const strip = dv.h >= 20;
          return {
            id: w.getAttribute('data-os-window-id') || '',
            app: w.getAttribute('data-os-window-app') || w.getAttribute('data-os-app') || '',
            chrome: w.getAttribute('data-os-chrome'),
            why: w.getAttribute('data-os-chrome-why') || '',
            fallbackStrip: !!w.querySelector('[data-os-chrome-fallback]'),
            close: !!close,
            minimise: !!min,
            maximise: !!max,
            closeBox: { w: Math.round(cv.w), h: Math.round(cv.h) },
            dragBox: { w: Math.round(dv.w), h: Math.round(dv.h) },
            closeHit: closeHit.hit,
            closeBlocked: closeHit.hit ? undefined : closeHit.why,
            dragHit: dragHit.hit,
            dragBlocked: dragHit.hit ? undefined : dragHit.why,
            /** a person can close it AND move it */
            usable: closeHit.hit && bigEnough && dragHit.hit && strip,
          };
        });
    },
    [],
    12_000,
    only
  );

/**
 * D2's real question, per window: RAISE it the way a visitor does, then ask
 * whether its close control and its title strip can be reached. A window read
 * while it sits under the cascade reports an unreachable bar and that is the
 * stack, not the chrome.
 */
export async function probeWindowChrome(page, ms = 250) {
  const ids = await evalSafe(
    page,
    () => [...document.querySelectorAll('[data-os-window-id]')].map((w) => w.getAttribute('data-os-window-id')),
    [],
    8000
  );
  const out = [];
  for (const id of ids) {
    await page
      .locator(`[data-os-window-id="${id}"]`)
      .first()
      .dispatchEvent('pointerdown')
      .catch(() => {});
    await sleep(ms);
    const r = await inspectWindows(page, id);
    if (r && r[0]) out.push(r[0]);
  }
  return out;
}

/** Every task entry in the bar, and whether its name is readable where it sits. */
export const inspectTasks = (page) =>
  evalSafe(
    page,
    () =>
      [...document.querySelectorAll('[data-os-task-for]')].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          for: el.getAttribute('data-os-task-for'),
          box: { w: Math.round(r.width), h: Math.round(r.height) },
          onScreen: r.top > -2 && r.bottom < innerHeight + 2 && r.left > -2 && r.right < innerWidth + 2,
          text: (el.innerText || '').trim().slice(0, 40),
          fallback: el.hasAttribute('data-os-task-fallback'),
        };
      }),
    [],
    12_000
  );

/**
 * SEAM T2 — tile sheets, read off the document that asked for them.
 * One sheet per theme is the contract, so the reading is per theme: how many
 * elements carry a tile of it, and how many of those actually show a picture.
 */
export const inspectTiles = (frame) =>
  evalSafe(
    frame,
    () => {
      const groups = {};
      for (const el of document.querySelectorAll('[data-os-tile], [data-os-face]')) {
        const theme = el.getAttribute('data-os-theme') || (el.hasAttribute('data-os-face') ? 'faces' : 'unknown');
        const g = (groups[theme] = groups[theme] || { theme, tiles: 0, filled: 0, seen: 0, boxes: [], slots: {} });
        g.tiles++;
        const bg = getComputedStyle(el).backgroundImage || '';
        const r = el.getBoundingClientRect();
        const has = /url\("data:image/.test(bg);
        if (has) g.filled++;
        /**
         * "filled" and "a person can see a picture there" are different claims,
         * and the youtube-shaped page of boot 1 read 10/10 filled while the
         * shot showed ten flat grey plates. So: a tile counts as SEEN when it
         * carries the sheet AND has a box of at least 24x24 on screen. A tile
         * that is filled and not seen is a picture bought and hidden — usually
         * a tiny element inside the plate the eye actually reads.
         */
        if (has && r.width >= 24 && r.height >= 24 && r.bottom > 0 && r.top < innerHeight) g.seen++;
        if (g.boxes.length < 4) g.boxes.push(Math.round(r.width) + 'x' + Math.round(r.height));
        const slot = el.getAttribute('data-os-img-slot');
        if (slot) g.slots[slot] = (g.slots[slot] || 0) + 1;
        /**
         * R4 — the box and the first row. HANDOFF-7 §7's third tile finding was
         * "the first row is often blank": the sheet's own top-left cells over a
         * white gradient while rows 2-3 are photographs. So the reading has to
         * be per ROW, not only per theme — a grid whose first row is empty is a
         * page that looks broken however many tiles below it filled.
         *
         * A row is every tile within 8 px of the same document top (offsetTop,
         * not the viewport, so scrolling cannot rename a row). R4's other two
         * numbers ride along: the widest tile of the theme (the bounded box) and
         * whether the first row starts inside the first screen.
         */
        const top = Math.round((r.top + (window.scrollY || 0)) / 8) * 8;
        (g.rows = g.rows || {})[top] = g.rows[top] || { top, n: 0, filled: 0, seen: 0 };
        g.rows[top].n++;
        if (has) g.rows[top].filled++;
        if (has && r.width >= 24 && r.height >= 24) g.rows[top].seen++;
        g.maxW = Math.max(g.maxW || 0, Math.round(r.width));
        g.maxH = Math.max(g.maxH || 0, Math.round(r.height));
      }
      return Object.values(groups).map((g) => {
        const rows = Object.values(g.rows || {}).sort((a, b) => a.top - b.top);
        const r1 = rows[0] || null;
        return {
          ...g,
          slots: Object.keys(g.slots).length,
          rows: rows.length,
          row1: r1 ? { n: r1.n, filled: r1.filled, seen: r1.seen, top: r1.top } : null,
          row1OnFirstScreen: r1 ? r1.top < innerHeight : null,
        };
      });
    },
    [],
    12_000
  );

/**
 * R2's instrument, and it is deliberately NOT the kernel's.
 *
 * "One clock on the screen" cannot be read off `[data-os-clock]` — that is the
 * hook, and HANDOFF-7 §4's defect was precisely a screen with two clocks and
 * one hook. So: every VISIBLE leaf run of text anywhere on the machine whose
 * own text reads as a time (HH:MM, optionally :SS) is a clock face, counted
 * whoever wrote it, and each is labelled with where it came from —
 * `adopted` (R2 gave the model's element the hook), `injected` (the kernel's
 * fallback), `model` (the model's, unhooked) — so two faces can never be
 * averaged into one verdict.
 */
export const inspectClocks = (page) =>
  evalSafe(
    page,
    () => {
      const RE = /(?:^|[^0-9])([01]?[0-9]|2[0-3])[:.]([0-5][0-9])(?:[:.]([0-5][0-9]))?(?![0-9])/;
      const seen = [];
      for (const el of document.querySelectorAll('body *')) {
        const tag = el.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TITLE' || tag === 'META' || tag === 'LINK') continue;
        const text = (el.textContent || '').trim();
        if (!text || text.length > 64 || !RE.test(text)) continue;
        // leaves only: a bar that contains the clock also matches
        if ([...el.children].some((c) => RE.test((c.textContent || '').trim()))) continue;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        if (r.width < 4 || r.height < 4) continue;
        if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
        seen.push({
          text: text.slice(0, 40),
          origin: el.hasAttribute('data-os-clock-adopted')
            ? 'adopted'
            : el.hasAttribute('data-os-injected')
              ? 'injected'
              : el.hasAttribute('data-os-clock')
                ? 'hooked'
                : 'model',
          inBar: !!el.closest('[data-os-taskbar],[data-os-menu],[data-os-menubar],[data-os-dock]'),
          box: Math.round(r.width) + 'x' + Math.round(r.height),
        });
      }
      return {
        count: seen.length,
        faces: seen.slice(0, 6),
        hooked: document.querySelectorAll('[data-os-clock]').length,
        adopted: !!document.querySelector('[data-os-clock-adopted]'),
        injected: !!document.querySelector('[data-os-clock][data-os-injected]'),
        ticks: document.documentElement.getAttribute('data-os-clock-ticks'),
      };
    },
    { count: null, faces: [], hooked: null },
    12_000
  );

/**
 * R1's instrument. Not "how many windows exist" — how many a visitor can SEE.
 * A minimised window is `display:none` and its task entry is the way back, so
 * it is not on the screen; the ruling is that below 768 px exactly one window
 * is. Read after every single open, because "one at the end" and "one at every
 * step" are different claims and only the second is the ruling.
 */
export const visibleWindows = (page) =>
  evalSafe(
    page,
    () => {
      const out = [];
      for (const w of document.querySelectorAll('[data-os-window-id]')) {
        const cs = getComputedStyle(w);
        const r = w.getBoundingClientRect();
        const hidden =
          cs.display === 'none' ||
          cs.visibility === 'hidden' ||
          Number(cs.opacity) === 0 ||
          r.width < 2 ||
          r.height < 2 ||
          r.bottom <= 0 ||
          r.top >= innerHeight ||
          r.right <= 0 ||
          r.left >= innerWidth;
        out.push({
          id: w.getAttribute('data-os-window-id') || '',
          app: w.getAttribute('data-os-window-app') || '',
          min: w.hasAttribute('data-os-minimized'),
          z: Number(cs.zIndex) || 0,
          box: Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.x) + ',' + Math.round(r.y),
          visible: !hidden,
        });
      }
      const vis = out.filter((w) => w.visible);
      return { total: out.length, visible: vis.length, top: vis.sort((a, b) => b.z - a.z)[0]?.id || null, windows: out };
    },
    { total: null, visible: null, windows: [] },
    12_000
  );

/**
 * Can a pointer reach these elements where they sit? A generic hit test, used
 * for two questions this pass has to answer honestly: after the phone has
 * minimised everything, is the bar's task entry — the only way back — actually
 * tappable; and once the windows are closed, are the launchers clickable again.
 * `covered` names the blocker, because "unreachable" without a blocker is not
 * a finding.
 */
export const reachReading = (page, sel) =>
  evalSafe(
    page,
    (s) =>
      [...document.querySelectorAll(s)].map((el) => {
        const r = el.getBoundingClientRect();
        const id = el.getAttribute('data-os-app') || el.getAttribute('data-os-task-for') || el.tagName.toLowerCase();
        if (r.width < 1 || r.height < 1) return { id, reach: false, why: 'no-box' };
        for (let iy = 1; iy <= 5; iy++)
          for (let ix = 1; ix <= 5; ix++) {
            const x = r.x + (r.width * ix) / 6;
            const y = r.y + (r.height * iy) / 6;
            if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;
            const at = document.elementFromPoint(Math.round(x), Math.round(y));
            if (at && (at === el || el.contains(at))) return { id, reach: true };
          }
        const cx = Math.min(innerWidth - 2, Math.max(2, r.x + r.width / 2));
        const cy = Math.min(innerHeight - 2, Math.max(2, r.y + r.height / 2));
        const at = document.elementFromPoint(Math.round(cx), Math.round(cy));
        const win = at && at.closest && at.closest('[data-os-window-id]');
        /**
         * "a div" is not a finding. Name the blocker the way the kernel would
         * recognise it: its own id, every `data-os-*` hook on it, and its
         * position/z — the difference between the model's bar sitting over its
         * own task entry and the KERNEL's windows layer eating the only way
         * back to a minimised window is the whole finding.
         */
        const name = (el) => {
          if (!el) return 'nothing';
          const hooks = [...el.attributes].map((a) => a.name).filter((n) => n.startsWith('data-os-'));
          const cs = getComputedStyle(el);
          return (
            el.tagName.toLowerCase() +
            (el.id ? '#' + el.id : '') +
            (hooks.length ? '[' + hooks.join(' ') + ']' : '') +
            ' ' +
            cs.position +
            ' z' +
            (cs.zIndex || 'auto') +
            ' pe:' +
            cs.pointerEvents
          );
        };
        /**
         * The /bakeoff HUD is the HARNESS's own furniture (`kernel/index.ts`
         * builds it only when MODE === 'bakeoff'; no visitor of `/` ever sees
         * it) and on a 390 px phone it covers a third of the screen. A reading
         * that calls the product unreachable because the instrument is standing
         * on it is the instrument lying, so it is flagged, never counted as a
         * defect of the product.
         */
        const harness = !!(at && at.closest && at.closest('[data-os-hud],[data-os-dock-hint],#os-bakeoff-dock'));
        /**
         * Whose fault: the element's own CSS or something painted over it?
         * `pointer-events:none` on the launcher (or an ancestor) makes
         * `elementFromPoint` return the PARENT, which looks identical to being
         * covered and is a completely different finding.
         */
        const mine = getComputedStyle(el);
        let peChain = '';
        for (let a = el; a && a !== document.body; a = a.parentElement) {
          if (getComputedStyle(a).pointerEvents === 'none') {
            /**
             * KERNEL-9 — named the way the blocker above is named, and for the
             * same reason: the first `peNoneAt` reading in the tree said
             * `"div"`, which cannot tell the model's own transparent overlay
             * from the kernel's empty windows layer, `#os-root`, or the
             * wallpaper host's pass-through. Every `data-os-*` hook on it, so
             * the next pass knows whose `pointer-events:none` it is.
             */
            peChain =
              a === el
                ? 'self'
                : a.tagName.toLowerCase() +
                  (a.id ? '#' + a.id : '') +
                  [...a.attributes]
                    .map((at) => at.name)
                    .filter((n) => n.startsWith('data-os-'))
                    .map((n) => '[' + n + ']')
                    .join('');
            break;
          }
        }
        return {
          id,
          reach: false,
          pe: mine.pointerEvents,
          peNoneAt: peChain || undefined,
          selfZ: mine.zIndex + '/' + mine.position,
          harness: harness || undefined,
          why: !at ? 'offscreen' : win ? 'window ' + win.getAttribute('data-os-window-id') : name(at),
          inside: at ? name(at.parentElement) : null,
        };
      }),
    [],
    12_000,
    sel
  );
