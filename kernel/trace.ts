/**
 * KERNEL-6 — the open-an-app trace.
 *
 * HANDOFF-5 issue 1: one real boot lost four of four app opens. A window that
 * never fills is bad; a window that never fills with **no line anywhere** —
 * no server telemetry, no connection-ledger entry, no JS error — is
 * undiagnosable, and three passes diagnosed it wrongly because the only
 * evidence was an absence.
 *
 * So the path from a launcher event to `POST /api/gen` is traced step by step
 * into a ring buffer that survives whatever happens next. Two readers:
 *
 *  - `window.__osTrace()` — the whole ring, oldest first, as `+<ms> step
 *    detail` lines, for the harness and for a human in a console.
 *  - the HUD telemetry stream — only the LOUD steps (a swallowed click, a
 *    caught callback exception, the watchdog), because the HUD is four lines
 *    of a real screenshot and a flood of `openApp.enter` would be a pixel of
 *    ours in every shot.
 *
 * It paints nothing, allocates one bounded array and never throws: an
 * instrument that can break the thing it measures is not an instrument.
 */

export interface TraceEntry {
  seq: number;
  /** ms since the kernel module was evaluated */
  t: number;
  step: string;
  detail: string;
  /** a caught exception's stack, when this entry is one */
  stack?: string;
}

const RING = 400;
const ring: TraceEntry[] = [];
const t0 = Date.now();
let seq = 0;

/** Where LOUD entries also go. The kernel wires this to the HUD. */
let loudSink: ((line: string) => void) | null = null;
export function setTraceSink(fn: ((line: string) => void) | null): void {
  loudSink = fn;
}

function push(step: string, detail: unknown, stack?: string): TraceEntry {
  const e: TraceEntry = {
    seq: ++seq,
    t: Date.now() - t0,
    step,
    detail: detail === undefined || detail === null ? '' : String(detail).slice(0, 200),
  };
  if (stack) e.stack = stack.slice(0, 1200);
  ring.push(e);
  if (ring.length > RING) ring.splice(0, ring.length - RING);
  return e;
}

/** One step of a traced path. Cheap, silent, ring only. */
export function trace(step: string, detail?: unknown): void {
  try {
    push(step, detail);
  } catch {}
}

/** A step that is also worth a telemetry line: a fault, a repair, a swallow. */
export function traceLoud(step: string, detail?: unknown): void {
  try {
    const e = push(step, detail);
    loudSink?.('trace ' + e.step + (e.detail ? ' ' + e.detail : ''));
  } catch {}
}

export function traceLine(e: TraceEntry): string {
  return '+' + e.t + 'ms ' + e.step + (e.detail ? ' ' + e.detail : '') + (e.stack ? '\n    ' + e.stack.split('\n').join('\n    ') : '');
}

export function traceEntries(): TraceEntry[] {
  return ring.slice();
}

export function traceDump(): string[] {
  return ring.map(traceLine);
}

export function resetTrace(): void {
  ring.length = 0;
  seq = 0;
}

/**
 * Run `fn` and never let it abandon the caller.
 *
 * HANDOFF-5 issue 1's second candidate: `openApp` calls `wm.focus`, which calls
 * the kernel's own `onFocus` hook, which calls `pushState` and
 * `fitBarContents`. An exception in any of those — `pushState` on a session
 * whose `persist` throws, `fitBarContents` on a bar the model wrote without a
 * task template — propagates out of `openApp` *before* `streamApp` is reached,
 * and out of a delegated click listener, where nothing in this product was
 * looking for it. It is recorded here, with its stack, and swallowed: the
 * window's document matters more than the side effect that failed.
 */
export function guard<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (err) {
    const stack = String((err as any)?.stack || (err as any)?.message || err);
    try {
      const e = push('threw ' + label, String((err as any)?.message || err), stack);
      loudSink?.('trace threw in ' + label + ': ' + e.detail);
      // never swallowed silently: the console is the second witness
      console.warn('[os] caught in ' + label + ':', err);
    } catch {}
    return undefined;
  }
}

/** The same, as a wrapped listener — for handlers the kernel hands to the DOM. */
export function guarded<E extends Event>(label: string, fn: (e: E) => void): (e: E) => void {
  return (e: E) => {
    guard(label, () => fn(e));
  };
}
