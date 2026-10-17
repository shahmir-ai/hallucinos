import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { ROOT } from './env.js';

/**
 * SPEC §12.4 — identity variety is the SERVER's job, not the model's.
 *
 * Two Haiku boots in a row named themselves "Meridian 2.x" with the word in no
 * prompt: the model's prior converges on its own. So the server rolls five dice
 * (`data/dice.json`, written by the prompt author) and hands them to the boot
 * prompt as hard constraints, and keeps a ring buffer of the last 200 names it
 * has seen so the prompt can say "never these".
 */

export interface Dice {
  era_decade: string[];
  setting: string[];
  temperament: string[];
  material_a: string[];
  material_b: string[];
  /**
   * S2, from BAKEOFF-2's variety read. Three dice added in v0.2:
   *
   *  - `naming_register` — the SHAPE of the name, not the name. Seven of nine
   *    boots welded two nouns together (SignalOak, QuarryDock, WindWatch): the
   *    settings varied and the register did not. >= 12 entries.
   *  - `strange_detail` — the "quietly wrong detail" seed. `prompts/system/
   *    voice.md` used to hand out three examples of it and every engine copied
   *    them verbatim every boot ("0.4 units" appeared in every OS in the run).
   *    Examples are attractors; a per-boot roll is not. >= 60 entries.
   *  - `wallpaper_motif` — what the wallpaper is OF. flux returned
   *    gallery-grade photographs of animals and hero objects, which are lovely
   *    and are not wallpapers. >= 40 entries, no animals, no hero objects.
   *
   * The prompt author owns the contents of `data/dice.json`; the server only
   * reads them, rolls one value each and renders them into {{dice_json}} (and,
   * for `wallpaper_motif`, into the server-built image prompt — S3).
   */
  naming_register: string[];
  strange_detail: string[];
  wallpaper_motif: string[];
}

export type Roll = Record<keyof Dice, string>;

/**
 * H5 — THE REALITY OFFSET.
 *
 * HANDOFF-4 issue 6, measured twice on the real engine: the encyclopedia now
 * invents the planet, the discoverer, the history and the named craters, and
 * still writes 384 400 km, 3 474.8 km, 7.347 x 10^22 kg and 27.321 days. Adding
 * "the numbers are the part that betrays it" to the prompt made the numbers
 * MORE precisely correct. A sentence does not beat a prior that strong.
 *
 * So the same mechanism §12.4 uses for identity: the SERVER rolls, once per
 * session, and the roll arrives as a hard constraint rather than a rule the
 * model has to remember. The lists are the prompt author's (data/dice.json ->
 * reality_offset, whose _shape field fixes the object rolled below); the scale
 * factor is rolled numerically rather than drawn from a list. The rendered
 * {{reality_json}} reaches kind=page and kind=app only — a boot screen and a
 * desktop have no measurements to be wrong about.
 */
export interface UnitSystem {
  name: string;
  /** exactly three, in the order distance, mass, duration */
  units: string[];
}

export interface RealityLists {
  calendar_quirk: string[];
  unit_system: UnitSystem[];
  /** both names of one pair are used together, so a session's two places belong to one world */
  place_pair: string[][];
  historical_event: string[];
  /** the scale factor is rolled numerically, not drawn from a list */
  scale_factor: { min: number; max: number; decimals: number };
}

/** The object `{{reality_json}}` renders to. Shape fixed by data/dice.json's `_shape`. */
export interface Reality {
  calendar: string;
  units: { name: string; unit_names: string[] };
  /** multiply every real-world measurement you know by this before writing it down */
  scale: number;
  places: string[];
  event: string;
}

export const REALITY_KEYS: (keyof RealityLists)[] = ['calendar_quirk', 'unit_system', 'place_pair', 'historical_event'];

/** `_shape`'s own minimums, asserted by a test against the real file. */
export const REALITY_MINIMUMS: Record<string, number> = {
  calendar_quirk: 40,
  unit_system: 40,
  place_pair: 60,
  historical_event: 60,
};

const REALITY_BUILTIN: RealityLists = {
  calendar_quirk: [
    'a ten day week, the tenth day unnamed',
    'thirteen months, the last one four days long',
    'the month is counted backwards to its end',
  ],
  unit_system: [
    { name: 'the Weighhouse Measure', units: ['strid', 'drachet', 'turn'] },
    { name: 'the Common Rule', units: ['prem', 'lode', 'bell'] },
    { name: 'the Old Reckoning', units: ['verge', 'quill', 'watch'] },
  ],
  place_pair: [
    ['Cold Harbour', 'Marran Fields'],
    ['Ostrel', 'Yarrowmouth'],
    ['Veldenhoek', 'Arret Bay'],
  ],
  historical_event: ['the Long Audit', 'the Quiet Partition', 'the Ledger Fire'],
  scale_factor: { min: 0.37, max: 2.9, decimals: 2 },
};


export const DICE_KEYS: (keyof Dice)[] = [
  'era_decade',
  'setting',
  'temperament',
  'material_a',
  'material_b',
  'naming_register',
  'strange_detail',
  'wallpaper_motif',
];

/** SPEC §12.4 / S2 minimum list lengths, asserted by a test against the real file. */
export const DICE_MINIMUMS: Record<keyof Dice, number> = {
  era_decade: 12,
  setting: 60,
  temperament: 30,
  material_a: 40,
  material_b: 40,
  naming_register: 12,
  strange_detail: 60,
  wallpaper_motif: 40,
};

/**
 * Stand-ins for a `data/dice.json` that is missing or malformed. Deliberately
 * short and dull: they exist so a keyless clone still boots with *some*
 * constraint, not to compete with the real lists.
 */
const BUILTIN: Dice = {
  era_decade: ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2030s', '2090s'],
  setting: ['a container ship', 'a rural dentistry', 'a customs office', 'an orbital greenhouse', 'a municipal swimming pool', 'a seed vault'],
  temperament: ['apologetic', 'officious', 'gleeful', 'exhausted', 'conspiratorial', 'maternal', 'bored', 'evangelical'],
  material_a: ['bakelite', 'wet slate', 'brushed brass', 'sailcloth', 'bone china', 'pressed felt', 'anodised aluminium'],
  material_b: ['beeswax', 'carbon fibre', 'corrugated iron', 'blown glass', 'lacquer', 'terracotta', 'oiled teak'],
  naming_register: [
    'a model number',
    'an acronym',
    'a single common word',
    "a person's first name",
    'a government codename',
    'two words with a space between them',
  ],
  strange_detail: [
    'a measurement given in the wrong unit',
    'a date that has not happened yet',
    'a setting that cannot be switched off',
    'a queue with one permanent entry',
    'a field labelled in a language nobody here reads',
    'a total that never changes',
  ],
  wallpaper_motif: [
    'overlapping soft gradients',
    'a repeating woven texture',
    'concentric rings',
    'a distant flat horizon',
    'diagonal ribbons',
    'a field of small squares',
    'layered translucent panels',
    'a blurred aurora',
  ],
};

const DICE_FILE = () => resolve(ROOT, 'data/dice.json');

let diceCache: { at: number; value: Dice } | null = null;
let realityCache: { at: number; value: RealityLists } | null = null;

/** Read `data/dice.json`, filling any key it does not supply from BUILTIN. */
export function loadDice(file = DICE_FILE(), ttlMs = 30_000): Dice {
  const now = Date.now();
  if (diceCache && now - diceCache.at < ttlMs) return diceCache.value;
  let raw: unknown = null;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    raw = null;
  }
  const value = coerceDice(raw);
  diceCache = { at: now, value };
  return value;
}

export function coerceDice(raw: unknown): Dice {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = {} as Dice;
  for (const k of DICE_KEYS) {
    const list = Array.isArray(o[k]) ? (o[k] as unknown[]) : [];
    const clean = list
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.replace(/[\r\n\u2028\u2029]+/g, ' ').trim().slice(0, 80))
      .slice(0, 500);
    out[k] = clean.length ? clean : BUILTIN[k];
  }
  return out;
}

/** Deterministic PRNG so a seed can be replayed in a test; xmur3 + mulberry32. */
export function rngFrom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One value per die. `material_b` avoids repeating `material_a` where it can. */
export function rollDice(dice: Dice, rng: () => number = Math.random): Roll {
  const pick = (list: string[]) => list[Math.floor(rng() * list.length) % list.length];
  const roll = {} as Roll;
  for (const k of DICE_KEYS) roll[k] = pick(dice[k]);
  if (roll.material_b === roll.material_a && dice.material_b.length > 1) {
    const others = dice.material_b.filter((m) => m !== roll.material_a);
    roll.material_b = others[Math.floor(rng() * others.length) % others.length];
  }
  return roll;
}

export function coerceReality(raw: unknown): RealityLists {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const s = v.replace(/[\r\n\u2028\u2029]+/g, ' ').trim().slice(0, 80);
    return s || null;
  };
  const strings = (v: unknown): string[] =>
    (Array.isArray(v) ? v : []).map(str).filter((x): x is string => !!x);

  const calendar_quirk = strings(o.calendar_quirk);
  const historical_event = strings(o.historical_event);
  const unit_system = (Array.isArray(o.unit_system) ? o.unit_system : [])
    .map((e) => {
      const r = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
      const name = str(r.name);
      const units = strings(r.units).slice(0, 3);
      return name && units.length === 3 ? { name, units } : null;
    })
    .filter((x): x is UnitSystem => !!x);
  const place_pair = (Array.isArray(o.place_pair) ? o.place_pair : [])
    .map((e) => strings(e).slice(0, 2))
    .filter((p) => p.length === 2);
  const sf = (o.scale_factor && typeof o.scale_factor === 'object' ? o.scale_factor : {}) as Record<string, unknown>;
  const numOr = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  let min = numOr(sf.min, REALITY_BUILTIN.scale_factor.min);
  let max = numOr(sf.max, REALITY_BUILTIN.scale_factor.max);
  if (!(max > min)) {
    min = REALITY_BUILTIN.scale_factor.min;
    max = REALITY_BUILTIN.scale_factor.max;
  }
  const decimals = Math.min(4, Math.max(0, Math.round(numOr(sf.decimals, 2))));
  return {
    calendar_quirk: calendar_quirk.length ? calendar_quirk.slice(0, 500) : REALITY_BUILTIN.calendar_quirk,
    unit_system: unit_system.length ? unit_system.slice(0, 500) : REALITY_BUILTIN.unit_system,
    place_pair: place_pair.length ? place_pair.slice(0, 500) : REALITY_BUILTIN.place_pair,
    historical_event: historical_event.length ? historical_event.slice(0, 500) : REALITY_BUILTIN.historical_event,
    scale_factor: { min, max, decimals },
  };
}

/** `reality_offset` out of data/dice.json, or the dull built-in stand-in. */
export function loadReality(file = DICE_FILE(), ttlMs = 30_000): RealityLists {
  const now = Date.now();
  if (realityCache && now - realityCache.at < ttlMs) return realityCache.value;
  let raw: unknown = null;
  try {
    raw = (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>).reality_offset ?? null;
  } catch {
    raw = null;
  }
  const value = coerceReality(raw);
  realityCache = { at: now, value };
  return value;
}

/**
 * One reality offset, in the shape `data/dice.json`'s `_shape` fixes.
 * Deterministic in the rng, so a session seed replays it exactly and every page
 * and every app of one session lives in the same slightly wrong world.
 */
export function rollReality(lists: RealityLists, rng: () => number = Math.random): Reality {
  const pick = <T>(list: T[]): T => list[Math.floor(rng() * list.length) % list.length];
  const sys = pick(lists.unit_system);
  const pair = pick(lists.place_pair);
  const { min, max, decimals } = lists.scale_factor;
  const p = Math.pow(10, decimals);
  let scale = Math.round((min + rng() * (max - min)) * p) / p;
  // an offset of exactly one is not an offset
  if (scale === 1) scale = Math.round((1 + (max - 1) / 2) * p) / p || 1.23;
  return {
    calendar: pick(lists.calendar_quirk),
    units: { name: sys.name, unit_names: sys.units.slice(0, 3) },
    scale,
    places: pair.slice(0, 2),
    event: pick(lists.historical_event),
  };
}

/**
 * The names ring (SPEC §12.4). Last N names, newest last, no duplicates.
 * Mirrored to `data/names-ring.json` so a redeploy does not hand the next
 * visitor the name the last one got.
 */
export class NamesRing {
  private names: string[] = [];
  private lastWrite = 0;

  constructor(
    private file: string | null = resolve(ROOT, 'data/names-ring.json'),
    private limit = 200,
    private now: () => number = () => Date.now()
  ) {
    this.load();
  }

  private load() {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8'));
      const list = Array.isArray(j) ? j : Array.isArray(j?.names) ? j.names : [];
      this.names = list
        .filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v: string) => clampName(v))
        .slice(-this.limit);
    } catch {
      /* unreadable ring: an empty one is not a reason to stop booting */
    }
  }

  private save(force = false) {
    if (!this.file) return;
    const t = this.now();
    if (!force && t - this.lastWrite < 1000) return;
    this.lastWrite = t;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      writeFileSync(tmp, JSON.stringify({ names: this.names }));
      renameSync(tmp, this.file);
    } catch {
      /* read-only fs: the ring stays in memory */
    }
  }

  /** Records a name. Returns false when there was nothing usable to record. */
  add(nameRaw: unknown): boolean {
    if (typeof nameRaw !== 'string') return false;
    const name = clampName(nameRaw);
    if (!name) return false;
    const lower = name.toLowerCase();
    const at = this.names.findIndex((n) => n.toLowerCase() === lower);
    if (at >= 0) this.names.splice(at, 1);
    this.names.push(name);
    if (this.names.length > this.limit) this.names = this.names.slice(-this.limit);
    this.save();
    return true;
  }

  list(): string[] {
    return this.names.slice();
  }

  count(): number {
    return this.names.length;
  }

  /** What {{never_names}} renders to: comma-separated, newest last. */
  joined(): string {
    return this.names.join(', ');
  }

  flush(): void {
    this.save(true);
  }
}

export function clampName(s: string): string {
  return String(s).replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}
