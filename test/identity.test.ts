import { describe, it, expect } from 'vitest';
import {
  ARCHETYPES,
  BootIdentityGate,
  IDENTITY_BUDGET_CHARS,
  coerceBootIdentity,
  findIdentityComment,
  isArchetype,
  renderIdentityComment,
  validIdentityPayload,
} from '../server/identity.js';

const GOOD = {
  name: 'TALLOW 4',
  tagline: 'it renders what it remembers',
  version: '4.1',
  era: '1994-adjacent',
  personality: 'apologetic',
  palette_words: ['bone', 'signal green'],
  font_words: ['condensed'],
  mascot: 'a moth',
  boot_message: 'waking',
  archetype: 'taskbar' as const,
};

describe('I1 — the identity comment', () => {
  it('round-trips through render and parse', () => {
    const line = renderIdentityComment(GOOD);
    expect(line.startsWith('<!--os-identity:')).toBe(true);
    expect(line.endsWith('-->')).toBe(true);
    const found = findIdentityComment(line + '<!doctype html><html>');
    expect(found).not.toBeNull();
    expect((found!.json as any).name).toBe('TALLOW 4');
    expect((found!.json as any).archetype).toBe('taskbar');
  });

  it('cannot be closed early by a value containing -->', () => {
    const line = renderIdentityComment({ ...GOOD, tagline: 'a --> b', mascot: '<script>x</script>' });
    // exactly one closing sequence, and it is the real one
    expect(line.split('-->').length - 1).toBe(1);
    const found = findIdentityComment(line);
    expect((found!.json as any).tagline).toBe('a --> b');
  });

  /**
   * v0.2. BAKEOFF-2 measured 25% UNNAMED on cerebras, and part of the cause was
   * this function: all-or-nothing acceptance threw away a payload that was
   * missing ONE defaultable field and bought a second call for it. Name and
   * tagline are the character and are required; 5 of the other 7 fields must be
   * usable; everything else is coerced.
   */
  it('requires a name and a tagline, and tolerates one missing extra', () => {
    expect(validIdentityPayload(GOOD)).toBe(true);
    // the two that make an OS characterless
    expect(validIdentityPayload({ ...GOOD, name: '' })).toBe(false);
    expect(validIdentityPayload({ ...GOOD, name: '   ' })).toBe(false);
    expect(validIdentityPayload({ ...GOOD, tagline: undefined })).toBe(false);
    expect(validIdentityPayload(null)).toBe(false);
    expect(validIdentityPayload('{"name":"x"')).toBe(false);
    expect(validIdentityPayload([GOOD])).toBe(false);
    // one absence each is survivable — coerceIdentity has a default for it and
    // a second round trip costs more than the default is worth
    for (const k of ['version', 'era', 'personality', 'boot_message', 'palette_words', 'font_words', 'archetype']) {
      expect(validIdentityPayload({ ...GOOD, [k]: undefined }), k).toBe(true);
    }
    // a mistyped archetype is one absence, not a dead identity: archetypeOf
    // draws one from the seed
    expect(validIdentityPayload({ ...GOOD, archetype: 'launcher' })).toBe(true);
    // but a payload that is mostly absent IS worth a call
    expect(validIdentityPayload({ name: 'X', tagline: 'y' })).toBe(false);
    expect(validIdentityPayload({ name: 'X', tagline: 'y', era: '1990s', version: '1' })).toBe(false);
    expect(validIdentityPayload({ ...GOOD, palette_words: [], font_words: [], era: '', version: '' })).toBe(false);
    // mascot is the one field whose wrong type is fatal (it is free text we forward)
    expect(validIdentityPayload({ ...GOOD, mascot: 7 })).toBe(false);
    const { mascot, ...noMascot } = GOOD;
    expect(validIdentityPayload(noMascot)).toBe(true);
  });

  it('reads the comment a model actually writes, not the one we specified', () => {
    const ok = (text: string, why: string) => {
      const f = findIdentityComment(text);
      expect(f, why).not.toBeNull();
      expect((f!.json as any)?.name, why).toBe('TALLOW 4');
    };
    const body = JSON.stringify(GOOD);
    ok(`<!--os-identity:${body}-->`, 'exactly as specified');
    ok(`<!-- os-identity: ${body} -->`, 'whitespace inside the comment');
    ok(`<!--OS-Identity:${body}-->`, 'different case');
    ok(`<!--os_identity:${body}-->`, 'an underscore');
    ok('<!--os-identity:```json\n' + body + '\n```-->', 'a fenced body');
    ok(`<!--os-identity:${body.replace('}', ',}')}-->`, 'a trailing comma');
    ok(`<!--os-identity:${body.replace('"it renders', '\u201cit renders').replace("remembers\"", 'remembers\u201d')}-->`, 'smart quotes');
    ok(`<!doctype html>\n<!--os-identity:${body}-->`, 'after the doctype');
    // the failure that cost a whole identity: --> inside a value
    const raw = JSON.stringify({ ...GOOD, tagline: 'TALLOW 4', mascot: 'a moth --> a lamp' });
    const f = findIdentityComment(`<!--os-identity:${raw}-->`);
    expect((f!.json as any).mascot).toBe('a moth --> a lamp');
    // a body cut off mid-object is closed and read
    const cut = body.slice(0, body.indexOf('"mascot"'));
    ok(`<!--os-identity:${cut}-->`, 'truncated mid-object');
  });

  it('always produces an archetype when it has to coerce', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const id = coerceBootIdentity({}, seed);
      expect(isArchetype(id.archetype)).toBe(true);
      expect(id.name.length).toBeGreaterThan(0);
    }
    expect(ARCHETYPES.length).toBe(2);
  });

  it('clamps a hostile identity down to the contract sizes', () => {
    const id = coerceBootIdentity({ ...GOOD, personality: 'x'.repeat(22_000), palette_words: Array(50).fill('y'.repeat(300)) }, 's');
    expect(id.personality.length).toBeLessThanOrEqual(200);
    expect(id.palette_words.length).toBeLessThanOrEqual(8);
    expect(renderIdentityComment(id).length).toBeLessThan(3000);
  });
});

describe('I1 — the boot gate', () => {
  /**
   * The gate stops accepting the moment it decides — in the server the rest of
   * the stream goes through the HTML filter instead — so a chunked feed only
   * keeps whatever arrived in the deciding chunk. Both are exercised below.
   */
  const feed = (gate: BootIdentityGate, text: string, size = 7) => {
    for (let i = 0; i < text.length; i += size) if (gate.push(text.slice(i, i + size))) return true;
    return gate.settled();
  };

  it('holds only until the comment closes, then hands back the rest', () => {
    const gate = new BootIdentityGate('seed');
    const doc = renderIdentityComment(GOOD) + '\n<!doctype html><html><body>hi</body></html>';
    expect(gate.push(doc)).toBe(true);
    const r = gate.result();
    expect(r.identity!.name).toBe('TALLOW 4');
    expect(r.rest).toContain('<!doctype html>');
    expect(r.rest).not.toContain('os-identity');
  });

  it('does not decide while the comment is still open', () => {
    const gate = new BootIdentityGate('seed');
    expect(gate.push('<!--os-identity:{"name":"X"')).toBe(false);
    expect(gate.settled()).toBe(false);
  });

  it('gives up after the token budget and says so, so the server can fall back', () => {
    const gate = new BootIdentityGate('seed');
    expect(feed(gate, '<!doctype html>' + 'x'.repeat(IDENTITY_BUDGET_CHARS), 200)).toBe(true);
    const r = gate.result();
    expect(r.identity).toBeNull();
    expect(r.rest.startsWith('<!doctype html>')).toBe(true);
  });

  it('treats an unparseable comment as no comment, and removes it', () => {
    const gate = new BootIdentityGate('seed');
    gate.push('<!--os-identity:{"name":"X", oh dear-->\n<!doctype html><p>x');
    const r = gate.result();
    expect(r.identity).toBeNull();
    expect(r.rest).not.toContain('os-identity');
    expect(r.rest).toContain('<!doctype html>');
  });

  it('accepts a valid-JSON comment with a bad archetype and draws one from the seed', () => {
    const gate = new BootIdentityGate('seed');
    gate.push(`<!--os-identity:${JSON.stringify({ ...GOOD, archetype: 'sidebar' })}-->\n<!doctype html>`);
    const r = gate.result();
    expect(r.identity!.name).toBe('TALLOW 4');
    expect(['taskbar', 'dock']).toContain(r.identity!.archetype);
  });

  it('says WHY it failed, so a telemetry line can name the failure class', () => {
    const fail = (text: string) => {
      const g = new BootIdentityGate('seed', 1 << 16);
      g.push(text);
      return g.result();
    };
    expect(fail('<!doctype html><p>no comment at all').fail).toBe('missing');
    expect(fail('').fail).toBe('missing');
    expect(fail('<!--os-identity:{oh dear, not json at all-->\n<!doctype html>').fail).toBe('bad-json');
    expect(fail(`<!--os-identity:{"name":"X"}-->\n<!doctype html>`).fail).toBe('invalid');
  });

  it('reads a model that wrote the JSON with no comment wrapper at all', () => {
    const g = new BootIdentityGate('seed', 1 << 16);
    g.push('```json\n' + JSON.stringify(GOOD) + '\n```\n<!doctype html><p>hi');
    const r = g.result();
    expect(r.identity!.name).toBe('TALLOW 4');
    expect(r.rest).toContain('<!doctype html>');
    expect(r.rest).not.toContain('TALLOW 4');
  });

  it('does not mistake an object inside the boot document for an identity', () => {
    const g = new BootIdentityGate('seed', 1 << 16);
    const doc = `<!doctype html><script>var x = ${JSON.stringify({ ...GOOD, name: 'INSIDE' })}</script>`;
    g.push(doc);
    const r = g.result();
    expect(r.identity).toBeNull();
    expect(r.rest).toBe(doc); // untouched: nothing was cut out of the document
  });

  it('stops holding the stream once the document has plainly started without a comment', () => {
    // v0.1 held the first 1,600 characters of every comment-less boot hostage
    const gate = new BootIdentityGate('seed');
    const doc = '<!doctype html><html><head><style>' + 'a{color:red}'.repeat(20) + '</style>';
    expect(gate.push(doc)).toBe(true);
    expect(gate.buffered().length).toBeLessThan(IDENTITY_BUDGET_CHARS);
    // ...but a comment that is still arriving is still waited for
    const g2 = new BootIdentityGate('seed');
    expect(g2.push('<!doctype html>' + 'x'.repeat(200) + '<!--os-ident')).toBe(false);
  });
});
