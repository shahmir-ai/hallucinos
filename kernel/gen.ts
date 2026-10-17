import type { Kind, Identity } from './contract.js';
import { netOpen } from './net.js';
import { trace } from './trace.js';

export interface GenContext {
  app_id?: string;
  url?: string;
  referer_url?: string;
  referer_title?: string;
  history?: string[];
  missing_hooks?: string[];
  viewport?: string;
  manifest?: { apps: { id: string; shape: string; name?: string }[] };
  /** a reboot: keep this name, bump this version (SPEC §4) */
  lineage?: { name: string; version: string };
}

export interface GenRequest {
  kind: Kind;
  engine: string;
  seed: string;
  identity?: Identity | null;
  params?: Record<string, unknown>;
  context?: GenContext;
  /**
   * Re-ask for a document the server rerouted mid-stream (SPEC §12.1). The
   * server OR-s it with its own verdict, so it can only make the answer more
   * wholesome.
   */
  rerouted?: boolean;
  /**
   * The client's id for this generation (INTERFACE I6). It is sent with the
   * request so the kernel can post first-paint marks the moment it has them,
   * without waiting for the telemetry sentinel at the end of the stream. The
   * server may echo its own `gen_id` in the sentinel; that one wins.
   */
  gen_id?: string;
}

export interface GenTelemetry {
  engine: string;
  kind: string;
  gen_id?: string;
  moderation_ms?: number;
  server_ms?: number;
  provider_ttfb_ms?: number;
  ttfb_ms: number;
  total_ms: number;
  tokens_in: number;
  tokens_out: number;
  tok_per_s: number;
  usd: number;
  contract_ok: boolean | null;
  missing?: string[];
  /** the server stopped the stream at the per-kind output hard cap */
  truncated?: boolean;
  prompt_fallbacks?: string[];
  /**
   * SEAM H2 — hedged generation. `engine` is the routed name the kernel asked
   * with (`auto`); `winner` is the engine whose first content token actually
   * arrived, and the loser's billed input is already inside `usd`.
   */
  hedged?: boolean;
  winner?: string;
  loser?: string;
  loser_aborted_ms?: number;
  loser_tokens_in?: number;
  // NOTE: no `rerouted`. The reroute is silent (SPEC §1.4) and is not reported
  // to the client at all — it lives only in the server's stdout telemetry line.
}

export class CapError extends Error {
  retryAfter: number;
  constructor(retryAfter: number) {
    super('over capacity');
    this.retryAfter = retryAfter;
  }
}

export class GenError extends Error {
  /** whatever had already been streamed when the error sentinel arrived */
  partial = '';
  /** the id this generation was marked with, so a kept document can still be reported */
  genId = '';
}

/**
 * The server flagged this document AFTER the stream had started (SPEC §12.1:
 * remote moderation runs beside the generation) and ended it with
 * `<!--os-reroute-->`. Distinct from GenError on purpose: the error path
 * regenerates the SAME request, which here would only lose the same race again
 * — the reroute path re-asks with `rerouted: true`.
 */
export class RerouteError extends Error {
  constructor(public reason = 'moderation') {
    super('rerouted');
  }
}

const TELEMETRY_RE = /<!--os-telemetry:([\s\S]*?)-->/;
const ERROR_RE = /<!--os-error:([\s\S]*?)-->/;
const REROUTE_RE = /<!--os-reroute:([\s\S]*?)-->/;

export interface GenResult {
  text: string;
  telemetry: GenTelemetry | null;
  /** the id this generation is marked with (I6) */
  genId: string;
}

let genSeq = 0;
export function newGenId(): string {
  genSeq += 1;
  return 'g' + genSeq + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * KERNEL-7 — the generation lane is GONE, and this note is its epitaph.
 *
 * BAKEOFF-4 built admission control for generations (three at a time, boot and
 * desktop at the front of the queue) to enforce HANDOFF-4's invariant that a
 * browser's six sockets are never all held by pictures and streams at once. It
 * shipped INERT (`GEN_CONCURRENCY = Infinity`) because at three it starved
 * every app generation of a real boot — and then KERNEL-6 found the actual
 * cause of the blank app window: one CSS selector in the desktop's click
 * delegation. There was never a connection to starve; the generation the lane
 * was rationing had never been asked for.
 *
 * So the lane rationed a mechanism that was not running, behind a switch nobody
 * was allowed to touch, with three unit tests proving the rationing worked.
 * HANDOFF-5 #9 and KERNEL-6 #3 both said delete it rather than leave it, and
 * this is that deletion: `genStream` calls the fetch directly again. If a real
 * socket ceiling is ever measured (the image lane's two, in `kernel/img.ts`, is
 * a live one), it comes back with the measurement that justifies its width.
 */
/** POST /api/gen and pump the HTML through `onChunk` as it lands. Never buffers before painting. */
export function genStream(req: GenRequest, onChunk: (text: string) => void, signal?: AbortSignal): Promise<GenResult> {
  return genStreamInner(req, onChunk, signal);
}

async function genStreamInner(
  req: GenRequest,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<GenResult> {
  const genId = req.gen_id || newGenId();
  /**
   * BAKEOFF-4 #1: this socket is held from here until the body is fully read,
   * which is the number that decides whether the NEXT generation leaves the
   * browser at all. `closeNet` is called in a finally below, not on the
   * promise, because a stream abandoned mid-body holds its socket too.
   */
  const closeNet = netOpen('gen', req.kind + ' ' + genId);
  trace('gen.fetch', req.kind + ' ' + genId);
  try {
  const res = await fetch('/api/gen', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...req, gen_id: genId }),
    cache: 'no-store',
    signal,
  });
  if (res.status === 429) {
    const j = await res.json().catch(() => ({ retryAfter: 30 }));
    throw new CapError(Number((j as any).retryAfter) || 30);
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new GenError(`gen ${res.status} ${detail.slice(0, 200)}`);
  }
  trace('gen.headers', req.kind + ' ' + genId + ' ' + res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const s = dec.decode(value, { stream: true });
    if (!s) continue;
    text += s;
    onChunk(s);
  }
  // SPEC §12.1 — the late-moderation sentinel. Checked BEFORE the error
  // sentinel: the server emits one or the other, never both, and a rerouted
  // document must never be left on screen (it was generated FROM the flagged
  // string).
  const rm = REROUTE_RE.exec(text);
  if (rm) {
    let reason = 'moderation';
    try {
      reason = JSON.parse(rm[1]).reason || reason;
    } catch {}
    throw new RerouteError(reason);
  }
  const em = ERROR_RE.exec(text);
  if (em) {
    let msg = 'engine error';
    try {
      msg = JSON.parse(em[1]).message || msg;
    } catch {}
    const e = new GenError(msg);
    // SPEC §12.2: a document the visitor is already looking at is not thrown
    // away. The caller decides — it needs what arrived and the id it is logged
    // under to keep it.
    e.partial = text;
    e.genId = genId;
    throw e;
  }
  const m = TELEMETRY_RE.exec(text);
  let telemetry: GenTelemetry | null = null;
  if (m) {
    try {
      telemetry = JSON.parse(m[1]) as GenTelemetry;
    } catch {}
  }
  return { text, telemetry, genId: telemetry?.gen_id || genId };
  } finally {
    trace('gen.closed', req.kind + ' ' + genId);
    closeNet();
  }
}

/* ------------------------------------------------- speculative generation (I4) */

/**
 * A generation started before anyone asked for it: on `mousedown` over a
 * launcher, and for the browser's home page in parallel with the browser
 * chrome. It streams into a buffer; `gen.take` replays the buffer into a real
 * sink and pipes the rest live. A handle nobody takes within 60 s is aborted
 * upstream and discarded — it is never stored, never reused twice, and never
 * cached (SPEC §1.1, §12.1).
 */
export interface SpecHandle {
  id: string;
  kind: Kind;
  key: string;
  started: number;
  taken: boolean;
  dead: boolean;
  controller: AbortController;
  promise: Promise<GenResult>;
  buffer: string[];
  sink: ((c: string) => void) | null;
}

/**
 * How long an untaken prefetch may live.
 *
 * It used to be 60 s, which is a lifetime: a real generation finishes in
 * 1.5-5 s, so every prefetch nobody clicked was complete and paid for long
 * before anything aborted it (16 mousedowns across the launcher grid with no
 * click bought 16 finished app documents). 10 s rather than 2 because the
 * browser's home page is started beside the browser chrome and is only claimed
 * after that chrome has finished streaming — under ~3 s the home prefetch would
 * miss its claim on every open and cost a second generation instead of saving
 * one. The real fix for the scrub case is `start()` dropping the previous
 * untaken prefetch of the same kind, below.
 */
const SPEC_TTL_MS = 10_000;
const specs = new Map<string, SpecHandle>();

function keyOf(kind: Kind, key: string): string {
  return kind + ':' + key;
}

export const gen = {
  /** Start one, keyed so the click that follows can find it. Re-starting a live key is a no-op. */
  start(req: GenRequest, key: string): SpecHandle {
    const k = keyOf(req.kind, key);
    const live = specs.get(k);
    const fresh = !!live && !live.taken && !live.dead && Date.now() - live.started < SPEC_TTL_MS;
    /**
     * One pointer, one prefetch of a kind. Scrubbing the icon grid used to
     * leave every app document it passed over streaming to completion; the
     * visitor can only click one of them, so the previous one is dropped the
     * moment the next is asked for. Kinds are kept apart deliberately: a
     * launcher mousedown must not abort the browser's in-flight home page.
     */
    for (const other of Array.from(specs.values())) {
      if (other === live || other.kind !== req.kind || other.taken || other.dead) continue;
      gen.drop(other);
    }
    if (fresh) return live!;
    if (live && !live.taken) gen.drop(live);

    const controller = new AbortController();
    const id = newGenId();
    const h: SpecHandle = {
      id,
      kind: req.kind,
      key: k,
      started: Date.now(),
      taken: false,
      dead: false,
      controller,
      buffer: [],
      sink: null,
      promise: null as unknown as Promise<GenResult>,
    };
    h.promise = genStream({ ...req, gen_id: id }, (c) => (h.sink ? h.sink(c) : h.buffer.push(c)), controller.signal);
    // never let an unclaimed generation keep costing money
    h.promise.catch(() => {});
    specs.set(k, h);
    window.setTimeout(() => {
      if (!h.taken) gen.drop(h);
    }, SPEC_TTL_MS);
    return h;
  },

  /** The live handle for this key, or null. Taking it removes it from the registry. */
  claim(kind: Kind, key: string): SpecHandle | null {
    const k = keyOf(kind, key);
    const h = specs.get(k);
    if (!h || h.taken || h.dead || Date.now() - h.started > SPEC_TTL_MS) return null;
    specs.delete(k);
    /**
     * KERNEL-6: claimed counts as taken. `take` is reached through a chain of
     * microtasks, so the TTL timer cannot currently interleave — but a handle
     * that has been claimed and not yet mounted was still one `!h.taken` check
     * away from being aborted out from under its own window, and this bug class
     * (a window with a handle and no stream) is precisely the one being closed.
     */
    h.taken = true;
    return h;
  },

  /** Mount a handle: replay what has arrived, then stream the rest into `onChunk`. */
  take(h: SpecHandle, onChunk: (c: string) => void): Promise<GenResult> {
    h.taken = true;
    specs.delete(h.key);
    const pending = h.buffer;
    h.buffer = [];
    h.sink = onChunk;
    for (const c of pending) onChunk(c);
    return h.promise;
  },

  drop(h: SpecHandle): void {
    if (h.dead) return;
    h.dead = true;
    if (specs.get(h.key) === h) specs.delete(h.key);
    try {
      h.controller.abort();
    } catch {}
  },

  dropAll(): void {
    for (const h of Array.from(specs.values())) gen.drop(h);
    specs.clear();
  },

  size(): number {
    return specs.size;
  },
};

/* ------------------------------------------------------------- marks (I6) */

/**
 * first paint / ink / interactive, reported per generation. Fire and forget:
 * never blocks a paint.
 *
 * SEAM H3: `ink_ms` is when the document first had an element with a box, and
 * `first_paint_ms` is now that same moment — the old "the first chunk was
 * written" reading flattered exactly the case that matters (a boot stream that
 * emits the identity comment and no document reported a 4,176 ms first paint
 * for a frame that stayed black). `interactive_ms` keeps the older meaning for
 * app and page documents, where the runtime attaches its delegation on the
 * first chunk.
 */
export interface Marks {
  first_paint_ms?: number;
  ink_ms?: number;
  interactive_ms?: number;
  complete_ms?: number;
}

/**
 * Marks are coalesced for one animation-frame-ish window before they are sent.
 *
 * H3 splits what used to be one moment into two — the chunk (interactive) and
 * the ink (first paint) — which are the same millisecond for a normal document
 * and would otherwise be two POSTs. That matters for one specific reason:
 * HANDOFF-4 issue 1 was a browser's six-connection HTTP/1.1 ceiling starving
 * `/api/gen` outright, and the kernel's budget is three generations plus two
 * pictures. A mark must never be the sixth connection, so the common case stays
 * at one request and the numbers arrive in the same telemetry line.
 */
const MARK_COALESCE_MS = 50;
const pendingMarks = new Map<string, Marks>();

function postMark(genId: string, marks: Marks): void {
  const closeNet = netOpen('mark', genId);
  try {
    fetch('/api/mark', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gen_id: genId, ...marks }),
      cache: 'no-store',
      keepalive: true,
    })
      .catch(() => {})
      .finally(closeNet);
  } catch {
    closeNet();
  }
}

export function flushMarks(): void {
  for (const [genId, marks] of Array.from(pendingMarks.entries())) {
    pendingMarks.delete(genId);
    postMark(genId, marks);
  }
}

if (typeof window !== 'undefined') {
  // a mark still in the window when the tab goes away is sent now rather than
  // lost: this is the one number a bake-off cannot re-measure
  window.addEventListener('pagehide', flushMarks);
  window.addEventListener('beforeunload', flushMarks);
}

export function mark(genId: string, marks: Marks): void {
  if (!genId) return;
  const live = pendingMarks.get(genId);
  if (live) {
    Object.assign(live, marks);
    return;
  }
  const entry: Marks = { ...marks };
  pendingMarks.set(genId, entry);
  window.setTimeout(() => {
    if (pendingMarks.get(genId) !== entry) return;
    pendingMarks.delete(genId);
    postMark(genId, entry);
  }, MARK_COALESCE_MS);
}

/**
 * The name ring buffer (I2): every parsed identity is reported so the server can
 * ban it. The gen id of the generation the name came out of goes with it — the
 * route is global prompt state and only accepts a name against a boot or
 * identity generation the server itself issued, once.
 */
export function identitySeen(name: string, genId: string): void {
  if (!name || !genId) return;
  try {
    fetch('/api/identity-seen', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, gen_id: genId }),
      cache: 'no-store',
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

export async function genIdentity(
  req: GenRequest,
  signal?: AbortSignal
): Promise<{ identity: Identity; telemetry: Partial<GenTelemetry>; genId: string }> {
  const closeNet = netOpen('gen', 'identity');
  try {
    const res = await fetch('/api/gen', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...req, kind: 'identity' }),
      cache: 'no-store',
      signal,
    });
    if (res.status === 429) {
      const j = await res.json().catch(() => ({ retryAfter: 30 }));
      throw new CapError(Number((j as any).retryAfter) || 30);
    }
    if (!res.ok) throw new GenError(`identity ${res.status}`);
    const j = (await res.json()) as { identity: Identity; telemetry: Partial<GenTelemetry>; gen_id?: string };
    return {
      identity: j.identity,
      telemetry: j.telemetry || {},
      genId: String(j.gen_id || res.headers.get('x-os-gen-id') || ''),
    };
  } finally {
    closeNet();
  }
}
