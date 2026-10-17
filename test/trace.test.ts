import { describe, it, expect, beforeEach, vi } from 'vitest';
import { trace, traceLoud, traceDump, traceEntries, resetTrace, setTraceSink, guard, guarded } from '../kernel/trace.js';

/**
 * KERNEL-6 — the open-an-app trace.
 *
 * HANDOFF-5 issue 1 was undiagnosable because its only evidence was an absence:
 * a window that never filled, with no server telemetry line, no
 * connection-ledger entry and no JS error. Two passes diagnosed it wrongly off
 * that absence. So what this instrument has to get right is: it records
 * everything, it is bounded, only the loud entries reach the HUD, and — the one
 * that matters — `guard` catches an exception thrown inside a delegated
 * handler's callback, records it with its stack, and lets the caller carry on.
 */
describe('the trace ring', () => {
  beforeEach(() => {
    resetTrace();
    setTraceSink(null);
  });

  it('records steps in order, as +<ms> step detail', () => {
    trace('openApp.enter', 'notes');
    trace('openApp.created', 'w1');
    const lines = traceDump();
    expect(lines.length).toBe(2);
    for (const l of lines) expect(l).toMatch(/^\+\d+ms \S+/);
    expect(lines[0]).toContain('openApp.enter notes');
    expect(lines[1]).toContain('openApp.created w1');
    expect(traceEntries().map((e) => e.seq)).toEqual([1, 2]);
  });

  it('is bounded: an old entry falls off rather than growing for ever', () => {
    for (let i = 0; i < 900; i++) trace('step', i);
    const entries = traceEntries();
    expect(entries.length).toBeLessThanOrEqual(400);
    // the newest survive, which is what a post-mortem needs
    expect(entries[entries.length - 1].detail).toBe('899');
  });

  it('sends only the loud entries to the HUD', () => {
    const lines: string[] = [];
    setTraceSink((l) => lines.push(l));
    trace('openApp.enter', 'notes');
    traceLoud('watchdog.fired', 'notes w1');
    expect(lines).toEqual(['trace watchdog.fired notes w1']);
    // both are still in the ring
    expect(traceDump().length).toBe(2);
  });

  it('never throws, whatever it is handed', () => {
    const circular: any = {};
    circular.self = circular;
    expect(() =>
      trace('weird', {
        toString() {
          throw new Error('no');
        },
      })
    ).not.toThrow();
    expect(() => trace('undef')).not.toThrow();
  });
});

describe('guard — a callback inside a delegated handler', () => {
  beforeEach(() => {
    resetTrace();
    setTraceSink(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns the value when nothing goes wrong', () => {
    expect(guard('ok', () => 7)).toBe(7);
    expect(traceDump().length).toBe(0);
  });

  it('swallows the throw, records it with its stack, and names the label', () => {
    const lines: string[] = [];
    setTraceSink((l) => lines.push(l));
    const out = guard('onFocus pushState', () => {
      throw new Error('storage is full');
    });
    expect(out).toBeUndefined();
    const entries = traceEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].step).toBe('threw onFocus pushState');
    expect(entries[0].detail).toBe('storage is full');
    expect(entries[0].stack).toContain('storage is full');
    expect(lines[0]).toContain('threw in onFocus pushState');
    // and it is not silent: the console is the second witness
    expect(console.warn).toHaveBeenCalled();
  });

  it('the caller keeps going — which is the whole point', () => {
    const done: string[] = [];
    const openApp = () => {
      guard('wm.focus', () => {
        throw new Error('geometry blew up');
      });
      done.push('streamApp');
    };
    expect(openApp).not.toThrow();
    expect(done).toEqual(['streamApp']);
  });

  it('guarded() wraps a listener the same way', () => {
    const fn = guarded('desktop click', () => {
      throw new Error('bad target');
    });
    expect(() => fn(new Event('click'))).not.toThrow();
    expect(traceEntries()[0].step).toBe('threw desktop click');
  });
});
