import { expect, type Frame, type Page } from '@playwright/test';

export const MAIN = 'http://localhost:8770';
export const CAPPED = 'http://localhost:8771';
export const BROKEN = 'http://localhost:8772';
export const SLOW = 'http://localhost:8773';
export const REPAIRABLE = 'http://localhost:8774';
/** MOCK_BREAK=content-collapse: a window template whose [data-os-content] has no height. */
export const COLLAPSED = 'http://localhost:8775';
/** MOCK_DELAY_MS=250: slow enough to interact with a document that is still arriving. */
export const CRAWL = 'http://localhost:8776';
/** remote moderation pointed at scripts/fake-mod.mjs, which flags "reroute-me" late. */
export const LATEMOD = 'http://localhost:8777';
/** MOCK_BREAK=app-error-once: the first app document dies half written. */
export const HALFAPP = 'http://localhost:8779';
/** MOCK_BREAK=stack-inverted: windows layer declared first, launchers given a z-index. */
export const INVERTED = 'http://localhost:8780';

export async function boot(page: Page, url = MAIN + '/'): Promise<void> {
  await page.goto(url);
  await page.waitForSelector('html[data-os-ready]', { timeout: 60_000 });
}

/**
 * Open an app from its desktop launcher — with a REAL hit-tested click by
 * default (KERNEL-6 #2 / HANDOFF-6 #7).
 *
 * The old default dispatched the `click` event straight at the launcher, which
 * meant every app-opening test in the suite was one delegation bug away from
 * being a test of nothing: HANDOFF-5 lost four windows to a kernel guard that
 * refused real clicks inside a `[data-os-dock]`, 102 e2e tests stayed green,
 * and `scripts/stress.mjs` — which needs a paid engine — was the only
 * hit-tested clicker in the tree.
 *
 * So the default is a real pointer press and release, at the launcher's own
 * box, through Playwright's actionability and hit-testing checks. That also
 * exercises the production path the dispatch never did: `mousedown` starts the
 * speculative generation (SPEC §12.1 / I4) and the click that follows claims
 * it.
 *
 * **The documented fallback.** A window a test has already opened can sit over
 * the launcher grid — the geometry is the model's — and then no amount of
 * waiting will make the launcher clickable. Rather than fail on that, the real
 * click is given `REAL_CLICK_MS` and, if it does not land, the helper falls
 * back to the old dispatch and RECORDS it in `openAppFallbacks`. A test that
 * wants to prove hit-testing asserts that list is empty (see
 * `e2e/hittest.spec.ts`); a test that just needs a window open does not care
 * how it got one. `{ real: false }` asks for the dispatch outright.
 */
export const REAL_CLICK_MS = 4000;

export interface OpenAppOpts {
  /** false: dispatch the click instead of pressing the mouse (the old default) */
  real?: boolean;
  timeout?: number;
  /** open the nth launcher for this id rather than the first (a menu entry, say) */
  nth?: number;
}

/** Every launcher the real click could not reach, with the reason. Cleared per test. */
export const openAppFallbacks: { id: string; why: string }[] = [];

export async function openApp(page: Page, id: string, opts: OpenAppOpts = {}): Promise<'clicked' | 'dispatched'> {
  const nth = opts.nth ?? 0;
  const loc = page.locator(`[data-os-app="${id}"]`).nth(nth);
  if (opts.real === false) {
    await loc.dispatchEvent('click');
    return 'dispatched';
  }
  try {
    await loc.click({ timeout: opts.timeout ?? REAL_CLICK_MS });
    return 'clicked';
  } catch (err: any) {
    const why = String(err?.message || err).split('\n')[0];
    openAppFallbacks.push({ id, why });
    // said out loud: a suite that quietly dispatched everything is how
    // HANDOFF-5's four lost windows stayed invisible through 102 green tests
    console.warn('[e2e] openApp fell back to a dispatched click on ' + id + ': ' + why);
    await loc.dispatchEvent('click');
    return 'dispatched';
  }
}

/** A real click and nothing else: no fallback, so a covered launcher fails the test. */
export async function clickLauncher(page: Page, id: string, nth = 0): Promise<void> {
  await page.locator(`[data-os-app="${id}"]`).nth(nth).click();
}

/**
 * What the pointer actually hit at the middle of this launcher's box, measured
 * the moment it is asked (HANDOFF-6's trap: "a launcher's box goes stale within
 * a second" — a dock with hover magnification moves its icons under the
 * pointer). Returns the `data-os-app` of the launcher the hit belongs to, or a
 * description of whatever is in the way.
 */
export async function hitTestLauncher(page: Page, id: string, nth = 0): Promise<string> {
  return page.evaluate(
    ([sel, n]) => {
      const el = document.querySelectorAll(sel as string)[n as number] as HTMLElement | undefined;
      if (!el) return 'no-launcher';
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return 'no-box';
      const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      if (!hit) return 'nothing';
      const owner = hit.closest('[data-os-app]');
      if (owner) return owner.getAttribute('data-os-app') || 'unnamed';
      return 'covered:' + hit.tagName.toLowerCase() + (hit.getAttribute('data-os-window-id') ? '[window]' : '');
    },
    [`[data-os-app="${id}"]`, nth] as const
  );
}

/** The iframe of the most recently opened window. */
export async function appFrame(page: Page, nth = -1): Promise<Frame> {
  const frames = page.locator('[data-os-window-id] iframe[data-os-frame="app"]');
  await expect.poll(async () => frames.count(), { timeout: 20_000 }).toBeGreaterThan(0);
  const count = await frames.count();
  const idx = nth < 0 ? count + nth : nth;
  const handle = await frames.nth(idx).elementHandle();
  const frame = await handle!.contentFrame();
  if (!frame) throw new Error('no content frame');
  return frame;
}

/** The nested page frame inside a browser app window. */
export async function pageFrame(page: Page, app?: Frame): Promise<Frame> {
  const a = app || (await appFrame(page));
  let child: Frame | undefined;
  await expect
    .poll(
      async () => {
        child = a.childFrames()[0];
        if (!child) return 0;
        return await child.evaluate(() => (document.body ? document.body.innerText.length : 0)).catch(() => 0);
      },
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0);
  return child!;
}

export async function frameText(f: Frame): Promise<string> {
  return f.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
}

/** Every mock document carries a unique token; two generations never share one. */
export async function genToken(f: Frame): Promise<string> {
  return f
    .evaluate(() => {
      const el = document.querySelector('[data-mock-token]');
      return el ? el.textContent || '' : '';
    })
    .catch(() => '');
}

export async function waitForPageShape(page: Page, shape: string, app?: Frame): Promise<Frame> {
  const a = app || (await appFrame(page));
  let f: Frame | undefined;
  await expect
    .poll(
      async () => {
        f = a.childFrames()[0];
        if (!f) return '';
        return await f.evaluate(() => document.querySelector('[data-mock-shape]')?.getAttribute('data-mock-shape') || '').catch(() => '');
      },
      { timeout: 30_000 }
    )
    .toBe(shape);
  return f!;
}
