import { describe, it, expect } from 'vitest';
import { Caps, RateBucket, isBotUa, hashIp, clientIpFrom } from '../server/caps.js';

describe('caps', () => {
  it('allows up to the hourly limit per ip and then queues', () => {
    let now = 1_000_000_000_000;
    const caps = new Caps(3, 100, Infinity, { now: () => now });
    expect(caps.take('a').allowed).toBe(true);
    expect(caps.take('a').allowed).toBe(true);
    expect(caps.take('a').allowed).toBe(true);
    const over = caps.take('a');
    expect(over.allowed).toBe(false);
    expect(over.reason).toBe('ip-hour');
    expect(over.retryAfter).toBeGreaterThan(0);
    expect(over.retryAfter).toBeLessThanOrEqual(3600);
    // a different visitor is unaffected
    expect(caps.take('b').allowed).toBe(true);
  });

  it('forgets hits older than an hour', () => {
    let now = 1_000_000_000_000;
    const caps = new Caps(1, 100, Infinity, { now: () => now });
    expect(caps.take('a').allowed).toBe(true);
    expect(caps.take('a').allowed).toBe(false);
    now += 3_600_001;
    expect(caps.take('a').allowed).toBe(true);
  });

  it('enforces the daily ceiling across everyone', () => {
    let now = Date.UTC(2026, 8, 17, 12, 0, 0);
    const caps = new Caps(100, 2, Infinity, { now: () => now });
    expect(caps.take('a').allowed).toBe(true);
    expect(caps.take('b').allowed).toBe(true);
    const over = caps.take('c');
    expect(over.allowed).toBe(false);
    expect(over.reason).toBe('day');
    expect(caps.dayCount()).toBe(2);
    now += 24 * 3600_000;
    expect(caps.take('c').allowed).toBe(true);
  });
});

describe('bot user agents', () => {
  it('blocks the crawlers and the scripts', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'GPTBot/1.0',
      'ClaudeBot/1.0',
      'curl/8.4.0',
      'Wget/1.21',
      'python-requests/2.31.0',
      'Scrapy/2.11',
      'Mozilla/5.0 HeadlessChrome/120.0.0.0',
      '',
      undefined,
    ]) {
      expect(isBotUa(ua as string)).toBe(true);
    }
  });

  it('lets real browsers through', () => {
    for (const ua of [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
    ]) {
      expect(isBotUa(ua)).toBe(false);
    }
  });
});

describe('ip hashing', () => {
  it('is stable, salted and not reversible to the address', () => {
    expect(hashIp('1.2.3.4', 's')).toBe(hashIp('1.2.3.4', 's'));
    expect(hashIp('1.2.3.4', 's')).not.toBe(hashIp('1.2.3.5', 's'));
    expect(hashIp('1.2.3.4', 's')).not.toContain('1.2.3.4');
  });
});

describe('the money cap (SPEC §1.8)', () => {
  it('refuses a generation whose worst case would cross the day ceiling', () => {
    let now = Date.UTC(2026, 8, 17, 12, 0, 0);
    const caps = new Caps(100, 100, 1, { now: () => now });
    expect(caps.affordable(0.4).allowed).toBe(true);
    caps.spend(0.4);
    caps.spend(0.4);
    expect(caps.dayUsd()).toBeCloseTo(0.8, 6);
    // 0.8 spent + a 0.4 worst case would be 1.2, over the $1 ceiling
    const over = caps.affordable(0.4);
    expect(over.allowed).toBe(false);
    expect(over.reason).toBe('usd');
    expect(over.retryAfter).toBeGreaterThan(0);
    // something small still fits
    expect(caps.affordable(0.1).allowed).toBe(true);
    // and a new day starts clean
    now += 24 * 3600_000;
    expect(caps.dayUsd()).toBe(0);
    expect(caps.affordable(0.9).allowed).toBe(true);
  });
});

describe('client address', () => {
  it('ignores X-Forwarded-For entirely unless a proxy of ours is trusted', () => {
    // Reachable directly (dev, a container port, an edge bypass) the header is
    // a client-controlled string, so the socket address is the only bucket.
    expect(clientIpFrom('10.0.0.9, 203.0.113.7', null, '127.0.0.1')).toBe('127.0.0.1');
    expect(clientIpFrom('203.0.113.7', '203.0.113.7', '127.0.0.1')).toBe('127.0.0.1');
  });

  it('reads the rightmost hop when the proxy IS trusted', () => {
    // one proxy (Railway's edge) appends the real address after whatever the
    // client sent: the real address is the LAST entry, never the first.
    const trusted = (xff: string) => clientIpFrom(xff, null, '127.0.0.1', 0, true);
    expect(trusted('10.0.0.9, 203.0.113.7')).toBe('203.0.113.7');
    expect(trusted('203.0.113.7')).toBe('203.0.113.7');
    // a client-forged chain still resolves to the same bucket
    expect(trusted('1.1.1.1, 203.0.113.7')).toBe(trusted('2.2.2.2, 203.0.113.7'));
  });

  it('honours extra trusted hops and falls back to the socket', () => {
    expect(clientIpFrom('10.0.0.9, 203.0.113.7, 10.1.0.2', null, '127.0.0.1', 1, true)).toBe('203.0.113.7');
    expect(clientIpFrom('', null, '198.51.100.4')).toBe('198.51.100.4');
    expect(clientIpFrom(undefined, '198.51.100.9', undefined, 0, true)).toBe('198.51.100.9');
    expect(clientIpFrom(undefined, undefined, undefined)).toBe('0.0.0.0');
  });

  it('a spoofed X-Forwarded-For does not create a new rate-limit bucket', () => {
    let now = 1_000_000_000_000;
    const caps = new Caps(2, 100, Infinity, { now: () => now });
    const bucket = (xff: string) => hashIp(clientIpFrom(xff, null, '203.0.113.7'), 'salt');
    // five requests from one machine, each inventing a different left-hand entry
    const results = ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4', '10.0.0.5'].map((fake) =>
      caps.take(bucket(`${fake}, 203.0.113.7`)).allowed
    );
    expect(results).toEqual([true, true, false, false, false]);
  });
});


/**
 * The blocker from the safety review: /api/img used to reserve against the same
 * in-flight counter as /api/gen, so twelve wallpapers holding their slots for
 * IMG_TIMEOUT_MS served every later visitor the kernel's over-capacity screen
 * while nothing was actually generating.
 */
describe('in-flight lanes', () => {
  it('keeps images out of the text lane in both directions', () => {
    const caps = new Caps(1000, 1000, Infinity, { maxConcurrent: 2, maxConcurrentImg: 2 });
    const imgs = [caps.reserve(0.003, 'img'), caps.reserve(0.003, 'img')];
    expect(imgs.every((r) => r.allowed)).toBe(true);
    // the image lane is full
    expect(caps.reserve(0.003, 'img')).toMatchObject({ allowed: false, reason: 'busy' });
    // and the text lane is untouched by it
    const gens = [caps.reserve(0.01), caps.reserve(0.01)];
    expect(gens.every((r) => r.allowed)).toBe(true);
    expect(caps.reserve(0.01)).toMatchObject({ allowed: false, reason: 'busy' });
    expect(caps.inFlight()).toBe(2);
    expect(caps.inFlightImg()).toBe(2);
    // settling an image frees an image slot, never a text one
    imgs[0].settle(0.003);
    expect(caps.inFlightImg()).toBe(1);
    expect(caps.inFlight()).toBe(2);
    expect(caps.reserve(0.003, 'img').allowed).toBe(true);
    expect(caps.reserve(0.01).allowed).toBe(false);
  });

  it('still holds both lanes against the one day ceiling', () => {
    const caps = new Caps(1000, 1000, 0.01, { maxConcurrent: 10, maxConcurrentImg: 10 });
    expect(caps.reserve(0.003, 'img').allowed).toBe(true);
    expect(caps.reserve(0.008).allowed).toBe(false);
  });
});

describe('the free-route rate bucket', () => {
  it('allows the hour’s worth and then refuses, per key', () => {
    let now = 1_000_000_000_000;
    const b = new RateBucket(2, () => now);
    expect(b.take('a')).toBe(true);
    expect(b.take('a')).toBe(true);
    expect(b.take('a')).toBe(false);
    expect(b.take('b')).toBe(true);
    now += 3_600_001;
    expect(b.take('a')).toBe(true);
  });
});
