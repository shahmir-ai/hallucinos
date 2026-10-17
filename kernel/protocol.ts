/** Kernel <-> generated-frame message protocol and the CSP every generated document gets. */

export const GENERATED_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; " +
  // form-action: generated documents carry real <form>s and the sandbox has
  // allow-forms so the submit event fires and can be intercepted. This makes
  // sure a submit that somehow escapes the interception navigates nowhere.
  "media-src data: blob:; form-action 'none'";

export const DOC_PREFIX =
  '<!doctype html><html><head><meta charset="utf-8">' +
  `<meta http-equiv="Content-Security-Policy" content="${GENERATED_CSP}">` +
  '<meta name="viewport" content="width=device-width,initial-scale=1">';

export type Role = 'boot' | 'app' | 'page';

/**
 * SEAM S1 — the image kinds a generated document may ask for. `wallpaper` and
 * `icons` are not among them: those two belong to the boot and their prompts are
 * the server's (SEAM S3). A document asks with
 * `data-os-img="photo|tiles|map"` + `data-os-prompt="..."`.
 */
export type DocImgKind = 'photo' | 'faces' | 'tiles' | 'map';

export const DOC_IMG_KINDS: DocImgKind[] = ['photo', 'faces', 'tiles', 'map'];

/**
 * SEAM T2 — one 768x768 sheet, 4x4, sixteen small pictures of ONE SET for one
 * $0.003 call, sliced by the runtime.
 *
 * `faces` was the first theme and is now an alias for `tiles` +
 * `theme: "faces"` (the server's `normalizeTiles` maps it, so a page written
 * against the old spelling keeps its pictures). Nothing in the arithmetic was
 * ever about faces: a catalogue's posters, a shop's product grid, a feed's
 * thumbnails and a shelf of covers are the same one-call-for-sixteen trade,
 * and without it each of them is either sixteen calls — which the per-document
 * ceiling of 2-4 forbids — or nothing.
 *
 * The list must stay identical to `server/img.ts` TILE_THEMES: a theme the
 * server does not know is a 400, not a picture.
 */
export const TILE_THEMES = ['faces', 'posters', 'products', 'thumbnails', 'covers'] as const;
export type TileTheme = (typeof TILE_THEMES)[number];
export const TILE_THEME_DEFAULT: TileTheme = 'faces';

export function isTileTheme(v: unknown): v is TileTheme {
  return typeof v === 'string' && (TILE_THEMES as readonly string[]).indexOf(v) >= 0;
}

/** Does this kind mean "one sheet, sliced into many elements"? */
export function isSheetKind(kind: string): boolean {
  return kind === 'tiles' || kind === 'faces';
}

/** SPEC §12.5: <= 4 image calls per app open, <= 2 per page. */
export const DOC_IMG_LIMIT: Record<Role, number> = { boot: 0, app: 4, page: 2 };

/** S1: the prompt a document writes is clamped here as well as on the server. */
export const IMG_PROMPT_MAX = 700;

/**
 * How long a page must stay on screen before the kernel buys it a picture
 * (BAKEOFF-3 open issue 4). A page's pictures die with the navigation that
 * leaves it, which is correct — but the server has already started paying fal
 * by then, and the visitor spent those seconds looking at a reserved empty
 * block. Zero of four page pictures in BAKEOFF-3 survived, so the honest
 * ruling is not to start them at all until the page has been looked at: a page
 * left inside the dwell costs nothing and keeps whatever background the model
 * drew, and a page anybody actually reads is unaffected.
 *
 * Apps have no dwell. An app document stays on screen after its own generation
 * has finished and its pictures live as long as its window.
 */
export const PAGE_IMG_DWELL_MS = 1200;

export function isDocImgKind(v: unknown): v is DocImgKind {
  return v === 'photo' || v === 'faces' || v === 'tiles' || v === 'map';
}

export interface DownMsg {
  __os: 1;
  t: 'init' | 'chunk' | 'end' | 'reset' | 'seturl' | 'state' | 'sub' | 'event' | 'inject' | 'imgfill';
  role?: Role;
  d?: string;
  url?: string;
  state?: unknown;
  bootstrap?: string;
  prefix?: string;
  what?: 'page' | 'url';
  m?: DownMsg;
  event?: string;
  detail?: unknown;
  /** imgfill: which slot this picture was asked for, and the picture itself */
  slot?: string;
  kind?: DocImgKind;
  /** T2: which set of sixteen this sheet is, for a `tiles` fill */
  theme?: string;
  dataUri?: string;
}

export interface UpMsg {
  __os: 1;
  /**
   * `paint` is "the first chunk was written into this document"; `ink` is "this
   * document has something with a box in it" (SEAM H3). The two are the same
   * moment for almost every document and catastrophically different for one
   * case: a boot stream that emits the identity comment and then dies has
   * painted and will never ink, and HANDOFF-4 measured the kernel reporting a
   * 4,176 ms "first paint" for a frame that was black for its whole life.
   */
  t: 'ready' | 'call' | 'relay' | 'paint' | 'ink' | 'img';
  fn?: string;
  args?: unknown[];
  m?: UpMsg;
  /** img: the request the document made (S1) */
  kind?: DocImgKind;
  prompt?: string;
  slot?: string;
  /** T2: the theme a `tiles` group declared, passed through verbatim */
  theme?: string;
}
