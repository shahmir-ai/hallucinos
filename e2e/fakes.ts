import type { Page } from '@playwright/test';

/**
 * Fake upstreams for the two failures a mock server cannot reproduce yet, faked
 * at the NETWORK layer rather than in `server/mock.ts` — this pass does not own
 * the server. Both want a `MOCK_BREAK` mode of their own eventually, and the
 * names are in KERNEL-5.md:
 *
 *  - `boot-ink-none`: a boot stream that is the identity comment and nothing
 *    else. HANDOFF-4 measured one `cerebras-oss120` boot probe in three doing
 *    exactly this — the whole budget on reasoning, no `<!doctype`, a frame that
 *    stays black for its whole life.
 *  - `desktop-overflow`: a desktop whose bar is below the fold of a document
 *    taller than the viewport, which is what a model writes when it gives the
 *    desktop area a fixed height and puts the taskbar after it in the flow.
 *
 * Everything else is passed through to the real server, so what the tests
 * exercise either side of the fake is the real `/api/gen`.
 */

export const IDENTITY_OPEN = '<!--os-identity:';

export interface GenAsk {
  kind: string;
  engine: string;
}

export interface GenRouteOpts {
  /** a whole response body for this request, or null/undefined to let it through */
  body?: (req: any) => string | null | undefined;
  /** rewrite the engine field before the request goes upstream */
  engine?: (req: any) => string;
  /** rewrite the response text that came back from the real server */
  patch?: (text: string, req: any) => string;
}

/**
 * Intercept POST /api/gen. Returns the list of `{kind, engine}` the kernel
 * asked for, in order — which is how the `engine: "auto"` assertions (SEAM H1)
 * are made without a keyed provider anywhere near the suite.
 */
export async function routeGen(page: Page, opts: GenRouteOpts = {}): Promise<GenAsk[]> {
  const asked: GenAsk[] = [];
  await page.route('**/api/gen', async (route) => {
    let req: any = {};
    try {
      req = route.request().postDataJSON() || {};
    } catch {}
    asked.push({ kind: String(req.kind), engine: String(req.engine) });
    const canned = opts.body ? opts.body(req) : null;
    if (typeof canned === 'string') {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        body: canned,
      });
      return;
    }
    const postData = JSON.stringify(opts.engine ? { ...req, engine: opts.engine(req) } : req);
    if (!opts.patch) {
      await route.continue({ postData });
      return;
    }
    const res = await route.fetch({ postData });
    const text = await res.text();
    await route.fulfill({
      status: res.status(),
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      body: opts.patch(text, req),
    });
  });
  return asked;
}

/** `boot-ink-none` — the identity comment, then the stream ends. No document. */
export function identityOnlyBoot(over: Record<string, unknown> = {}): string {
  return (
    IDENTITY_OPEN +
    JSON.stringify({
      name: 'INKLESS',
      tagline: 'it boots, allegedly',
      version: '1.0',
      era: '1994-adjacent',
      personality: 'terse, unhelpful',
      palette_words: ['oxide', 'bone'],
      font_words: ['monospace'],
      boot_message: 'checking the tape',
      archetype: 'taskbar',
      ...over,
    }) +
    '-->'
  );
}

const WIN_TEMPLATE =
  '<template data-os-window><div style="position:absolute;background:#12161c;border:1px solid #39424f;display:flex;flex-direction:column;overflow:hidden;pointer-events:auto">' +
  '<header data-os-drag style="display:flex;gap:6px;align-items:center;padding:6px 8px;background:#1d2430;cursor:move">' +
  '<span data-os-title>window</span><span style="flex:1"></span>' +
  '<button data-os-minimize>_</button><button data-os-maximize>[]</button><button data-os-close>x</button></header>' +
  '<div data-os-content style="flex:1;position:relative"></div>' +
  '<div data-os-resize style="position:absolute;right:0;bottom:0;width:14px;height:14px"></div></div></template>' +
  '<template data-os-task><button><span data-os-title>task</span></button></template>';

/**
 * `desktop-overflow` — every contract hook present and the bar past the bottom
 * of the screen: the desktop area is given a fixed 1,700 px height and the bar
 * is written after it in the normal flow, in a document whose own stylesheet
 * re-opens scrolling on `html,body`. The kernel's fit guard has to clamp the
 * document and then pin the bar, or the bar, its clock and every window entry
 * in it do not exist for the visitor.
 */
export function overflowDesktop(req: any): string {
  const apps: string[] = ((req?.context?.manifest?.apps || []) as any[]).map((a) => String(a.id));
  const launchers = apps
    .map(
      (id) =>
        `<button data-os-app="${id}" style="display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:0;color:inherit;font:inherit">` +
        `<span data-os-icon="${id}" style="width:40px;height:40px;display:block;background:#243040">&#9635;</span><span>${id}</span></button>`
    )
    .join('');
  return (
    '<!doctype html><html data-os-archetype="taskbar"><head><meta charset="utf-8"><title>OVERFLOW</title><style>' +
    'html,body{margin:0;overflow:auto;background:#0e1216;color:#e6e8ea;font:13px/1.4 ui-monospace,monospace}' +
    // the mistake: a desktop area with a fixed height, taller than any screen
    '.desk{min-height:1700px;padding:14px;display:grid;grid-template-columns:repeat(8,minmax(90px,1fr));gap:10px;align-content:start}' +
    '.bar{display:flex;gap:8px;align-items:center;height:36px;padding:0 10px;background:#1d2430;border-top:1px solid #2c3543}' +
    '</style></head><body>' +
    `<section data-os-desktop class="desk">${launchers}</section>` +
    '<div data-os-windows style="position:absolute;left:0;top:0;right:0;bottom:36px"></div>' +
    '<footer data-os-taskbar class="bar"><strong>OVERFLOW</strong><span style="flex:1"></span>' +
    '<span data-os-clock>00:00:00 &middot; 01/01/1994</span></footer>' +
    WIN_TEMPLATE +
    '</body></html>'
  );
}

/**
 * Advertise `auto` from /api/engines the way a keyed server does (SEAM H1), so
 * the kernel's routing default can be asserted on a suite that has no provider
 * key anywhere in it. The real list is kept and `auto` goes first, which is
 * where the server puts it.
 */
export async function routeEngines(
  page: Page,
  opts: { auto?: boolean; default?: string; pinned?: string | null } = {}
): Promise<void> {
  const withAuto = opts.auto !== false;
  await page.route('**/api/engines', async (route) => {
    const res = await route.fetch();
    const j: any = await res.json().catch(() => ({ engines: [] }));
    const real = (j.engines || []).filter((e: any) => e.id !== 'auto');
    j.engines = withAuto ? [{ id: 'auto', label: 'auto (routed, hedged)', model: 'routed' }, ...real] : real;
    j.default = opts.default ?? (withAuto ? 'auto' : j.default);
    /**
     * T1/D6: non-null when DEFAULT_ENGINE names a keyed engine, i.e. `/` is
     * pinned to one engine and the router is not the default. A fake that does
     * not mention a pin means there is none — otherwise the real server's own
     * `DEFAULT_ENGINE=mock` (playwright.config.ts) would leak into every
     * routing assertion as a pin.
     */
    j.pinned = opts.pinned === undefined ? null : opts.pinned;
    j.routing = withAuto;
    await route.fulfill({ json: j, headers: { 'cache-control': 'no-store' } });
  });
}

/** Merge hedge telemetry (SEAM H2) into the sentinel the server already sent. */
export function withHedgeTelemetry(text: string, over: Record<string, unknown>): string {
  return text.replace(/<!--os-telemetry:([\s\S]*?)-->/, (_m, json) => {
    let t: any = {};
    try {
      t = JSON.parse(json);
    } catch {}
    return '<!--os-telemetry:' + JSON.stringify({ ...t, ...over }) + '-->';
  });
}

/**
 * `bar-contents-overflow` — the fault BAKEOFF-4 found in `auto` boot 1
 * (glide7) and that nothing was measuring: the bar's OWN box sits perfectly
 * inside the viewport, `data-os-fit` never fires, and every task entry is a
 * blank rounded rectangle whose icon and label are below the bottom of the
 * screen. The shape of it is a short bar (34 px, pinned to the bottom edge by
 * the model itself) with `align-items:center` and entries taller than it, so
 * each entry straddles the bar and hangs the same distance out of the top and
 * the bottom — and the bottom half of it is off the screen.
 *
 * `fitBarContents` (step 3 of the kernel's fit guard) has to grow the bar to
 * contain its own children and re-pin it, or §12.3's "one entry per open
 * window" is a row of empty rectangles.
 */
export function barContentsOverflowDesktop(req: any): string {
  const apps: string[] = ((req?.context?.manifest?.apps || []) as any[]).map((a) => String(a.id));
  const launchers = apps
    .map(
      (id) =>
        `<button data-os-app="${id}" style="display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:0;color:inherit;font:inherit">` +
        `<span data-os-icon="${id}" style="width:40px;height:40px;display:block;background:#2a3444">&#9635;</span><span>${id}</span></button>`
    )
    .join('');
  return (
    '<!doctype html><html data-os-archetype="taskbar"><head><meta charset="utf-8"><title>GLIDE</title><style>' +
    'html,body{margin:0;height:100%;overflow:hidden;background:#101418;color:#e7eaee;font:13px/1.4 ui-monospace,monospace}' +
    '.desk{padding:14px;display:grid;grid-template-columns:repeat(8,minmax(90px,1fr));gap:10px;align-content:start}' +
    // the bar fits the screen; what is inside it does not
    '.bar{position:fixed;left:0;right:0;bottom:0;height:34px;display:flex;align-items:center;gap:8px;' +
    'padding:0 10px;background:#1b222c;border-top:1px solid #2b3442}' +
    '.task{height:70px;min-width:110px;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:4px;border-radius:12px;background:#26303d;color:inherit;border:1px solid #37424f;font:inherit}' +
    '</style></head><body>' +
    `<section data-os-desktop class="desk">${launchers}</section>` +
    '<div data-os-windows style="position:absolute;left:0;top:0;right:0;bottom:34px"></div>' +
    '<footer data-os-taskbar class="bar"><strong>GLIDE</strong><span style="flex:1"></span>' +
    '<span data-os-clock>00:00:00 &middot; 01/01/2007</span></footer>' +
    WIN_TEMPLATE.replace(
      '<template data-os-task><button><span data-os-title>task</span></button></template>',
      '<template data-os-task><button class="task"><span data-os-icon style="width:28px;height:28px;display:block;background:#3d4a5c"></span>' +
        '<span data-os-title>task</span></button></template>'
    ) +
    '</body></html>'
  );
}

/**
 * `dock-launchers` — HANDOFF-5 issue 1, reproduced.
 *
 * A SPEC §12.3 `dock` desktop that does exactly what the archetype asks for:
 * "a dock along the bottom (or a side) holding the launchers as icons", and
 * names that dock `data-os-dock` — a plain attribute nothing in the prompts
 * forbids, and the same one the kernel's own bake-off chrome used to be
 * identified by. Every launcher in this desktop was dead: the kernel's
 * delegation skipped anything inside `[data-os-dock]`, so `mousedown` never
 * started a speculative generation and `click` never reached `openApp` — no
 * window, no connection, no generation, no error, nothing said anywhere.
 * Verification boot A of HANDOFF-5 is this document: `dock` archetype, 4 of 4
 * app opens lost, `windowId: null` on all four.
 *
 * The four "custom" launchers sit on the wallpaper the way boot A's did, so
 * the same fixture proves the fix did not break the launchers that always
 * worked.
 */
export function dockLaunchersDesktop(req: any): string {
  const apps: string[] = ((req?.context?.manifest?.apps || []) as any[]).map((a) => String(a.id));
  const icon = (id: string) =>
    `<button data-os-app="${id}" style="display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:0;color:inherit;font:inherit">` +
    `<span data-os-icon="${id}" style="width:40px;height:40px;display:block;background:#2b3646">&#9635;</span><span>${id}</span></button>`;
  // the first half in the dock, the rest on the wallpaper — boot A's shape
  const half = Math.max(1, Math.ceil(apps.length / 2));
  const inDock = apps.slice(0, half).map(icon).join('');
  const onDesk = apps.slice(half).map(icon).join('');
  return (
    '<!doctype html><html data-os-archetype="dock"><head><meta charset="utf-8"><title>VORTEX</title><style>' +
    'html,body{margin:0;height:100%;overflow:hidden;background:#d8c7ad;color:#22252a;font:13px/1.4 ui-monospace,monospace}' +
    '.menu{position:fixed;left:0;right:0;top:0;height:24px;display:flex;align-items:center;gap:10px;padding:0 10px;background:#efe7d9}' +
    '.desk{position:absolute;left:0;right:0;top:24px;bottom:96px;padding:14px;display:grid;' +
    'grid-template-columns:repeat(4,110px);gap:12px;align-content:start;justify-content:end}' +
    '.dock{position:fixed;left:50%;transform:translateX(-50%);bottom:8px;height:76px;display:flex;align-items:center;' +
    'gap:10px;padding:0 12px;border-radius:14px;background:rgba(255,255,255,.55)}' +
    '</style></head><body>' +
    '<header data-os-taskbar class="menu"><strong>VORTEX</strong><span style="flex:1"></span>' +
    '<span data-os-clock>00:00:00 &middot; 17/09/2026</span></header>' +
    `<section data-os-desktop class="desk">${onDesk}</section>` +
    '<div data-os-windows style="position:absolute;left:0;top:24px;right:0;bottom:96px"></div>' +
    `<nav data-os-dock class="dock">${inDock}</nav>` +
    WIN_TEMPLATE +
    '</body></html>'
  );
}

/**
 * HANDOFF-7 / D2's last case: a top menu bar, and a windows layer that spans
 * the WHOLE viewport under it.
 *
 * `dockLaunchersDesktop` gives its layer `top:24px`, so its windows start below
 * the bar and the defect cannot appear. The live boot did not: §12.9 raises the
 * bar above the windows layer, the layer covered the screen, and the first
 * window cascaded to y = 20 — its title strip and its close control under the
 * menu bar, with real pixels a pointer could not reach.
 */
export function topBarDesktop(req: any): string {
  const apps: string[] = ((req?.context?.manifest?.apps || []) as any[]).map((a) => String(a.id));
  const icon = (id: string) =>
    `<button data-os-app="${id}" style="display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:0;color:inherit;font:inherit">` +
    `<span data-os-icon="${id}" style="width:40px;height:40px;display:block;background:#2b3646">&#9635;</span><span>${id}</span></button>`;
  return (
    '<!doctype html><html data-os-archetype="dock"><head><meta charset="utf-8"><title>OBELISK</title><style>' +
    'html,body{margin:0;height:100%;overflow:hidden;background:#111;color:#eee;font:13px/1.4 ui-monospace,monospace}' +
    '.menu{position:fixed;left:0;right:0;top:0;height:36px;display:flex;align-items:center;gap:10px;padding:0 10px;background:#333}' +
    '.desk{position:absolute;right:8px;top:44px;width:180px;display:grid;grid-template-columns:repeat(2,84px);gap:10px}' +
    '</style></head><body>' +
    '<header data-os-taskbar class="menu"><strong>OBELISK</strong><span style="flex:1"></span>' +
    '<span data-os-clock>00:00:00</span> <span>&middot;</span> <span>17/09/2026</span></header>' +
    `<section data-os-desktop class="desk">${apps.map(icon).join('')}</section>` +
    // the layer covers the screen, bar included: the live shape
    '<div data-os-windows style="position:absolute;left:0;top:0;right:0;bottom:0"></div>' +
    WIN_TEMPLATE +
    '</body></html>'
  );
}

/**
 * A shared `/api/img` fake. The e2e servers have no `FAL_KEY` (deliberately —
 * the suite must never be able to spend money), so every picture in the suite
 * is this one 1x1 jpeg, and the calls the kernel made are the record.
 */
export const FAKE_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

export interface ImgAsk {
  kind: string;
  theme: string;
  prompt: string;
  scope: string;
  scopeKind: string;
  session: string;
}

/** Intercept POST /api/img, answer with the fake jpeg, and record every ask. */
export async function routeImg(page: Page, opts: { delayMs?: number } = {}): Promise<ImgAsk[]> {
  const calls: ImgAsk[] = [];
  await page.route('**/api/img', async (route) => {
    let b: any = {};
    try {
      b = route.request().postDataJSON() || {};
    } catch {}
    calls.push({
      kind: String(b.kind || ''),
      theme: String(b.theme || ''),
      prompt: String(b.prompt || ''),
      scope: String(b.scope || ''),
      scopeKind: String(b.scopeKind || ''),
      session: String(b.session || ''),
    });
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dataUri: FAKE_JPEG }) });
  });
  return calls;
}

const APPS = (req: any): string[] => ((req?.context?.manifest?.apps || []) as any[]).map((a) => String(a.id));

/**
 * `chrome-invisible` — the architect's defect D2, as a document.
 *
 * Every hook §3.2 asks for is present and spelled correctly, and the contract
 * validator says `ok`: there IS a `[data-os-drag]`, there IS a
 * `[data-os-title]`, there ARE `[data-os-close]`, `[data-os-minimize]` and
 * `[data-os-maximize]`. They are also a zero-height clipped strip and three
 * 0x0 transparent buttons, so the app's own header is the top of the window and
 * a visitor can neither close it nor move it. T4's check has to notice, patch
 * one bare strip in, and say so.
 *
 * `tasks: 'hidden'` does the same to `template[data-os-task]`: an entry with no
 * box at all, which is the other half of §12.3's "one entry per open window".
 */
export function chromelessDesktop(req: any, opts: { tasks?: 'ok' | 'hidden' } = {}): string {
  const launchers = APPS(req)
    .map(
      (id) =>
        `<button data-os-app="${id}" style="display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:0;color:inherit;font:inherit">` +
        `<span data-os-icon="${id}" style="width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:32px;line-height:1">&#9635;</span>` +
        `<span>${id}</span></button>`
    )
    .join('');
  const taskTpl =
    opts.tasks === 'hidden'
      ? '<template data-os-task><button style="height:0;width:0;padding:0;border:0;overflow:hidden;opacity:0"><span data-os-title>task</span></button></template>'
      : '<template data-os-task><button><span data-os-title>task</span></button></template>';
  return (
    '<!doctype html><html data-os-archetype="taskbar"><head><meta charset="utf-8"><title>PANE</title><style>' +
    'html,body{margin:0;height:100%;overflow:hidden;background:#101418;color:#e7eaee;font:13px/1.4 ui-monospace,monospace}' +
    '.desk{padding:14px;display:grid;grid-template-columns:repeat(8,minmax(90px,1fr));gap:10px;align-content:start}' +
    '.bar{position:fixed;left:0;right:0;bottom:0;height:34px;display:flex;align-items:center;gap:8px;padding:0 10px;background:#1b222c}' +
    // the defect: a title bar with no height, and controls with no box and no ink
    '.chrome{height:0;overflow:hidden;padding:0;margin:0}' +
    '.ctl{width:0;height:0;padding:0;margin:0;border:0;background:transparent;color:transparent;opacity:0;overflow:hidden}' +
    '</style></head><body>' +
    `<section data-os-desktop class="desk">${launchers}</section>` +
    '<div data-os-windows style="position:absolute;left:0;top:0;right:0;bottom:34px"></div>' +
    '<footer data-os-taskbar class="bar"><strong>PANE</strong><span style="flex:1"></span>' +
    '<span data-os-clock>00:00:00 &middot; 01/01/1999</span></footer>' +
    '<template data-os-window><div style="position:absolute;background:#12161c;border:1px solid #39424f;display:flex;flex-direction:column;overflow:hidden;pointer-events:auto">' +
    '<header data-os-drag class="chrome"><span data-os-title>window</span>' +
    '<button data-os-minimize class="ctl">_</button><button data-os-maximize class="ctl">[]</button><button data-os-close class="ctl">x</button></header>' +
    '<div data-os-content style="flex:1;position:relative"></div></div></template>' +
    taskTpl +
    '</body></html>'
  );
}

/**
 * `dock-labels` — the architect's defect D3, as a document.
 *
 * A SPEC §12.3 dock whose launchers carry `data-os-icon` on the LAUNCHER
 * itself (a shape the prompt asks against and models write anyway), inside a
 * rounded dock that clips, with the label as a second line. The kernel used to
 * write a `line-height` the height of the whole launcher onto that element to
 * centre the glyph; the glyph's line box then pushed the label down and the
 * dock's `overflow:hidden` took it away — visible before the plate sheet
 * landed, gone after it, which is exactly what was reported.
 *
 * Half the launchers are on the wallpaper, so the same fixture also proves the
 * launchers that never had the fault still have their labels.
 */
export function dockLabelDesktop(req: any): string {
  const apps = APPS(req);
  const inDock = (id: string) =>
    `<button data-os-app="${id}" data-os-icon="${id}" class="di">&#9670;<span class="lab">${id}</span></button>`;
  const onDesk = (id: string) =>
    `<button data-os-app="${id}" class="gi"><span data-os-icon="${id}" class="gicon">&#9670;</span><span class="lab">${id}</span></button>`;
  const half = Math.max(1, Math.min(8, Math.ceil(apps.length / 2)));
  return (
    '<!doctype html><html data-os-archetype="dock"><head><meta charset="utf-8"><title>LUMEN</title><style>' +
    'html,body{margin:0;height:100%;overflow:hidden;background:#cfd8e3;color:#1b2330;font:13px/1.4 ui-sans-serif,system-ui}' +
    '.menu{position:fixed;left:0;right:0;top:0;height:26px;display:flex;align-items:center;gap:10px;padding:0 10px;background:#eef2f7}' +
    '.desk{position:absolute;right:0;top:26px;bottom:100px;padding:14px;display:grid;grid-template-columns:repeat(3,104px);gap:12px;align-content:start}' +
    // the dock clips, and every launcher in it has a pinned height
    '.dock{position:fixed;left:50%;transform:translateX(-50%);bottom:10px;height:74px;display:flex;align-items:center;gap:8px;' +
    'padding:0 12px;border-radius:16px;background:#ffffffaa;overflow:hidden}' +
    '.di{height:66px;width:60px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;' +
    'overflow:hidden;background:none;border:0;color:inherit;font:inherit;font-size:30px;line-height:1}' +
    '.gi{display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:0;color:inherit;font:inherit}' +
    '.gicon{width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:32px;line-height:1}' +
    '.lab{font-size:11px;line-height:1.2;background:#20293acc;color:#f2f5f9;padding:1px 4px;border-radius:3px}' +
    '</style></head><body>' +
    '<header data-os-taskbar class="menu"><strong>LUMEN</strong><span style="flex:1"></span>' +
    '<span data-os-clock>00:00:00 &middot; 17/09/2026</span></header>' +
    `<section data-os-desktop class="desk">${apps.slice(half).map(onDesk).join('')}</section>` +
    '<div data-os-windows style="position:absolute;left:0;top:26px;right:0;bottom:100px"></div>' +
    `<nav class="dock">${apps.slice(0, half).map(inDock).join('')}</nav>` +
    WIN_TEMPLATE +
    '</body></html>'
  );
}

/**
 * `boxless-icons` — the other way a picture can cost a label its pixels, and
 * the one T4's net exists for.
 *
 * The icon slots have no box at all (`display:inline`, no glyph, an inline
 * `width:auto` that used to defeat the kernel's own fallback), inside launchers
 * that clip at 48 px. The kernel gives a boxless slot 44x44 — the one reflow it
 * is allowed, because nothing can show a picture in nothing — and on this
 * desktop that reflow pushes every label out of its launcher. The net has to
 * notice, take the kernel's own styles back, and leave the label readable.
 */
export function boxlessIconDesktop(req: any): string {
  const launchers = APPS(req)
    .map(
      (id) =>
        `<button data-os-app="${id}" class="lau"><span data-os-icon="${id}" style="display:inline;width:auto;height:auto"></span>` +
        `<span class="lab">${id}</span></button>`
    )
    .join('');
  return (
    '<!doctype html><html data-os-archetype="taskbar"><head><meta charset="utf-8"><title>SLATE</title><style>' +
    'html,body{margin:0;height:100%;overflow:hidden;background:#20242a;color:#eceff3;font:13px/1.4 ui-monospace,monospace}' +
    '.desk{padding:14px;display:grid;grid-template-columns:repeat(6,120px);gap:10px;align-content:start}' +
    // a block launcher that clips: the icon and the label stack, and the icon
    // the kernel gives a box to is NOT a flex item, so nothing shrinks it
    '.lau{display:block;height:48px;overflow:hidden;padding:0;text-align:center;background:none;border:0;color:inherit;font:inherit}' +
    '.lab{display:block;font-size:11px;line-height:1.2}' +
    '.bar{position:fixed;left:0;right:0;bottom:0;height:32px;display:flex;align-items:center;gap:8px;padding:0 10px;background:#2b313a}' +
    '</style></head><body>' +
    `<section data-os-desktop class="desk">${launchers}</section>` +
    '<div data-os-windows style="position:absolute;left:0;top:0;right:0;bottom:32px"></div>' +
    '<footer data-os-taskbar class="bar"><strong>SLATE</strong><span style="flex:1"></span>' +
    '<span data-os-clock>00:00:00 &middot; 01/01/2011</span></footer>' +
    WIN_TEMPLATE +
    '</body></html>'
  );
}

/**
 * `hover-labels` — a dock that shows its names on hover, which is a real design
 * and not a defect. The kernel must leave it exactly as it is: a label the
 * MODEL hid reads the same before and after a picture lands, so there is
 * nothing for T4's net to undo, and "re-showing" it would be the kernel
 * restyling the machine.
 */
export function hoverLabelDesktop(req: any): string {
  const launchers = APPS(req)
    .map(
      (id) =>
        `<button data-os-app="${id}" class="lau"><span data-os-icon="${id}" class="ico">&#9670;</span><span class="lab">${id}</span></button>`
    )
    .join('');
  return (
    '<!doctype html><html data-os-archetype="dock"><head><meta charset="utf-8"><title>QUIET</title><style>' +
    'html,body{margin:0;height:100%;overflow:hidden;background:#b9c6d4;color:#16202c;font:13px/1.4 ui-sans-serif,system-ui}' +
    '.menu{position:fixed;left:0;right:0;top:0;height:26px;display:flex;align-items:center;padding:0 10px;background:#e7edf4}' +
    '.dock{position:fixed;left:0;right:0;bottom:0;height:84px;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;background:#ffffffaa}' +
    '.lau{display:flex;flex-direction:column;align-items:center;gap:2px;background:none;border:0;color:inherit;font:inherit}' +
    '.ico{width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:26px;line-height:1}' +
    '.lab{font-size:11px;opacity:0}' +
    '.lau:hover .lab{opacity:1}' +
    '</style></head><body>' +
    '<header data-os-taskbar class="menu"><strong>QUIET</strong><span style="flex:1"></span><span data-os-clock>00:00:00 &middot; 2026</span></header>' +
    '<section data-os-desktop style="position:absolute;left:0;top:26px;right:0;bottom:84px"></section>' +
    '<div data-os-windows style="position:absolute;left:0;top:26px;right:0;bottom:84px"></div>' +
    `<nav class="dock">${launchers}</nav>` +
    WIN_TEMPLATE +
    '</body></html>'
  );
}

/**
 * `start-menu` — the third way a launcher is reached, and the one the suite has
 * never clicked: a taskbar with a start control that opens a menu of entries,
 * each one a `[data-os-app]`. §12.3 allows a menu as well as the grid, so a
 * hit-tested click has to work on a menu entry that only exists after the
 * model's own script has run.
 */
export function startMenuDesktop(req: any): string {
  const apps = APPS(req);
  const grid = apps
    .slice(0, 4)
    .map(
      (id) =>
        `<button data-os-app="${id}" class="gi"><span data-os-icon="${id}" class="gicon">&#9670;</span><span class="lab">${id}</span></button>`
    )
    .join('');
  const menu = apps
    .map((id) => `<button data-os-app="${id}" class="mi"><span data-os-icon="${id}" class="micon">&#9670;</span><span class="lab">${id}</span></button>`)
    .join('');
  return (
    '<!doctype html><html data-os-archetype="taskbar"><head><meta charset="utf-8"><title>MERIT</title><style>' +
    'html,body{margin:0;height:100%;overflow:hidden;background:#17202b;color:#e8eef5;font:13px/1.4 ui-sans-serif,system-ui}' +
    '.desk{padding:14px;display:grid;grid-template-columns:repeat(4,110px);gap:12px;align-content:start}' +
    '.bar{position:fixed;left:0;right:0;bottom:0;height:38px;display:flex;align-items:center;gap:8px;padding:0 8px;background:#202b39}' +
    '#start{font:inherit;color:inherit;background:#2f3d4f;border:1px solid #435469;padding:4px 10px;border-radius:4px}' +
    '.menu{position:fixed;left:8px;bottom:44px;width:520px;max-height:60vh;overflow:auto;display:none;grid-template-columns:repeat(4,1fr);' +
    'gap:6px;padding:10px;background:#1b2634;border:1px solid #33455a;border-radius:6px}' +
    '.menu.open{display:grid}' +
    '.mi,.gi{display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:0;color:inherit;font:inherit;padding:4px}' +
    '.micon{width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1}' +
    '.gicon{width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:32px;line-height:1}' +
    '.lab{font-size:11px;line-height:1.2}' +
    '</style></head><body>' +
    `<section data-os-desktop class="desk">${grid}</section>` +
    '<div data-os-windows style="position:absolute;left:0;top:0;right:0;bottom:38px"></div>' +
    `<nav id="menu" class="menu">${menu}</nav>` +
    '<footer data-os-taskbar class="bar"><button id="start">MERIT</button><span style="flex:1"></span>' +
    '<span data-os-clock>00:00:00 &middot; 01/01/2003</span></footer>' +
    WIN_TEMPLATE +
    '<script>document.getElementById("start").addEventListener("click",function(){document.getElementById("menu").classList.toggle("open")});</script>' +
    '</body></html>'
  );
}

/**
 * `own-clock` — HANDOFF-7 §4's second finding, as a document (R2).
 *
 * A `dock` desktop whose MENU BAR draws a real, ticking clock and never
 * declares `[data-os-clock]` — one live boot of v0.5 did exactly this, and the
 * kernel's fallback then appended a second clock at the other end of the same
 * bar (`clock.patched: true`, two times on screen at once). The bar is also
 * unhooked apart from `[data-os-taskbar]` on the DOCK, which is the shape
 * §12.3's dock archetype and the prompt's own example produce: the thing the
 * kernel has to search is a strip on the top edge that carries no hook at all.
 *
 * `static: true` writes a string that LOOKS like a time and never changes — a
 * static string is not a clock, and the adoption has to say so rather than
 * quietly claim a clock the machine has not got.
 */
export function ownClockDesktop(req: any, opts: { static?: boolean } = {}): string {
  const icon = (id: string) =>
    `<button data-os-app="${id}" style="display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:0;color:inherit;font:inherit">` +
    `<span data-os-icon="${id}" style="width:40px;height:40px;display:block;background:#2b3646">&#9635;</span><span>${id}</span></button>`;
  const tick = opts.static
    ? ''
    : '<script>(function(){var el=document.getElementById("mb-clock");function t(){var d=new Date();' +
      'el.textContent=d.toLocaleTimeString()+" \\u00b7 "+d.toLocaleDateString();}t();setInterval(t,200);})();</script>';
  return (
    '<!doctype html><html data-os-archetype="dock"><head><meta charset="utf-8"><title>CASTELLAN</title><style>' +
    'html,body{margin:0;height:100%;overflow:hidden;background:#20262e;color:#eef2f6;font:13px/1.4 ui-sans-serif,system-ui}' +
    '.menu{position:fixed;left:0;right:0;top:0;height:28px;display:flex;align-items:center;gap:10px;padding:0 12px;background:#2d3641}' +
    '.desk{position:absolute;left:0;right:0;top:36px;bottom:92px;padding:12px;display:grid;grid-template-columns:repeat(4,96px);gap:12px;align-content:start}' +
    '.dock{position:fixed;left:0;right:0;bottom:0;height:84px;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;background:#28313b}' +
    '</style></head><body>' +
    // a menu bar with NO hook on it and a clock with no hook either
    '<header class="menu"><strong>CASTELLAN</strong><span style="flex:1"></span>' +
    '<span id="mb-clock">00:00:00 &middot; 18/09/2026</span></header>' +
    `<section data-os-desktop class="desk">${APPS(req).slice(6).map(icon).join('')}</section>` +
    '<div data-os-windows style="position:absolute;left:0;top:36px;right:0;bottom:92px"></div>' +
    `<nav data-os-taskbar class="dock">${APPS(req).slice(0, 6).map(icon).join('')}</nav>` +
    WIN_TEMPLATE +
    tick +
    '</body></html>'
  );
}

/**
 * `jammed-bar` — the three bars HANDOFF-7 §4 names, as documents (R3).
 *
 *  - `name-clock`: `sky` immediately followed by `23:12:50` — the live defect
 *    the architect photographed, 0 px between two runs of text.
 *  - `time-date`: `02:03:55` immediately followed by `9/18/2026` — where the
 *    jam actually is on every live instance measured, and the pair PROMPTS-4's
 *    rule is not landing on.
 *  - `spaced`: the same bar with a 12 px gap. Nothing may be inserted into
 *    this one: a net that fires on a bar that is already legible is a net that
 *    edits the machine for no reason.
 */
export function jammedBarDesktop(req: any, variant: 'name-clock' | 'time-date' | 'spaced'): string {
  const launchers = APPS(req)
    .map(
      (id) =>
        `<button data-os-app="${id}" style="display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:0;color:inherit;font:inherit">` +
        `<span data-os-icon="${id}" style="width:40px;height:40px;display:block;background:#243040">&#9635;</span><span>${id}</span></button>`
    )
    .join('');
  const bar =
    variant === 'name-clock'
      ? '<span id="run-a">sky</span><span id="run-b" data-os-clock>23:12:50</span>'
      : '<strong>SKYFORGE</strong><span style="flex:1"></span>' +
        '<span id="run-a" data-os-clock>02:03:55</span><span id="run-b">9/18/2026</span>';
  // `name-clock` jams at the LEFT end (the live shot), the others at the right
  const fill = variant === 'name-clock' ? '<span style="flex:1"></span>' : '';
  return (
    '<!doctype html><html data-os-archetype="taskbar"><head><meta charset="utf-8"><title>SKYFORGE</title><style>' +
    'html,body{margin:0;height:100%;overflow:hidden;background:#0f1319;color:#e9edf2;font:13px/1.4 ui-monospace,monospace}' +
    '.desk{padding:14px;display:grid;grid-template-columns:repeat(8,minmax(90px,1fr));gap:10px;align-content:start}' +
    '.bar{position:fixed;left:0;right:0;bottom:0;height:34px;display:flex;align-items:center;padding:0 10px;background:#1a2230;' +
    (variant === 'spaced' ? 'gap:12px}' : 'gap:0}') +
    '</style></head><body>' +
    `<section data-os-desktop class="desk">${launchers}</section>` +
    '<div data-os-windows style="position:absolute;left:0;top:0;right:0;bottom:34px"></div>' +
    `<footer data-os-taskbar class="bar">${bar}${fill}</footer>` +
    WIN_TEMPLATE +
    '</body></html>'
  );
}

/**
 * `menu-over-launchers` — HANDOFF-7 §8's second phone defect, as a document.
 *
 * `shots-v05-real-mobile/boot-1/02b-desktop-plates.png`: a fixed menu bar and a
 * launcher grid that starts at the top of the screen, so the machine's name is
 * written across the first icon. The model's layout at a width it has never
 * been asked about — and the overlap is geometry, so the kernel may pad the
 * desktop down by the height of the bar.
 */
export function menuOverLaunchersDesktop(req: any): string {
  const icon = (id: string) =>
    `<button data-os-app="${id}" style="display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:0;color:inherit;font:inherit">` +
    `<span data-os-icon="${id}" style="width:44px;height:44px;display:block;background:#33405a">&#9635;</span><span style="font-size:11px">${id}</span></button>`;
  return (
    '<!doctype html><html data-os-archetype="dock"><head><meta charset="utf-8"><title>TALLOW</title><style>' +
    'html,body{margin:0;height:100%;overflow:hidden;background:#1a1f27;color:#eceff4;font:13px/1.4 ui-sans-serif,system-ui}' +
    '.menu{position:fixed;left:0;right:0;top:0;height:34px;display:flex;align-items:center;gap:8px;padding:0 10px;background:#262d38;z-index:5}' +
    // the defect: the launcher area starts at the top of the screen, under the bar
    '.desk{position:absolute;left:0;right:0;top:0;bottom:80px;padding:6px;display:grid;grid-template-columns:repeat(4,1fr);gap:10px;align-content:start}' +
    '.dock{position:fixed;left:0;right:0;bottom:0;height:72px;display:flex;align-items:center;justify-content:center;gap:10px;background:#242b35}' +
    '</style></head><body>' +
    '<header data-os-taskbar class="menu"><strong>TALLOW</strong><span style="flex:1"></span>' +
    '<span data-os-clock>00:00:00 &middot; 18/09/2026</span></header>' +
    `<section data-os-desktop class="desk">${APPS(req).slice(2).map(icon).join('')}</section>` +
    '<div data-os-windows style="position:absolute;left:0;top:34px;right:0;bottom:80px"></div>' +
    `<nav class="dock">${APPS(req).slice(0, 2).map(icon).join('')}</nav>` +
    WIN_TEMPLATE +
    '</body></html>'
  );
}

/**
 * `growing-bar` — HANDOFF-8 §8 item 1, as a document: the defect the kernel's
 * OWN repair caused, on 2 of 4 real desktops in run D.
 *
 * `shots-v06-real-desktop/boot-4`: a 38 px taskbar pinned to the bottom edge
 * with a row of launchers immediately above it (clipping the bar by a few
 * pixels, which is what a model writes when it centres a quick-launch row over
 * its own bar). Eight windows open, eight task entries go into the bar,
 * `fitBarContents` grows the bar to hold them — and the pixels it takes come
 * out of the launcher row. `launchersReachable: 0/16`, blocked by
 * `div[data-os-taskbar data-os-stacked data-os-fit-bar]`: the kernel's own
 * attribute. §8's `fitLauncherRow` could not help, because it padded for a
 * fixed TOP bar, once, latched, at desktop time.
 *
 * The task entries are deliberately taller than the bar (64 px in a 38 px
 * strip, `flex-wrap:wrap`), so ten of them want more than three rows: the
 * growth has to be bounded (`barGrowth`), the launcher area has to be inset at
 * the BOTTOM edge, and both have to keep working as entries accumulate.
 */
export function growingBarDesktop(req: any): string {
  const launchers = APPS(req)
    .map(
      (id) =>
        `<button data-os-app="${id}" class="lau"><span data-os-icon="${id}" class="ico">&#9635;</span><span class="lab">${id}</span></button>`
    )
    .join('');
  return (
    '<!doctype html><html data-os-archetype="taskbar"><head><meta charset="utf-8"><title>PLINTH</title><style>' +
    'html,body{margin:0;height:100%;overflow:hidden;background:#101826;color:#e8eef6;font:13px/1.4 ui-sans-serif,system-ui}' +
    // the launcher row hangs just low enough to clip the model's own bar
    '.desk{position:absolute;left:0;right:0;top:0;bottom:20px;padding:6px;display:flex;flex-wrap:wrap;' +
    'align-content:flex-end;justify-content:center;gap:10px}' +
    '.lau{width:96px;height:64px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;' +
    'background:none;border:0;color:inherit;font:inherit}' +
    '.ico{width:34px;height:34px;display:block;background:#33415a}' +
    '.lab{font-size:11px;line-height:1.2}' +
    // the bar: a 38 px strip that wraps, which is how eight entries become three rows
    '.bar{position:fixed;left:0;right:0;bottom:0;height:38px;display:flex;flex-wrap:wrap;align-items:center;' +
    'gap:8px;padding:0 10px;background:#1b2536;border-top:1px solid #2c3950}' +
    '.task{height:64px;min-width:130px;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:4px;border-radius:10px;background:#28344a;color:inherit;border:1px solid #3a4a66;font:inherit}' +
    '</style></head><body>' +
    `<section data-os-desktop class="desk">${launchers}</section>` +
    '<div data-os-windows style="position:absolute;left:0;top:0;right:0;bottom:38px"></div>' +
    '<footer data-os-taskbar class="bar"><strong>Start</strong><span style="flex:1"></span>' +
    '<span data-os-clock>00:00:00 &middot; 18/09/2026</span></footer>' +
    WIN_TEMPLATE.replace(
      '<template data-os-task><button><span data-os-title>task</span></button></template>',
      '<template data-os-task><button class="task"><span data-os-icon style="width:26px;height:26px;display:block;background:#40527a"></span>' +
        '<span data-os-title>task</span></button></template>'
    ) +
    '</body></html>'
  );
}
