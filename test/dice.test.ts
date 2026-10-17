import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ROOT } from '../server/env.js';
import { DICE_KEYS, DICE_MINIMUMS, NamesRing, clampName, coerceDice, loadDice, rngFrom, rollDice, REALITY_MINIMUMS, coerceReality, rollReality } from '../server/dice.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'hallucinos-dice-'));

describe('I2 — the dice the server rolls', () => {
  it('fills every die, even from an empty or hostile file', () => {
    for (const raw of [null, {}, { setting: [] }, { era_decade: [1, 2, 3] }, 'nope']) {
      const d = coerceDice(raw);
      for (const k of DICE_KEYS) {
        expect(Array.isArray(d[k])).toBe(true);
        expect(d[k].length).toBeGreaterThan(0);
      }
    }
  });

  it('takes the lists the prompt author wrote, clamped', () => {
    const dir = tmp();
    const file = join(dir, 'dice.json');
    writeFileSync(
      file,
      JSON.stringify({
        era_decade: ['1930s', '2170s'],
        setting: ['a lighthouse\nwith opinions', 'x'.repeat(400)],
        temperament: ['seasick'],
        material_a: ['pumice'],
        material_b: ['resin'],
      })
    );
    const d = loadDice(file, 0);
    expect(d.era_decade).toEqual(['1930s', '2170s']);
    expect(d.setting[0]).toBe('a lighthouse with opinions');
    expect(d.setting[1].length).toBeLessThanOrEqual(80);
  });

  it('rolls one value per die, reproducibly from a seed', () => {
    const d = coerceDice(null);
    const a = rollDice(d, rngFrom('seed-1'));
    const b = rollDice(d, rngFrom('seed-1'));
    expect(a).toEqual(b);
    for (const k of DICE_KEYS) expect(d[k]).toContain(a[k]);
  });

  it('actually varies across seeds — the whole point of SPEC §12.4', () => {
    const d = coerceDice(null);
    const seen = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(rollDice(d, rngFrom('s' + i)))));
    expect(seen.size).toBeGreaterThan(20);
  });

  it('does not hand back the same material twice when it can avoid it', () => {
    const same = { ...coerceDice(null), material_a: ['slate', 'felt'], material_b: ['slate', 'felt'] };
    for (let i = 0; i < 30; i++) {
      const r = rollDice(same, rngFrom('m' + i));
      expect(r.material_a).not.toBe(r.material_b);
    }
  });
});

describe('I2 — the names ring', () => {
  it('keeps the last N, newest last, without duplicates', () => {
    const ring = new NamesRing(null, 3);
    for (const n of ['A', 'B', 'C', 'D']) ring.add(n);
    expect(ring.list()).toEqual(['B', 'C', 'D']);
    ring.add('b'); // same name, different case: moved to the end, not duplicated
    expect(ring.list()).toEqual(['C', 'D', 'b']);
    expect(ring.joined()).toBe('C, D, b');
  });

  it('refuses junk and clamps what it keeps', () => {
    const ring = new NamesRing(null, 10);
    expect(ring.add('')).toBe(false);
    expect(ring.add('   ')).toBe(false);
    expect(ring.add(null)).toBe(false);
    expect(ring.add(42 as unknown)).toBe(false);
    expect(ring.add('x'.repeat(500))).toBe(true);
    expect(ring.list()[0].length).toBe(60);
    expect(clampName(' a\n b ')).toBe('a b');
  });

  it('survives a restart through its file, and an unreadable one', () => {
    const dir = tmp();
    const file = join(dir, 'names-ring.json');
    const a = new NamesRing(file, 200);
    a.add('HALCYON 3');
    a.add('BUREAU-9');
    a.flush();
    expect(new NamesRing(file, 200).list()).toEqual(['HALCYON 3', 'BUREAU-9']);

    writeFileSync(file, 'not json at all');
    expect(new NamesRing(file, 200).list()).toEqual([]);
  });
});

describe('I2 — the dice reach the prompt', () => {
  it('renders {{dice_json}} and {{never_names}} into the boot and identity turns', async () => {
    const { buildPrompt } = await import('../server/prompts.js');
    const d = rollDice(coerceDice(null), rngFrom('plumbing'));
    const ring = new NamesRing(null, 200);
    ring.add('MERIDIAN 2.1');
    ring.add('MERIDIAN 2.4');
    for (const kind of ['boot', 'identity'] as const) {
      const built = buildPrompt(kind, { seed: 's', dice_json: JSON.stringify(d), never_names: ring.joined() });
      const all = built.system + '\n' + built.user;
      expect(all).toContain(d.setting);
      expect(all).toContain(d.temperament);
      // SPEC §12.4: the model is told the names it converged on last time
      expect(all).toContain('MERIDIAN 2.1');
      expect(all).toContain('MERIDIAN 2.4');
      expect(all).not.toContain('{{dice_json}}');
      expect(all).not.toContain('{{never_names}}');
    }
  });
});

describe('S2 — the three dice added in v0.2', () => {
  it('reads them out of the real data/dice.json and meets every minimum', () => {
    const dice = loadDice(resolve(import.meta.dirname, '../data/dice.json'), 0);
    for (const k of DICE_KEYS) {
      expect(dice[k].length, `${k} has ${dice[k].length}, needs ${DICE_MINIMUMS[k]}`).toBeGreaterThanOrEqual(DICE_MINIMUMS[k]);
      // no duplicates: a die with the same face twice is a loaded die
      expect(new Set(dice[k].map((v) => v.toLowerCase())).size, k).toBe(dice[k].length);
    }
    // BAKEOFF-2: seven of nine names welded two nouns together, and the "0.4
    // units" detail appeared in every OS in the run. Both are now rolled.
    expect(DICE_KEYS).toContain('naming_register');
    expect(DICE_KEYS).toContain('strange_detail');
    expect(DICE_KEYS).toContain('wallpaper_motif');
  });

  it('rolls one face of each into the JSON the boot prompt is given', () => {
    const roll = rollDice(loadDice(resolve(import.meta.dirname, '../data/dice.json'), 0), rngFrom('s'));
    for (const k of DICE_KEYS) expect(typeof roll[k], k).toBe('string');
    expect(Object.keys(roll).sort()).toEqual([...DICE_KEYS].sort());
  });

  it('varies all three across boots rather than converging', () => {
    const dice = loadDice(resolve(import.meta.dirname, '../data/dice.json'), 0);
    for (const k of ['naming_register', 'strange_detail', 'wallpaper_motif'] as const) {
      const seen = new Set<string>();
      for (let i = 0; i < 60; i++) seen.add(rollDice(dice, rngFrom('seed-' + i))[k]);
      expect(seen.size, k).toBeGreaterThan(8);
    }
  });

  it('falls back to a builtin face for a die the data file forgot', () => {
    const d = coerceDice({ era_decade: ['1970s'] });
    expect(d.era_decade).toEqual(['1970s']);
    for (const k of DICE_KEYS) expect(d[k].length, k).toBeGreaterThan(0);
  });
});

/**
 * H5 — the reality-offset lists are a contract between the prompt author (who
 * writes them) and the server (which rolls them). `data/dice.json`'s own
 * `_shape` field states the minimums and the object shape; this asserts both
 * against the real file, so a list that shrinks or an entry in the wrong shape
 * fails here rather than in a page's measurements.
 */
describe('H5 — reality_offset', () => {
  const file = JSON.parse(readFileSync(resolve(ROOT, 'data/dice.json'), 'utf8')) as Record<string, any>;

  it('is present in data/dice.json with every list at its minimum', () => {
    const r = file.reality_offset;
    expect(r, 'data/dice.json has no reality_offset').toBeTruthy();
    for (const [k, min] of Object.entries(REALITY_MINIMUMS)) {
      expect(Array.isArray(r[k]), `${k} is not a list`).toBe(true);
      expect(r[k].length, `${k} has ${r[k].length}, needs ${min}`).toBeGreaterThanOrEqual(min);
    }
    expect(typeof r.scale_factor?.min).toBe('number');
    expect(typeof r.scale_factor?.max).toBe('number');
  });

  it('survives the coercion with every entry in the authored shape', () => {
    const lists = coerceReality(file.reality_offset);
    // nothing was dropped: a unit system without three unit names, or a place
    // pair without two names, is dropped by coerceReality, so equal lengths
    // prove the file is in shape
    expect(lists.unit_system.length).toBe(file.reality_offset.unit_system.length);
    expect(lists.place_pair.length).toBe(file.reality_offset.place_pair.length);
    for (const s of lists.unit_system) expect(s.units).toHaveLength(3);
    for (const p of lists.place_pair) expect(p).toHaveLength(2);
  });

  it('rolls one world per session, inside the authored band', () => {
    const lists = coerceReality(file.reality_offset);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const r = rollReality(lists, rngFrom('sess-' + i));
      expect(r.scale).toBeGreaterThanOrEqual(lists.scale_factor.min);
      expect(r.scale).toBeLessThanOrEqual(lists.scale_factor.max);
      expect(r.scale).not.toBe(1);
      expect(Number(r.scale.toFixed(lists.scale_factor.decimals))).toBe(r.scale);
      expect(r.units.unit_names).toHaveLength(3);
      expect(r.places).toHaveLength(2);
      expect(r.calendar).toBeTruthy();
      expect(r.event).toBeTruthy();
      seen.add(JSON.stringify(r));
    }
    // 200 sessions do not get the same world (the whole point of §12.4's dice)
    expect(seen.size).toBeGreaterThan(150);
  });

  it('falls back to the built-in lists when the file has no reality_offset', () => {
    const lists = coerceReality(undefined);
    expect(lists.calendar_quirk.length).toBeGreaterThan(0);
    expect(lists.unit_system[0].units).toHaveLength(3);
    const r = rollReality(lists, rngFrom('x'));
    expect(r.units.name).toBeTruthy();
  });
});
