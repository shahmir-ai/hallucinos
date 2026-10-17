import { test, expect, type Page } from '@playwright/test';
import { boot, openApp, appFrame, pageFrame, clickLauncher } from './helpers.js';

/**
 * INTERFACE I6 — first paint is reported per generation, on every path.
 *
 * The bug this exists for (BAKEOFF-2 §7): `streamApp()` set `frame.onPaint`
 * before the generation had an id, so `mark('')` returned early and an app's
 * first paint was recorded ONLY when the open happened to take the speculative
 * path. Every §12.1 app and page number in a bake-off was therefore measured on
 * the one code path a visitor does not take when they click without pressing
 * first. The id is now minted before the request and sent with it.
 *
 * Read off the wire rather than out of the kernel: `/api/mark` is what the
 * bake-off runner and the telemetry line actually see.
 */
interface Mark {
  gen_id: string;
  first_paint_ms?: number;
  interactive_ms?: number;
  complete_ms?: number;
}

function watch(page: Page): { marks: Mark[]; gens: { kind: string; gen_id: string }[] } {
  const marks: Mark[] = [];
  const gens: { kind: string; gen_id: string }[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/mark')) {
      const b = r.postDataJSON();
      if (b) marks.push(b as Mark);
      return;
    }
    if (r.url().endsWith('/api/gen')) {
      const b = r.postDataJSON();
      if (b) gens.push({ kind: String(b.kind), gen_id: String(b.gen_id || '') });
    }
  });
  return { marks, gens };
}

const painted = (marks: Mark[], id: string) => marks.filter((m) => m.gen_id === id && typeof m.first_paint_ms === 'number');

test.describe('first-paint marks (I6)', () => {
  test('an app opened with a plain click reports its own first paint', async ({ page }) => {
    const seen = watch(page);
    await boot(page);
    // dispatched, not pressed: no mousedown, so no speculative generation and
    // this is the non-speculative path the bug hid in
    await openApp(page, 'calculator');
    await appFrame(page);

    const app = seen.gens.filter((g) => g.kind === 'app');
    expect(app).toHaveLength(1);
    expect(app[0].gen_id).not.toBe('');
    await expect.poll(async () => painted(seen.marks, app[0].gen_id).length, { timeout: 20_000 }).toBeGreaterThan(0);
    const m = painted(seen.marks, app[0].gen_id)[0];
    expect(m.first_paint_ms).toBeGreaterThan(0);
    /**
     * SEAM H3 split the one moment into two. `interactive_ms` is still the
     * first chunk — the runtime has the document open and its delegation
     * attached — and `first_paint_ms` is now the INK, the first element with a
     * box, because a chunk that is a comment or a stylesheet is not a pixel
     * (HANDOFF-4's headline). Both are reported against this generation and the
     * order between them can only be one way round.
     */
    const interactive = seen.marks.filter((x) => x.gen_id === app[0].gen_id && typeof x.interactive_ms === 'number');
    expect(interactive.length).toBeGreaterThan(0);
    expect(interactive[0].interactive_ms!).toBeLessThanOrEqual(m.first_paint_ms!);
    // and the whole generation is reported too, against the same id
    await expect
      .poll(async () => seen.marks.filter((x) => x.gen_id === app[0].gen_id && typeof x.complete_ms === 'number').length, { timeout: 20_000 })
      .toBeGreaterThan(0);
  });

  test('every generation of a boot is marked: boot, desktop, app, page', async ({ page }) => {
    const seen = watch(page);
    await boot(page);
    // a real, hit-tested click: this one DOES fire mousedown, so it takes the
    // speculative path — both paths have to report
    await clickLauncher(page, 'browser');
    const app = await appFrame(page);
    await pageFrame(page, app);

    for (const kind of ['boot', 'desktop', 'app', 'page']) {
      const ids = seen.gens.filter((g) => g.kind === kind).map((g) => g.gen_id);
      expect(ids.length).toBeGreaterThan(0);
      await expect
        .poll(async () => ids.some((id) => painted(seen.marks, id).length > 0), { timeout: 30_000 })
        .toBe(true);
    }
    // no mark is ever posted without an id (that was the bug's signature)
    expect(seen.marks.every((m) => !!m.gen_id)).toBe(true);
  });
});
