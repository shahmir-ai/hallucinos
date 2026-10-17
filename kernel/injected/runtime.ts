/**
 * The runtime injected into every generated document (SPEC §2.2).
 *
 * Runs inside a sandboxed, opaque-origin iframe. It owns:
 *  - progressive document.write of streamed chunks (the paint you can watch)
 *  - window.os, proxied to the kernel over postMessage
 *  - automatic interception of links, forms and the data-os-* affordances
 *  - <img src="http..."> -> an inline "hallucinated image" box carrying the alt text
 *  - for the browser app: the nested page frame inside [data-os-page], and relaying
 *
 * It is written ONCE per frame and survives document.open(), so the generated
 * document never carries kernel code of its own.
 */
import { DOC_IMG_LIMIT, IMG_PROMPT_MAX, isDocImgKind, isSheetKind, TILE_THEME_DEFAULT, type DocImgKind } from '../protocol.js';
import { sheetSlice, SHEET_CELLS } from '../sheet.js';
import { fadeIn } from '../fade.js';

(function () {
  const w = window as any;
  if (w.__osRuntime) return;
  w.__osRuntime = true;

  // small, bounded diagnostic surface — the e2e suite reads it to prove the
  // document painted progressively rather than in one lump
  const stats: any = { msgs: 0, chunks: 0, bytes: 0, opens: 0, errors: [] as string[], role: '' };
  w.__osStats = stats;
  const parentWin = window.parent;
  let role: string = 'page';
  let currentUrl = '';
  let snapshot: any = {};
  let bootstrap = '';
  let docPrefix = '<!doctype html><html><head><meta charset="utf-8">';
  let opened = false;
  let closed = false;
  let painted = false;
  let inked = false;
  let pageFrame: HTMLIFrameElement | null = null;
  let pageReady = false;
  const pageQueue: any[] = [];

  function up(m: any) {
    try {
      parentWin.postMessage(Object.assign({ __os: 1 }, m), '*');
    } catch (e) {
      /* the kernel went away */
    }
  }

  function call(fn: string, args: unknown[]) {
    up({ t: 'call', fn: fn, args: args });
  }

  /* ---------------------------------------------------------------- window.os */

  const listeners: Record<string, Function[]> = {};
  const os = {
    open: function (appId: string, params?: unknown) {
      call('open', [appId, params || {}]);
    },
    close: function () {
      call('close', []);
    },
    navigate: function (url: string) {
      call('navigate', [resolve(url)]);
    },
    reload: function () {
      call('reload', []);
    },
    back: function () {
      call('back', []);
    },
    forward: function () {
      call('forward', []);
    },
    home: function () {
      call('home', []);
    },
    setTitle: function (t: string) {
      call('setTitle', [String(t)]);
    },
    install: function (spec: unknown) {
      call('install', [spec]);
    },
    /** SPEC §4: the updater reboots the machine into version+1, same name lineage. */
    reboot: function () {
      call('reboot', []);
    },
    state: function () {
      return JSON.parse(JSON.stringify(snapshot || {}));
    },
    on: function (type: string, cb: Function) {
      (listeners[type] = listeners[type] || []).push(cb);
    },
    url: function () {
      return currentUrl;
    },
  };
  w.os = os;

  function fire(type: string, detail: unknown) {
    const ls = listeners[type] || [];
    for (let i = 0; i < ls.length; i++) {
      try {
        ls[i](detail);
      } catch (e) {}
    }
    try {
      document.dispatchEvent(new CustomEvent('os:' + type, { detail: detail }));
    } catch (e) {}
  }

  /**
   * A path is resolved against the page it was written on; a bare hostname is
   * NOT — it is a different site, exactly as the kernel's own normalizeUrl
   * treats a typed address. Without this, a generated page calling
   * os.navigate('reddit.com/r/cats') (or any model-written bookmark button)
   * asks for `https://<this site>/reddit.com/r/cats`, and the fake internet
   * answers with a nonsense URL nested inside the site you were already on.
   * A first segment that ends in a file extension stays relative.
   */
  const FILE_EXT = /\.(html?|php|aspx?|jsp|cgi|json|xml|css|m?js|txt|md|pdf|png|jpe?g|gif|webp|svg|ico|mp4|webm|mp3|zip|gz)$/i;

  function hostish(s: string): boolean {
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return false; // has a scheme
    if (/^[/?#]/.test(s) || s.indexOf('.') === 0) return false; // path, query, fragment, ./ ../
    const first = s.split(/[/?#]/)[0];
    if (!/^[\w-]+(\.[\w-]+)+$/.test(first)) return false;
    if (FILE_EXT.test(first)) return false;
    return /\.[a-z]{2,24}$/i.test(first);
  }

  function resolve(href: string): string {
    if (!href) return currentUrl;
    const s = String(href).trim();
    if (hostish(s)) return 'https://' + s;
    try {
      const base = currentUrl && /^[a-z][a-z0-9+.-]*:\/\//i.test(currentUrl) ? currentUrl : 'https://' + (currentUrl || 'start.page');
      return new URL(s, base).href;
    } catch (e) {
      return s;
    }
  }

  /* ------------------------------------------------------- progressive write */

  function openDoc() {
    stats.opens++;
    try {
      if (opened && !closed) document.close();
      document.open();
      closed = false;
      painted = false;
      inked = false;
      document.write(docPrefix);
      opened = true;
      stats.afterOpen = document.readyState + '/' + (document.body ? 'body' : 'nobody');
      pageFrame = null;
      pageReady = false;
      // a new document gets its own image budget and its own slot names
      imgSlots.length = 0;
      imgSeq = 0;
      wire();
      attach();
    } catch (e) {
      stats.errors.push('open:' + String(e));
    }
  }

  function write(s: string) {
    if (!opened) openDoc();
    stats.chunks++;
    stats.bytes += s.length;
    try {
      document.write(s);
    } catch (e) {
      stats.errors.push('write:' + String(e));
    }
    reportPaint();
    reportInk();
  }

  /**
   * First paint of THIS document (INTERFACE I6). Posted once per document.open()
   * from inside a rAF, so it is the frame the browser actually drew rather than
   * the moment the bytes arrived.
   */
  let paintPending = false;
  function reportPaint() {
    if (painted || paintPending) return;
    paintPending = true;
    const send = function () {
      paintPending = false;
      if (painted) return;
      painted = true;
      stats.paintedAt = Date.now();
      up({ t: 'paint' });
    };
    try {
      requestAnimationFrame(function () {
        requestAnimationFrame(send);
      });
    } catch (e) {
      send();
    }
  }

  /**
   * INK (SEAM H3) — "there is something on screen", as distinct from `paint`,
   * which only ever meant "the first chunk was written".
   *
   * The distinction is the whole of HANDOFF-4's headline. On a real engine one
   * boot generation in three spends its entire budget on reasoning, emits the
   * identity comment and nothing else, and the kernel then held a black overlay
   * for its full 2.5 s floor while reporting a first paint of 4,176 ms. A
   * document that has painted may never ink; the kernel's reveal rule and its
   * telemetry both want the second number.
   *
   * Ink is any element inside <body> with a box bigger than a pixel, with the
   * tags that never draw excluded by name — the same rule the harness's own
   * probe uses (`scripts/run.mjs`, `bootPainted`), so the two instruments can
   * no longer disagree. The bootstrap document's own <script> and <style> carry
   * no box and would be excluded anyway; they are named because they are what
   * is in the frame before the first model byte.
   *
   * Cheap on purpose: it runs at most once per animation frame, it stops at the
   * first element that has a box, and it never looks at more than INK_SCAN_MAX
   * of them. A document with no ink at all is the only case that pays the full
   * scan, and those documents are tiny by definition.
   */
  const INK_SCAN_MAX = 400;
  const NO_BOX: Record<string, 1> = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, TITLE: 1, BASE: 1, HEAD: 1, TEMPLATE: 1, NOSCRIPT: 1 };

  function hasInk(): boolean {
    const body = document.body;
    if (!body) return false;
    let els: Element[] = [];
    try {
      els = Array.prototype.slice.call(body.querySelectorAll('*'), 0, INK_SCAN_MAX);
    } catch (e) {
      return false;
    }
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (NO_BOX[el.tagName]) continue;
      let r: DOMRect;
      try {
        r = el.getBoundingClientRect();
      } catch (e) {
        continue;
      }
      if (r.width > 1 && r.height > 1) return true;
    }
    return false;
  }

  let inkPending = false;
  function reportInk() {
    if (inked || inkPending) return;
    inkPending = true;
    const check = function () {
      inkPending = false;
      if (inked) return;
      if (!hasInk()) return;
      inked = true;
      stats.inkedAt = Date.now();
      up({ t: 'ink' });
    };
    try {
      requestAnimationFrame(function () {
        requestAnimationFrame(check);
      });
    } catch (e) {
      check();
    }
  }

  function endDoc() {
    if (!opened) return;
    try {
      document.close();
      closed = true;
    } catch (e) {}
    sweep();
    applyUrl();
    collectImgSlots();
    // the last word on this document: a stream whose final chunk closed the
    // only element with a box inks here or never
    reportInk();
  }

  /* ------------------------------------------------------- os.img (SEAM S1) */

  /**
   * Images inside a generated document.
   *
   * The document declares what it wants —
   * `data-os-img="photo|faces|map"` plus `data-os-prompt="<short description>"`
   * — and the kernel fills it with a `data:` URI. The CSP stays `img-src data:`
   * and nothing generated ever touches the network.
   *
   * Collected AFTER `document.close()`, deliberately: a slot inside a document
   * that is still streaming may not have its `data-os-prompt` attribute yet
   * (an attribute is only complete when its tag is), and asking for a picture
   * of half a prompt is money spent on nothing. First N in document order, N
   * being 4 for an app document and 2 for a page (SPEC §12.5), so a model that
   * declares thirty photo slots gets four and the rest keep whatever it drew.
   */
  const imgSlots: Element[] = [];
  let imgSeq = 0;

  /** T2: the theme this element's sheet belongs to. `faces` is a theme spelled as a kind. */
  function themeOf(el: Element): string {
    const kind = (el.getAttribute('data-os-img') || '').trim().toLowerCase();
    if (kind === 'faces') return 'faces';
    const t = (el.getAttribute('data-os-theme') || '').trim().toLowerCase();
    return t || TILE_THEME_DEFAULT;
  }

  /**
   * T2, and the defect the first live catalogue page found (HANDOFF-7 §tiles).
   *
   * This used to be ONE loop bounded by `imgSlots.length < limit`, which marked
   * a tile group's later members as it walked past them. So the LAST group the
   * limit allowed got its slot written onto its asker and onto nobody else: the
   * loop's condition was already false. Live, on a page declaring a products
   * grid and a poster wall (a page's ceiling is 2), the sheet was bought, it
   * arrived, and **1 of 24 posters showed a picture** — the other twenty-three
   * were never marked, so `fillTiles` could not find them. A page declaring one
   * group filled all of it, which is why every fixture passed: the limit is
   * never reached with one group.
   *
   * Two phases, so the two questions are asked separately: WHICH pictures this
   * document gets (the ceiling's business, in document order), and WHICH
   * elements share each one (the group's business, which the ceiling has no
   * opinion about — sixteen tiles of one sheet are one picture).
   */
  function collectImgSlots() {
    const limit = role === 'app' ? DOC_IMG_LIMIT.app : role === 'page' ? DOC_IMG_LIMIT.page : DOC_IMG_LIMIT.boot;
    if (!limit) return;
    let els: Element[] = [];
    try {
      // T2: a tile element carries the prompt only on the group's FIRST member,
      // so the `[data-os-prompt]` requirement cannot be in the selector any more
      els = Array.prototype.slice.call(document.querySelectorAll('[data-os-img]'));
    } catch (e) {}

    interface Sheet {
      theme: string;
      prompt: string;
      asker: Element | null;
      members: Element[];
    }
    /** phase 1 — the asks, in document order; a sheet group is one ask */
    const groups: any = {};
    const asks: Array<{ el: Element; kind: string; prompt: string; sheet?: Sheet }> = [];
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el.getAttribute('data-os-img-slot')) continue; // already asked for on an earlier pass
      const kind = (el.getAttribute('data-os-img') || '').trim().toLowerCase();
      if (!isDocImgKind(kind)) continue; // wallpaper/icons are the boot's, not a document's
      const prompt = (el.getAttribute('data-os-prompt') || '').replace(/\s+/g, ' ').trim().slice(0, IMG_PROMPT_MAX);
      if (isSheetKind(kind)) {
        const theme = themeOf(el);
        let g: Sheet = groups[theme];
        if (!g) g = groups[theme] = { theme: theme, prompt: '', asker: null, members: [] };
        g.members.push(el);
        // the group's first member that describes the set is its asker, and
        // the ask takes that member's place in document order
        if (!g.asker && prompt) {
          g.asker = el;
          g.prompt = prompt;
          asks.push({ el: el, kind: 'tiles', prompt: prompt, sheet: g });
        }
        continue;
      }
      if (!prompt) continue;
      asks.push({ el: el, kind: kind, prompt: prompt });
    }

    /** phase 2 — the ceiling, and then every element that shares the picture */
    for (let i = 0; i < asks.length && imgSlots.length < limit; i++) {
      const a = asks[i];
      const slot = 's' + ++imgSeq;
      if (a.sheet) {
        const m = a.sheet.members;
        for (let k = 0; k < m.length; k++) m[k].setAttribute('data-os-img-slot', slot);
      } else {
        a.el.setAttribute('data-os-img-slot', slot);
      }
      imgSlots.push(a.el);
      stats.imgAsked = (stats.imgAsked || 0) + 1;
      up(
        a.sheet
          ? { t: 'img', kind: 'tiles' as DocImgKind, prompt: a.prompt, slot: slot, theme: a.sheet.theme }
          : { t: 'img', kind: a.kind as DocImgKind, prompt: a.prompt, slot: slot }
      );
    }
  }

  /** Paint one data: URI into the slot that asked for it. */
  function fillImg(slot: string, kind: string, dataUri: string, theme?: string) {
    if (!slot || !/^data:image\//i.test(dataUri || '')) return;
    let el: HTMLElement | null = null;
    try {
      el = document.querySelector('[data-os-img-slot="' + slot.replace(/["\\]/g, '') + '"]') as HTMLElement | null;
    } catch (e) {}
    if (!el) return; // the document moved on; the picture is simply dropped
    if (isSheetKind(kind)) {
      fillTiles(el, dataUri, theme || themeOf(el), slot);
      return;
    }
    if (el.tagName === 'IMG') {
      (el as HTMLImageElement).src = dataUri;
    } else {
      el.style.backgroundImage = 'url("' + dataUri + '")';
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.style.backgroundRepeat = 'no-repeat';
    }
    el.setAttribute('data-os-img-filled', kind);
    stats.imgFilled = (stats.imgFilled || 0) + 1;
    fadeIn(el);
  }

  /**
   * T2 — ONE 4x4 sheet for a whole set, sliced by CSS.
   *
   * Every member of the group shows one cell: `data-os-tile="0..15"` on a
   * `tiles` element, or `data-os-face="0..15"` for the `faces` theme, which is
   * the spelling this started as and the one a page written against v0.4 uses.
   * Sixteen small pictures of one set for one $0.003 call — the arithmetic that
   * makes a contact list, a poster wall, a product grid or a shelf of covers
   * affordable at all under the per-document ceiling (SPEC §12.5).
   *
   * Members are found by the group's SLOT, which `collectImgSlots` wrote onto
   * every tile of the theme, so two sheets in one document cannot slice into
   * each other's elements.
   */
  function fillTiles(asker: HTMLElement, dataUri: string, theme: string, slot: string) {
    let els: HTMLElement[] = [];
    const push = (el: HTMLElement) => {
      if (el && els.indexOf(el) < 0) els.push(el);
    };
    try {
      const mine = Array.prototype.slice.call(document.querySelectorAll('[data-os-img-slot="' + String(slot).replace(/["\\]/g, '') + '"][data-os-tile]'));
      for (let i = 0; i < mine.length; i++) push(mine[i]);
      // the faces theme keeps its own element spelling, and a `tiles` group may
      // also point plain `[data-os-tile]` elements at the sheet it described
      if (theme === 'faces') {
        const faces = Array.prototype.slice.call(document.querySelectorAll('[data-os-face]'));
        for (let i = 0; i < faces.length; i++) push(faces[i]);
      }
      if (!els.length) {
        const loose = Array.prototype.slice.call(document.querySelectorAll('[data-os-tile]:not([data-os-img-slot])'));
        for (let i = 0; i < loose.length; i++) push(loose[i]);
      }
    } catch (e) {}
    if ((asker.hasAttribute('data-os-face') || asker.hasAttribute('data-os-tile')) && els.indexOf(asker) < 0) push(asker);
    let n = 0;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const attr = el.hasAttribute('data-os-tile') ? el.getAttribute('data-os-tile') : el.getAttribute('data-os-face');
      const raw = parseInt(attr || '', 10);
      const index = isNaN(raw) ? i % SHEET_CELLS : raw;
      const slice = sheetSlice(index);
      // measured before anything is written, and with getBoundingClientRect:
      // an inline <span> reports clientWidth 0 whatever it renders, and the
      // fallback below would then resize every face and reflow the document the
      // reader is already looking at
      const had = el.getBoundingClientRect();
      el.style.backgroundImage = 'url("' + dataUri + '")';
      el.style.backgroundSize = slice.size;
      el.style.backgroundPosition = slice.position;
      el.style.backgroundRepeat = 'no-repeat';
      if (had.width < 8 || had.height < 8) {
        el.style.display = el.style.display || 'inline-block';
        el.style.width = el.style.width || '44px';
        el.style.height = el.style.height || '44px';
      }
      el.setAttribute('data-os-img-filled', theme === 'faces' ? 'face' : 'tile');
      fadeIn(el);
      n++;
    }
    asker.setAttribute('data-os-img-filled', theme === 'faces' ? 'faces' : 'tiles');
    asker.setAttribute('data-os-img-theme', theme);
    stats.imgFilled = (stats.imgFilled || 0) + 1;
    stats.faces = theme === 'faces' ? n : stats.faces || 0;
    stats.tiles = n;
  }

  /* ---------------------------------------------------------- img de-fanging */

  function placeholder(img: HTMLImageElement) {
    const alt = img.getAttribute('alt') || 'an image that does not exist';
    const box = document.createElement('span');
    box.setAttribute('data-os-hallucinated-image', '');
    const wAttr = img.getAttribute('width');
    const hAttr = img.getAttribute('height');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', alt);
    box.style.cssText =
      'display:inline-flex;align-items:center;justify-content:center;text-align:center;' +
      'border:1px dashed currentColor;opacity:.75;padding:6px;font:12px/1.3 ui-monospace,monospace;' +
      'min-width:40px;min-height:30px;overflow:hidden;' +
      (img.getAttribute('style') || '') +
      (wAttr ? ';width:' + wAttr + 'px' : '') +
      (hAttr ? ';height:' + hAttr + 'px' : '');
    if (img.className) box.className = img.className;
    box.textContent = alt;
    if (img.parentNode) img.parentNode.replaceChild(box, img);
  }

  /**
   * An `<img data-os-img="photo">` is a slot the kernel is about to fill with a
   * `data:` URI (SEAM S1), so it is NOT a broken external image and must not be
   * turned into an alt-text box — de-fanging it first would delete the very
   * element the picture is for.
   */
  function isImgSlot(el: Element): boolean {
    return isDocImgKind((el.getAttribute('data-os-img') || '').trim().toLowerCase());
  }

  function sweep(root?: ParentNode) {
    const scope: ParentNode = root || document;
    let imgs: HTMLImageElement[] = [];
    try {
      imgs = Array.prototype.slice.call(scope.querySelectorAll('img'));
    } catch (e) {}
    for (let i = 0; i < imgs.length; i++) {
      const src = imgs[i].getAttribute('src') || '';
      if (/^data:/i.test(src) || isImgSlot(imgs[i])) continue;
      placeholder(imgs[i]);
    }
  }

  /* ------------------------------------------------------------ interception */

  /**
   * The interception is (re)wired after every document.open().
   *
   * document.open() drops the document's event listeners but keeps the same
   * Document object, so a "have I wired this document yet" flag stored on the
   * document survives while the listeners it is guarding do not — which left
   * every document after the first one in a frame with no interception at all:
   * links in a results page navigated the sandboxed frame instead of the OS.
   * These handlers are module-level functions and addEventListener
   * de-duplicates identical (type, listener, capture) triples, so calling this
   * on every open is both necessary and safe.
   */
  function wire() {
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('keydown', onKeydown, true);
    observe();
  }

  function onClick(e: any) {
    const t = e.target as Element;
    if (!t || !t.closest) return;
    const nav = t.closest('[data-os-nav]');
    if (nav) {
      const which = (nav.getAttribute('data-os-nav') || '').toLowerCase();
      if (which === 'back' || which === 'forward' || which === 'reload' || which === 'home') {
        e.preventDefault();
        call(which, []);
        return;
      }
    }
    const reboot = t.closest('[data-os-reboot]');
    if (reboot) {
      e.preventDefault();
      os.reboot();
      return;
    }
    const close = t.closest('[data-os-close]');
    if (close) {
      e.preventDefault();
      os.close();
      return;
    }
    const appEl = t.closest('[data-os-app]');
    if (appEl) {
      e.preventDefault();
      os.open(appEl.getAttribute('data-os-app') || '');
      return;
    }
    const a = t.closest('a[href]');
    if (a) {
      const href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#' || /^javascript:/i.test(href)) return;
      e.preventDefault();
      os.navigate(href);
    }
  }

  function onSubmit(e: any) {
    const form = e.target as HTMLFormElement;
    if (!form || form.tagName !== 'FORM') return;
    e.preventDefault();
    const action = form.getAttribute('action') || currentUrl || '';
    const pairs: string[] = [];
    const els = form.querySelectorAll('input,select,textarea');
    for (let i = 0; i < els.length; i++) {
      const el = els[i] as HTMLInputElement;
      const name = el.getAttribute('name');
      if (!name) continue;
      const type = (el.getAttribute('type') || '').toLowerCase();
      if ((type === 'checkbox' || type === 'radio') && !el.checked) continue;
      if (type === 'submit' || type === 'button' || type === 'file' || type === 'password') continue;
      pairs.push(encodeURIComponent(name) + '=' + encodeURIComponent(el.value == null ? '' : el.value));
    }
    const q = pairs.join('&');
    const target = resolve(action);
    os.navigate(q ? target + (target.indexOf('?') >= 0 ? '&' : '?') + q : target);
  }

  function onKeydown(e: any) {
    if (e.key !== 'Enter') return;
    const t = e.target as Element;
    if (!t || !t.closest) return;
    const urlEl = t.closest('[data-os-url]');
    if (!urlEl) return;
    e.preventDefault();
    const v = (urlEl as HTMLInputElement).value || '';
    // NOT resolved against the current page: what someone types in an
    // address bar is an address, not a relative link. Resolving it turned
    // "reddit.com/r/cats" into "google.com/reddit.com/r/cats". The kernel
    // normalises it (bare domain -> https://, anything else -> a search).
    if (v.trim()) call('navigate', [v.trim()]);
  }

  /**
   * <img> de-fanging for nodes that arrive after the initial sweep. A new
   * observer per document: document.open() replaces documentElement, so the
   * previous one is watching a node that no longer exists.
   */
  let observer: MutationObserver | null = null;
  function observe() {
    try {
      if (observer) observer.disconnect();
      observer = new MutationObserver(function (recs) {
        for (let i = 0; i < recs.length; i++) {
          const added = recs[i].addedNodes;
          for (let j = 0; j < added.length; j++) {
            const n = added[j] as Element;
            if (!n || n.nodeType !== 1) continue;
            if (n.tagName === 'IMG') {
              const src = n.getAttribute('src') || '';
              if (!/^data:/i.test(src) && !isImgSlot(n)) placeholder(n as HTMLImageElement);
            } else if (typeof (n as any).querySelectorAll === 'function') {
              sweep(n);
            }
          }
        }
        if (role === 'app') pumpPageQueue();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }

  function applyUrl() {
    if (!currentUrl) return;
    let els: Element[] = [];
    try {
      els = Array.prototype.slice.call(document.querySelectorAll('[data-os-url]'));
    } catch (e) {}
    for (let i = 0; i < els.length; i++) {
      const el = els[i] as any;
      if ('value' in el) el.value = currentUrl;
      else el.textContent = currentUrl;
    }
  }

  /* ------------------------------------------------- nested page frame (browser) */

  function ensurePageFrame(): HTMLIFrameElement | null {
    const host = document.querySelector('[data-os-page]');
    if (!host) return null;
    if (pageFrame && pageFrame.parentNode === host) return pageFrame;
    host.innerHTML = '';
    const hostEl = host as HTMLElement;
    const cs = hostEl.style;
    if (!cs.position) cs.position = 'relative';
    const f = document.createElement('iframe');
    // allow-forms is needed, not optional: the home page of the fake internet is
    // search-shaped, and a sandbox without it blocks the submission outright —
    // the submit event never fires, so the interception below never runs and
    // searching does nothing. Never allow-same-origin. The generated CSP carries
    // form-action 'none', so even an un-intercepted submit navigates nowhere.
    f.setAttribute('sandbox', 'allow-scripts allow-forms');
    f.setAttribute('title', 'page');
    f.style.cssText = 'border:0;display:block;position:absolute;left:0;top:0;width:100%;height:100%;background:transparent';
    f.srcdoc = bootstrap;
    host.appendChild(f);
    pageFrame = f;
    pageReady = false;
    return f;
  }

  function pumpPageQueue() {
    if (!pageQueue.length) return;
    const f = ensurePageFrame();
    if (!f || !pageReady || !f.contentWindow) return;
    while (pageQueue.length) {
      const m = pageQueue.shift();
      try {
        f.contentWindow.postMessage(m, '*');
      } catch (e) {}
    }
  }

  function toPage(m: any) {
    pageQueue.push(m);
    ensurePageFrame();
    pumpPageQueue();
  }

  /**
   * Last-resort hook injection, asked for by the kernel when a generated app
   * still lacks a required hook after the repair pass. Bare and unstyled on
   * purpose — the kernel has no visual opinions.
   */
  function injectHook(what: string) {
    if (what === 'page') {
      if (document.querySelector('[data-os-page]')) return;
      const el = document.createElement('div');
      el.setAttribute('data-os-page', '');
      el.setAttribute('data-os-injected', '');
      el.style.cssText = 'position:absolute;left:0;top:28px;right:0;bottom:0';
      document.body.appendChild(el);
      pumpPageQueue();
    } else if (what === 'url') {
      if (document.querySelector('[data-os-url]')) return;
      const el = document.createElement('input');
      el.setAttribute('data-os-url', '');
      el.setAttribute('data-os-injected', '');
      el.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:26px;box-sizing:border-box';
      document.body.insertBefore(el, document.body.firstChild);
      applyUrl();
    }
  }

  /* -------------------------------------------------------------- messaging */

  /**
   * document.open() drops the window's event listeners, so the message handler is
   * re-attached after every open. addEventListener de-duplicates identical
   * (type, listener) pairs, so re-attaching is always safe.
   */
  function attach() {
    window.addEventListener('message', onMessage);
  }

  function onMessage(e: MessageEvent) {
    const m: any = e.data;
    if (!m || m.__os !== 1) return;
    stats.msgs++;
    stats.last = m.t;
    if (!stats.seq) stats.seq = [];
    if (stats.seq.length < 200) stats.seq.push(m.t);

    // a message from our own nested page frame -> relay up to the kernel
    if (pageFrame && e.source === pageFrame.contentWindow) {
      if (m.t === 'ready') {
        pageReady = true;
        pumpPageQueue();
      }
      up({ t: 'relay', m: m });
      return;
    }

    if (e.source !== parentWin) return;

    switch (m.t) {
      case 'init':
        role = m.role || role;
        if (typeof m.url === 'string') currentUrl = m.url;
        if (m.state) snapshot = m.state;
        if (typeof m.bootstrap === 'string') bootstrap = m.bootstrap;
        if (typeof m.prefix === 'string' && m.prefix) docPrefix = m.prefix;
        break;
      case 'reset':
        openDoc();
        break;
      case 'chunk':
        write(m.d || '');
        break;
      case 'end':
        endDoc();
        break;
      case 'seturl':
        currentUrl = m.url || '';
        applyUrl();
        break;
      case 'state':
        snapshot = m.state;
        break;
      case 'event':
        fire(m.event || 'event', m.detail);
        break;
      case 'sub':
        toPage(m.m);
        break;
      case 'inject':
        injectHook(m.what);
        break;
      case 'imgfill':
        fillImg(String(m.slot || ''), String(m.kind || ''), String(m.dataUri || ''), m.theme ? String(m.theme) : '');
        break;
    }
  }

  attach();
  up({ t: 'ready' });
})();
