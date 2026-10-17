import { render, readPrompt } from './prompts.js';
import type { Roll } from './dice.js';
import type { BootIdentity } from './identity.js';
import type { TileTheme } from './img.js';

/**
 * S3 — image prompts are built by the SERVER, from identity + dice.
 *
 * Not by the model (it never sees the picture and BAKEOFF-2 caught it declaring
 * more icon slots than the sheet has cells) and not by the kernel (which sent
 * `wallpaperPrompt(identity)` in v0.1 and got gallery-grade photographs of
 * animals: "the wallpapers are beautiful and mostly wrong"). The kernel now
 * sends `{kind, session, seed}` and the server owns every word.
 *
 * The wording lives in `prompts/images/{wallpaper,icons,map}.md` when the prompt
 * author has written them — this module loads and renders those with the
 * variables below — and falls back to S3's own wording when they are absent, so
 * the server never depends on a file another builder owns.
 *
 * Variables available to every template:
 *   {{era_decade}} {{wallpaper_motif}} {{palette_words}} {{font_words}}
 *   {{setting}} {{temperament}} {{material_a}} {{material_b}}
 *   {{era}} {{personality}} {{icon_cells}} {{app_shapes}}
 * `{{icon_cells}}` and its alias `{{app_shapes}}` are still rendered but are
 * used by no shipped template (ICON RULING); they stay so an older
 * `prompts/images/icons.md` still renders rather than emitting the literal
 * placeholder.
 * Deliberately NOT available: the OS name and the mascot. A name in an image
 * prompt is what flux renders as text, and "no text" is the one rule all three
 * pictures have to keep.
 */

/**
 * Clamp on a SERVER-built prompt. Not the same as `LIMITS.imgPrompt` (700),
 * which clamps a prompt a generated document supplied. The three
 * server-written prompts render to ~280-430 characters each now that the icon
 * sheet no longer carries sixteen numbered cells (the ICON RULING below); the
 * ceiling stays generous because a prompt author's file is loaded at runtime
 * and this is the only thing standing between a long one and the provider.
 */
export const IMG_PROMPT_MAX = 1400;

/** S3's wording, used when `prompts/images/<kind>.md` is not there. */
export const BUILTIN_WALLPAPER =
  'desktop wallpaper, {{era_decade}} computer operating system default background, {{wallpaper_motif}}, ' +
  '{{palette_words}}, no text, no people, no animals, no objects in focus, soft, low contrast';

/**
 * ICON RULING (architect, 2026-09-17, verified live). The sheet used to name
 * sixteen app shapes in manifest order and the kernel sliced it in that order.
 * The slicing was correct; the sheet was not — FLUX schnell does not place
 * sixteen specific subjects in a requested order (weather got a music note,
 * news got the cloud), while the model's own glyph inside each
 * `[data-os-icon]` was semantically perfect until the picture covered it.
 *
 * So the picture supplies the PLATE and the model supplies the MEANING:
 * sixteen matching blank plates, no symbols and no text, and the glyph stays
 * visible on top of its plate. Nothing in the sheet can be in the wrong cell
 * because every cell is the same.
 */
export const BUILTIN_ICONS =
  '4x4 grid of sixteen identical blank icon plates, sixteen cells, one plate centred in each cell, ' +
  'every plate the same shape, the same size, the same material and the same finish, ' +
  '{{era_decade}} interface hardware, {{palette_words}}, the middle of every plate left clear and unmarked, ' +
  'plain background, evenly spaced, ' +
  // The kernel slices this sheet at quarters (kernel/sheet.ts), so the geometry
  // is a mechanical requirement, not a design instruction: without it flux draws
  // frames and gutters and every launcher shows a slice of its neighbour. Seen
  // on the first real boot.
  'cells touching edge to edge, no symbols, no pictograms, no marks, no objects, ' +
  'no text, no letters, no numbers, no gutters, no grid lines, no frames, no shadows between cells';

/**
 * The map surface joined S3 in v0.4. It was one of the three slots the MODEL
 * described (`data-os-prompt` on its own `[data-os-img="map"]`), and
 * `prompts/apps/maps.md` asked it to name "the terrain this place sits in" —
 * an honest answer to which is a landscape, and a landscape from above is an
 * aerial photograph, which has no street network a route can follow. The
 * overlay the model draws on top (pins, labels, routes, scale bar) only reads
 * as a map over a flat straight-down PLAN, and nothing in a per-document
 * prompt guaranteed the projection.
 */
export const BUILTIN_MAP =
  'flat top-down illustrated street map of a city that does not exist, printed cartographic style, ' +
  '{{era_decade}} paper map, a street network drawn as lines, city blocks between the streets, ' +
  'a river or a stretch of coast, parks and open ground, {{palette_words}}, muted, low contrast, ' +
  'seen straight down from directly above, no perspective, no buildings drawn in elevation, ' +
  'no aerial photography, no satellite imagery, no photograph, no people, no vehicles, ' +
  'no text, no letters, no numbers, no legend, no compass, no pins, no markers';

/**
 * T2 — the tile sheet's prompt, which is neither purely ours nor purely the
 * document's.
 *
 * The SHAPE is ours and mechanical: sixteen cells, edge to edge, no gutters, no
 * text — exactly the clauses the icon sheet needed before flux would produce a
 * sheet the runtime can slice at quarters (`kernel/sheet.ts`). Without them
 * flux draws frames and margins and every tile shows a slice of its neighbour,
 * which was seen on the first real boot.
 *
 * The SUBJECT is the theme's, one short clause per theme, and the SET is the
 * document's own `data-os-prompt` on the group's first element ("the genre mix
 * of this catalogue"), which is the only part that knows what this particular
 * shelf is holding.
 *
 * `no text` applies to every theme, posters and covers included: flux renders
 * lettering as garbled shapes, and the title belongs to the model's own markup
 * next to the tile, where it is real text a visitor can read.
 */
export const TILE_GRID =
  'sixteen cells in a 4x4 grid, sixteen separate pictures, one picture in each cell, all sixteen different, ' +
  'each cell a complete picture in itself, every cell filled to its own edges with its own picture, ' +
  'evenly spaced, cells touching edge to edge, no margin around the sheet, ' +
  /**
   * R4's second half. `thumbnails` drew a recognisable Eiffel Tower and Spanish
   * Roman ruins (HANDOFF-7 §7) despite "scenes that do not exist" — an image
   * model reads "scene" as "a photograph of somewhere", and somewhere is
   * whatever its training set has most of. SPEC §1.10 draws the same line from
   * the other direction (parody in scope, impersonation not). The positive half
   * of this fix is the subject CLASSES in the theme clauses below.
   */
  'every place and every subject invented and anonymous, ' +
  /**
   * R4, measured twice (reviews/SERVER-v06.md). Two failures, opposite shapes,
   * and one clause each:
   *
   *  - GUTTERS. The old template said `plain background`, for the frames reason
   *    below, and a baseline `thumbnails` sheet drawn with it came back as a
   *    contact sheet with white margins around every cell — which the kernel's
   *    quarter-slice puts inside every tile. A sheet whose cells touch edge to
   *    edge has no background at all, so the clause could only read as
   *    permission to leave the sheet unpainted. Replaced by `no margin around
   *    the sheet` and the per-cell coverage clause above.
   *  - ONE CONTINUOUS SCENE. Stating the coverage at SHEET level ("the whole
   *    sheet covered in pictures to all four of its edges") bought the opposite
   *    failure on `products` and `covers`: a photograph of a shop's shelving
   *    unit and of a bookcase, with the shelf rails crossing the slice lines.
   *    So coverage is stated per CELL, and the display furniture is named.
   */
  'no one continuous scene divided into cells, no shelf, no rack, no display stand, no wall of frames, ' +
  'no empty cell, no blank cell, no flat colour cell, no gradient cell, ' +
  'no gutters, no grid lines, no frames, no borders, ' +
  'no landmark, no monument, no famous building, no recognisable city, no flag, no signage, ' +
  'no text, no letters, no numbers, no logos, no watermarks';

/**
 * One clause per theme: what the sixteen pictures ARE. No examples — those are
 * attractors.
 *
 * These are NOT only the no-prompts-directory fallback. `{{theme_subject}}` is a
 * variable, so `prompts/images/tiles.md` renders THESE words even when the file
 * is present — the file owns the sentence and the geometry, this table owns the
 * subject. The wording below is therefore kept identical to that file's own
 * table of five clauses, which is the reviewed one; when they disagree, this is
 * what the provider actually receives, and that is worth saying out loud because
 * the file's "Deviation to note" currently assumes the opposite.
 */
export const BUILTIN_TILES: Record<TileTheme, string> = {
  faces: 'portrait photographs of sixteen people who do not exist, head and shoulders, each facing the camera, even soft lighting',
  posters: 'sixteen printed poster designs for works that do not exist, each upright and filling its cell, flat graphic shapes, printed ink',
  products: 'sixteen product photographs of manufactured objects that do not exist, one object centred per cell, even studio lighting',
  /**
   * R4: the subject CLASSES are the positive half of the anti-landmark fix —
   * a class is a direction, where a named place is an attractor. The theme
   * word itself stays unused (see `{{theme}}` in prompts/images/tiles.md).
   */
  thumbnails:
    'sixteen small photographs of invented everyday scenes, one per cell, a mix of interiors, close views of objects, weather over open ground, crowds of strangers and plain abstract texture, every place invented and anonymous, even exposure',
  covers: 'sixteen cover designs for works that do not exist, each upright and filling its cell, flat graphic shapes and simple illustration',
};

/**
 * How much of the document's own set description reaches the provider.
 *
 * `LIMITS.imgPrompt` (700) is what the route accepts from a document; this is
 * how much of it goes in FRONT of the geometry clauses, which have to stay
 * within reach of the model's attention or the sheet is unsliceable. The rest
 * of the 1,400-character ceiling is the theme clause, the palette and the grid.
 */
export const TILE_SET_MAX = 320;

export interface TilesPromptOpts {
  /**
   * Whether this sheet may carry the machine's identity words. SPEC §3.1: pages
   * never receive identity — the fake internet is not the OS and has its own
   * reality — so a page's sheet is theme + set only, and an app's sheet gets
   * the palette so a catalogue inside the OS looks like it belongs to it.
   */
  identity: boolean;
}

/**
 * The prompt for one tile sheet. A prompt author may override a theme with
 * `prompts/images/tiles-<theme>.md`, or every theme with
 * `prompts/images/tiles.md`; both are rendered with the same variables as the
 * other image prompts plus `{{theme}}`, `{{theme_subject}}` and `{{set}}`.
 */
export function buildTilesPrompt(theme: TileTheme, docPrompt: string, ctx: ImgPromptCtx, opts: TilesPromptOpts): string {
  const flat = String(docPrompt || '')
    .replace(/\s+/g, ' ')
    .trim();
  /**
   * R4 made the geometry clauses longer, and the longest case — the
   * `thumbnails` subject clause plus a maxed-out 320-character set plus the
   * palette — now renders 1,296 of the 1,400-character ceiling. The final
   * `.slice(IMG_PROMPT_MAX)` cuts the TAIL, which is the grid geometry the
   * kernel's quarter-slice depends on, so the ceiling must never be reached by
   * the one part of this prompt a document controls. It is not: the SET is what
   * gets trimmed when the whole would overflow, and the render runs again.
   */
  const compose = (setText: string) => renderTiles(theme, setText, ctx, opts);
  let set = flat.slice(0, TILE_SET_MAX);
  let out = compose(set);
  if (out.length > IMG_PROMPT_MAX && set) {
    const over = out.length - IMG_PROMPT_MAX;
    set = set.slice(0, Math.max(0, set.length - over - 2)).replace(/[,\s]+$/, '');
    out = compose(set);
  }
  return out.slice(0, IMG_PROMPT_MAX);
}

function renderTiles(theme: TileTheme, set: string, ctx: ImgPromptCtx, opts: TilesPromptOpts): string {
  const vars: Record<string, string> = {
    ...imgPromptVars(ctx),
    theme,
    theme_subject: BUILTIN_TILES[theme],
    set,
  };
  if (!opts.identity) {
    // a page's sheet gets no identity words at all (SPEC §3.1)
    vars.palette_words = '';
    vars.font_words = '';
    vars.era = '';
    vars.personality = '';
    vars.era_decade = '';
    vars.wallpaper_motif = '';
  }
  const file = readPrompt(`images/tiles-${theme}.md`) || readPrompt('images/tiles.md');
  const tpl = file ? promptFromFile(file) : null;
  const rendered = tpl
    ? render(tpl, vars)
    : [vars.theme_subject, set, opts.identity ? vars.palette_words : '', TILE_GRID].filter(Boolean).join(', ');
  return (
    rendered
      .replace(/\s*\n+\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      /**
       * An empty variable in a comma-separated template leaves `, ,` behind —
       * a page's sheet renders `{{palette_words}}` empty by design, and a
       * document may send no set description at all. `prompts/images/tiles.md`
       * says it tolerates that, and it does; this collapses it anyway, because
       * it costs nothing and the provider is being sent a sentence.
       */
      .replace(/(?:,\s*){2,}/g, ', ')
      .replace(/^[,\s]+|[,\s]+$/g, '')
      .trim()
  );
}

/**
 * The prompt inside a `prompts/images/*.md` file.
 *
 * Those files are written for people: a contract paragraph, ONE fenced block
 * holding the prompt itself, and then commentary explaining every clause. The
 * commentary must never reach the model — it names the failures the wording is
 * fixing, which is exactly the kind of text that becomes an attractor. So the
 * first fenced block wins, and a file with no fence is taken whole (which is
 * what a bare one-line template is).
 */
export function promptFromFile(text: string): string {
  const fence = /```[a-zA-Z0-9_-]*\n([\s\S]*?)```/.exec(text);
  return (fence ? fence[1] : text).trim();
}

export interface ImgPromptCtx {
  identity: BootIdentity | null;
  roll: Roll | null;
  /** manifest order, already sliced to 16 by the caller */
  apps: { id: string; shape: string; name?: string }[];
}

const words = (a: string[] | undefined, n: number): string =>
  (a || [])
    .filter((w) => typeof w === 'string' && w.trim())
    .slice(0, n)
    .join(', ');

/**
 * One short phrase per app, in manifest order, numbered so the model keeps the
 * order the kernel slices in. The shape text is our own (`manifest.json`), never
 * the client's — `safeManifest` already guarantees that for /api/gen and this
 * reads the file directly.
 */
export function appShapes(apps: { id: string; shape: string; name?: string }[]): string {
  return apps
    .slice(0, 16)
    .map((a, i) => `${i + 1}. ${((a.shape || a.id).split(/[;:.]/)[0] || a.id).trim().slice(0, 40)}`)
    .join('. ');
}

export function imgPromptVars(ctx: ImgPromptCtx): Record<string, string> {
  const id = ctx.identity;
  const r = ctx.roll;
  return {
    era_decade: r?.era_decade || decadeFromEra(id?.era) || '1990s',
    wallpaper_motif: r?.wallpaper_motif || 'overlapping soft gradients',
    setting: r?.setting || '',
    temperament: r?.temperament || '',
    material_a: r?.material_a || '',
    material_b: r?.material_b || '',
    palette_words: words(id?.palette_words, 4) || 'muted grey and amber',
    font_words: words(id?.font_words, 2),
    era: (id?.era || '').slice(0, 60),
    personality: (id?.personality || '').slice(0, 60),
    // `icon_cells` is the name prompts/images/icons.md uses; `app_shapes` is
    // kept as an alias so an older template still renders.
    icon_cells: appShapes(ctx.apps),
    app_shapes: appShapes(ctx.apps),
  };
}

/** `era` is free text from the model ("a 2040s railway signal box"); pull a decade out of it. */
export function decadeFromEra(era: string | undefined): string {
  if (!era) return '';
  const m = /\b((?:18|19|20|21)\d0)s?\b/.exec(era);
  if (m) return m[1] + 's';
  const y = /\b((?:18|19|20|21)\d\d)\b/.exec(era);
  return y ? String(Math.floor(Number(y[1]) / 10) * 10) + 's' : '';
}

/**
 * The prompt for one server-owned image kind. The kinds the server does NOT
 * own are `photo` and `faces`, whose wording comes from the document's own
 * `data-os-prompt` (seam S1).
 */
export function buildImgPrompt(kind: ServerOwnedKind, ctx: ImgPromptCtx): string {
  const file = readPrompt(`images/${kind}.md`);
  const fromFile = file ? promptFromFile(file) : '';
  const tpl = fromFile || BUILTIN[kind];
  const out = render(tpl, imgPromptVars(ctx))
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return out.slice(0, IMG_PROMPT_MAX);
}

/** Which kinds the server writes the words for (S3). */
export const SERVER_OWNED_KINDS = ['wallpaper', 'icons', 'map'] as const;
export type ServerOwnedKind = (typeof SERVER_OWNED_KINDS)[number];

/** The fallback wording per server-owned kind, used when `prompts/images/<kind>.md` is absent. */
const BUILTIN: Record<ServerOwnedKind, string> = {
  wallpaper: BUILTIN_WALLPAPER,
  icons: BUILTIN_ICONS,
  map: BUILTIN_MAP,
};

export function serverOwnsPrompt(kind: string): kind is ServerOwnedKind {
  return (SERVER_OWNED_KINDS as readonly string[]).includes(kind);
}
