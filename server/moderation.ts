import { createHash } from 'node:crypto';

/**
 * SPEC §1.4 / §8 — the only categories that fire are `sexual` and `sexual/minors`.
 * A hit never produces a refusal: the caller sets rerouted:true and the page prompt
 * renders a wholesome, unrelated site at the same shape. The string itself is never
 * logged; only a hash.
 */

export interface ModerationResult {
  flagged: boolean;
  source: 'openai' | 'local' | 'off';
  hash: string;
  /** more user text than MAX_CHUNKS windows: treated as a hit, never waved through */
  overflow: boolean;
}

const ADULT_DOMAINS = [
  'pornhub', 'xvideos', 'xhamster', 'xnxx', 'redtube', 'youporn', 'brazzers', 'onlyfans',
  'chaturbate', 'stripchat', 'bongacams', 'spankbang', 'motherless', 'rule34', 'e-hentai',
  'nhentai', 'fansly', 'manyvids', 'camsoda', 'myfreecams', 'tnaflix', 'beeg', 'erome',
];

const SEXUAL_TERMS = [
  'porn', 'porno', 'pornography', 'xxx', 'hentai', 'nsfw', 'nudes', 'nude pics', 'naked girls',
  'naked women', 'naked men', 'blowjob', 'handjob', 'anal sex', 'cum', 'creampie', 'milf',
  'escort service', 'escorts', 'camgirl', 'cam girls', 'sex tape', 'sexcam', 'fuck videos',
  'erotica', 'erotic stories', 'bdsm', 'fetish porn', 'incest', 'bestiality', 'rule34',
];

const MINOR_TERMS = ['child', 'children', 'kid', 'kids', 'toddler', 'minor', 'underage', 'preteen', 'teen', 'teens', '12yo', '13yo', '14yo', '15yo', '16yo', '17yo', 'schoolgirl', 'schoolboy'];
const MINOR_SEXUAL_PHRASES = ['cp', 'csam', 'loli', 'lolicon', 'shota', 'shotacon', 'jailbait', 'child porn', 'childporn', 'pedo', 'pedophile'];

/**
 * The hash that appears in telemetry. Salted: URLs and search queries are
 * low-entropy, so an unsalted SHA-256 prefix of "what a visitor typed" is
 * reversible by dictionary — which is exactly the log SPEC §8 forbids.
 */
export function hashString(s: string, salt = process.env.MOD_SALT || process.env.IP_SALT || 'hallucinos'): string {
  return createHash('sha256').update(salt + '|' + s).digest('hex').slice(0, 16);
}

/** The local fallback list — used when OPENAI_API_KEY is absent (or MODERATION=local). */
export function localFlagged(input: string): boolean {
  const s = input.toLowerCase();
  const words = s.split(/[^a-z0-9]+/).filter(Boolean);
  const wordSet = new Set(words);

  for (const d of ADULT_DOMAINS) if (s.includes(d)) return true;
  for (const p of MINOR_SEXUAL_PHRASES) {
    if (p.length <= 3 ? wordSet.has(p) : s.includes(p)) return true;
  }
  for (const t of SEXUAL_TERMS) {
    if (t.includes(' ') ? s.includes(t) : wordSet.has(t)) return true;
  }
  // minor + sexual NEAR each other. Both sides match whole words only and have
  // to be within a few words of one another: substring matching turned every
  // host containing "sex" (essex, sussex, middlesex) plus any mention of
  // children into a silent reroute.
  const SEXUALISH = new Set(['sex', 'sexy', 'sexual', 'naked', 'nude', 'nudes', 'porn', 'xxx', 'erotic', 'erotica']);
  const minorWords = new Set(MINOR_TERMS);
  const minorAt: number[] = [];
  const sexualAt: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (minorWords.has(words[i])) minorAt.push(i);
    if (SEXUALISH.has(words[i])) sexualAt.push(i);
  }
  const NEAR = 3;
  for (const a of minorAt) for (const b of sexualAt) if (Math.abs(a - b) <= NEAR) return true;
  return false;
}

/**
 * Every user-controlled string reachable from one request, flattened. SPEC §8
 * lists the URL, the address bar, app params, search queries — all of which can
 * arrive nested (params.cmd[0]) or beside the URL (referer, history, a
 * client-supplied manifest shape), and none of which were being moderated.
 */
export function collectStrings(value: unknown, depth = 0, out: string[] = []): string[] {
  if (out.length >= MAX_STRINGS) return out;
  if (typeof value === 'string') {
    // NOT truncated here: a clamp at this layer is exactly how padding hid the
    // payload. Length is handled by chunkString(), which moderates all of it.
    if (value.trim()) out.push(value);
    return out;
  }
  if (depth >= 5) return out;
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 32)) collectStrings(v, depth + 1, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>).slice(0, 32)) collectStrings(v, depth + 1, out);
    return out;
  }
  return out;
}

/**
 * Moderation must see exactly what the prompt will carry. Long fields are cut
 * into overlapping windows rather than truncated, so a term cannot be hidden by
 * padding it past a character budget, and the overlap means a term straddling a
 * window boundary is still whole in one of them.
 */
export const MOD_CHUNK = 1500;
export const MOD_OVERLAP = 64;
/** Items collectStrings() will gather, and windows moderate() will inspect. */
export const MAX_STRINGS = 64;
export const MAX_CHUNKS = 96;

export function chunkString(s: string, size = MOD_CHUNK, overlap = MOD_OVERLAP): string[] {
  if (s.length <= size) return [s];
  const step = Math.max(1, size - overlap);
  const out: string[] = [];
  for (let i = 0; i < s.length; i += step) {
    out.push(s.slice(i, i + size));
    if (i + size >= s.length) break;
  }
  return out;
}

/** Every window that will be inspected, and whether there was more than we allow. */
export function moderationInputs(strings: string[]): { inputs: string[]; overflow: boolean } {
  const inputs: string[] = [];
  for (const s of strings.slice(0, MAX_STRINGS)) {
    for (const c of chunkString(s)) {
      if (inputs.length >= MAX_CHUNKS) return { inputs, overflow: true };
      inputs.push(c);
    }
  }
  return { inputs, overflow: strings.length > MAX_STRINGS };
}

/** Overridable so a test can point the remote half at a local fake; never set in production. */
export const MODERATION_ENDPOINT = () => process.env.MODERATION_ENDPOINT || 'https://api.openai.com/v1/moderations';

async function openAiFlagged(input: string[], key: string): Promise<boolean | null> {
  try {
    const res = await fetch(MODERATION_ENDPOINT(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'omni-moderation-latest', input }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const results: any[] = Array.isArray(json?.results) ? json.results : [];
    if (!results.length) return null;
    for (const r of results) {
      const cats = r?.categories || {};
      if (cats['sexual'] || cats['sexual/minors']) return true;
    }
    return false;
  } catch {
    return null;
  }
}

/**
 * Moderate the user-supplied strings of one generation. Any hit reroutes.
 * mode: 'auto' uses omni-moderation when a key is present and falls back to the
 * local list on any error; 'local' always uses the list; 'off' never fires.
 */
export async function moderate(
  strings: (string | undefined)[],
  mode: 'auto' | 'local' | 'off' = 'auto',
  key = process.env.OPENAI_API_KEY
): Promise<ModerationResult> {
  const kept = strings.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  const hash = kept.length ? hashString(kept.join('\n').slice(0, 4000)) : '';
  if (mode === 'off' || !kept.length) return { flagged: false, source: mode === 'off' ? 'off' : 'local', hash, overflow: false };

  const { inputs, overflow } = moderationInputs(kept);
  // More text than we are willing to inspect is refused, never waved through:
  // the old code joined everything and sliced to 4,000 characters, so 4 KB of
  // padding in the URL pushed history, params and identity out of the
  // moderated view while they still rendered into the prompt.
  if (overflow) return { flagged: true, source: 'local', hash, overflow: true };

  if (mode === 'auto' && key) {
    const remote = await openAiFlagged(inputs, key);
    if (remote !== null) return { flagged: remote, source: 'openai', hash, overflow: false };
  }
  return { flagged: inputs.some(localFlagged), source: 'local', hash, overflow: false };
}

/**
 * SPEC §12.1 — moderation comes OFF the critical path.
 *
 * The local list is microseconds and runs synchronously before the generation
 * starts. The remote call is ~200-600 ms, so it runs in parallel with the
 * generation: `moderateRemote()` is started and not awaited, and if it flags
 * after the stream has begun the caller aborts the stream and the kernel starts
 * the rerouted generation (SPEC calls this the rare path, and it may repaint).
 */

export interface LocalResult {
  flagged: boolean;
  hash: string;
  overflow: boolean;
  /** the windows the remote call should inspect, already chunked */
  inputs: string[];
}

/** Synchronous half: the local list. Never touches the network. */
export function moderateLocalSync(strings: (string | undefined)[], mode: 'auto' | 'local' | 'off' = 'auto'): LocalResult {
  const kept = strings.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  const hash = kept.length ? hashString(kept.join('\n').slice(0, 4000)) : '';
  if (mode === 'off' || !kept.length) return { flagged: false, hash, overflow: false, inputs: [] };
  const { inputs, overflow } = moderationInputs(kept);
  // More text than we are willing to inspect is refused, never waved through.
  if (overflow) return { flagged: true, hash, overflow: true, inputs };
  return { flagged: inputs.some(localFlagged), hash, overflow: false, inputs };
}

/**
 * Asynchronous half: omni-moderation. Returns null when it could not be reached
 * (the local verdict then stands), true/false otherwise. Never throws.
 */
export async function moderateRemote(inputs: string[], key = process.env.OPENAI_API_KEY): Promise<boolean | null> {
  if (!key || !inputs.length) return null;
  return openAiFlagged(inputs, key);
}
