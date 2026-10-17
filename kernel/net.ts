/**
 * BAKEOFF-4 #1 — the connection ledger.
 *
 * The worst failure in the product is an app window that never paints, and the
 * cause is now proven but not quantified: a `POST /api/gen` that never leaves
 * the browser because every one of Chrome's six per-origin HTTP/1.1 sockets is
 * already held. HANDOFF-4 wrote down the invariant that made the image lane
 * safe — "at most two images, and the kernel never needs more than three live
 * generations (2 + 3 = 5 of 6)" — and BAKEOFF-4 falsified it by building a
 * three-wide generation lane that deadlocked every app generation of a real
 * boot. So the count of what is actually open at the moment a window opens has
 * never been measured, and a number is worth more than another guess.
 *
 * This is that instrument and nothing else: every request the kernel issues
 * opens an entry here and closes it when its body has been fully read (which is
 * when the socket is actually free, not when the promise resolves), and the
 * kernel asks for `netSnapshot()` at the moments that matter. It changes no
 * behaviour, holds nothing back and has no opinion about the ceiling.
 */

export type NetLane = 'gen' | 'img' | 'mark';

interface Entry {
  lane: NetLane;
  label: string;
  at: number;
}

const live = new Map<number, Entry>();
let seq = 0;
/** the high-water mark for the life of the page, and the one at the last report */
let peak = 0;

export interface NetSnapshot {
  /** requests open right now */
  n: number;
  /** the most that were ever open at once on this page */
  peak: number;
  /** open requests by lane */
  byLane: Record<NetLane, number>;
  /** every open request, oldest first: `<lane>:<label> <age>ms` */
  open: string[];
}

export function netOpen(lane: NetLane, label: string): () => void {
  const id = ++seq;
  live.set(id, { lane, label, at: Date.now() });
  if (live.size > peak) peak = live.size;
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    live.delete(id);
  };
}

export function netSnapshot(): NetSnapshot {
  const now = Date.now();
  const byLane: Record<NetLane, number> = { gen: 0, img: 0, mark: 0 };
  const open: string[] = [];
  for (const e of live.values()) {
    byLane[e.lane] = (byLane[e.lane] || 0) + 1;
    open.push(e.lane + ':' + e.label + ' ' + (now - e.at) + 'ms');
  }
  return { n: live.size, peak, byLane, open };
}

/** One line for the HUD and the telemetry note. */
export function netNote(why: string): string {
  const s = netSnapshot();
  return (
    'connections: ' +
    s.n +
    ' open (' +
    s.byLane.gen +
    ' gen, ' +
    s.byLane.img +
    ' img, ' +
    s.byLane.mark +
    ' mark), peak ' +
    s.peak +
    ' — ' +
    why +
    (s.open.length ? ' [' + s.open.join(', ') + ']' : '')
  );
}

/** Tests and the harness: `window.__osNet()`. */
export function resetNet(): void {
  live.clear();
  peak = 0;
  seq = 0;
}
