import { validate, nextVersion, coerceIdentity, scanIdentityComment, IDENTITY_OPEN, type Identity } from './contract.js';
import {
  genStream,
  genIdentity,
  gen as spec,
  mark,
  identitySeen,
  newGenId,
  CapError,
  RerouteError,
  type GenRequest,
  type GenResult,
  type GenTelemetry,
  type SpecHandle,
} from './gen.js';
import { netNote, netSnapshot } from './net.js';
import { trace, traceLoud, traceDump, setTraceSink, guard, guarded } from './trace.js';
import { Frame } from './frames.js';
import {
  mountDesktop,
  unmount,
  injectMissing,
  domMissing,
  stopFallbackClock,
  fitViewport,
  fitBarContents,
  fitBarGaps,
  fitLauncherRow,
  adoptClock,
  verifyClockTick,
  type LauncherSpec,
  type Mounted,
} from './inject.js';
import { readHost, WindowManager, probeChrome, type OsWindow } from './windows.js';
import { rectOf } from './visible.js';
import { newSession, persist, snapshot, type AppSpec, type SessionState } from './session.js';
import { showQueue, showError, clearScreen } from './screens.js';
import { Hud, enginePicker, undock, isKernelChrome } from './hud.js';
import { isMobile } from './geometry.js';
import { requestBootImage, requestDocImage, applyWallpaper, applyIconSheet, resetImgStyles } from './img.js';
import { DOC_IMG_LIMIT, IMG_PROMPT_MAX, PAGE_IMG_DWELL_MS, type DocImgKind } from './protocol.js';

/* ------------------------------------------------------------------ state */

/**
 * The HUD and the engine picker exist on the bake-off *run* route only
 * (SPEC §12.6 / I8): `/bakeoff` is a plain landing page served by the server,
 * `/bakeoff/run?engine=` is this. The server says which page it rendered; the
 * path is the second witness, so a stale `/bakeoff` kernel page cannot show a
 * HUD on `/`.
 */
const MODE = document.body.getAttribute('data-mode') === 'bakeoff' && /\/bakeoff\/run\/?$/.test(location.pathname) ? 'bakeoff' : 'plain';
const root = document.getElementById('os-root') as HTMLElement;

/**
 * KERNEL-7 — `#os-root` must not eat a launcher click, and it was.
 *
 * The kernel page (`server/page.ts`) serves one empty div,
 * `#os-root{position:fixed;inset:0}`, and the desktop is mounted into
 * `document.body` beside it. A positioned box paints above the in-flow content
 * of the same stacking context, so on every desktop whose launcher area is in
 * NORMAL FLOW — which is what `prompts/system/desktop.md` asks for, a
 * `display:grid` section on the wallpaper — `#os-root` is the topmost thing at
 * every launcher, `document.elementFromPoint` returns it, and a real click
 * lands on it. The kernel's delegation then reads `event.target.closest(
 * '[data-os-app]')`, gets null, and the launcher is dead: no window, no
 * generation, nothing logged. Exactly the class KERNEL-6 named — the kernel
 * being the cause — and it was invisible because every e2e test DISPATCHED its
 * clicks (helpers.openApp, now hit-tested) while the two real clickers in the
 * tree happened to meet desktops that positioned their launcher areas.
 *
 * `#os-root` holds nothing (the boot overlay and the kernel's own screens are
 * appended to `document.body`), so it takes no pointer events. This is the
 * identical rule `stackDesktopLayers` applies to the model's own empty windows
 * layer, applied to the kernel's own empty layer, and it paints nothing.
 */
if (root) root.style.pointerEvents = 'none';

/** SPEC §12.3: the boot screen stays up for at least this long. */
const BOOT_MIN_MS = 2500;

let session: SessionState;
let wm: WindowManager | null = null;
let mounted: Mounted | null = null;
let hud: Hud | null = null;
let bootOverlay: HTMLElement | null = null;
let bootFrame: Frame | null = null;
let picker: HTMLElement | null = null;
let engineList: { id: string; label: string }[] = [];
let booting = false;
let bootPaintedAt = 0;
/**
 * SEAM H3 — when the boot frame first had anything with a box in it. Zero means
 * it never did, which is the case the reveal rule below exists for and the case
 * the old `bootPaintedAt` could not tell apart from a boot screen.
 */
let bootInkedAt = 0;
/** when this boot started, so the reveal can be reported against it */
let bootT0 = 0;
let bootAbort: AbortController | null = null;
let revealTimer = 0;
/** images that landed before the desktop was mounted (SPEC §12.5) */
let pendingWallpaper: string | null = null;
let pendingIcons: string | null = null;

const viewport = () => `${window.innerWidth}x${window.innerHeight}`;
const appIds = () => session.manifest.apps.map((a) => a.id);
/** id + the model's own name for it; the launcher label is never the raw id when a name exists. */
const launchers = (): LauncherSpec[] => session.manifest.apps.map((a) => ({ id: a.id, label: a.name || a.id }));

function telemetry(t: GenTelemetry | null, note?: string) {
  hud?.record(t, note);
}

/**
 * KERNEL-6 — the loud half of the trace goes to the HUD's telemetry stream, so
 * a swallowed click or a caught callback exception shows up where every other
 * fault in this product does. The quiet half stays in the ring
 * (`window.__osTrace()`), which is the only instrument that exists on `/`,
 * where there is no HUD at all.
 */
setTraceSink((line) => telemetry(null, line));

/* -------------------------------------------------------------- bootstrap */

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return (await r.json()) as T;
}

/**
 * SEAM H1 — the routed engine. `/` asks for `auto` and the server resolves it
 * per kind through `engines.json`'s routing table, hedging the primary against
 * a second provider; an explicit id bypasses routing and hedging entirely so a
 * single engine can still be judged.
 *
 * `/bakeoff/run` is exactly that judging surface, so it never resolves to
 * `auto` on its own — only `?engine=auto`, typed by a judge who wants to watch
 * the router, gets it.
 */
const AUTO_ENGINE = 'auto';

/**
 * SEAM T1 / defect D6 — the engine `/` is PINNED to, stamped on the kernel page
 * by the server when `DEFAULT_ENGINE` names an engine it holds a key for.
 *
 * HANDOFF-6 §2 reproduced three times what this closes: with
 * `DEFAULT_ENGINE=cerebras-oss120` — the documented deploy recipe — a live boot
 * of `/` was still served by `auto` and still hedged, at the hedged price,
 * because this function preferred `auto` whenever the list carried it and never
 * looked at the default underneath. Two clauses were named; this is the
 * kernel's half.
 *
 * The page attribute is the second witness, exactly as `MODE` uses the path: a
 * `/api/engines` response and the HTML that loaded this bundle have to agree
 * before the kernel takes a pin off either of them.
 */
const PAGE_PIN = (document.body.getAttribute('data-engine') || '').trim();

function chooseEngine(list: { id: string }[], serverDefault: string | null, pinned?: string | null): string {
  const q = new URLSearchParams(location.search).get('engine');
  if (q && list.some((e) => e.id === q)) return q;
  const has = (id: string) => list.some((e) => e.id === id);
  /**
   * T1: an explicit pin outranks the router. `unset` and `auto` are not pins —
   * the server answers `pinned: null` for both — and a pin naming an engine
   * this server has no key for is not one either, because it is not in the
   * list.
   *
   * `/api/engines` is the authority when it answers the question at all: it is
   * read at boot, while the HTML that loaded this bundle can be older than the
   * bundle. The page attribute is the fallback for a server that has not
   * shipped the field, i.e. `pinned` ABSENT rather than null.
   */
  const pin = (pinned === undefined ? PAGE_PIN : pinned || '').trim();
  if (pin && pin !== AUTO_ENGINE && has(pin)) return pin;
  // H1: routed by default on `/`. A server that has not shipped the table yet
  // does not list `auto`, and the old choice below still applies.
  if (MODE === 'plain' && has(AUTO_ENGINE)) return AUTO_ENGINE;
  const single = list.filter((e) => e.id !== AUTO_ENGINE);
  if (serverDefault && serverDefault !== AUTO_ENGINE && single.some((e) => e.id === serverDefault)) return serverDefault;
  const firstReal = single.find((e) => e.id !== 'mock');
  return firstReal ? firstReal.id : single.length ? single[0].id : 'mock';
}

interface Lineage {
  name: string;
  version: string;
}

/**
 * The identity comment the boot stream opens with (INTERFACE I1). It is pulled
 * out of the stream before the bytes reach the boot frame, so the desktop and
 * the image calls start on the first ~120 tokens instead of after a separate
 * round trip.
 *
 * A stream that does not begin with the comment is not held up: the moment the
 * head cannot be a prefix of the marker any more, everything buffered is
 * flushed and the kernel falls back to one `kind=identity` call. That keeps a
 * server that has not shipped I1 yet bootable.
 */
class BootSplitter {
  private buf = '';
  private settled = false;
  constructor(
    private onIdentity: (json: string) => void,
    private onHtml: (s: string) => void,
    private onNone: () => void
  ) {}

  push(chunk: string): void {
    if (this.settled) {
      this.onHtml(chunk);
      return;
    }
    this.buf += chunk;
    const scan = scanIdentityComment(this.buf);
    if (scan.json !== null) {
      const rest = this.buf.slice(scan.end);
      this.buf = '';
      this.settled = true;
      this.onIdentity(scan.json);
      if (rest) this.onHtml(rest);
      return;
    }
    const head = this.buf.replace(/^[\s﻿]+/, '');
    if (!head) return;
    const cmp = head.slice(0, IDENTITY_OPEN.length);
    const couldBe = IDENTITY_OPEN.indexOf(cmp) === 0 || (scan.partial && this.buf.length < 8192);
    if (!couldBe) this.giveUp();
  }

  /** the stream ended: nothing more is coming */
  end(): void {
    if (!this.settled) this.giveUp();
  }

  private giveUp(): void {
    this.settled = true;
    const rest = this.buf;
    this.buf = '';
    if (rest) this.onHtml(rest);
    this.onNone();
  }
}

async function boot(engineOverride?: string, lineage?: Lineage) {
  if (booting) return;
  booting = true;
  clearScreen();
  teardown();

  let enginesRes: { engines: { id: string; label: string }[]; default?: string; pinned?: string | null };
  let manifest: { apps: AppSpec[] };
  try {
    [enginesRes, manifest] = await Promise.all([
      fetchJson<{ engines: { id: string; label: string }[]; default?: string; pinned?: string | null }>('/api/engines'),
      fetchJson<{ apps: AppSpec[] }>('/api/manifest'),
    ]);
  } catch (err: any) {
    booting = false;
    showError(String(err?.message || err), () => boot());
    return;
  }
  engineList = enginesRes.engines;
  const engine = engineOverride || chooseEngine(engineList, enginesRes.default || null, enginesRes.pinned);

  session = newSession(engine);
  session.manifest = { apps: manifest.apps.slice() };

  // fixed and above everything the desktop can mount: the desktop is built
  // *behind* this overlay and only revealed when it is interactive and the boot
  // screen has had its 2.5 s (SPEC §12.2, §12.3).
  bootOverlay = document.createElement('div');
  bootOverlay.id = 'os-boot';
  bootOverlay.setAttribute('data-os-boot', '');
  bootOverlay.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;background:#000;z-index:2147482000';
  document.body.appendChild(bootOverlay);
  bootFrame = new Frame('boot', { style: 'border:0;display:block;width:100%;height:100%;background:#000' });
  bootOverlay.appendChild(bootFrame.el);

  if (MODE === 'bakeoff') {
    hud = new Hud();
    // H1: single engines only in the judging picker; `auto` is the router's name
    picker = enginePicker(engineList.filter((e) => e.id !== AUTO_ENGINE || engine === AUTO_ENGINE), engine, (id) => {
      const u = new URL(location.href);
      u.searchParams.set('engine', id);
      history.replaceState(null, '', u.toString());
      booting = false;
      boot(id);
    });
  }

  try {
    const t0 = Date.now();
    bootT0 = t0;
    const bootGenId = newGenId();
    const sessionId = session.sessionId;
    let deskPromise: Promise<DeskResult> | null = null;
    let identityGate: () => void = () => {};
    const identityReady = new Promise<void>((r) => (identityGate = r));

    /** the generation the identity was parsed out of; /api/identity-seen is gated on it */
    let identityGenId = bootGenId;
    const onIdentity = (idIn: Identity) => {
      if (session.sessionId !== sessionId || session.identity) return;
      // SPEC §4: a reboot is the same name lineage, one version on. The kernel
      // enforces it rather than trusting the stream to have obeyed — an
      // off-by-one or a renamed machine in a hallucinated version string is not
      // detectable, and the updater promised version+1 of THIS machine.
      const id = lineage ? { ...idIn, name: lineage.name, version: nextVersion(lineage.version) } : idIn;
      session.identity = id;
      identitySeen(id.name, identityGenId);
      telemetry(null, 'identity: ' + id.name + ' [' + id.archetype + ']');
      // desktop and both image calls start here — the boot document is still
      // streaming into the frame behind us (SPEC §12.1)
      deskPromise = generateDesktop(engine);
      startBootImages(sessionId);
      identityGate();
    };

    if (bootFrame) {
      /**
       * SEAM H3. `paint` is the first chunk — for a boot stream that is the
       * identity comment, and a comment is not a pixel. It is recorded as
       * `interactive_ms` (the runtime has the document open and delegating) and
       * NOT as a first paint any more; `ink` is the first paint.
       */
      bootFrame.onPaint = () => {
        bootPaintedAt = Date.now();
        mark(bootGenId, { interactive_ms: bootPaintedAt - t0 });
      };
      bootFrame.onInk = () => {
        bootInkedAt = Date.now();
        const dt = bootInkedAt - t0;
        mark(bootGenId, { first_paint_ms: dt, ink_ms: dt });
        hud?.ink('boot', dt);
        telemetry(null, 'boot inked at ' + dt + ' ms');
      };
    }

    bootAbort = new AbortController();
    const splitter = new BootSplitter(
      (json) => {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(json);
        } catch {}
        onIdentity(coerceIdentity(parsed, session.seed));
      },
      (html) => bootFrame?.chunk(html),
      () => identityGate() // no comment in this stream: the fallback below runs
    );

    const bootPromise = genStream(
      {
        kind: 'boot',
        engine,
        seed: session.seed,
        gen_id: bootGenId,
        context: { viewport: viewport(), ...(lineage ? { lineage } : {}) },
      },
      (c) => splitter.push(c),
      bootAbort.signal
    )
      .then((r) => {
        splitter.end();
        bootFrame?.end();
        telemetry(r.telemetry, 'boot');
        return r;
      })
      .catch((err) => {
        splitter.end();
        if ((err as any)?.name !== 'AbortError') telemetry(null, 'boot failed: ' + String((err as any)?.message || err));
        return null;
      });

    // whichever comes first: the identity comment, or the stream giving up on one
    await Promise.race([identityReady, bootPromise.then(() => {})]);

    if (!session.identity) {
      // I1 says the server guarantees a valid comment first. This is the path for
      // a server that has not shipped it (and for a boot stream that died before
      // the comment closed): one `kind=identity` round trip, then carry on.
      const idRes = await genIdentity({ kind: 'identity', engine, seed: session.seed, context: lineage ? { lineage } : undefined });
      if (idRes.genId) identityGenId = idRes.genId;
      onIdentity(idRes.identity);
    }

    const desk = await (deskPromise || generateDesktop(engine));
    if (session.sessionId !== sessionId) return;
    mountDesk(desk, t0);
  } catch (err: any) {
    booting = false;
    if (err instanceof CapError) {
      teardown();
      showQueue(err.retryAfter, () => boot(engineOverride, lineage));
      return;
    }
    showError(String(err?.message || err), () => boot(engineOverride, lineage));
    return;
  }
  booting = false;
}

interface DeskResult {
  text: string;
  missing: string[];
  contractOk: boolean;
  genId: string;
}

/**
 * The desktop. One generation, never two: SPEC §12.2 kills the repair pass — a
 * missing hook is patched onto the document that arrived (mountDesk below), and
 * only a server-side error sentinel buys a second generation (I1).
 */
async function generateDesktop(engine: string): Promise<DeskResult> {
  const req: GenRequest = {
    kind: 'desktop',
    engine,
    seed: session.seed,
    identity: session.identity,
    context: { manifest: session.manifest, viewport: viewport() },
  };
  let res: GenResult;
  try {
    res = await genStream(req, () => {});
  } catch (err) {
    if (err instanceof CapError) throw err;
    if (err instanceof RerouteError) {
      // a Store-authored shape flagged after the stream started: ask again with
      // the flag the server trusts, or the retry loses the same race (SPEC §12.1)
      telemetry(null, 'desktop rerouted mid-stream, asking again');
      res = await genStream({ ...req, rerouted: true }, () => {});
    } else {
      telemetry(null, 'desktop regenerating after error: ' + String((err as any)?.message || err));
      res = await genStream(req, () => {});
    }
  }
  telemetry(res.telemetry, 'desktop');
  const v = validate('desktop', res.text, { appIds: appIds(), archetype: session.identity?.archetype });
  return { text: res.text, missing: v.missing, contractOk: v.ok, genId: res.genId };
}

/**
 * Mount the desktop behind the boot screen, wire it, and only then reveal it —
 * and never before the boot screen has been up for 2.5 s (SPEC §12.2/§12.3).
 * Nothing the user can see is replaced: the boot overlay is lifted off an
 * already-interactive desktop.
 */
function mountDesk(desk: DeskResult, t0: number) {
  unmount(mounted);
  mounted = mountDesktop(desk.text);

  /**
   * R2 (KERNEL-8) — before anything is injected, look for the clock the model
   * DID draw. HANDOFF-7 §4 measured a live boot with a visible ticking clock
   * and no `[data-os-clock]`: the fallback then put a second clock at the other
   * end of the same bar. Adopting the model's element is identifying it, not
   * forging one — no pixel changes and the attribute is taken back at unmount —
   * and it has to happen before `domMissing`, which is what decides whether a
   * clock gets injected at all.
   */
  const adoptedClock = adoptClock();
  if (adoptedClock) {
    telemetry(null, 'clock adopted from the bar: "' + adoptedClock.text + '" (no second clock injected)');
    verifyClockTick((ticks, text) =>
      telemetry(null, 'adopted clock ' + (ticks ? 'ticks' : 'DID NOT tick in 1.2 s') + ': "' + text + '"')
    );
  }

  // What is actually missing is what the mounted DOM does not have — the text
  // validator is a pre-flight, never the authority (SPEC §3.2).
  const missing = domMissing(launchers(), session.identity?.archetype);
  const injected = missing.length ? injectMissing(missing, launchers()) : [];
  if (injected.length) telemetry(null, 'contract MISS, patched: ' + injected.join(' '));

  const host = readHost();
  if (!host) {
    showError('the desktop had no window layer and could not be repaired', () => boot());
    return;
  }
  wm = new WindowManager(host, {
    onClose: () => {
      guard('onClose pushState', pushState);
    },
    onFocus: () => {
      guard('onFocus pushState', pushState);
      /**
       * BAKEOFF-4: a window opening adds an entry to the bar, and an entry
       * taller than the bar hangs out of the bottom of the screen with its
       * icon and label on it (auto boot 1: every entry a blank rounded
       * rectangle, the bar's own box perfectly inside the viewport). The
       * repair is geometry and therefore the kernel's; it can only fire on a
       * bar whose contents are already off screen, and it is cheap enough to
       * ask on focus because that is when the entries change.
       */
      /**
       * KERNEL-6: guarded, because this runs inside `openApp`, which runs
       * inside a delegated click handler. HANDOFF-5 issue 1's second suspect
       * was exactly this: a throw here abandons `openApp` before `streamApp`,
       * and an uncaught listener exception leaves a window that never fills.
       * It is now caught, traced with its stack, and the document still gets
       * asked for.
       */
      const grew = guard('onFocus fitBarContents', fitBarContents);
      if (grew) {
        telemetry(null, 'viewport fit: [data-os-taskbar] height rewritten to hold its own entries');
        /**
         * KERNEL-8 — a bar that just grew is a windows area that just shrank.
         * On a phone the window fills that area (R1), so without this the
         * window keeps the height it was given against the 34 px bar and is
         * then 21 px over the 55 px one, with the task entries under it.
         */
        guard('onFocus reflow after bar grew', () => wm?.reflow());
      }
      /**
       * KERNEL-9 — and a bar that just grew is also a launcher grid that just
       * disappeared. HANDOFF-8 §8 item 1: eight task entries grew a 38 px bar
       * to 70 px and the extra 32 px came out of the row of launchers above
       * it — 0 of 16 reachable at the end of the session, on 2 of 4 real
       * desktops, blocked by the kernel's own repair. So the launcher inset is
       * asked on every focus now, at both edges, unlatched; it is gated on the
       * bars' own geometry, so a bar that has not moved costs one
       * `getBoundingClientRect` per bar and writes nothing.
       */
      const inset = guard('onFocus fitLauncherRow', fitLauncherRow);
      if (inset) telemetry(null, 'viewport fit: launcher area inset ' + inset + 'px, a bar was over the launchers');
      if (grew || inset) guard('onFocus titlesClearOfBars', () => wm?.titlesClearOfBars());
      /**
       * R3 again on focus: a window entry appearing in the bar is new text on
       * the same line as the clock, so a bar that was spaced when it was empty
       * can jam the moment somebody opens something. Bounded and idempotent
       * (`GAP_BUDGET`), and guarded for the same reason the line above is.
       */
      const more = guard('onFocus fitBarGaps', fitBarGaps);
      if (more) telemetry(null, 'bar spacing: ' + more + ' thin space' + (more > 1 ? 's' : '') + ' inserted after a window opened');
    },
    /**
     * SEAM T4 — the kernel had to patch a window's own chrome or its taskbar
     * entry. Never silent: `contract_patch` is the reading that tells the next
     * prompt iteration which part of §12.3 this engine is losing, and the
     * architect's D2 (a window with no visible title bar and no visible close
     * control, reported `contract: ok` by everything in the tree) is exactly the
     * defect that had no number anywhere.
     */
    onPatch: (what, detail) => {
      telemetry(null, 'contract_patch ' + what + ': ' + detail);
      const el = document.documentElement;
      const had = el.getAttribute('data-os-contract-patch') || '';
      if (had.split(' ').indexOf(what) < 0) el.setAttribute('data-os-contract-patch', (had ? had + ' ' : '') + what);
    },
  });
  /**
   * T4 — the chrome reading, taken before anybody has opened a window. The
   * clone is never painted (see `probeChrome`); the repair happens per window.
   */
  const chrome = probeChrome(host);
  document.documentElement.setAttribute('data-os-chrome-template', chrome.ok ? 'ok' : chrome.why.join(','));
  if (!chrome.ok)
    telemetry(
      null,
      'window chrome is not usable as written: ' + chrome.why.join(',') + ' (bar ' + chrome.barH + 'px, close ' + chrome.closeW + 'x' + chrome.closeH + ')'
    );
  wireDesktop();
  installTopLevelOs();
  /**
   * The desktop has to fit the screen it is on. Geometry, not style (SPEC §2.2)
   * — see `fitViewport`.
   */
  const fit = fitViewport();
  fitBarContents();
  /**
   * R3 — two runs of text in the bar with nothing between them read as one word
   * (HANDOFF-7 §4: `02:03:559/18/2026`, 1 live bar in 4). One thin space goes
   * in between; the prompt still asks for the gap.
   */
  const gaps = fitBarGaps();
  if (gaps) telemetry(null, 'bar spacing: ' + gaps + ' thin space' + (gaps > 1 ? 's' : '') + ' inserted between jammed text runs');
  /**
   * §8 / KERNEL-9 — the launcher row under an edge bar, at either edge. Asked
   * again on every focus (see `onFocus`), because a bar can grow later.
   */
  const pushed = fitLauncherRow();
  if (pushed) telemetry(null, 'viewport fit: [data-os-desktop] inset ' + pushed + 'px, a launcher was under a fixed bar');
  if (fit.fitted) {
    telemetry(null, 'viewport fit: html/body clamped' + (fit.pinned ? ', [data-os-taskbar] pinned ' + fit.pinned : ''));
  }
  // one listener for the life of the page, not one per machine: it reads the
  // live `wm`, and a reboot used to add another copy of it every time
  if (!resizeWired) {
    resizeWired = true;
    window.addEventListener('resize', () => {
      fitViewport();
      wm?.reflow();
      // KERNEL-9 — a new viewport is new bar geometry: the inset is recomputed
      // from the launchers' own un-inset positions, so this cannot accumulate
      guard('resize fitLauncherRow', fitLauncherRow);
      guard('resize titlesClearOfBars', () => wm?.titlesClearOfBars());
    });
  }
  wm.reflow();
  applyPendingImages();

  const interactiveAt = Date.now();
  mark(desk.genId, { first_paint_ms: interactiveAt - t0, interactive_ms: interactiveAt - t0 });
  document.documentElement.setAttribute('data-os-contract', desk.contractOk && missing.length === 0 ? 'ok' : 'miss');
  document.documentElement.setAttribute('data-os-desktop-ms', String(interactiveAt - t0));
  // Measured, never repaired: a launcher the model put past the bottom edge is
  // its layout, but "how many are off screen" is a number the next prompt
  // iteration needs (SPEC §12.3 wants every launcher reachable without
  // scrolling, and a real boot put all sixteen in one clipped column).
  const off = offscreenLaunchers();
  document.documentElement.setAttribute('data-os-launchers-offscreen', String(off));
  if (off) telemetry(null, 'launchers off screen: ' + off + '/' + session.manifest.apps.length);
  pushState();

  /**
   * SEAM H3 — the 2.5 s boot floor applies only to a boot screen that EXISTS.
   *
   * HANDOFF-4's headline: on `cerebras-oss120` roughly one boot generation in
   * three spends its whole budget on reasoning and emits the identity comment
   * and no document at all. The overlay is then a black rectangle, and §12.3's
   * floor held it there for its full term — two and a half seconds of nothing
   * as the first thing anybody sees. The kernel still paints no pixel of its
   * own (the fix HANDOFF-3 proposed and this one refuses): it simply stops
   * holding an empty frame in front of a desktop that is ready.
   *
   * The floor is measured from INK rather than from the first chunk, so a boot
   * screen a visitor can actually read still gets its full time on screen.
   */
  if (revealTimer) window.clearTimeout(revealTimer);
  document.documentElement.setAttribute('data-os-boot-ink', bootInkedAt ? String(bootInkedAt - t0) : 'none');
  if (!bootInkedAt) {
    document.documentElement.setAttribute('data-os-boot-hold-ms', '0');
    hud?.ink('boot', null);
    telemetry(null, 'the boot frame never inked: revealing the desktop now, no black hold');
    revealDesktop();
    return;
  }
  const rest = Math.max(0, BOOT_MIN_MS - (interactiveAt - bootInkedAt));
  document.documentElement.setAttribute('data-os-boot-hold-ms', String(rest));
  revealTimer = window.setTimeout(() => revealDesktop(), rest);
}

/** Launchers whose box is not inside the viewport once the desktop is laid out. */
function offscreenLaunchers(): number {
  const seen = new Set<string>();
  let off = 0;
  const w = window.innerWidth;
  const h = window.innerHeight;
  document.querySelectorAll('[data-os-app]').forEach((el) => {
    const id = el.getAttribute('data-os-app') || '';
    if (!id || seen.has(id)) return; // a menu entry for the same app is a second chance, not a second launcher
    const r = rectOf(el);
    if (r.width === 0 && r.height === 0) return; // hidden behind a menu the user can open
    seen.add(id);
    if (r.bottom > h + 1 || r.right > w + 1 || r.top < -1 || r.left < -1) off += 1;
  });
  return off;
}

/** The one swap the kernel is allowed to make without a user event (SPEC §12.2). */
function revealDesktop() {
  revealTimer = 0;
  // the boot document has been on screen for its time; stop paying for the rest
  try {
    bootAbort?.abort();
  } catch {}
  bootAbort = null;
  if (bootFrame) {
    bootFrame.destroy();
    bootFrame = null;
  }
  if (bootOverlay) {
    bootOverlay.remove();
    bootOverlay = null;
  }
  if (picker) {
    undock(picker); // picker is boot-screen only
    picker = null;
  }
  document.documentElement.setAttribute('data-os-ready', '1');
  // H3: when the boot overlay actually came off, so the gap between this and
  // `data-os-desktop-ms` is readable — that gap is the hold, and on a boot
  // frame that never inked it has to be nothing
  document.documentElement.setAttribute('data-os-revealed-ms', String(bootT0 ? Date.now() - bootT0 : 0));
}

/* ----------------------------------------------------------------- images */

/**
 * SPEC §12.5: wallpaper and icon sheet, started the instant the identity is
 * known and applied whenever they land — before the desktop exists, while it is
 * generating, or minutes after it mounted. Nothing ever waits for them, and a
 * 404 (no FAL_KEY) leaves the model's own SVG exactly where it is.
 */
function startBootImages(sessionId: string) {
  if (!session.identity) return;
  const stale = () => session.sessionId !== sessionId;

  // SEAM S3: `{kind, session}` and nothing else. The server holds the identity
  // and the dice for this session and writes the prompt from them; the kernel
  // has no business describing a wallpaper.
  const seed = session.seed;
  requestBootImage({ kind: 'wallpaper', session: sessionId, seed }).then((uri) => {
    if (!uri || stale()) return;
    pendingWallpaper = uri;
    if (mounted) applyPendingImages();
  });
  requestBootImage({ kind: 'icons', session: sessionId, seed }).then((uri) => {
    if (!uri || stale()) return;
    pendingIcons = uri;
    if (mounted) applyPendingImages();
  });
}

/* ------------------------------------------- images inside documents (S1) */

/**
 * SEAM S1. A generated app or page declared
 * `data-os-img="photo|faces|map"` + `data-os-prompt="..."`; its runtime
 * collected the slots once the document closed and asked for them.
 *
 * The per-document ceiling is counted HERE as well as in the runtime and on the
 * server, and that is not belt-and-braces: the runtime lives in the same
 * document as the model's own script, which can post the same message itself.
 * Three of these cost a cent; a loop costs the day's budget.
 */
const imgSpend = new Map<string, number>();

/** Resolve true if `ms` passed with the signal still live, false if it aborted first. */
function dwell(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise<boolean>((res) => {
    const done = (v: boolean) => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      res(v);
    };
    const onAbort = () => done(false);
    const timer = window.setTimeout(() => done(true), ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** window id for an app document, navigation id for a page (the server's bucket). */
function imgScope(w: OsWindow, from: 'self' | 'page'): string {
  return from === 'page' ? w.pageScope || w.state.id + ':page' : w.state.id;
}

async function handleImg(w: OsWindow, kind: DocImgKind, prompt: string, slot: string, from: 'self' | 'page', theme?: string) {
  if (!session) return;
  const scopeKind = from === 'page' ? 'page' : 'app';
  const scope = imgScope(w, from);
  const limit = DOC_IMG_LIMIT[scopeKind];
  const spent = imgSpend.get(scope) || 0;
  if (spent >= limit) {
    telemetry(null, 'img refused, ' + scopeKind + ' ceiling ' + limit + ': ' + scope);
    return;
  }
  imgSpend.set(scope, spent + 1);
  if (imgSpend.size > 400) for (const k of Array.from(imgSpend.keys()).slice(0, 200)) imgSpend.delete(k);

  /**
   * Which lifetime this picture has. A PAGE's picture dies when the visitor
   * navigates away — that is the window's generation controller, and the server
   * stops paying for the rest of it. An APP's picture dies when the window
   * closes: the app document that asked for it is still on screen after its own
   * generation has finished, and BAKEOFF-3 lost fifteen of sixteen app pictures
   * to a later generation in the same window aborting `gen` underneath them.
   */
  const signal = scopeKind === 'page' ? w.gen?.signal : w.imgs?.signal;

  /**
   * A page waits to be looked at before it is worth a picture (open issue 4,
   * `PAGE_IMG_DWELL_MS`). The wait is free: if the visitor has moved on, the
   * navigation has aborted this signal and nothing was ever bought.
   */
  if (scopeKind === 'page' && PAGE_IMG_DWELL_MS > 0) {
    const stayed = await dwell(PAGE_IMG_DWELL_MS, signal);
    if (!stayed) {
      imgSpend.set(scope, Math.max(0, (imgSpend.get(scope) || 1) - 1));
      telemetry(null, 'img ' + kind + ' not started, page left inside the dwell: ' + scope + ' slot ' + slot);
      return;
    }
  }

  // two at a time (kernel/img.ts): four parallel asks all aged past the
  // server's image timeout in BAKEOFF-3 and fifteen of sixteen never arrived
  const uri = await requestDocImage(
    {
      kind,
      prompt: prompt.slice(0, IMG_PROMPT_MAX),
      session: session.sessionId,
      seed: session.seed,
      scope,
      scopeKind,
      // T2: one sheet of sixteen, and which set it is
      ...(theme ? { theme } : {}),
    },
    signal
  );
  /**
   * BAKEOFF-3 open issue 5 asked for the abort to be logged at the kernel end
   * with the window and what triggered it. There are exactly two triggers:
   * `w.imgs` aborts when the WINDOW CLOSES and `w.gen` aborts when the visitor
   * NAVIGATES, so the reason is readable off which controller fired.
   */
  if (!uri) {
    const why = signal?.aborted
      ? scopeKind === 'page'
        ? 'cancelled by a navigation'
        : 'cancelled by the window closing'
      : 'not delivered';
    telemetry(null, 'img ' + kind + ' ' + why + ': ' + scopeKind + ' ' + scope + ' slot ' + slot);
    return;
  }
  // the document may have been replaced while fal was drawing; the runtime
  // drops a fill for a slot that is no longer there, so this is only about not
  // shouting into a dead frame
  if (from === 'page' && imgScope(w, from) !== scope) return;
  w.frame.fillImg(slot, kind, uri, from, theme);
  telemetry(null, 'img ' + kind + (theme ? '/' + theme : '') + ' -> ' + scopeKind + ' ' + slot);
}

function applyPendingImages() {
  if (pendingWallpaper) {
    applyWallpaper(pendingWallpaper);
    telemetry(null, 'wallpaper applied');
  }
  if (pendingIcons) {
    const n = applyIconSheet(pendingIcons, appIds());
    telemetry(null, 'icons applied: ' + n);
  }
}

function teardown() {
  wm?.windows.slice().forEach((w) => wm?.close(w));
  wm = null;
  unmount(mounted);
  mounted = null;
  spec.dropAll();
  stopFallbackClock();
  // the kernel's own <style> for launcher legibility over a wallpaper: it
  // belongs to the machine that is going away, like everything else here
  resetImgStyles();
  imgSpend.clear();
  document.documentElement.removeAttribute('data-os-archetype');
  document.documentElement.removeAttribute('data-os-archetype-patched');
  document.documentElement.removeAttribute('data-os-contract-patch');
  document.documentElement.removeAttribute('data-os-chrome-template');
  pendingWallpaper = null;
  pendingIcons = null;
  bootPaintedAt = 0;
  bootInkedAt = 0;
  document.documentElement.removeAttribute('data-os-boot-ink');
  document.documentElement.removeAttribute('data-os-boot-hold-ms');
  document.documentElement.removeAttribute('data-os-revealed-ms');
  if (revealTimer) window.clearTimeout(revealTimer);
  revealTimer = 0;
  try {
    bootAbort?.abort();
  } catch {}
  bootAbort = null;
  bootFrame?.destroy();
  bootFrame = null;
  bootOverlay?.remove();
  bootOverlay = null;
  undock(picker);
  picker = null;
  hud?.destroy();
  hud = null;
  document.documentElement.removeAttribute('data-os-ready');
}

/* ---------------------------------------------------------- desktop wiring */

let desktopWired = false;
let resizeWired = false;
function wireDesktop() {
  if (desktopWired) return;
  desktopWired = true;

  /**
   * Speculative generation (SPEC §12.1 / I4): a launcher's app starts
   * generating on `mousedown`/`touchstart`, which buys the 100–300 ms between
   * the press and the click, and rather more when the press is a considered
   * one. Shown at most once, discarded otherwise, never cached.
   */
  const speculate = guarded('desktop mousedown', (e: Event) => {
    const t = e.target as Element | null;
    if (!t || !t.closest) return;
    if (notOurs(t)) return;
    const el = t.closest('[data-os-app]');
    const id = el?.getAttribute('data-os-app') || '';
    if (!id || !session?.identity) return;
    trace('launcher.press', id);
    startAppSpec(id);
  });
  document.addEventListener('mousedown', speculate, true);
  document.addEventListener('touchstart', speculate, { capture: true, passive: true });

  document.addEventListener(
    'click',
    guarded('desktop click', (e: Event) => {
      const t = e.target as Element | null;
      if (!t || !t.closest) return;
      if (notOurs(t)) return;
      const appEl = t.closest('[data-os-app]');
      if (appEl) {
        e.preventDefault();
        trace('launcher.click', appEl.getAttribute('data-os-app') || '');
        openApp(appEl.getAttribute('data-os-app') || '', {});
        return;
      }
      const a = t.closest('a[href]') as HTMLAnchorElement | null;
      if (a) {
        const href = a.getAttribute('href') || '';
        if (!href || href.charAt(0) === '#' || /^javascript:/i.test(href)) return;
        e.preventDefault();
        trace('desktop.link', href);
        openApp('browser', { url: href });
      }
    })
  );
}

/**
 * KERNEL-6 / HANDOFF-5 issue 1 — THE BUG.
 *
 * The desktop's delegation has to ignore two things: clicks inside a window
 * (the frame handles those) and clicks on the kernel's own bake-off chrome.
 * Both were identified by ATTRIBUTE — `[data-os-window-id]` and
 * `[data-os-dock]` — in a document the MODEL writes. SPEC §12.3's `dock`
 * archetype is "a dock along the bottom holding the launchers as icons", and a
 * generated Mac-shaped desktop that named its own dock `data-os-dock` made
 * every launcher inside it dead: `mousedown` returned before the speculative
 * generation, `click` returned before `openApp`, so no window was created, no
 * connection was opened, no generation was asked for, nothing threw, and
 * nothing anywhere said a word. That is verification boot A of HANDOFF-5,
 * `dock` archetype, 4 of 4 app opens lost, `windowId: null` on all four.
 *
 * Identity replaces the selectors: the kernel's dock is the one element it
 * created (`isKernelChrome`), and a window is one of the window manager's own
 * roots (`wm.owns`). A model cannot collide with either.
 */
function notOurs(t: Element): boolean {
  if (isKernelChrome(t)) {
    trace('click.kernelChrome');
    return true;
  }
  if (wm?.owns(t)) return true;
  return false;
}

/** window.os for the desktop's own scripts (same document as the kernel). */
function installTopLevelOs() {
  const listeners: Record<string, Function[]> = {};
  (window as any).os = {
    open: (id: string, params?: Record<string, unknown>) => openApp(id, params || {}),
    close: () => {},
    navigate: (url: string) => openApp('browser', { url }),
    reload: () => boot(session.engine),
    back: () => {},
    forward: () => {},
    home: () => openApp('browser', {}),
    setTitle: () => {},
    install: (spec: AppSpec) => install(spec),
    reboot: () => reboot(),
    state: () => snapshot(session),
    on: (type: string, cb: Function) => {
      (listeners[type] = listeners[type] || []).push(cb);
    },
    event: (type: string, detail?: unknown) => fireOsEvent(type, detail, listeners),
  };
  (window as any).__osFire = (type: string, detail?: unknown) => fireOsEvent(type, detail, listeners);
}

function fireOsEvent(type: string, detail: unknown, listeners: Record<string, Function[]>) {
  for (const cb of listeners[type] || []) {
    try {
      cb(detail);
    } catch {}
  }
  try {
    document.dispatchEvent(new CustomEvent('os:' + type, { detail }));
  } catch {}
  for (const w of wm?.windows || []) w.frame.event(type, detail);
}

function pushState() {
  if (!session) return;
  // session.windows is the read side of os.state(); the window manager owns the
  // live list, so it is mirrored here rather than maintained twice.
  session.windows = (wm?.windows || []).map((w) => w.state);
  persist(session);
  const snap = snapshot(session);
  for (const w of wm?.windows || []) w.frame.state(snap);
}

/* ------------------------------------------------------------------- apps */

function appSpec(id: string): AppSpec | null {
  return session.manifest.apps.find((a) => a.id === id) || null;
}

/**
 * What the desktop calls this app. SPEC §1.2: the names of apps are the
 * model's, so a window is titled with the launcher's own label rather than with
 * the raw manifest id, until the app calls os.setTitle().
 */
function launcherLabel(id: string): string {
  const el = document.querySelector(`[data-os-app="${id.replace(/["\\]/g, '\\$&')}"]`);
  const text = (el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return text;
}

function appReq(appId: string, params: Record<string, unknown>): GenRequest {
  return {
    kind: 'app',
    engine: session.engine,
    seed: session.seed,
    identity: session.identity,
    params,
    context: { app_id: appId, manifest: session.manifest, viewport: viewport() },
  };
}

function pageReq(url: string, refererUrl: string, refererTitle: string, history: string[]): GenRequest {
  return {
    kind: 'page',
    engine: session.engine,
    seed: session.seed,
    context: { url, referer_url: refererUrl, referer_title: refererTitle, history, viewport: viewport() },
  };
}

/** I4: start this app's document now; the click that follows will take it. */
function startAppSpec(appId: string): void {
  const s = appSpec(appId);
  if (!s && appId.indexOf('custom:') !== 0) return;
  spec.start(appReq(appId, {}), appId);
  // the browser's home page is generated in parallel with its chrome, not after it
  if (appId === 'browser') spec.start(pageReq(BROWSER_HOME, '', '', []), 'home:' + BROWSER_HOME);
}

const BROWSER_HOME = 'https://google.com/';

/**
 * KERNEL-6 — how many generations are streaming into this window right now.
 *
 * The watchdog needs the difference between "nothing has arrived because the
 * provider is slow" (leave it alone) and "nothing has arrived because nobody
 * asked" (ask). A count rather than a boolean because a browser window's
 * chrome and its home page stream one after the other into the same window.
 */
const genLive = new WeakMap<OsWindow, number>();
/** windows the watchdog has already re-asked for. It fires once per window. */
const watchdogged = new WeakSet<OsWindow>();

function genCount(w: OsWindow): number {
  return genLive.get(w) || 0;
}

/**
 * KERNEL-6 — the last line of defence, and deliberately the weakest thing here.
 *
 * A window whose frame has received nothing 8 s after it was created, with no
 * generation in flight, has lost its generation somewhere the trace did not
 * cover. It is asked for exactly once more. This is not §12.2's forbidden
 * replacement of a painted document: it only ever runs on a frame where
 * NOTHING has been painted and nothing is on its way.
 */
const WATCHDOG_MS = 8000;

function armWatchdog(w: OsWindow) {
  window.setTimeout(() => {
    if (!w.root.isConnected || watchdogged.has(w)) return;
    if (w.frame.painted || w.frame.inked) return;
    if (genCount(w) > 0) {
      trace('watchdog.waiting', w.state.app + ' ' + genCount(w) + ' in flight');
      return;
    }
    watchdogged.add(w);
    traceLoud('watchdog.fired', w.state.app + ' ' + w.state.id + ' had no generation ' + WATCHDOG_MS + 'ms after opening');
    telemetry(null, 'watchdog: ' + w.state.app + ' window had nothing streaming after ' + WATCHDOG_MS + ' ms, asking once');
    streamApp(w).catch((err) => handleGenError(err));
  }, WATCHDOG_MS);
}

export function openApp(id: string, params: Record<string, unknown>): OsWindow | null {
  trace('openApp.enter', id);
  if (!wm) {
    traceLoud('openApp.noWm', id);
    return null;
  }
  const s = appSpec(id);
  const appId = s ? s.id : id;
  const noParams = !params || Object.keys(params).length === 0;
  const handle = noParams ? spec.claim('app', appId) : null;
  trace('openApp.claim', appId + ' ' + (handle ? 'hit ' + handle.id : 'miss'));
  const w = guard('wm.create', () => wm!.create(appId, params, (s && s.name) || launcherLabel(appId) || appId));
  if (!w) {
    traceLoud('openApp.createFailed', appId);
    if (handle) spec.drop(handle);
    return null;
  }
  trace('openApp.created', appId + ' ' + w.state.id);
  // guarded: a throw in focus (its own geometry, or the kernel's onFocus hook)
  // must not cost this window its document — HANDOFF-5 issue 1, suspect 2
  guard('wm.focus', () => wm!.focus(w));
  trace('openApp.focused', w.state.id);
  w.frame.onCall = (fn, args, from) => handleCall(w, fn, args, from);
  // S1: images this window's documents ask for, app and nested page alike
  w.frame.onImg = (kind, prompt, slot, from, theme) => {
    handleImg(w, kind, prompt, slot, from, theme).catch(() => {});
  };
  /**
   * BAKEOFF-4 #1: the number that decides whether this window's generation
   * leaves the browser at all. Chrome gives an origin six HTTP/1.1 sockets;
   * every one of them held when a window opens is the blank-window bug, and
   * until now nothing counted them.
   */
  telemetry(null, netNote('app ' + appId + ' opening'));
  // the browser's chrome and its home page generate at the same time (I4)
  if (appId === 'browser' && noParams) spec.start(pageReq(BROWSER_HOME, '', '', []), 'home:' + BROWSER_HOME);
  trace('openApp.stream', w.state.id);
  streamApp(w, handle).catch((err) => handleGenError(err));
  armWatchdog(w);
  trace('openApp.exit', w.state.id);
  return w;
}

interface DocSink {
  reset: () => void;
  chunk: (c: string) => void;
  end: () => void;
  /** SPEC §12.2: has anything been written into this document? */
  painted: () => boolean;
  /**
   * SEAM H3: has the visitor actually SEEN anything in it? A document whose
   * only bytes are a comment or a stylesheet has painted and shows nothing, so
   * the stall report below asks this one.
   */
  inked: () => boolean;
}

/**
 * Stream one document into one sink, with I1's single regeneration on a server
 * error sentinel and I4's speculative handle.
 *
 * Two rules, both from SPEC §12.2:
 *
 *  - **A painted document is never reset.** `sink.reset()` reaches the runtime
 *    as `document.open()`, so retrying a generation that already put pixels on
 *    screen is precisely the "loads, sits there, then turns into a different
 *    UI" that §12.2 exists to forbid. Live trigger: GEN_TIMEOUT_MS kills a
 *    generation the engine is still streaming, and the server then emits
 *    `os-error` after everything it had already sent. When that happens the
 *    truncated document stays, finished and logged; only an unpainted sink is
 *    reset and re-asked.
 *  - **A rerouted document is always thrown away**, painted or not — it was
 *    generated FROM the flagged string (SPEC §1.4) — and the retry carries
 *    `rerouted: true` so the server does not lose the same race again.
 */
/**
 * How long a document may show the visitor nothing before the kernel says so
 * out loud. BAKEOFF-3 run B had two app windows sit blank for a 60 s step
 * ceiling with NO telemetry line anywhere — neither the server's nor the
 * kernel's — which made the worst failure in the product also the only
 * invisible one. A generation the visitor cannot see anything of by now is
 * reported; the report does not touch the screen (§12.2) and does not cancel
 * anything.
 *
 * It asks `inked`, not `painted` (SEAM H3): a document that wrote a comment and
 * died has painted, and reporting it as fine is the mistake this whole pass is
 * about.
 */
const STALL_MS = 12_000;

/** the outer half of streamDoc: a stall is always reported, whatever happens next */
async function streamDoc(
  req: GenRequest,
  sink: DocSink,
  signal: AbortSignal,
  handle?: SpecHandle | null
): Promise<GenResult> {
  const t0 = Date.now();
  let stalled = false;
  const timer = window.setTimeout(() => {
    if (sink.inked() || signal.aborted) return;
    stalled = true;
    telemetry(
      null,
      req.kind + ' has shown nothing after ' + STALL_MS + ' ms (gen ' + (req.gen_id || '?') + '); ' + netNote('stalled')
    );
  }, STALL_MS);
  try {
    const r = await streamDocInner(req, sink, signal, handle);
    if (!sink.inked() && !signal.aborted) {
      telemetry(
        null,
        req.kind +
          ' finished having shown nothing after ' +
          (Date.now() - t0) +
          ' ms' +
          (sink.painted() ? ' (bytes arrived, none of them a box)' : ' (no bytes at all)') +
          '; ' +
          netNote('finished blank')
      );
    } else if (stalled) {
      telemetry(null, req.kind + ' recovered after ' + (Date.now() - t0) + ' ms');
    }
    return r;
  } finally {
    window.clearTimeout(timer);
  }
}

async function streamDocInner(
  req: GenRequest,
  sink: DocSink,
  signal: AbortSignal,
  handle?: SpecHandle | null
): Promise<GenResult> {
  trace('streamDoc.enter', req.kind + ' ' + (req.gen_id || '?') + (handle ? ' spec ' + handle.id : ''));
  /** the truncated-but-painted document stays: report it, do not replace it */
  const keep = (err: unknown): GenResult => {
    telemetry(null, req.kind + ' truncated, keeping the painted document: ' + String((err as any)?.message || err));
    sink.end();
    return { text: String((err as any)?.partial || ''), telemetry: null, genId: String((err as any)?.genId || req.gen_id || '') };
  };

  /**
   * HANDOFF-4 / BAKEOFF-3 open issue 1. An `AbortError` is only "the visitor
   * asked for something else" when the abort came from THIS caller's
   * controller. A speculative handle has a controller of its own (its TTL, and
   * `gen.start` dropping the previous prefetch of the same kind), and its
   * abort used to arrive here as an AbortError, get rethrown, and be swallowed
   * by `handleGenError` as a supersede — leaving a window that had painted
   * nothing with no generation running and no retry, for ever. Nothing painted
   * plus nobody superseded it means: ask again, normally.
   */
  const supersededByUser = () => signal.aborted;

  if (handle) {
    sink.reset();
    try {
      trace('streamDoc.take', handle.id);
      const r = await spec.take(handle, sink.chunk);
      sink.end();
      return r;
    } catch (err) {
      if (err instanceof CapError) throw err;
      if ((err as any)?.name === 'AbortError' && supersededByUser()) throw err;
      if (err instanceof RerouteError) return streamDocInner({ ...req, rerouted: true, gen_id: undefined }, sink, signal);
      if (sink.painted()) return keep(err);
      telemetry(
        null,
        'speculative ' + req.kind + ' ' + ((err as any)?.name === 'AbortError' ? 'was dropped' : 'failed') + ', regenerating'
      );
    }
  }
  sink.reset();
  try {
    trace('streamDoc.gen', req.kind + ' ' + (req.gen_id || '?'));
    const r = await genStream(req, sink.chunk, signal);
    sink.end();
    return r;
  } catch (err) {
    if ((err as any)?.name === 'AbortError' || err instanceof CapError) throw err;
    if (err instanceof RerouteError) {
      // SPEC §12.1: moderation flagged after the stream started. Discard and
      // ask again with the flag the server trusts, so the rerouted generation
      // is the one that arrives.
      telemetry(null, req.kind + ' rerouted mid-stream, asking again');
      sink.reset();
      const r = await genStream({ ...req, rerouted: true, gen_id: undefined }, sink.chunk, signal);
      sink.end();
      return r;
    }
    if (sink.painted()) return keep(err);
    // I1: a generation that ended in <!--os-error--> (upstream timeout) and had
    // painted nothing is regenerated exactly once. Nothing else in the kernel
    // replaces a document.
    telemetry(null, req.kind + ' regenerating after error: ' + String((err as any)?.message || err));
    sink.reset();
    const r = await genStream({ ...req, gen_id: undefined }, sink.chunk, signal);
    sink.end();
    return r;
  }
}

async function streamApp(w: OsWindow, handle?: SpecHandle | null) {
  const frame = w.frame;
  trace('streamApp.enter', w.state.id + ' ' + w.state.app + (handle ? ' spec ' + handle.id : ''));
  genLive.set(w, genCount(w) + 1);
  try {
    await streamAppInner(w, handle);
  } finally {
    genLive.set(w, Math.max(0, genCount(w) - 1));
    trace('streamApp.exit', w.state.id + ' inked=' + frame.inked + ' painted=' + frame.painted);
  }
}

async function streamAppInner(w: OsWindow, handle?: SpecHandle | null) {
  const frame = w.frame;
  const ac = beginGen(w);
  const t0 = Date.now();
  /**
   * §12.1's app number is measured against this id, so it is minted BEFORE the
   * request and sent with it (the server adopts a sane client gen_id). Waiting
   * for the stream to resolve meant `mark()` was called with '' for every
   * non-speculative open and returned early — the only app and page first
   * paints that were ever recorded were the speculative replays.
   */
  const genId = handle ? handle.id : newGenId();
  // §12.2: the runtime attaches delegation inside openDoc, on the first chunk.
  // That moment IS interactivity for an app; the end of the stream is
  // complete_ms. One field, one meaning.
  frame.onPaint = () => {
    mark(genId, { interactive_ms: Date.now() - t0 });
  };
  // SEAM H3: first paint is ink — the first element with a box — for every
  // document, not only the boot's. An app whose generation dies before it wrote
  // a tag is not a paint at any latency.
  frame.onInk = () => {
    mark(genId, { first_paint_ms: Date.now() - t0, ink_ms: Date.now() - t0 });
  };
  if (handle) ac.signal.addEventListener('abort', () => spec.drop(handle), { once: true });

  const req = appReq(w.state.app, w.state.params);
  req.gen_id = genId;
  const res = await streamDoc(
    req,
    {
      reset: () => frame.reset(),
      chunk: (c) => frame.chunk(c),
      end: () => frame.end(),
      painted: () => frame.painted,
      inked: () => frame.inked,
    },
    ac.signal,
    handle
  );
  telemetry(res.telemetry, 'app ' + w.state.app);

  // SPEC §12.2: a missing hook is patched into the document that is already on
  // screen. There is no app repair generation any more.
  const v = validate('app', res.text, { appId: w.state.app });
  for (const sel of v.missing) frame.inject(sel.indexOf('page') >= 0 ? 'page' : 'url');

  frame.state(snapshot(session));
  mark(res.genId || genId, { complete_ms: Date.now() - t0 });
  if (w.state.app === 'browser') {
    const start = typeof w.state.params.url === 'string' ? (w.state.params.url as string) : BROWSER_HOME;
    await navigate(w, start, { push: true, speculative: 'home:' + normalizeUrl(start) });
  }
}

/* ------------------------------------------------------ the fake internet */

function normalizeUrl(raw: string): string {
  let s = (raw || '').trim();
  if (!s) return 'https://google.com/';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (/^\w[\w-]*(\.[\w-]+)+/.test(s)) return 'https://' + s;
  return 'https://google.com/search?q=' + encodeURIComponent(s);
}

async function navigate(w: OsWindow, rawUrl: string, opts: { push?: boolean; speculative?: string } = { push: true }) {
  const url = normalizeUrl(rawUrl);
  const frame = w.frame;
  if (opts.push !== false) {
    w.state.history = w.state.history.slice(0, w.state.cursor + 1);
    w.state.history.push(url);
    w.state.cursor = w.state.history.length - 1;
  }
  const refererUrl = w.state.cursor > 0 ? w.state.history[w.state.cursor - 1] : '';
  const ac = beginGen(w);
  const t0 = Date.now();
  const handle = opts.speculative ? spec.claim('page', opts.speculative) : null;
  // minted before the request, like the app path above: §12.1's page first
  // paint was otherwise only ever recorded for the pre-buffered speculative
  // replay of the browser's own home page.
  const genId = handle ? handle.id : newGenId();
  // S1: one image bucket per navigation, named by the generation that is about
  // to fill the frame
  w.pageScope = genId;
  frame.onPagePaint = () => {
    mark(genId, { interactive_ms: Date.now() - t0 });
  };
  frame.onPageInk = () => {
    const dt = Date.now() - t0;
    mark(genId, { first_paint_ms: dt, ink_ms: dt });
  };
  if (handle) ac.signal.addEventListener('abort', () => spec.drop(handle), { once: true });

  frame.setUrl(url);
  frame.pageInit(url, snapshot(session));
  const req = pageReq(url, refererUrl, w.pageTitle, w.state.history.slice(-4, -1));
  req.gen_id = genId;
  const res = await streamDoc(
    req,
    {
      reset: () => {
        frame.pageReset();
        frame.pageSetUrl(url);
      },
      chunk: (c) => frame.pageChunk(c),
      end: () => frame.pageEnd(),
      painted: () => frame.pagePainted,
      inked: () => frame.pageInked,
    },
    ac.signal,
    handle
  );
  mark(res.genId || genId, { complete_ms: Date.now() - t0 });
  telemetry(res.telemetry, 'page ' + url);
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(res.text);
  w.pageTitle = m ? m[1].trim().slice(0, 140) : url;
  w.root.querySelectorAll('[data-os-title]').forEach((el) => {
    el.textContent = w.pageTitle || url;
  });
  w.state.title = w.pageTitle || url;
  if (w.task) {
    const t = w.task.querySelector('[data-os-title]');
    if (t) t.textContent = w.state.title;
  }
  pushState();
}

/**
 * Claim this window's generation slot, cancelling whatever was still streaming
 * into it. Every path that writes a document into a window goes through here.
 */
function beginGen(w: OsWindow): AbortController {
  w.gen?.abort();
  const ac = new AbortController();
  w.gen = ac;
  return ac;
}

function handleGenError(err: unknown) {
  // a superseded generation is not a failure: the user asked for something else
  if ((err as any)?.name === 'AbortError') return;
  // the kernel stays visually silent, but it never swallows a failure
  try {
    console.warn('[os] generation failed:', err);
  } catch {}
  if (err instanceof CapError) {
    showQueue(err.retryAfter, () => clearScreen());
    return;
  }
  telemetry(null, 'error: ' + String((err as any)?.message || err));
}

/* --------------------------------------------------------- runtime calls */

function handleCall(w: OsWindow, fn: string, args: unknown[], _from: 'self' | 'page') {
  const arg0 = args[0];
  switch (fn) {
    case 'open':
      openApp(String(arg0 || ''), (args[1] as Record<string, unknown>) || {});
      break;
    case 'close':
      wm?.close(w);
      break;
    case 'navigate': {
      const url = String(arg0 || '');
      if (w.state.app === 'browser') navigate(w, url).catch(handleGenError);
      else openApp('browser', { url });
      break;
    }
    case 'reload':
      if (w.state.app === 'browser' && w.state.cursor >= 0) {
        // no caching, ever: reloading regenerates from scratch
        navigate(w, w.state.history[w.state.cursor], { push: false }).catch(handleGenError);
      } else {
        streamApp(w).catch(handleGenError);
      }
      break;
    case 'back':
      if (w.state.cursor > 0) {
        w.state.cursor -= 1;
        navigate(w, w.state.history[w.state.cursor], { push: false }).catch(handleGenError);
      }
      break;
    case 'forward':
      if (w.state.cursor >= 0 && w.state.cursor < w.state.history.length - 1) {
        w.state.cursor += 1;
        navigate(w, w.state.history[w.state.cursor], { push: false }).catch(handleGenError);
      }
      break;
    case 'home':
      if (w.state.app === 'browser') navigate(w, 'https://google.com/').catch(handleGenError);
      else openApp('browser', {});
      break;
    case 'setTitle': {
      const t = String(arg0 || '');
      w.state.title = t;
      // every one of them (T4): a window may now carry the kernel's bare chrome
      // strip as well as the model's own header
      w.root.querySelectorAll('[data-os-title]').forEach((el) => {
        el.textContent = t;
      });
      break;
    }
    case 'install':
      install(arg0 as AppSpec);
      break;
    case 'reboot':
      reboot();
      break;
  }
}

/** Store installs: the manifest grows for this session only (SPEC §2.2). */
function install(specIn: AppSpec | undefined) {
  if (!specIn || typeof specIn !== 'object') return;
  const rawId = String((specIn as any).id || '').trim();
  const slug = (rawId.replace(/^custom:/, '') || 'thing')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .slice(0, 40);
  const id = 'custom:' + (slug || 'thing');
  if (session.manifest.apps.some((a) => a.id === id)) return;
  const name = (specIn as any).name ? String((specIn as any).name).slice(0, 60) : undefined;
  const spec: AppSpec = {
    id,
    name,
    shape: String((specIn as any).shape || slug),
    affordances: (specIn as any).affordances ? String((specIn as any).affordances) : undefined,
  };
  session.manifest.apps.push(spec);
  // the launcher carries the model's name, not `custom:dowsing-kit`
  injectMissing([`[data-os-app="${id}"]`], [{ id, label: name || slug }]);
  (window as any).__osFire?.('installed', spec);
  pushState();
}

/**
 * SPEC §4: the updater's install reboots into version+1 with the same name
 * lineage. A reboot is a whole new machine — nothing is carried but the name
 * and the version number.
 */
function reboot() {
  const id = session?.identity;
  const lineage = id ? { name: id.name, version: id.version } : undefined;
  const engine = session?.engine;
  telemetry(null, 'rebooting' + (lineage ? ' into ' + nextVersion(lineage.version) : ''));
  booting = false;
  boot(engine, lineage);
}

/* ------------------------------------------------------------------ start */

if (isMobile(window.innerWidth)) document.documentElement.setAttribute('data-os-mobile', '1');
/**
 * BAKEOFF-4 #1: the ledger, readable from outside. The bake-off harness and the
 * e2e suite ask for it; it is a read of a counter and changes nothing.
 */
(window as any).__osNet = () => netSnapshot();
/**
 * KERNEL-6 — the open-an-app trace, oldest first. The instrument HANDOFF-5
 * issue 1 asked for: on `/` there is no HUD, so this ring is the only witness
 * a real boot leaves behind.
 */
(window as any).__osTrace = () => traceDump();
boot();
export {};
