/**
 * The shape contract (SPEC §3).
 *
 * SPEC §3.2 says validation runs on the parsed document. It runs here on a
 * *tokenised* one: the same code has to run in the kernel (browser) and in
 * vitest (node), and a DOM parser is only available in one of them. The
 * tokeniser is the part of parsing that matters for this job — it removes
 * comments, the bodies of <script> and <style>, and it only ever looks at
 * attribute names inside an element's opening tag. So a stylesheet rule
 * `[data-os-windows]{position:relative}`, a mention inside a script string, or
 * the kernel's own `<!--os-telemetry:{"missing":["[data-os-taskbar]"]}-->`
 * sentinel can no longer satisfy the contract.
 *
 * The kernel additionally re-checks the live DOM after mounting the desktop
 * (see kernel/inject.ts domMissing) — that check is the one that decides what
 * gets injected, so a validator mistake can never leave the OS without a
 * window layer.
 */
export type Kind = 'identity' | 'boot' | 'desktop' | 'app' | 'page' | 'repair';

export interface ContractResult {
  ok: boolean;
  missing: string[];
}

/** The kernel's own out-of-band comments are not part of the model's document. */
const SENTINEL_RE = /<!--os-(?:telemetry|error):[\s\S]*?-->/gi;

export function stripSentinels(html: string): string {
  return html.replace(SENTINEL_RE, ' ');
}

/**
 * Remove everything that is not markup: comments (the sentinels included) and
 * the raw-text bodies of <script>, <style> and <textarea>.
 */
export function stripInert(html: string): string {
  return html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?(?:<\/style\s*>|$)/gi, ' ')
    .replace(/<textarea\b[^>]*>[\s\S]*?(?:<\/textarea\s*>|$)/gi, ' ');
}

/**
 * The opening tags of the document, with comments and raw text already gone.
 *
 * Quote-aware on purpose: `/<[a-zA-Z][^>]*>/` ends a tag at the first `>`
 * character, including one inside a quoted attribute value — which is legal
 * HTML and exactly what voice.md §8 invites by telling the model that inline
 * handlers work. `<div title="width > 50%" data-os-windows>` then lost every
 * attribute after the `>`, the validator reported a hook that was there, and the
 * kernel bought a repair generation and stamped contract_ok:false on it.
 */
function tagsOf(html: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    const c = html.charCodeAt(lt + 1);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) {
      i = lt + 1;
      continue;
    }
    let quote = 0;
    let prev = 0; // last non-space character seen inside the tag
    let end = -1;
    for (let j = lt + 1; j < html.length; j++) {
      const ch = html.charCodeAt(j);
      if (quote) {
        if (ch === quote) quote = 0;
        continue;
      }
      // a quote opens a value only straight after `=`; an apostrophe inside an
      // unquoted value (title=don't) must not swallow the rest of the document
      if ((ch === 34 || ch === 39) && prev === 61) {
        quote = ch;
      } else if (ch === 62) {
        end = j;
        break;
      }
      if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) prev = ch;
    }
    if (end < 0) {
      out.push(html.slice(lt));
      break;
    }
    out.push(html.slice(lt, end + 1));
    i = end + 1;
  }
  return out;
}

/**
 * The same tag with every quoted attribute VALUE blanked, so an attribute name
 * is only ever found where it really is one. Without this the mirror-image
 * false positive holds: `<div title="no data-os-taskbar here">` validated as a
 * taskbar.
 */
function attrNamesOnly(tag: string): string {
  return tag.replace(/=\s*"[^"]*"/g, '=""').replace(/=\s*'[^']*'/g, "=''");
}

/** True when `attr` appears as an attribute NAME on some element's opening tag. */
function hasAttrIn(tags: string[], attr: string): boolean {
  const re = new RegExp(`[\\s/]${attr}(?=[\\s/>=]|$)`, 'i');
  for (const t of tags) if (re.test(attrNamesOnly(t))) return true;
  return false;
}

const APP_ATTR_RE = /[\s/]data-os-app\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/** Every id used as a `data-os-app` launcher, read from attribute values only. */
function appIdsIn(tags: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of tags) {
    const m = APP_ATTR_RE.exec(t);
    if (m) out.add((m[1] ?? m[2] ?? m[3] ?? '').trim());
  }
  return out;
}

/** Contents of the first <template ... data-os-window ...> ... </template>, or null. */
export function windowTemplate(html: string): string | null {
  const m = /<template[^>]*\bdata-os-window\b[^>]*>([\s\S]*?)<\/template>/i.exec(stripInert(stripSentinels(html)));
  return m ? m[1] : null;
}

export function taskTemplate(html: string): string | null {
  const m = /<template[^>]*\bdata-os-task\b[^>]*>([\s\S]*?)<\/template>/i.exec(stripInert(stripSentinels(html)));
  return m ? m[1] : null;
}

const ARCHETYPE_ATTR_RE = /[\s/]data-os-archetype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/** The archetype the document declares, read from attribute values only (SPEC §12.3). */
export function archetypeIn(htmlRaw: string): string | null {
  const tags = tagsOf(stripInert(stripSentinels(htmlRaw)));
  for (const t of tags) {
    const m = ARCHETYPE_ATTR_RE.exec(t);
    if (m) return (m[1] ?? m[2] ?? m[3] ?? '').trim().toLowerCase();
  }
  return null;
}

/**
 * SPEC §3.2, plus the §12.3 archetype hooks.
 *
 * The archetype check fires only when an expected archetype is passed in: the
 * server validates the same text without an identity in hand, and a hook it
 * cannot evaluate must not be reported as missing. The kernel passes the
 * identity's own archetype, and the live-DOM check in inject.ts domMissing() is
 * still the authority for what gets patched.
 */
export function validateDesktop(htmlRaw: string, appIds: string[] = [], archetype?: string): ContractResult {
  const html = stripInert(stripSentinels(htmlRaw));
  const tags = tagsOf(html);
  const missing: string[] = [];
  for (const a of ['data-os-desktop', 'data-os-windows', 'data-os-taskbar']) {
    if (!hasAttrIn(tags, a)) missing.push(`[${a}]`);
  }
  // The clock (SPEC §12.3, I5) needs no identity to evaluate, so it is checked
  // on both sides of the wire; only the archetype *value* needs one.
  if (!hasAttrIn(tags, 'data-os-clock')) missing.push('[data-os-clock]');
  if (archetype) {
    const got = archetypeIn(htmlRaw);
    if (got !== archetype) missing.push(`[data-os-archetype="${archetype}"]`);
  }

  const winM = /<template[^>]*\bdata-os-window\b[^>]*>([\s\S]*?)<\/template>/i.exec(html);
  if (!winM) {
    missing.push('template[data-os-window]');
  } else {
    const winTags = tagsOf(winM[1]);
    for (const a of ['data-os-title', 'data-os-content', 'data-os-close', 'data-os-drag']) {
      if (!hasAttrIn(winTags, a)) missing.push(`template[data-os-window] [${a}]`);
    }
  }

  const taskM = /<template[^>]*\bdata-os-task\b[^>]*>([\s\S]*?)<\/template>/i.exec(html);
  if (!taskM) {
    missing.push('template[data-os-task]');
  } else if (!hasAttrIn(tagsOf(taskM[1]), 'data-os-title')) {
    missing.push('template[data-os-task] [data-os-title]');
  }

  const present = appIdsIn(tags);
  for (const id of appIds) if (!present.has(id)) missing.push(`[data-os-app="${id}"]`);
  return { ok: missing.length === 0, missing };
}

/** SPEC §3.3 — only the browser app has required hooks. */
export function validateApp(htmlRaw: string, appId: string): ContractResult {
  const missing: string[] = [];
  if (appId === 'browser') {
    const tags = tagsOf(stripInert(stripSentinels(htmlRaw)));
    if (!hasAttrIn(tags, 'data-os-page')) missing.push('[data-os-page]');
    if (!hasAttrIn(tags, 'data-os-url')) missing.push('[data-os-url]');
  }
  return { ok: missing.length === 0, missing };
}

export function validate(kind: Kind, html: string, opts: { appIds?: string[]; appId?: string; archetype?: string } = {}): ContractResult {
  if (kind === 'desktop') return validateDesktop(html, opts.appIds || [], opts.archetype);
  if (kind === 'app') return validateApp(html, opts.appId || '');
  return { ok: true, missing: [] };
}

/** SPEC §12.3: the desktop archetype the model picked. */
export const ARCHETYPES = ['taskbar', 'dock'] as const;
export type Archetype = (typeof ARCHETYPES)[number];

/** Identity JSON shape (SPEC §3.1 + §12.3 archetype). Missing fields are filled, never rejected. */
export interface Identity {
  name: string;
  tagline: string;
  version: string;
  era: string;
  personality: string;
  palette_words: string[];
  font_words: string[];
  mascot?: string;
  boot_message: string;
  /** which desktop structure this machine follows (SPEC §12.3) */
  archetype: Archetype;
}

/**
 * The identity comment the boot stream opens with (INTERFACE I1):
 * `<!--os-identity:{...}-->` before `<!doctype`. The server guarantees a valid
 * one arrives first; this is the reader.
 */
export const IDENTITY_OPEN = '<!--os-identity:';

export interface IdentityScan {
  /** JSON text between the marker and the closing `-->`, when the comment is complete */
  json: string | null;
  /** index just past the closing `-->`, or -1 */
  end: number;
  /** the comment has started but has not closed yet */
  partial: boolean;
}

export function scanIdentityComment(text: string): IdentityScan {
  const i = text.indexOf(IDENTITY_OPEN);
  if (i < 0) return { json: null, end: -1, partial: false };
  const close = text.indexOf('-->', i + IDENTITY_OPEN.length);
  if (close < 0) return { json: null, end: -1, partial: true };
  return { json: text.slice(i + IDENTITY_OPEN.length, close), end: close + 3, partial: false };
}

/**
 * Field sizes. The identity is client-supplied on every non-identity generation
 * (the kernel round-trips it), and unclamped it was both an input-token
 * amplifier — 22 KB of `personality` doubled tokens_in on every request — and a
 * way into the desktop/boot/app system prompt.
 */
export const IDENTITY_LIMITS = { text: 200, word: 40, words: 8 };

export function coerceIdentity(v: unknown, seed: string): Identity {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const cut = (s: string, n: number) => s.replace(/[\r\n\u2028\u2029]+/g, ' ').slice(0, n);
  const str = (k: string, d: string) =>
    typeof o[k] === 'string' && o[k] ? cut(o[k] as string, IDENTITY_LIMITS.text) : d;
  const arr = (k: string, d: string[]) =>
    Array.isArray(o[k]) && (o[k] as unknown[]).length
      ? (o[k] as unknown[]).slice(0, IDENTITY_LIMITS.words).map((x) => cut(String(x), IDENTITY_LIMITS.word))
      : d;
  return {
    name: str('name', 'UNNAMED/' + seed.slice(0, 4).toUpperCase()),
    tagline: str('tagline', 'it boots.'),
    version: str('version', '1.0'),
    era: str('era', 'unknown'),
    personality: str('personality', 'terse'),
    palette_words: arr('palette_words', ['grey', 'amber']),
    font_words: arr('font_words', ['monospace']),
    mascot: typeof o.mascot === 'string' ? cut(o.mascot as string, IDENTITY_LIMITS.text) : undefined,
    boot_message: str('boot_message', 'starting up'),
    archetype: archetypeOf(o.archetype, seed),
  };
}

/**
 * The model picks the archetype (SPEC §12.3). When it does not, the fallback is
 * drawn from the seed rather than pinned to one value: a constant default would
 * make every fallback machine a Windows-shaped one.
 */
function archetypeOf(v: unknown, seed: string): Archetype {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if ((ARCHETYPES as readonly string[]).includes(s)) return s as Archetype;
  let n = 0;
  for (let i = 0; i < seed.length; i++) n = (n + seed.charCodeAt(i)) % 2;
  return n === 0 ? 'taskbar' : 'dock';
}

/** Every string of an identity, for moderation (SPEC §8). */
export function identityStrings(id: Identity | null | undefined): string[] {
  if (!id) return [];
  return [id.name, id.tagline, id.version, id.era, id.personality, id.boot_message, id.mascot || '', ...id.palette_words, ...id.font_words].filter(
    (s) => typeof s === 'string' && s.trim().length > 0
  );
}

/** The next version in a lineage: bump the last integer it contains (SPEC §4, update app). */
export function nextVersion(v: string): string {
  const s = String(v || '1.0');
  const m = /(\d+)(?!.*\d)/.exec(s);
  if (!m) return s + ' II';
  const n = String(Number(m[1]) + 1);
  return s.slice(0, m.index) + n + s.slice(m.index + m[1].length);
}
