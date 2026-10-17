import { test, expect } from '@playwright/test';
import { MAIN, boot, openApp, appFrame } from './helpers.js';
import { routeGen, routeEngines, withHedgeTelemetry } from './fakes.js';

/**
 * SEAM H1/H2, the kernel's side.
 *
 * `/` asks for the engine `auto`: not a model, a policy — the server resolves it
 * per kind through `engines.json`'s routing table and hedges the primary against
 * a second provider. `/bakeoff/run` is the judging surface and keeps explicit
 * ids, because a single engine that is silently helped by another cannot be
 * judged. The HUD says which engine actually won.
 *
 * The suite has no provider key in it (that is deliberate: it must never be able
 * to spend money), so `auto` is advertised by a fake `/api/engines` and the
 * engine the kernel asks with is read off the `/api/gen` bodies. What the
 * requests then reach is the real server, with the engine rewritten to `mock`.
 */

test('/ boots on the routed engine when the server advertises it', async ({ page }) => {
  await routeEngines(page, { auto: true, default: 'auto' });
  const asked = await routeGen(page, { engine: () => 'mock' });
  await boot(page, MAIN + '/');

  expect(asked.length).toBeGreaterThan(1);
  // every generation of the session, boot and desktop and anything after them
  expect(asked.map((a) => a.engine)).toEqual(asked.map(() => 'auto'));
  await openApp(page, 'notes');
  await appFrame(page);
  expect(asked.filter((a) => a.kind === 'app').map((a) => a.engine)).toEqual(['auto']);

  // and `/` still has no picker and no HUD, routed or not
  await expect(page.locator('[data-os-picker]')).toHaveCount(0);
  await expect(page.locator('[data-os-hud]')).toHaveCount(0);
});

test('/ falls back to a single engine when the server advertises no routing', async ({ page }) => {
  // a server with no keyed route — which is what the whole suite runs against
  const asked = await routeGen(page);
  await boot(page, MAIN + '/');
  expect(asked.map((a) => a.engine)).toEqual(asked.map(() => 'mock'));
});

test('/bakeoff/run keeps explicit engine ids and never resolves to auto', async ({ page }) => {
  await routeEngines(page, { auto: true, default: 'auto' });
  const asked = await routeGen(page, { engine: () => 'mock' });

  // asked for by name: the picker's own case
  await boot(page, MAIN + '/bakeoff/run?engine=mock');
  expect(asked.map((a) => a.engine)).toEqual(asked.map(() => 'mock'));

  // and with nothing asked for: a judging surface picks an engine, not a policy
  asked.length = 0;
  await boot(page, MAIN + '/bakeoff/run');
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.map((a) => a.engine)).not.toContain('auto');

  // the picker offers engines, not the router
  const options = await page.request.get(MAIN + '/api/engines');
  expect((await options.json()).engines.map((e: any) => e.id)).toEqual(['mock']);
});

test('the HUD names the engine that won a hedged generation', async ({ page }) => {
  await routeEngines(page, { auto: true, default: 'auto' });
  await routeGen(page, {
    engine: () => 'mock',
    patch: (text, req) =>
      req.kind === 'desktop'
        ? withHedgeTelemetry(text, {
            engine: 'auto',
            hedged: true,
            winner: 'or-oss120-groq',
            loser: 'cerebras-oss120',
            loser_aborted_ms: 41,
            loser_tokens_in: 5438,
          })
        : text,
  });
  await boot(page, MAIN + '/bakeoff/run?engine=auto');
  const hud = (await page.locator('[data-os-hud]').textContent()) || '';
  expect(hud).toContain('engine   auto');
  expect(hud).toContain('hedge    won by or-oss120-groq');
  expect(hud).toContain('lost cerebras-oss120');
  expect(hud).toContain('@41ms');
  expect(hud).toContain('5438 in billed');
});

/**
 * SEAM H3's number on the judging surface: the HUD says when the boot frame
 * inked, which is the reading HANDOFF-4's two instruments disagreed about.
 */
test('the HUD reports the boot ink', async ({ page }) => {
  await boot(page, MAIN + '/bakeoff/run?engine=mock');
  const hud = (await page.locator('[data-os-hud]').textContent()) || '';
  expect(hud).toMatch(/ink\s+boot \d+ ms/);
});

/**
 * SEAM T1 / defect D6 — `DEFAULT_ENGINE` can put `/` on ONE engine again.
 *
 * HANDOFF-6 §2 reproduced this three times on a wiped tree: with
 * `DEFAULT_ENGINE=cerebras-oss120` — the documented deploy recipe — a live boot
 * of `/` was served by `auto` and hedged, at the hedged price, because
 * `chooseEngine` preferred `auto` whenever the list carried it and never looked
 * at the default underneath. The only way to pin `/` was `ROUTING=off`, which
 * throws the hedge away everywhere and is a kill switch, not a setting.
 *
 * The server publishes the verdict twice — `pinned` on `/api/engines` and
 * `<body data-engine>` on the kernel page — and the kernel honours either.
 */

test('/ honours a pinned engine instead of the router (T1)', async ({ page }) => {
  await routeEngines(page, { auto: true, default: 'mock', pinned: 'mock' });
  const asked = await routeGen(page);
  await boot(page, MAIN + '/');
  expect(asked.length).toBeGreaterThan(1);
  expect(asked.map((a) => a.engine)).toEqual(asked.map(() => 'mock'));
  await openApp(page, 'notes');
  await appFrame(page);
  expect(asked.filter((a) => a.kind === 'app').map((a) => a.engine)).toEqual(['mock']);
});

test('/ is routed when nothing is pinned, pin or no pin field (T1)', async ({ page }) => {
  await routeEngines(page, { auto: true, default: 'auto', pinned: null });
  const asked = await routeGen(page, { engine: () => 'mock' });
  await boot(page, MAIN + '/');
  expect(asked.map((a) => a.engine)).toEqual(asked.map(() => 'auto'));
});

test('a pin naming an engine the server has no key for is not a pin (T1)', async ({ page }) => {
  // the server would send `pinned: null` for this; a kernel that trusted the
  // string would ask for an engine that does not exist and get a 400 per boot
  await routeEngines(page, { auto: true, default: 'auto', pinned: 'cerebras-oss120' });
  const asked = await routeGen(page, { engine: () => 'mock' });
  await boot(page, MAIN + '/');
  expect(asked.map((a) => a.engine)).toEqual(asked.map(() => 'auto'));
});

test('an explicit ?engine= still outranks the pin (T1)', async ({ page }) => {
  await routeEngines(page, { auto: true, default: 'mock', pinned: 'mock' });
  const asked = await routeGen(page, { engine: () => 'mock' });
  await boot(page, MAIN + '/bakeoff/run?engine=auto');
  expect(asked.map((a) => a.engine)).toEqual(asked.map(() => 'auto'));
});

/**
 * And the whole suite is the pin's own regression test: every e2e server runs
 * with `DEFAULT_ENGINE=mock` (playwright.config.ts), so `/api/engines` answers
 * `pinned: "mock"` and `<body data-engine="mock">` — which is what these
 * assertions read when no `/api/engines` fake is installed at all.
 */
test('the server publishes the pin on both witnesses (T1)', async ({ page }) => {
  const res = await page.request.get(MAIN + '/api/engines');
  const j = await res.json();
  expect(j.pinned).toBe('mock');
  expect(j.default).toBe('mock');
  await page.goto(MAIN + '/');
  await expect(page.locator('body')).toHaveAttribute('data-engine', 'mock');
});
