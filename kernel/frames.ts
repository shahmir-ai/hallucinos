import { DOC_PREFIX, isDocImgKind, isSheetKind, type DocImgKind, type Role, type DownMsg } from './protocol.js';

/** The injected runtime source, inlined at build time by scripts/build.mjs. */
declare const __OS_RUNTIME__: string;

/**
 * The bootstrap document every generated document is streamed into. It carries
 * the runtime and nothing else; the CSP meta and the runtime are therefore in
 * place before the first model byte (SPEC §2.2).
 */
export function bootstrapDoc(): string {
  const src = String(__OS_RUNTIME__).replace(/<\/script/gi, '<\\/script');
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<style>html,body{margin:0;height:100%;background:transparent}</style>' +
    '</head><body><script>' +
    src +
    '</script></body></html>'
  );
}

export type CallHandler = (fn: string, args: unknown[], from: 'self' | 'page') => void;
/** SEAM S1: `data-os-img` + `data-os-prompt` inside a generated document. */
export type ImgHandler = (kind: DocImgKind, prompt: string, slot: string, from: 'self' | 'page', theme?: string) => void;

/**
 * SPEC §3.1: "Pages never receive identity — the fake internet is not the OS."
 * The prompt side honours it; this is the runtime side. A generated page that
 * calls os.state() must not be able to read the machine's name back out.
 */
function forPage(state: unknown): unknown {
  if (!state || typeof state !== 'object') return state;
  const { os: _os, ...rest } = state as Record<string, unknown>;
  return rest;
}

const registry: Frame[] = [];
let listening = false;

function ensureListener() {
  if (listening) return;
  listening = true;
  window.addEventListener('message', (e: MessageEvent) => {
    const m: any = e.data;
    if (!m || m.__os !== 1) return;
    const frame = registry.find((f) => f.el.contentWindow === e.source);
    if (!frame) return;
    if (m.t === 'ready') {
      frame.markReady();
      return;
    }
    if (m.t === 'paint') {
      frame.painted = true;
      const cb = frame.onPaint;
      frame.onPaint = null;
      cb?.();
      return;
    }
    if (m.t === 'ink') {
      frame.inked = true;
      const cb = frame.onInk;
      frame.onInk = null;
      cb?.();
      frame.fireInkHooks();
      return;
    }
    if (m.t === 'call') {
      frame.onCall?.(String(m.fn), Array.isArray(m.args) ? m.args : [], 'self');
      return;
    }
    if (m.t === 'img') {
      askImg(frame, m, 'self');
      return;
    }
    if (m.t === 'relay') {
      const inner: any = m.m;
      if (!inner) return;
      if (inner.t === 'ready') {
        frame.pageReady = true;
        frame.flushPage();
        return;
      }
      if (inner.t === 'paint') {
        frame.pagePainted = true;
        const cb = frame.onPagePaint;
        frame.onPagePaint = null;
        cb?.();
        return;
      }
      if (inner.t === 'ink') {
        frame.pageInked = true;
        const cb = frame.onPageInk;
        frame.onPageInk = null;
        cb?.();
        return;
      }
      if (inner.t === 'img') {
        askImg(frame, inner, 'page');
        return;
      }
      if (inner.t === 'call') frame.onCall?.(String(inner.fn), Array.isArray(inner.args) ? inner.args : [], 'page');
    }
  });
}

/**
 * SEAM S1 — a generated document asking for a picture. The kind and the slot are
 * validated here rather than trusted: this arrives over `postMessage` from an
 * opaque-origin document whose own script can send anything, and every image
 * costs $0.003. `wallpaper` and `icons` are rejected by `isDocImgKind` — those
 * two are the boot's and the server owns their prompts (SEAM S3).
 */
function askImg(frame: Frame, m: any, from: 'self' | 'page'): void {
  const kind = m?.kind;
  const slot = String(m?.slot || '').slice(0, 24);
  const prompt = String(m?.prompt || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!isDocImgKind(kind) || !slot || !prompt) return;
  /**
   * T2 — the theme travels as the document declared it, clamped in length and
   * character set and nothing more. The server refuses a theme it does not know
   * (a wrong theme is a wrong $0.003 picture), and silently rewriting one here
   * would hide exactly that mismatch.
   */
  const theme = isSheetKind(String(kind))
    ? String(m?.theme || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 24)
    : '';
  frame.onImg?.(kind, prompt, slot, from, theme || undefined);
}

/** One sandboxed iframe holding one generated document. */
export class Frame {
  el: HTMLIFrameElement;
  role: Role;
  onCall: CallHandler | null = null;
  onImg: ImgHandler | null = null;
  pageReady = false;
  /** SPEC §12.2: a painted document is never replaced except by a user action. */
  painted = false;
  pagePainted = false;
  /**
   * SEAM H3: this document has something with a box in it. `painted` says the
   * first chunk was written, which a boot stream carrying only the identity
   * comment also satisfies — and that document is black for ever.
   */
  inked = false;
  pageInked = false;
  onPaint: (() => void) | null = null;
  onPagePaint: (() => void) | null = null;
  onInk: (() => void) | null = null;
  onPageInk: (() => void) | null = null;
  /**
   * KERNEL-6. `onInk` is one slot and `streamApp` owns it (it is where §12.1's
   * app ink number is taken). The window manager needs the same moment for
   * something else — dropping the opaque backdrop it put behind a streaming
   * document — so the kernel's own listeners go here instead of fighting over
   * the slot. Each runs once, in a try/catch: an ink hook may not cost a paint.
   */
  private inkHooks: (() => void)[] = [];
  private ready = false;
  private queue: DownMsg[] = [];
  private pageQueue: DownMsg[] = [];

  constructor(role: Role, opts: { url?: string; state?: unknown; style?: string; allowForms?: boolean } = {}) {
    ensureListener();
    this.role = role;
    const f = document.createElement('iframe');
    // never allow-same-origin: generated documents stay in an opaque origin
    f.setAttribute('sandbox', opts.allowForms ? 'allow-scripts allow-forms' : 'allow-scripts');
    f.setAttribute('data-os-frame', role);
    f.setAttribute('title', role);
    // transparent, not white: an app that sets no background should show the
    // machine's own desktop through it, not a kernel-coloured pane.
    f.style.cssText = opts.style || 'border:0;display:block;position:absolute;left:0;top:0;width:100%;height:100%;background:transparent';
    f.srcdoc = bootstrapDoc();
    this.el = f;
    registry.push(this);
    this.send({ __os: 1, t: 'init', role, url: opts.url || '', state: opts.state, bootstrap: bootstrapDoc(), prefix: DOC_PREFIX });
  }

  /** KERNEL-6: run once, on the first element with a box in this document. */
  addInkHook(fn: () => void) {
    if (this.inked) {
      try {
        fn();
      } catch {}
      return;
    }
    this.inkHooks.push(fn);
  }

  fireInkHooks() {
    const hooks = this.inkHooks;
    this.inkHooks = [];
    for (const fn of hooks) {
      try {
        fn();
      } catch {}
    }
  }

  markReady() {
    this.ready = true;
    const q = this.queue;
    this.queue = [];
    for (const m of q) this.post(m);
  }

  private post(m: DownMsg) {
    try {
      this.el.contentWindow?.postMessage(m, '*');
    } catch {}
  }

  send(m: DownMsg) {
    if (!this.ready) this.queue.push(m);
    else this.post(m);
  }

  /** messages destined for the nested page frame of a browser app */
  sendPage(m: DownMsg) {
    this.send({ __os: 1, t: 'sub', m });
  }

  flushPage() {
    const q = this.pageQueue;
    this.pageQueue = [];
    for (const m of q) this.sendPage(m);
  }

  reset() {
    this.painted = false;
    this.inked = false;
    this.send({ __os: 1, t: 'reset' });
  }
  chunk(d: string) {
    this.send({ __os: 1, t: 'chunk', d });
  }
  end() {
    this.send({ __os: 1, t: 'end' });
  }
  setUrl(url: string) {
    this.send({ __os: 1, t: 'seturl', url });
  }
  state(state: unknown) {
    this.send({ __os: 1, t: 'state', state });
    this.sendPage({ __os: 1, t: 'state', state: forPage(state) });
  }
  event(name: string, detail?: unknown) {
    this.send({ __os: 1, t: 'event', event: name, detail });
  }

  pageReset() {
    this.pagePainted = false;
    this.pageInked = false;
    this.sendPage({ __os: 1, t: 'reset' });
  }
  pageChunk(d: string) {
    this.sendPage({ __os: 1, t: 'chunk', d });
  }
  pageEnd() {
    this.sendPage({ __os: 1, t: 'end' });
  }
  pageSetUrl(url: string) {
    this.sendPage({ __os: 1, t: 'seturl', url });
  }

  /** init the nested page frame of a browser app */
  pageInit(url: string, state: unknown) {
    this.sendPage({ __os: 1, t: 'init', role: 'page', url, state: forPage(state), prefix: DOC_PREFIX });
  }

  inject(what: 'page' | 'url') {
    this.send({ __os: 1, t: 'inject', what });
  }

  /** S1: hand a slot its picture. `from` says which document asked. */
  fillImg(slot: string, kind: DocImgKind, dataUri: string, from: 'self' | 'page' = 'self', theme?: string) {
    const m: DownMsg = { __os: 1, t: 'imgfill', slot, kind, dataUri, ...(theme ? { theme } : {}) };
    if (from === 'page') this.sendPage(m);
    else this.send(m);
  }

  destroy() {
    const i = registry.indexOf(this);
    if (i >= 0) registry.splice(i, 1);
    if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
  }
}
