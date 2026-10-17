import { describe, it, expect } from 'vitest';
import { BootMemory } from '../server/sessions.js';
import { coerceBootIdentity } from '../server/identity.js';

const ID = coerceBootIdentity({ name: 'SALTWORKS', tagline: 'weigh it twice' }, 's');

describe('what the server remembers about a boot', () => {
  it('finds one boot under any of its names', () => {
    const m = new BootMemory();
    m.rememberIdentity({ seed: 'sd', session: 'sess', client: 'ip' }, ID);
    expect(m.resolve({ seed: 'sd' })?.identity?.name).toBe('SALTWORKS');
    expect(m.resolve({ session: 'sess' })?.identity?.name).toBe('SALTWORKS');
    // the alias that actually fires today: /api/img knows the session id and the
    // IP, and the kernel does not send the seed with a boot image
    expect(m.resolve({ client: 'ip' })?.identity?.name).toBe('SALTWORKS');
    expect(m.resolve({ seed: 'other' })).toBeNull();
    expect(m.resolve({})).toBeNull();
  });

  it('keeps the seed, so the dice replay rather than being rolled twice', () => {
    const m = new BootMemory();
    m.rememberIdentity({ seed: 'sd', client: 'ip' }, ID);
    expect(m.resolve({ client: 'ip' })?.seed).toBe('sd');
  });

  it('joins the desktop chunk and the identity onto one record across requests', () => {
    const m = new BootMemory();
    // the boot generation carries the seed AND the session; the desktop
    // generation that follows carries the same pair
    m.rememberIdentity({ seed: 'sd', session: 'sess', client: 'ip' }, ID);
    m.noteDesktopStarted({ seed: 'sd', session: 'sess', client: 'ip' });
    const rec = m.resolve({ session: 'sess' })!;
    expect(rec.identity?.name).toBe('SALTWORKS');
    expect(rec.desktopStarted).toBe(true);
  });

  it('BAKEOFF-2 finding 6 — the icon sheet waits for the desktop and gives up', async () => {
    const m = new BootMemory();
    m.rememberIdentity({ seed: 'sd', client: 'ip' }, ID);
    // not started: the wait times out and the caller refuses the image
    expect(await m.waitForDesktop({ client: 'ip' }, 20)).toBe(false);
    // started while waiting: the wait resolves immediately, no polling
    const pending = m.waitForDesktop({ client: 'ip' }, 5000);
    m.noteDesktopStarted({ seed: 'sd', client: 'ip' });
    expect(await pending).toBe(true);
    // and afterwards it is instant
    expect(await m.waitForDesktop({ client: 'ip' }, 0)).toBe(true);
  });

  it('refuses instantly for a boot it has never heard of', async () => {
    const m = new BootMemory();
    const t0 = Date.now();
    expect(await m.waitForDesktop({ client: 'nobody' }, 5000)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('forgets a boot after the TTL rather than serving a stale machine', () => {
    let now = 1000;
    const m = new BootMemory(100, 1000, () => now);
    m.rememberIdentity({ seed: 'sd', client: 'ip' }, ID);
    now += 999;
    expect(m.resolve({ client: 'ip' })?.identity).toBeTruthy();
    now += 2;
    expect(m.resolve({ client: 'ip' })).toBeNull();
  });

  it('is bounded, so a busy day cannot grow it without limit', () => {
    const m = new BootMemory(50);
    for (let i = 0; i < 400; i++) m.rememberIdentity({ seed: 's' + i, session: 'x' + i, client: 'c' + i }, ID);
    expect(m.size()).toBeLessThanOrEqual(50);
    // the newest survives, the oldest is gone
    expect(m.resolve({ seed: 's399' })).toBeTruthy();
    expect(m.resolve({ seed: 's0' })).toBeNull();
  });
});
