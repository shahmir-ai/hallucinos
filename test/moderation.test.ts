import { describe, it, expect } from 'vitest';
import {
  localFlagged,
  moderate,
  hashString,
  collectStrings,
  moderationInputs,
  moderateLocalSync,
  MAX_CHUNKS,
} from '../server/moderation.js';

describe('local moderation fallback', () => {
  it('fires on obvious adult domains and terms', () => {
    for (const s of ['https://pornhub.com/', 'xvideos.com', 'free porn', 'hentai forum', 'onlyfans.com/x']) {
      expect(localFlagged(s)).toBe(true);
    }
  });

  it('fires on anything involving minors', () => {
    for (const s of ['child porn', 'loli art', 'jailbait forum', 'naked teen photos']) {
      expect(localFlagged(s)).toBe(true);
    }
  });

  it('leaves the rest of the internet alone', () => {
    for (const s of [
      'https://reddit.com/r/cats',
      'best pizza in town',
      'en.wikipedia.org/wiki/Moon',
      'sussex.gov.uk',
      'scunthorpe united',
      'analytics dashboard',
      'essex county council',
      'middlesex hospital',
      'teenage mutant ninja turtles',
      'child development milestones',
    ]) {
      expect(localFlagged(s)).toBe(false);
    }
  });
});

describe('moderate()', () => {
  it('uses the local list when told to, and never returns the string', async () => {
    const r = await moderate(['https://pornhub.com'], 'local');
    expect(r.flagged).toBe(true);
    expect(r.source).toBe('local');
    expect(r.hash).toBe(hashString('https://pornhub.com'));
    expect(JSON.stringify(r)).not.toContain('pornhub');
  });

  it('is a no-op when off', async () => {
    expect((await moderate(['https://pornhub.com'], 'off')).flagged).toBe(false);
  });

  it('ignores empty input', async () => {
    const r = await moderate([undefined, '', '  '], 'local');
    expect(r.flagged).toBe(false);
    expect(r.hash).toBe('');
  });

  it('falls back to the list when the remote call fails', async () => {
    const r = await moderate(['pornhub.com'], 'auto', 'sk-not-a-real-key-for-a-failing-call');
    expect(r.flagged).toBe(true);
    expect(r.source).toBe('local');
  });
});

describe('the local list does not reroute ordinary pages', () => {
  it('a county council page about children is not sexual content', () => {
    // 'essex' contains 'sex'; substring matching turned this into a silent reroute
    expect(localFlagged('https://www.essex.gov.uk/children-social-care')).toBe(false);
    expect(localFlagged('https://www.sussex.police.uk/child-protection')).toBe(false);
    expect(localFlagged('middlesex school kids sports day')).toBe(false);
    expect(localFlagged('https://scunthorpe.gov.uk/')).toBe(false);
  });

  it('still fires when a minor word and a sexual word are actually together', () => {
    expect(localFlagged('naked teen photos')).toBe(true);
    expect(localFlagged('child porn')).toBe(true);
    expect(localFlagged('teen sex videos')).toBe(true);
  });
});

describe('the moderated surface', () => {
  it('collects nested params, not just top-level strings', () => {
    const found = collectStrings({ cmd: ['write me hardcore porn'], n: 3, deep: { a: { b: 'hello' } } });
    expect(found).toContain('write me hardcore porn');
    expect(found).toContain('hello');
  });

  it('a flagged string nested in params reroutes', async () => {
    const strings = collectStrings({ cmd: ['open https://pornhub.com'] });
    expect((await moderate(strings, 'local')).flagged).toBe(true);
  });

  it('is bounded: a hostile object cannot make an unbounded moderation call', () => {
    const wide = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [String(i), 'x'.repeat(4000)]));
    const found = collectStrings(wide);
    expect(found.length).toBeLessThanOrEqual(64);
    // collectStrings deliberately does NOT truncate — a clamp there is how
    // padding used to hide a payload. The bound is on the WINDOWS that are
    // inspected, and more windows than we allow is a reroute, not a pass.
    const { inputs } = moderationInputs(found);
    expect(inputs.length).toBeLessThanOrEqual(MAX_CHUNKS);
  });

  it('refuses rather than waves through when there is more text than it will inspect', () => {
    // one very long string is windowed past the chunk ceiling: overflow is a
    // reroute, because the alternative is 200 KB of padding pushing the payload
    // out of the moderated view while it still renders into the prompt.
    const huge = ['x'.repeat(MAX_CHUNKS * 1500 + 5000)];
    expect(moderationInputs(huge).overflow).toBe(true);
    expect(moderateLocalSync(huge, 'local').flagged).toBe(true);
    expect(moderateLocalSync(huge, 'off').flagged).toBe(false);
  });
});

describe('the telemetry hash', () => {
  it('is salted, so a low-entropy query is not recoverable by dictionary', () => {
    const q = 'https://google.com/search?q=barnsley+fc';
    expect(hashString(q, 'salt-a')).not.toBe(hashString(q, 'salt-b'));
    expect(hashString(q, 'salt-a')).toBe(hashString(q, 'salt-a'));
  });
});
