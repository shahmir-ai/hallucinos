import { coerceIdentity, type Identity } from '../kernel/contract.js';

/**
 * SPEC §12.1 / interface I1 — the identity rides inside the boot stream.
 *
 * `kind=boot` output begins, before `<!doctype>`, with exactly one line:
 *   <!--os-identity:{ ...json... }-->
 * The kernel parses it the moment the closing `-->` lands and starts the
 * desktop and the image calls immediately, so there is no identity round trip.
 *
 * ROBUSTNESS. BAKEOFF-2 measured **one boot in four on `cerebras-oss120`
 * arriving as `UNNAMED/6BXG`** — the single biggest variety bug in the run. Two
 * things were wrong and both are here:
 *
 *  1. the reader was literal. `OPEN` had to match `<!--os-identity:` byte for
 *     byte, the body had to be strict JSON, and the FIRST `-->` was assumed to
 *     be the closing one. A space after `<!--`, a fenced body, a trailing
 *     comma, a smart quote, or an `-->` inside a tagline each cost a whole
 *     identity. `readIdentityComment` below is tolerant of all of those, and
 *     `findIdentityLoose` catches the model that wrote the JSON with no comment
 *     wrapper at all.
 *  2. acceptance was all-or-nothing. A payload missing only `boot_message` was
 *     thrown away entire and a second call bought, even though `coerceIdentity`
 *     has a sane default for it. Acceptance is now: a name and a tagline are
 *     required (they are the character), and 5 of the other 7 fields must be
 *     usable. Everything else is coerced.
 *
 * When the head really is unusable the server buys one `kind=identity` call on
 * the same engine — in JSON mode where the engine supports it, with one retry
 * (see `index.ts`) — and injects a valid comment at the top of the stream
 * itself. The kernel therefore always receives a valid comment first and never
 * has to implement a fallback of its own.
 */

export const ARCHETYPES = ['taskbar', 'dock'] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export interface BootIdentity extends Identity {
  archetype: Archetype;
}

export const OPEN = '<!--os-identity:';
export const CLOSE = '-->';

/** Tolerant opener: `<!--  os-identity :` and `<!--OS-IDENTITY:` both count. */
const OPEN_RE = /<!--\s*os[-_ ]?identity\s*:?/i;

/** 400 tokens of grace, in characters (SPEC's budget is in tokens; ~4 chars each). */
export const IDENTITY_BUDGET_CHARS = 1600;

const WANTED_TEXT = ['version', 'era', 'personality', 'boot_message'] as const;
const WANTED_LIST = ['palette_words', 'font_words'] as const;
/** of `WANTED_TEXT` + `WANTED_LIST` + archetype — 7 fields — this many must be usable */
export const WANTED_MIN = 5;

export function isArchetype(v: unknown): v is Archetype {
  return typeof v === 'string' && (ARCHETYPES as readonly string[]).includes(v);
}

const usableText = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;
const usableList = (v: unknown): boolean =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.trim().length > 0);

/**
 * Why a head was not usable, for the telemetry line (and for the sweep).
 *  - `missing`  no identity comment (and no loose JSON object) in the head
 *  - `bad-json` something that looked like the comment, whose body would not parse
 *  - `invalid`  parsed, but not enough of an identity to render a machine from
 */
export type IdentityFail = 'missing' | 'bad-json' | 'invalid';

/**
 * Is this payload usable as-is?
 *
 * Name and tagline are load-bearing: without them the visitor gets
 * `UNNAMED/xxxx` and "it boots.", which is the exact failure this function
 * exists to prevent. The rest have defaults in `coerceIdentity`, so a single
 * omission is not worth a second round trip — but a payload that is mostly
 * absent is, because `era: unknown` + `personality: terse` is a characterless
 * OS by another route.
 */
export function validIdentityPayload(v: unknown): v is BootIdentity {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (!usableText(o.name) || !usableText(o.tagline)) return false;
  if (o.mascot !== undefined && typeof o.mascot !== 'string') return false;
  let have = 0;
  for (const k of WANTED_TEXT) if (usableText(o[k])) have += 1;
  for (const k of WANTED_LIST) if (usableList(o[k])) have += 1;
  if (isArchetype(o.archetype)) have += 1;
  return have >= WANTED_MIN;
}

/** Clamp to the contract's field sizes and guarantee an archetype. */
export function coerceBootIdentity(v: unknown, seed: string, pick: () => number = Math.random): BootIdentity {
  const base = coerceIdentity(v, seed);
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const archetype: Archetype = isArchetype(o.archetype) ? o.archetype : ARCHETYPES[Math.floor(pick() * ARCHETYPES.length) % ARCHETYPES.length];
  return { ...base, archetype };
}

/**
 * The one line the kernel reads. `>` is escaped as `\u003e` (still valid JSON,
 * and `>` only ever occurs inside a string here) so no value can close the
 * comment early with a stray `-->`.
 */
export function renderIdentityComment(id: BootIdentity): string {
  const json = JSON.stringify(id).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `${OPEN}${json}${CLOSE}`;
}

/* ------------------------------------------------------------------ parsing */

/**
 * Parse JSON the way a language model writes it.
 *
 * Every step here is a failure mode seen in a real boot head, cheapest first.
 * Nothing eval-like: each repair is a textual transform followed by an ordinary
 * `JSON.parse`, so a hostile payload can still only become data.
 */
export function tolerantJsonParse(raw: string, allowTruncated = true): unknown {
  const attempts: string[] = [];
  const add = (s: string) => {
    const t = s.trim();
    if (t && !attempts.includes(t)) attempts.push(t);
  };
  const base = stripFencesLocal(raw).trim();
  add(base);
  // outermost object only: prose on either side of it is common
  const first = base.indexOf('{');
  const last = base.lastIndexOf('}');
  if (first >= 0 && last > first) add(base.slice(first, last + 1));
  for (const s of attempts.slice()) {
    add(repairJson(s));
    // Closing an unclosed object is the LAST resort and is opt-out, because it
    // turns a body that was cut off at the wrong `-->` into a plausible parse:
    // findIdentityComment needs one pass without it (see there).
    if (allowTruncated) add(repairJson(closeTruncated(s)));
  }
  for (const s of attempts) {
    try {
      const v = JSON.parse(s);
      if (v && typeof v === 'object') return v;
    } catch {
      /* next repair */
    }
  }
  throw new Error('no JSON object in response');
}

const stripFencesLocal = (s: string) => s.replace(/```[a-zA-Z0-9_-]*/g, '');

/**
 * The textual repairs, applied together: smart quotes, a raw newline inside a
 * string (illegal JSON, and gpt-oss writes them in taglines), trailing commas,
 * and `'single'` quoting of keys and values.
 */
export function repairJson(s: string): string {
  let out = s
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u2028\u2029]/g, ' ');
  // raw control characters inside strings: JSON forbids them, the model writes them
  out = out.replace(/"((?:[^"\\]|\\.)*)"/gs, (m) => m.replace(/[\n\r\t]+/g, ' '));
  // a trailing comma before a close
  out = out.replace(/,\s*([}\]])/g, '$1');
  // single-quoted strings, only when there is no double quote in sight to confuse
  if (!/"/.test(out)) out = out.replace(/'([^'\\]*)'/g, '"$1"');
  return out;
}

/** A body that stopped mid-object: close the open string, arrays and braces. */
export function closeTruncated(s: string): string {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (const ch of s) {
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\') {
      if (inStr) esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (!inStr && !stack.length) return s;
  let out = s.replace(/[,:]\s*$/, '');
  if (inStr) out += '"';
  while (stack.length) out += stack.pop() === '{' ? '}' : ']';
  return out;
}

export interface FoundComment {
  /** the parsed payload, whatever it is */
  json: unknown;
  /** index just past the closing --> */
  end: number;
  /** index of the opening <!--os-identity: */
  start: number;
}

/**
 * The first identity comment in `text`, or null when it has not closed yet.
 *
 * `-->` inside a value is why this tries every closing sequence rather than the
 * first: `tagline: "a --> b"` used to cost the whole identity. Our own writer
 * escapes `>`, a model's does not.
 */
export function findIdentityComment(text: string): FoundComment | null {
  const m = OPEN_RE.exec(text);
  if (!m) return null;
  const bodyFrom = m.index + m[0].length;
  const ends: number[] = [];
  for (let i = text.indexOf(CLOSE, bodyFrom); i >= 0; i = text.indexOf(CLOSE, i + 1)) {
    ends.push(i);
    if (ends.length >= 8) break;
  }
  if (!ends.length) return null;
  // Two passes. The first refuses to close an unclosed object, so a body cut
  // short at an `-->` INSIDE a value fails here and the next candidate close is
  // tried — which is the whole-value parse. Only when no candidate parses
  // cleanly does the second pass accept a repaired, truncated body.
  for (const truncOk of [false, true]) {
    for (const closeAt of ends) {
      try {
        return { json: tolerantJsonParse(text.slice(bodyFrom, closeAt), truncOk), start: m.index, end: closeAt + CLOSE.length };
      } catch {
        /* try the next --> */
      }
    }
  }
  // the comment is there and closed, but nothing in it parsed: report it as
  // found with a null payload so the caller can strip it and say `bad-json`.
  return { json: null, start: m.index, end: ends[0] + CLOSE.length };
}

/**
 * The model that ignored the comment wrapper entirely and just wrote the JSON
 * (seen on gpt-oss: a fenced ```json block, or a bare object, ahead of the
 * doctype). The object must carry a `name` for this to fire, so an unrelated
 * object in an inline script cannot be mistaken for an identity.
 */
export function findIdentityLoose(text: string): { json: unknown; start: number; end: number } | null {
  // Only ever ahead of the document. An object literal inside the boot screen's
  // own inline script is not an identity, and removing it from the stream (which
  // is what the caller does with a hit) would break the document.
  const doc = DOC_START.exec(text);
  const head = text.slice(0, Math.min(doc ? doc.index : text.length, IDENTITY_BUDGET_CHARS * 2));
  for (let i = head.indexOf('{'); i >= 0; i = head.indexOf('{', i + 1)) {
    const close = matchingBrace(head, i);
    const body = head.slice(i, close < 0 ? head.length : close + 1);
    if (!/"\s*name\s*"\s*:/.test(body) && !/\bname\s*:/.test(body)) continue;
    try {
      const json = tolerantJsonParse(body);
      if (json && typeof json === 'object' && usableText((json as any).name)) {
        return { json, start: i, end: close < 0 ? head.length : close + 1 };
      }
    } catch {
      /* not it */
    }
  }
  return null;
}

function matchingBrace(s: string, from: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\') {
      if (inStr) esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (!depth) return i;
    }
  }
  return -1;
}

export interface GateResult {
  /** the payload when the model produced a valid one; null means: go call kind=identity */
  identity: BootIdentity | null;
  /** everything after the comment (or the whole buffer when there was none) */
  rest: string;
  /** why it failed, when it did */
  fail?: IdentityFail;
}

const DOC_START = /<!doctype|<html[\s>]/i;

/**
 * Could a `<!--os-identity:` opener still be arriving, i.e. is the tail of the
 * buffer a prefix of one? Used to stop waiting for a comment that is plainly
 * not coming: a boot that opens straight into the document used to hold 1,600
 * characters of it hostage before the gate gave up.
 */
export function mightStillOpen(buf: string): boolean {
  const tail = buf.slice(-OPEN.length);
  for (let i = 0; i < tail.length; i++) {
    const suffix = tail.slice(i).toLowerCase();
    if ('<!--os-identity:'.startsWith(suffix)) return true;
    if ('<!-- os-identity:'.startsWith(suffix)) return true;
  }
  return false;
}

/**
 * Buffers the head of a boot stream until the identity comment closes, the
 * budget runs out, or the stream ends — and no longer. Everything after the
 * comment streams straight through.
 */
export class BootIdentityGate {
  private buf = '';
  private decided = false;

  constructor(
    private seed: string,
    private budget = IDENTITY_BUDGET_CHARS
  ) {}

  /** Feed upstream text. Returns true once the gate has decided. */
  push(text: string): boolean {
    if (this.decided) return true;
    this.buf += text;
    if (findIdentityComment(this.buf)) this.decided = true;
    else if (this.buf.length >= this.budget) this.decided = true;
    // The model opened the document without a comment and is not about to write
    // one. Decide now (the fallback call rescues the identity) rather than
    // holding the first 1,600 characters of a boot screen off the wire.
    else if (DOC_START.test(this.buf) && this.buf.length >= 160 && !OPEN_RE.test(this.buf) && !mightStillOpen(this.buf)) this.decided = true;
    return this.decided;
  }

  /** The gate has decided (or the stream ended and we are forcing a decision). */
  settled(): boolean {
    return this.decided;
  }

  buffered(): string {
    return this.buf;
  }

  result(pick: () => number = Math.random): GateResult {
    const found = findIdentityComment(this.buf);
    if (found && validIdentityPayload(found.json)) {
      return { identity: coerceBootIdentity(found.json, this.seed, pick), rest: this.buf.slice(found.end) };
    }
    // A malformed comment is removed rather than forwarded: the kernel is told
    // to expect exactly one, and a second (invalid) one would be read as the
    // authority by anything scanning from the top.
    const strip = (r: { start: number; end: number }) => this.buf.slice(0, r.start) + this.buf.slice(r.end);
    if (found) {
      // there IS a comment; it either did not parse or was not enough of one
      const fail: IdentityFail = found.json === null ? 'bad-json' : 'invalid';
      return { identity: null, rest: strip(found), fail };
    }
    // no comment at all — the model may still have written the JSON plainly
    const loose = findIdentityLoose(this.buf);
    if (loose && validIdentityPayload(loose.json)) {
      return { identity: coerceBootIdentity(loose.json, this.seed, pick), rest: strip(loose) };
    }
    return { identity: null, rest: this.buf, fail: loose ? 'invalid' : 'missing' };
  }
}
