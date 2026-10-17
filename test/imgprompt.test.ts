import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BUILTIN_ICONS,
  BUILTIN_MAP,
  BUILTIN_WALLPAPER,
  IMG_PROMPT_MAX,
  appShapes,
  buildImgPrompt,
  buildTilesPrompt,
  decadeFromEra,
  imgPromptVars,
  promptFromFile,
  serverOwnsPrompt,
} from '../server/imgprompt.js';
import { loadDice, rollDice, rngFrom } from '../server/dice.js';
import { coerceBootIdentity } from '../server/identity.js';

const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../manifest.json'), 'utf8')) as {
  apps: { id: string; shape: string }[];
};

const ID = coerceBootIdentity(
  {
    name: 'SALTWORKS',
    tagline: 'evaporate, weigh, record',
    version: '3.2',
    era: 'a 1980s salt works',
    personality: 'proud of its ledgers',
    palette_words: ['brine white', 'rust', 'slate', 'sodium yellow'],
    font_words: ['condensed grotesque'],
    mascot: 'a heron',
    boot_message: 'pans warming',
    archetype: 'taskbar',
  },
  'seed-1'
);
const ROLL = rollDice(loadDice(), rngFrom('seed-1'));
const CTX = { identity: ID, roll: ROLL, apps: manifest.apps.slice(0, 16) };

describe('S3 — the server writes the image prompts', () => {
  it('owns the wording for the shell images and nothing else', () => {
    expect(serverOwnsPrompt('wallpaper')).toBe(true);
    expect(serverOwnsPrompt('icons')).toBe(true);
    // v0.4: the map surface joined S3. A terrain brief written by a model that
    // never sees the result draws a landscape, and a landscape from above is an
    // aerial photograph with no street network a route can follow.
    expect(serverOwnsPrompt('map')).toBe(true);
    // photo / faces stay the document's own data-os-prompt (seam S1)
    expect(serverOwnsPrompt('photo')).toBe(false);
    expect(serverOwnsPrompt('faces')).toBe(false);
  });

  it('builds the wallpaper prompt from the decade, the motif and the palette', () => {
    const p = buildImgPrompt('wallpaper', CTX);
    expect(p).toContain('desktop wallpaper');
    expect(p).toContain(ROLL.era_decade);
    expect(p).toContain(ROLL.wallpaper_motif);
    expect(p).toContain('brine white');
    // BAKEOFF-2: flux returned photographed animals and hero objects, which are
    // lovely and are not wallpapers. The bans are the fix.
    expect(p).toMatch(/no animals/);
    expect(p).toMatch(/no people/);
    expect(p).toMatch(/no text/);
    expect(p.length).toBeLessThanOrEqual(IMG_PROMPT_MAX);
  });

  it('never puts the machine\'s name or mascot in a picture prompt', () => {
    // a name in an image prompt is what flux renders as text, and "no text" is
    // the one rule both pictures have to keep
    for (const kind of ['wallpaper', 'icons', 'map'] as const) {
      const p = buildImgPrompt(kind, CTX);
      expect(p, kind).not.toContain('SALTWORKS');
      expect(p, kind).not.toContain('heron');
      expect(p, kind).not.toContain('evaporate');
    }
  });

  it('asks the icon sheet for sixteen MATCHING BLANK plates, not sixteen subjects', () => {
    // ICON RULING (2026-09-17, verified live): flux does not place sixteen
    // specific subjects in a requested order — weather got a music note, news
    // got the cloud — while the model's own glyph was right every time. So the
    // picture supplies the plate and the model supplies the meaning.
    const p = buildImgPrompt('icons', CTX);
    expect(p).toMatch(/4x4 grid of sixteen/);
    expect(p).toMatch(/identical blank icon plates/);
    expect(p).toMatch(/same shape/);
    expect(p).toMatch(/same material/);
    expect(p).toContain(ROLL.era_decade);
    expect(p).toContain('rust');
    // nothing that could land in the wrong cell
    expect(p).toMatch(/no symbols/);
    expect(p).toMatch(/no text/);
    expect(p).toMatch(/no letters/);
    expect(p).toMatch(/no numbers/);
    // the geometry the kernel's quarter-slicing depends on survives the rewrite
    expect(p).toMatch(/edge to edge/);
    expect(p).toMatch(/no gutters/);
    expect(p).toMatch(/no grid lines/);
    // and the app shapes are gone: they bought nothing and cost ~900 characters
    const first = manifest.apps[0].shape.split(/[;:.]/)[0].trim().slice(0, 40);
    expect(p).not.toContain(first);
    expect(p).not.toContain('1. ');
    expect(p.length).toBeLessThanOrEqual(IMG_PROMPT_MAX);
  });

  it('asks the map surface for a flat plan, never a photograph from above', () => {
    const p = buildImgPrompt('map', CTX);
    expect(p).toMatch(/top-down/);
    expect(p).toMatch(/street map/);
    expect(p).toContain(ROLL.era_decade);
    expect(p).toContain('brine white');
    // the projection, stated more than once, because the model's SVG overlay
    // (pins upright, labels flat, routes along the streets) only reads over a plan
    expect(p).toMatch(/straight down/);
    expect(p).toMatch(/no perspective/);
    expect(p).toMatch(/no aerial photography/);
    expect(p).toMatch(/no satellite/);
    // the labels, pins and legend are the overlay's, in this machine's language
    expect(p).toMatch(/no text/);
    expect(p).toMatch(/no pins/);
    expect(p).toMatch(/no legend/);
    expect(p.length).toBeLessThanOrEqual(IMG_PROMPT_MAX);
  });

  it('numbers exactly sixteen cells however long the manifest is', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: 'a' + i, shape: 'shape ' + i }));
    const s = appShapes(many);
    expect(s).toContain('16. shape 15');
    expect(s).not.toContain('17.');
  });

  it('degrades to the dice alone when the identity was never seen', () => {
    // the route falls back to this when no boot record matches (a stale session,
    // a redeploy mid-boot) — it must still produce a usable prompt
    const p = buildImgPrompt('wallpaper', { identity: null, roll: ROLL, apps: manifest.apps });
    expect(p).toContain('desktop wallpaper');
    expect(p).toContain(ROLL.era_decade);
    expect(p.length).toBeGreaterThan(40);
    const q = buildImgPrompt('icons', { identity: null, roll: null, apps: manifest.apps });
    expect(q).toMatch(/sixteen/);
    expect(q).not.toContain('{{');
    const m = buildImgPrompt('map', { identity: null, roll: null, apps: [] });
    expect(m).toMatch(/street map/);
    expect(m).not.toContain('{{');
  });

  it('sends only the fenced prompt from prompts/images/*.md, never the commentary', () => {
    // those files explain every clause by naming the failure it fixes, which is
    // the last text that should be loaded next to a model
    const p = buildImgPrompt('wallpaper', CTX);
    expect(p).not.toMatch(/BAKEOFF|Contract|Variables|^#/);
    expect(promptFromFile('# title\n\nblah\n\n```text\nTHE PROMPT {{era_decade}}\n```\n\n## why\nnot this\n')).toBe(
      'THE PROMPT {{era_decade}}'
    );
    // a bare template with no fence is taken whole
    expect(promptFromFile('just the prompt')).toBe('just the prompt');
  });

  it('leaves no unrendered placeholder in either builtin template', () => {
    for (const kind of ['wallpaper', 'icons', 'map'] as const) {
      expect(buildImgPrompt(kind, CTX)).not.toContain('{{');
    }
    // and the builtins name every variable the vars object supplies
    const vars = imgPromptVars(CTX);
    for (const tpl of [BUILTIN_WALLPAPER, BUILTIN_ICONS, BUILTIN_MAP]) {
      for (const m of tpl.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) {
        expect(Object.keys(vars), m[1]).toContain(m[1]);
      }
    }
  });

  it('reads a decade out of whatever free text the model called its era', () => {
    expect(decadeFromEra('a 1980s salt works')).toBe('1980s');
    expect(decadeFromEra('1994-adjacent')).toBe('1990s');
    expect(decadeFromEra('2061, deep sea')).toBe('2060s');
    expect(decadeFromEra('neo-futuristic')).toBe('');
    expect(decadeFromEra(undefined)).toBe('');
    // and the roll wins over the model's prose when both exist
    expect(imgPromptVars(CTX).era_decade).toBe(ROLL.era_decade);
    expect(imgPromptVars({ ...CTX, roll: null }).era_decade).toBe('1980s');
  });

  it('is one line, because it is a prompt and not a document', () => {
    for (const kind of ['wallpaper', 'icons', 'map'] as const) {
      expect(buildImgPrompt(kind, CTX)).not.toMatch(/\n/);
    }
  });
});

/**
 * T2 — the tile sheet's prompt. Three parts with three owners: the theme clause
 * (ours), the set description (the document's `data-os-prompt`), the palette
 * (the machine's, and only for an app — SPEC §3.1 gives pages no identity).
 */
describe('T2 — buildTilesPrompt', () => {
  const ctx = {
    identity: {
      name: 'ZORNAX',
      version: '1',
      tagline: 't',
      era: 'a 1970s harbour office',
      personality: 'p',
      boot_message: 'b',
      palette_words: ['oxide', 'bone', 'signal green'],
      font_words: ['slab'],
    } as any,
    roll: null,
    apps: [],
  };

  /**
   * Template-agnostic on purpose: `prompts/images/tiles.md` exists and wins over
   * `BUILTIN_TILES`, exactly as every other image kind works, so these assert
   * the CONTRACT (subject, set, geometry, in that order) rather than one file's
   * wording. `test/prompts.test.ts` is where a prompt file's own text is held.
   */
  it('carries the theme, the set and the grid geometry, in that order', async () => {
    const { buildTilesPrompt } = await import('../server/imgprompt.js');
    const out = await buildTilesPrompt('posters', 'the genre mix of this catalogue', ctx, { identity: true });
    expect(out).toContain('poster');
    expect(out).toContain('the genre mix of this catalogue');
    expect(out).toContain('4x4');
    // the geometry clauses last, so they are the nearest thing to the pixels
    expect(out.indexOf('the genre mix')).toBeLessThan(out.indexOf('4x4'));
    expect(out.indexOf('poster')).toBeLessThan(out.indexOf('the genre mix'));
  });

  it('gives an app the palette and a page nothing of the machine', async () => {
    const { buildTilesPrompt } = await import('../server/imgprompt.js');
    const app = await buildTilesPrompt('faces', 'the regulars', ctx, { identity: true });
    const page = await buildTilesPrompt('faces', 'the regulars', ctx, { identity: false });
    expect(app).toContain('oxide');
    expect(page).not.toContain('oxide');
    expect(page).toContain('portrait');
    expect(page).toContain('the regulars');
  });

  it('never carries the machine\'s name, whatever the document sent', async () => {
    const { buildTilesPrompt } = await import('../server/imgprompt.js');
    const out = await buildTilesPrompt('covers', 'a shelf of ZORNAX editions', ctx, { identity: true });
    // the identity's name is never a variable in an image prompt (a name is what
    // flux renders as text) — but the DOCUMENT may still have written it, and
    // that is the document's business
    expect(out).not.toContain('ZORNAX,');
    expect(out).toContain('a shelf of ZORNAX editions');
  });

  it('clamps the set description and the whole prompt', async () => {
    const { buildTilesPrompt, TILE_SET_MAX, IMG_PROMPT_MAX } = await import('../server/imgprompt.js');
    const out = await buildTilesPrompt('products', 'Zq'.repeat(4000), ctx, { identity: true });
    expect(out.length).toBeLessThanOrEqual(IMG_PROMPT_MAX);
    expect(/(?:Zq)+/.exec(out)![0].length).toBe(TILE_SET_MAX);
    // and the geometry still made it in, which is the point of the set clamp
    expect(out).toContain('no gutters');
  });

  it('every theme produces a sheet prompt with no text in it', async () => {
    const { buildTilesPrompt } = await import('../server/imgprompt.js');
    const { TILE_THEMES } = await import('../server/img.js');
    expect(TILE_THEMES.length).toBe(5);
    for (const theme of TILE_THEMES) {
      const out = await buildTilesPrompt(theme, '', ctx, { identity: false });
      expect(out, theme).toContain('no text');
      expect(out, theme).toContain('sixteen');
      expect(out, theme).toContain('4x4');
      expect(out.length, theme).toBeGreaterThan(80);
    }
  });

  it('the five builtin subject clauses stay in step with the five themes', async () => {
    const { BUILTIN_TILES } = await import('../server/imgprompt.js');
    const { TILE_THEMES } = await import('../server/img.js');
    expect(Object.keys(BUILTIN_TILES).sort()).toEqual([...TILE_THEMES].sort());
  });

  it('a sheet with no set description is still a prompt and has no dangling commas', async () => {
    const { buildTilesPrompt } = await import('../server/imgprompt.js');
    const out = await buildTilesPrompt('thumbnails', '   ', ctx, { identity: false });
    expect(out).not.toMatch(/,\s*,/);
    expect(out).not.toMatch(/^,|,$/);
  });
});

/**
 * R4 made the grid clauses longer and the worst case (the `thumbnails` subject
 * clause + a maxed-out set + the palette) renders 1,296 of the 1,400-character
 * ceiling. The ceiling clamps the TAIL, which is the geometry the kernel's
 * quarter-slice depends on, so overflow has to cost the document's set
 * description instead.
 */
describe('R4 — the geometry clauses are never what the ceiling cuts', () => {
  const id: any = { era: '1990s', personality: 'brisk', palette_words: ['oxide red', 'bone', 'slate', 'amber'], font_words: ['grotesk'] };
  const roll: any = { era_decade: '1990s', wallpaper_motif: 'overlapping soft gradients' };

  it('ends every theme on the last grid clause, app scope and page scope alike', () => {
    for (const theme of ['faces', 'posters', 'products', 'thumbnails', 'covers'] as const) {
      for (const identity of [true, false]) {
        const p = buildTilesPrompt(theme, 'x '.repeat(500), { identity: identity ? id : null, roll: identity ? roll : null, apps: [] }, { identity });
        expect(p.length, theme).toBeLessThanOrEqual(IMG_PROMPT_MAX);
        expect(p.endsWith('no watermarks'), theme + (identity ? ' app' : ' page')).toBe(true);
        // and the clauses the runtime depends on are all still in there
        for (const clause of ['4x4 grid', 'cells touching edge to edge', 'no gutters', 'no text'])
          expect(p, theme + ' ' + clause).toContain(clause);
      }
    }
  });

  it('spends a ridiculous set description on the set, not on the grid', () => {
    const p = buildTilesPrompt('thumbnails', 'y'.repeat(2000), { identity: id, roll, apps: [] }, { identity: true });
    expect(p.length).toBeLessThanOrEqual(IMG_PROMPT_MAX);
    expect(p.endsWith('no watermarks')).toBe(true);
    expect(p).toContain('yyy');
  });
});
