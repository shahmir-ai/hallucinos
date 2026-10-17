import { test, expect, type Page } from '@playwright/test';
import { MAIN, boot, openApp, appFrame } from './helpers.js';

/**
 * SEAM H4 — focus is a state the machine can see, and the focused window's
 * title bar is legible.
 *
 * The kernel owns focus (SPEC §2.2), so no generated document can work out
 * which of its windows is active: `data-os-focused="true|false"` on every window
 * root and `data-os-active` on the matching task entry are how it is told, and
 * the prompts say the attributes exist so a model can style an inactive title
 * bar and a pressed task entry.
 *
 * The other half is placement. Raising the focused window above the rest is not
 * enough to READ it: the cascade wraps after six windows, so the seventh lands
 * exactly on the first and two title bars occupy the same strip — which is also
 * what made HANDOFF-4 issue 8 (the harness photographing whichever window was
 * on top) confusing to look at. The focused window is nudged off any strip it
 * collides with; nothing else moves.
 */

interface WinView {
  id: string;
  focused: string | null;
  z: number;
  active: boolean;
  strip: { x: number; y: number; w: number; h: number };
}

async function windows(page: Page): Promise<WinView[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-os-window-id]')).map((el) => {
      const root = el as HTMLElement;
      const id = root.getAttribute('data-os-window-id') || '';
      const r = root.getBoundingClientRect();
      const bar = (root.querySelector('[data-os-drag]') || root.querySelector('[data-os-title]')) as HTMLElement | null;
      const bh = bar ? bar.getBoundingClientRect().height : 34;
      const task = document.querySelector(`[data-os-task-for="${id}"]`);
      return {
        id,
        focused: root.getAttribute('data-os-focused'),
        z: Number(getComputedStyle(root).zIndex) || 0,
        active: !!task && task.hasAttribute('data-os-active'),
        strip: { x: r.left, y: r.top, w: r.width, h: Math.max(8, Math.min(bh, r.height)) },
      };
    })
  );
}

/**
 * The kernel's own rule (`stripsCollide`), restated here rather than imported:
 * a cascade overlap is not a collision, two title bars covering at least half of
 * the shorter one are.
 */
function collide(a: WinView['strip'], b: WinView['strip']): boolean {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  if (w < 24) return false;
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return h >= Math.max(12, Math.round(Math.min(a.h, b.h) * 0.5));
}

async function twoWindows(page: Page) {
  await boot(page, MAIN + '/');
  await openApp(page, 'notes');
  await appFrame(page);
  await openApp(page, 'calculator');
  await expect.poll(async () => page.locator('[data-os-window-id]').count(), { timeout: 20_000 }).toBe(2);
  return windows(page);
}

test('every window says whether it is focused, and only one task entry is active', async ({ page }) => {
  const ws = await twoWindows(page);
  expect(ws).toHaveLength(2);
  // `false` is a selector too: the attribute is on BOTH windows, not only the
  // focused one, so a machine can style an inactive title bar from the start
  expect(ws.every((w) => w.focused === 'true' || w.focused === 'false')).toBe(true);
  const focused = ws.filter((w) => w.focused === 'true');
  expect(focused).toHaveLength(1);
  // the newest window has it, and it is the one on top
  expect(focused[0].id).toBe(ws[ws.length - 1].id);
  expect(focused[0].z).toBeGreaterThan(ws.find((w) => w.focused === 'false')!.z);
  // and exactly one task entry is marked active — the focused window's
  expect(ws.filter((w) => w.active).map((w) => w.id)).toEqual([focused[0].id]);
});

test('clicking a task entry focuses that window and moves the active mark', async ({ page }) => {
  const before = await twoWindows(page);
  const other = before.find((w) => w.focused === 'false')!;
  await page.locator(`[data-os-task-for="${other.id}"]`).click();

  const after = await windows(page);
  const now = after.find((w) => w.id === other.id)!;
  expect(now.focused).toBe('true');
  expect(now.active).toBe(true);
  // fully above all others, not merely one step up
  expect(now.z).toBe(Math.max(...after.map((w) => w.z)));
  expect(after.filter((w) => w.focused === 'true')).toHaveLength(1);
  expect(after.filter((w) => w.active)).toHaveLength(1);
  // and it really is the thing on top in its own middle
  const top = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      return el?.closest('[data-os-window-id]')?.getAttribute('data-os-window-id') || '';
    },
    { x: now.strip.x + now.strip.w / 2, y: now.strip.y + 40 }
  );
  expect(top).toBe(other.id);
});

test('a minimized window is restored and focused by its task entry', async ({ page }) => {
  const ws = await twoWindows(page);
  const target = ws[ws.length - 1];
  await page.locator(`[data-os-window-id="${target.id}"] [data-os-minimize]`).first().click();
  await expect(page.locator(`[data-os-window-id="${target.id}"]`)).toHaveAttribute('data-os-minimized', 'true');
  // hidden is not focused, and its entry is not active
  let now = (await windows(page)).find((w) => w.id === target.id)!;
  expect(now.focused).toBe('false');
  expect(now.active).toBe(false);

  await page.locator(`[data-os-task-for="${target.id}"]`).click();
  await expect(page.locator(`[data-os-window-id="${target.id}"]`)).not.toHaveAttribute('data-os-minimized', 'true');
  now = (await windows(page)).find((w) => w.id === target.id)!;
  expect(now.focused).toBe('true');
  expect(now.active).toBe(true);
});

test('closing the focused window hands focus to the one underneath', async ({ page }) => {
  const ws = await twoWindows(page);
  const top = ws.find((w) => w.focused === 'true')!;
  const under = ws.find((w) => w.focused === 'false')!;
  await page.locator(`[data-os-window-id="${top.id}"] [data-os-close]`).first().click();
  await expect.poll(async () => page.locator('[data-os-window-id]').count(), { timeout: 20_000 }).toBe(1);
  const after = await windows(page);
  expect(after[0].id).toBe(under.id);
  expect(after[0].focused).toBe('true');
  expect(after[0].active).toBe(true);
});

test('the cascade keeps title bars clear, and focus nudges one that is not', async ({ page }) => {
  const ws = await twoWindows(page);
  // the cascade already separates them: nothing to repair on a fresh desktop
  expect(collide(ws[0].strip, ws[1].strip)).toBe(false);
  expect(await page.locator('[data-os-nudged]').count()).toBe(0);

  // a desktop script (or a resize, or the model's own layout) puts two windows
  // in the same place; the focused one must not be left sharing a title strip
  const ids = ws.map((w) => w.id);
  await page.evaluate((ids) => {
    for (const id of ids) {
      const el = document.querySelector(`[data-os-window-id="${id}"]`) as HTMLElement;
      el.style.left = '140px';
      el.style.top = '110px';
    }
  }, ids);
  const stacked = await windows(page);
  expect(collide(stacked[0].strip, stacked[1].strip)).toBe(true);

  await page.locator(`[data-os-task-for="${ids[0]}"]`).click();
  const after = await windows(page);
  const moved = after.find((w) => w.id === ids[0])!;
  expect(moved.focused).toBe('true');
  await expect(page.locator(`[data-os-window-id="${ids[0]}"]`)).toHaveAttribute('data-os-nudged', /\d+/);
  expect(collide(moved.strip, after.find((w) => w.id === ids[1])!.strip)).toBe(false);
  // the nudge is placement inside the layer, not a window pushed off the edge
  const area = await page.evaluate(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
  expect(moved.strip.x).toBeGreaterThanOrEqual(0);
  expect(moved.strip.y).toBeGreaterThanOrEqual(0);
  expect(moved.strip.y + moved.strip.h).toBeLessThanOrEqual(area.vh);
  expect(moved.strip.x + moved.strip.w).toBeLessThanOrEqual(area.vw + 1);
});
