import { describe, it, expect, afterEach } from 'vitest';
import { imgLaneState, requestBootImage, requestDocImage } from '../kernel/img.js';

/**
 * BAKEOFF-3 open issue 1 — the blank app window with no telemetry line
 * anywhere. The doc-image lane was two and the boot's wallpaper and icon sheet
 * bypassed it, so four `POST /api/img` could be open at once; each holds its
 * connection for 3-14 s. Four of those plus the boot and desktop streams is
 * six, which is a browser's per-origin HTTP/1.1 connection limit, and the next
 * `POST /api/gen` therefore never left the browser: nothing painted, and the
 * server had no request to write a telemetry line about.
 *
 * One lane for every picture, two at a time, boot pictures first.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const DATA = 'data:image/jpeg;base64,/9j/4AAQ';

/** a fal-shaped route that answers only when the test releases it */
function gatedFetch() {
  let peak = 0;
  let live = 0;
  const order: string[] = [];
  const gates: (() => void)[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    order.push(String(body.kind));
    live++;
    peak = Math.max(peak, live);
    await new Promise<void>((res) => gates.push(res));
    live--;
    return new Response(JSON.stringify({ dataUri: DATA }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return {
    get peak() {
      return peak;
    },
    order,
    releaseAll() {
      const g = gates.splice(0);
      for (const f of g) f();
    },
    inFlight() {
      return gates.length;
    },
  };
}

const doc = (slot: string) =>
  requestDocImage({ kind: 'photo', prompt: 'p ' + slot, session: 's', seed: 'x', scope: 'w1', scopeKind: 'app' });
const boot = (kind: 'wallpaper' | 'icons') => requestBootImage({ kind, session: 's', seed: 'x' });

describe('the image lane (kernel/img.ts)', () => {
  it('never opens more than two image connections, boot pictures included', async () => {
    const f = gatedFetch();
    const all = Promise.all([boot('wallpaper'), boot('icons'), doc('a'), doc('b'), doc('c'), doc('d')]);
    // let every queued microtask run: without a lane all six would be open
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(f.inFlight()).toBe(2);
    expect(imgLaneState()).toEqual({ active: 2, waiting: 4 });
    // drain the lane two at a time
    for (let wave = 0; wave < 3; wave++) {
      f.releaseAll();
      for (let i = 0; i < 40; i++) await Promise.resolve();
    }
    f.releaseAll();
    const out = await all;
    expect(out.every((u) => u === DATA)).toBe(true);
    expect(f.peak).toBe(2);
    expect(imgLaneState()).toEqual({ active: 0, waiting: 0 });
  });

  it('a desktop never waits behind a document: a boot picture jumps the doc queue', async () => {
    const f = gatedFetch();
    // four documents ask first, and only then does the boot ask for its two
    const asks = [doc('a'), doc('b'), doc('c'), doc('d')];
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const later = [boot('wallpaper'), boot('icons')];
    for (let i = 0; i < 10; i++) await Promise.resolve();
    // the two open connections are the first two documents; the boot is queued
    expect(f.order).toEqual(['photo', 'photo']);
    f.releaseAll();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    // the next two to go are the boot's, ahead of the two documents still waiting
    expect(f.order.slice(2)).toEqual(['wallpaper', 'icons']);
    f.releaseAll();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    f.releaseAll();
    await Promise.all([...asks, ...later]);
    expect(f.peak).toBe(2);
    expect(imgLaneState()).toEqual({ active: 0, waiting: 0 });
  });
});
