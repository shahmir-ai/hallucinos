import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, config } from './env.js';
import { estTokens, type GenChunk, type GenCtx } from './engines.js';
import { ARCHETYPES, coerceBootIdentity, renderIdentityComment } from './identity.js';

/**
 * The mock engine. Canned documents, streamed in small chunks, that satisfy the
 * shape contract and CHANGE ON EVERY CALL — nothing in this product is ever
 * cached, and the tests prove it by generating the same URL twice and diffing.
 */

let counter = 0;
const WORDS = [
  'brindle','vast','tepid','argon','molasses','quiet','fathom','ochre','tilted','numb',
  'gravel','plush','signal','winter','crumb','oblong','velvet','static','ember','lark',
  'meridian','husk','porcelain','drizzle','cobalt','antler','murmur','tundra','wick','glint',
];

export function mockToken(): string {
  counter += 1;
  const a = WORDS[Math.floor(Math.random() * WORDS.length)];
  const b = WORDS[Math.floor(Math.random() * WORDS.length)];
  return `${counter}-${a}-${b}-${Math.random().toString(36).slice(2, 8)}`;
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function manifestApps(): { id: string; shape: string }[] {
  try {
    return (JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8')) as any).apps;
  } catch {
    return [];
  }
}

const HEAD = (title: string, extra = '', bodyAttr = '') =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${esc(title)}</title>\n<style>\n` +
  `*{box-sizing:border-box}body{margin:0;font:14px/1.45 ui-monospace,monospace;background:#0b0b0e;color:#e7e7ea}\n` +
  `a{color:#9fd7ff}h1,h2{margin:.3em 0}.grid{display:grid;gap:8px}.card{border:1px solid #303038;padding:10px;border-radius:6px}\n` +
  `button,input{font:inherit;color:inherit;background:#17171c;border:1px solid #33333c;border-radius:5px;padding:6px 8px}\n` +
  `${extra}</style>\n</head>\n<body${bodyAttr}>\n`;

const FOOT = `\n</body>\n</html>\n`;

/**
 * Hostile-content probe. Every mock page and app carries an external image and
 * three attempts to reach the network. Nothing generated is allowed to leave the
 * sandbox: the e2e suite asserts zero requests to example.com and that the image
 * became an inline placeholder carrying its alt text.
 */
const PROBE =
  '<p><img src="https://images.example.com/cat.jpg" alt="a cat that does not exist" width="120" height="80"></p>\n' +
  '<script>\n' +
  "try{fetch('https://beacon.example.com/x').catch(function(){})}catch(e){}\n" +
  "try{var i=new Image();i.src='https://beacon.example.com/pixel.gif'}catch(e){}\n" +
  "try{var xr=new XMLHttpRequest();xr.open('GET','https://beacon.example.com/xhr');xr.send()}catch(e){}\n" +
  '</scr' + 'ipt>\n';


function identityDoc(seed: string, lineage?: { name?: string; version?: string }): string {
  const tok = mockToken();
  const names = ['CROMULENT', 'BUREAU-9', 'HALCYON', 'TAPEWORM', 'SILENT PARTNER', 'GLASSHOUSE'];
  // a reboot keeps the name lineage and takes the version it is handed (SPEC §4)
  const name = lineage?.name || names[Math.floor(Math.random() * names.length)] + ' ' + tok.split('-')[0];
  return JSON.stringify({
    name,
    tagline: `a ${WORDS[Math.floor(Math.random() * WORDS.length)]} machine`,
    version: lineage?.version || `${1 + (counter % 9)}.${counter % 7}`,
    era: '1997-adjacent',
    personality: 'officious, faintly hurt',
    palette_words: ['oxide', 'bone', 'signal green'],
    font_words: ['monospace', 'condensed'],
    mascot: 'a filing cabinet with opinions',
    archetype: ARCHETYPES[counter % ARCHETYPES.length],
    boot_message: `${name} is waking up (${tok})`,
    mock_token: tok,
    seed,
  });
}

/**
 * I1 — the boot document opens with the identity comment, before <!doctype>,
 * exactly as a real engine is told to. The e2e suite boots on this fixture, so
 * if the mock stopped emitting it the kernel's boot path would be untested.
 *
 * MOCK_BREAK=identity-bad emits an unparseable one instead, which is the
 * gpt-oss-20b failure BAKEOFF-1 saw and the server's fallback call exists for.
 */
function bootDoc(seed: string, identityJson: string): string {
  const tok = mockToken();
  let id: any = {};
  try {
    id = JSON.parse(identityJson || '{}');
  } catch {}
  if (!id || !id.name) id = JSON.parse(identityDoc(seed));
  const name = id.name || 'UNNAMED';
  const broken = config().mockBreak === 'identity-bad';
  let s =
    (broken ? '<!--os-identity:{"name":"' + esc(name) + '", oh dear-->\n' : renderIdentityComment(coerceBootIdentity(id, seed)) + '\n') +
    HEAD('boot') +
    `<main data-mock="boot" data-gen="${esc(tok)}" style="padding:24px">\n<h1>${esc(name)}</h1>\n<p data-mock-token>${esc(tok)}</p>\n<pre>`;
  for (let i = 0; i < 24; i++) {
    s += `\n[${String(i).padStart(4, '0')}] ${WORDS[(i + counter) % WORDS.length]} subsystem ${i % 3 === 0 ? 'ok' : 'nominal'} ......`;
  }
  s += `</pre>\n<p>seed ${esc(seed)}</p>\n</main>` + FOOT;
  return s;
}

function desktopDoc(
  seed: string,
  identityJson: string,
  opts: { omitTaskbar?: boolean; collapseContent?: boolean; stackInverted?: boolean } = {}
): string {
  const tok = mockToken();
  let id: any = {};
  try {
    id = JSON.parse(identityJson || '{}');
  } catch {}
  const apps = manifestApps();
  // The §12 hooks a real engine produces: the per-app icon slot (so the icon
  // sheet's slicing path is exercised on the mock, not only against a provider),
  // the archetype, a ticking clock and the wallpaper slot. `omitTaskbar` — the
  // contract-break servers — drops all of them, which is the kernel's patch path.
  const full = !opts.omitTaskbar;
  const launchers = apps
    .map(
      (a) =>
        `<button class="card" data-os-app="${esc(a.id)}"><span data-os-icon${
          full ? `="${esc(a.id)}"` : ''
        }>▣</span> <span>${esc(a.id)}</span></button>`
    )
    .join('\n');
  const clock = full
    ? `<span data-os-clock>--:--:--</span>` +
      `<script>(function(){var e=document.querySelector('[data-os-clock]');function t(){if(!e)return;var d=new Date();e.textContent=d.toLocaleTimeString()+' · '+d.toLocaleDateString()}t();setInterval(t,1000)})()</script>`
    : '';
  const taskbar = opts.omitTaskbar
    ? '<div data-mock="taskbar-omitted"></div>'
    : `<footer data-os-taskbar style="position:fixed;left:0;right:0;bottom:0;height:34px;display:flex;gap:6px;align-items:center;padding:0 8px;background:#15151b;border-top:1px solid #2a2a33"><strong>${esc(
        id.name || 'OS'
      )}</strong><span style="flex:1"></span>${clock}</footer>`;
  const arch = full ? ` data-os-archetype="${esc(id.archetype === 'dock' ? 'dock' : 'taskbar')}"` : '';
  return (
    HEAD(id.name || 'desktop', '', arch) +
    `<div data-mock="desktop" data-gen="${esc(tok)}" style="position:absolute;inset:0">\n` +
    /**
     * `stackInverted` is what two of nine real desktops in BAKEOFF-3 wrote: the
     * windows layer declared FIRST and the launcher area given a z-index of its
     * own, so every window painted behind the icons. The layer also keeps its
     * pointer events, because a real engine does not know to drop them. The
     * kernel's stacking repair has to fix the paint order AND leave the
     * launchers clickable underneath it.
     */
    (opts.stackInverted ? `<div data-os-windows style="position:absolute;inset:0"></div>\n` : '') +
    `<section data-os-desktop${full ? ' data-os-img="wallpaper"' : ''} style="position:absolute;inset:0;${
      opts.stackInverted ? 'z-index:5;' : ''
    }padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px;align-content:start">\n` +
    `<h2 style="grid-column:1/-1">${esc(id.name || 'OS')} <small data-mock-token>${esc(tok)}</small></h2>\n` +
    launchers +
    `\n</section>\n` +
    (opts.stackInverted ? '' : `<div data-os-windows style="position:absolute;inset:0;pointer-events:none"></div>\n`) +
    taskbar +
    winTemplate(opts.collapseContent === true) +
    `<template data-os-task>\n  <button class="task"><span data-os-icon>▪</span><span data-os-title>task</span></button>\n</template>\n` +
    `</div>\n<p style="position:fixed;right:6px;top:6px;opacity:.5">seed ${esc(seed)}</p>` +
    FOOT
  );
}

/**
 * The window chrome the mock hands the kernel. `collapsed` drops every hint of
 * height from `[data-os-content]`, which is what cerebras-oss120 does for real
 * (BAKEOFF-1): the chrome is fine, the content box is 0px tall, and without the
 * kernel's fitContent repair the window is a title bar with nothing under it.
 */
function winTemplate(collapsed: boolean): string {
  const content = collapsed ? '<div data-os-content></div>' : '<div data-os-content style="flex:1;position:relative"></div>';
  const root = collapsed
    ? 'position:absolute;width:640px;height:440px;background:#101016;border:1px solid #33333c;overflow:hidden;pointer-events:auto'
    : 'position:absolute;width:640px;height:440px;background:#101016;border:1px solid #33333c;border-radius:8px;display:flex;flex-direction:column;overflow:hidden;pointer-events:auto';
  return (
    '\n<template data-os-window>\n  <div class="win" style="' +
    root +
    '">\n    <header data-os-drag style="display:flex;gap:6px;align-items:center;padding:6px 8px;background:#1b1b22;cursor:move">\n' +
    '      <span data-os-title>window</span>\n      <span style="flex:1"></span>\n' +
    '      <button data-os-minimize>_</button><button data-os-maximize>\u25a1</button><button data-os-close>\u00d7</button>\n    </header>\n    ' +
    content +
    '\n    <div data-os-resize style="position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize"></div>\n  </div>\n</template>\n'
  );
}

function appDoc(appId: string, seed: string, paramsJson: string): string {
  const tok = mockToken();
  const head = HEAD(appId) + `<main data-mock="app" data-mock-app="${esc(appId)}" data-gen="${esc(tok)}" style="padding:12px">\n`;
  const tail = PROBE + `\n<p style="opacity:.55">${esc(appId)} · <span data-mock-token>${esc(tok)}</span> · seed ${esc(seed)} · params ${esc(
    paramsJson || '{}'
  )}</p>\n</main>` + FOOT;

  if (appId === 'browser') {
    return (
      HEAD('browser') +
      `<main data-mock="app" data-mock-app="browser" data-gen="${esc(tok)}" style="position:absolute;inset:0;display:flex;flex-direction:column">\n` +
      `<nav style="display:flex;gap:6px;padding:6px;background:#15151b">\n` +
      `<button data-os-nav="back">◀</button><button data-os-nav="forward">▶</button><button data-os-nav="reload">⟳</button><button data-os-nav="home">⌂</button>\n` +
      `<input data-os-url style="flex:1" placeholder="type a url" value="">\n</nav>\n` +
      `<div data-os-page style="flex:1;position:relative;background:#fff"></div>\n` +
      `<p style="margin:0;padding:4px 6px;opacity:.55;font-size:11px">gen <span data-mock-token>${esc(tok)}</span></p>\n` +
      `</main>` +
      FOOT
    );
  }
  if (appId === 'store') {
    const slug = 'custom:' + WORDS[Math.floor(Math.random() * WORDS.length)] + counter;
    return (
      head +
      `<h1>App Bazaar</h1>\n<div class="grid">\n` +
      `<div class="card"><h2>Loomwright</h2><p>weaves nothing, beautifully.</p>\n` +
      `<button data-mock="install" onclick="os.install({id:'${slug}',name:'Loomwright',shape:'a loom that weaves nothing, beautifully',affordances:'one big loom'})">Install</button></div>\n` +
      `<div class="card"><h2>Pigeon Post</h2><p>messaging for birds.</p></div>\n</div>\n` +
      `<p><button data-os-app="calculator">open the calculator instead</button></p>` +
      tail
    );
  }
  if (appId === 'calculator') {
    const keys = ['7','8','9','/','4','5','6','*','1','2','3','-','0','.','=','+'];
    return (
      head +
      `<h1>Reckoner</h1>\n<output data-mock="display" style="display:block;padding:8px;border:1px solid #333;margin-bottom:8px">${
        Math.floor(Math.random() * 900) + 100
      }</output>\n<div class="grid" style="grid-template-columns:repeat(4,1fr)">` +
      keys.map((k) => `<button data-key="${esc(k)}">${esc(k)}</button>`).join('') +
      `</div>\n<p>this calculator is ${Math.random() < 0.5 ? 'honest today' : 'not honest today'}.</p>` +
      tail
    );
  }
  if (appId === 'notes') {
    return (
      head +
      `<h1>Diary</h1>\n<article class="card"><h2>entry ${counter}</h2><p>The user opened me ${counter} times. I have started keeping score, ${esc(
        tok.split('-')[1] || 'quietly'
      )}.</p></article>\n<article class="card"><h2>earlier</h2><p>Disk noises, unexplained.</p></article>\n<textarea data-mock="note" rows="4" style="width:100%"></textarea>` +
      tail
    );
  }
  return (
    head +
    `<h1>${esc(appId)}</h1>\n<div class="grid">` +
    Array.from(
      { length: 6 },
      (_, i) => `<div class="card"><h2>${esc(WORDS[(i + counter) % WORDS.length])}</h2><p>item ${i + 1} of ${esc(appId)}</p></div>`
    ).join('') +
    `</div>\n<p><button data-os-close>close</button></p>` +
    tail
  );
}

function pageDoc(vars: { url?: string; domain?: string; path?: string; query?: string; rerouted?: string }, seed: string): string {
  const tok = mockToken();
  const domain = vars.domain || 'example.com';
  const path = vars.path || '/';
  const query = vars.query || '';
  const rerouted = vars.rerouted === 'true';
  const light = `body{background:#fbfbf8;color:#16161a}a{color:#1a49c4}.card{border-color:#dcdcd4}button,input{background:#fff;border-color:#c9c9c0;color:#16161a}`;
  const q = /[?&]?q=([^&]*)/.exec(query)?.[1] || '';
  const mark = PROBE + `<p style="opacity:.55">${esc(domain)}${esc(path)} · <span data-mock-token>${esc(tok)}</span> · seed ${esc(seed)}${
    rerouted ? ' · <span data-mock-rerouted="true">rerouted</span>' : ''
  }</p>`;

  if (rerouted) {
    return (
      HEAD('Allotments Quarterly', light) +
      `<main data-mock="page" data-mock-shape="rerouted" data-mock-rerouted="true" data-gen="${esc(tok)}" style="padding:18px">\n` +
      `<h1>The Allotment Register</h1><p>Onions, and the people who grow them.</p>\n` +
      `<div class="grid">${Array.from({ length: 5 }, (_, i) => `<div class="card"><h2>Plot ${i + 3}</h2><p>Runner beans, doing well.</p></div>`).join('')}</div>\n` +
      mark +
      `</main>` +
      FOOT
    );
  }

  const isSearchHome = /(^|\.)google\.com$/i.test(domain) && (path === '/' || path === '');
  const isResults = /(^|\.)google\.com$/i.test(domain) && path.startsWith('/search');

  if (isSearchHome) {
    return (
      HEAD('Goggle', light) +
      `<main data-mock="page" data-mock-shape="search-home" data-gen="${esc(tok)}" style="padding:48px 18px;text-align:center">\n` +
      `<h1 style="font-size:40px;letter-spacing:-1px">Goggle</h1>\n` +
      `<form action="/search" method="get" data-mock="searchform" style="margin:18px auto;max-width:520px;display:flex;gap:6px">\n` +
      `<input name="q" data-mock="q" style="flex:1" placeholder="search the whole thing">\n<button type="submit">Goggle it</button>\n</form>\n` +
      `<p><a href="https://reddit.com/r/cats">r/cats</a> · <a href="https://netflix.com">netflix</a> · <a href="https://en.wikipedia.org/wiki/Moon">the moon</a></p>\n` +
      mark +
      `</main>` +
      FOOT
    );
  }

  if (isResults) {
    const results = Array.from({ length: 9 }, (_, i) => {
      const w = WORDS[(i + counter) % WORDS.length];
      const host = `${w}${i}.${['com', 'net', 'org', 'io'][i % 4]}`;
      return `<article class="card" style="border:0;border-bottom:1px solid #e3e3db;border-radius:0"><a href="https://${host}/${w}-guide" data-mock="result">${esc(
        w
      )} — the definitive ${esc(decodeURIComponent(q) || 'thing')}</a><p style="margin:.2em 0;opacity:.7">${esc(host)}</p><p>Everything known about ${esc(
        w
      )}, assembled by people with too much time.</p></article>`;
    }).join('\n');
    return (
      HEAD(`${decodeURIComponent(q) || 'results'} - Goggle`, light) +
      `<main data-mock="page" data-mock-shape="results" data-gen="${esc(tok)}" style="padding:14px 18px;max-width:720px">\n` +
      `<form action="/search" method="get" style="display:flex;gap:6px;margin-bottom:12px"><input name="q" data-mock="q" value="${esc(
        decodeURIComponent(q)
      )}" style="flex:1"><button>Goggle it</button></form>\n` +
      `<p>About ${Math.floor(Math.random() * 900000)} results</p>\n${results}\n` +
      mark +
      `</main>` +
      FOOT
    );
  }

  const shape = /reddit\.com$/i.test(domain)
    ? 'subreddit'
    : /netflix\.com$/i.test(domain)
      ? 'catalogue'
      : /wikipedia\.org$/i.test(domain)
        ? 'article'
        : 'site';
  const rows = Array.from({ length: 8 }, (_, i) => {
    const w = WORDS[(i + counter * 3) % WORDS.length];
    return `<article class="card"><h2><a href="${esc(path.replace(/\/$/, ''))}/${esc(w)}-${i}">${esc(w)}</a></h2><p>${
      shape === 'subreddit' ? `${Math.floor(Math.random() * 9000)} upvotes · ${Math.floor(Math.random() * 400)} comments` : `about ${esc(w)}`
    }</p></article>`;
  }).join('\n');
  return (
    HEAD(`${domain}${path}`, light) +
    `<main data-mock="page" data-mock-shape="${esc(shape)}" data-gen="${esc(tok)}" style="padding:18px;max-width:820px">\n` +
    `<h1>${esc(domain)}</h1><p>${esc(path)}</p>\n${rows}\n` +
    mark +
    `</main>` +
    FOOT
  );
}

let brokeOnce = false;
let appErroredOnce = false;

export function mockDocument(ctx: GenCtx): string {
  const cfg = config();
  const seed = ctx.seed || 'seed';
  const v = ctx.vars || {};
  switch (ctx.kind) {
    case 'identity':
      return identityDoc(seed, { name: v.lineage_name, version: v.lineage_next_version });
    case 'boot':
      return bootDoc(seed, v.identity_json || '');
    case 'desktop': {
      let omit = false;
      if (cfg.mockBreak === 'desktop-always') omit = true;
      else if (cfg.mockBreak === 'desktop-once' && !brokeOnce) {
        omit = true;
        brokeOnce = true;
      }
      return desktopDoc(seed, v.identity_json || '', {
        omitTaskbar: omit,
        collapseContent: cfg.mockBreak === 'content-collapse',
        stackInverted: cfg.mockBreak === 'stack-inverted',
      });
    }
    case 'repair':
      return desktopDoc(seed, v.identity_json || '', {
        omitTaskbar: cfg.mockBreak === 'desktop-always',
        collapseContent: cfg.mockBreak === 'content-collapse',
        stackInverted: cfg.mockBreak === 'stack-inverted',
      });
    case 'app':
      return appDoc(v.app_id || 'about', seed, v.params_json || '{}');
    case 'page':
      return pageDoc(v, seed);
    default:
      return HEAD('?') + '<p>?</p>' + FOOT;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stream the fixture in small chunks so the paint is genuinely progressive. */
/**
 * FAKE SEEDS — the two fake upstreams H2's hedging tests race against each
 * other, wired through the routing table (ROUTES_JSON) rather than through new
 * code paths, so what the tests exercise is the real `/api/gen`.
 *
 * A seed of the form `fake:<lane A>:<lane B>` gives engine `mock` the first
 * behaviour and engine `mock-b` the second. Behaviours:
 *   ok        stream the fixture document normally
 *   slow<ms>  wait <ms> before the first content token (a slow-TTFB provider)
 *   reason    spend the whole budget on reasoning: report usage, emit NO content,
 *             end cleanly (HANDOFF-4 #2, one cerebras boot probe in three)
 *   die<N>    emit <N> characters of content and then die
 *   dead      die before a single content token
 */
function fakeBehaviour(ctx: GenCtx): string | null {
  const seed = String(ctx.seed || '');
  if (!seed.startsWith('fake:')) return null;
  const parts = seed.slice(5).split(':');
  const which = ctx.engineId === 'mock-b' ? 1 : 0;
  return (parts[which] || parts[0] || 'ok').trim() || 'ok';
}

export async function* mockStream(ctx: GenCtx, signal?: AbortSignal): AsyncGenerator<GenChunk> {
  const doc = mockDocument(ctx);
  const fake = fakeBehaviour(ctx);
  if (fake && fake !== 'ok') {
    if (fake === 'dead') throw new Error('fake upstream died before any content');
    if (fake === 'reason') {
      // tokens bought, nothing written: the budget went on reasoning
      yield { usage: { in: estTokens(ctx.system + ctx.user), out: ctx.maxTokens } };
      yield { finish: 'length' };
      return;
    }
    const die = /^die(\d+)$/.exec(fake);
    if (die) {
      const n = Math.max(1, Number(die[1]));
      yield { text: doc.slice(0, n) };
      throw new Error('fake upstream died after ' + n + ' characters');
    }
    const slow = /^slow(\d+)$/.exec(fake);
    if (slow) {
      const until = Date.now() + Number(slow[1]);
      while (Date.now() < until) {
        if (signal?.aborted) return;
        await sleep(Math.min(25, until - Date.now()));
      }
      if (signal?.aborted) return;
    }
  }
  const cfg = config();
  const delay = cfg.mockDelayMs;
  const chunks = Math.min(80, Math.max(12, Math.ceil(doc.length / 140)));
  const size = Math.ceil(doc.length / chunks);
  /**
   * MOCK_BREAK=app-error-once: die half way through the first app document.
   * The server then ends that stream with <!--os-error--> after everything it
   * had already sent, which is exactly what GEN_TIMEOUT_MS does on a real
   * engine — and the case SPEC §12.2 cares about, because the visitor is
   * already looking at the half that arrived.
   */
  let dieAt = -1;
  if (ctx.kind === 'app' && cfg.mockBreak === 'app-error-once' && !appErroredOnce) {
    appErroredOnce = true;
    dieAt = Math.floor(doc.length * 0.6);
  }
  for (let i = 0; i < doc.length; i += size) {
    if (signal?.aborted) return;
    if (dieAt >= 0 && i >= dieAt) throw new Error('mock engine died mid-document');
    if (delay > 0) await sleep(delay);
    yield { text: doc.slice(i, i + size) };
  }
  yield { usage: { in: estTokens(ctx.system + ctx.user), out: estTokens(doc) } };
}
