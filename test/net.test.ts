import { describe, it, expect, beforeEach } from 'vitest';
import { netOpen, netSnapshot, netNote, resetNet } from '../kernel/net.js';

/**
 * BAKEOFF-4 #1 — the connection ledger. It exists to turn "the kernel holds
 * more than three generation connections open" from an inference into a number,
 * so what it must get right is the arithmetic and the fact that it never holds
 * anything: every `netOpen` hands back its own closer, a closer called twice
 * does not double-count, and the peak survives the requests that set it.
 */
describe('the connection ledger', () => {
  beforeEach(() => resetNet());

  it('counts what is open, by lane', () => {
    const a = netOpen('gen', 'boot g1');
    const b = netOpen('gen', 'desktop g2');
    const c = netOpen('img', 'wallpaper');
    const s = netSnapshot();
    expect(s.n).toBe(3);
    expect(s.byLane).toEqual({ gen: 2, img: 1, mark: 0 });
    expect(s.open.some((l) => l.startsWith('gen:boot g1 '))).toBe(true);
    a();
    b();
    c();
    expect(netSnapshot().n).toBe(0);
  });

  it('remembers the high-water mark after everything has closed', () => {
    const open = [netOpen('gen', '1'), netOpen('gen', '2'), netOpen('img', '3'), netOpen('mark', '4')];
    expect(netSnapshot().peak).toBe(4);
    for (const close of open) close();
    const s = netSnapshot();
    expect(s.n).toBe(0);
    expect(s.peak).toBe(4);
  });

  it('a closer called twice does not take the count negative', () => {
    const close = netOpen('gen', 'twice');
    close();
    close();
    const other = netOpen('img', 'after');
    expect(netSnapshot().n).toBe(1);
    other();
    expect(netSnapshot().n).toBe(0);
  });

  it('writes one line naming every open request and why it was asked', () => {
    netOpen('gen', 'app g7');
    netOpen('img', 'icons');
    const note = netNote('app photos opening');
    expect(note).toContain('connections: 2 open');
    expect(note).toContain('1 gen, 1 img');
    expect(note).toContain('app photos opening');
    expect(note).toContain('gen:app g7');
  });

  it('resets for the next page, peak included', () => {
    netOpen('gen', 'a');
    resetNet();
    expect(netSnapshot()).toMatchObject({ n: 0, peak: 0 });
  });
});
