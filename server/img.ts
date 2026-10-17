/**
 * SPEC §12.5 / interface I3 — real images, because SVG icons are not good enough.
 *
 * `fal-ai/flux-1/schnell`: $0.003 per image at any size <= 1 MP, 4 steps,
 * safety checker on. The route returns a `data:` URI, never a URL: the CSP on
 * every generated document is still `img-src data:` and nothing generated is
 * allowed to touch the network. Without `FAL_KEY` the route 404s and the kernel
 * leaves its SVG fallback in place.
 *
 * The endpoint is configurable (`IMG_MODEL`) because HANDOFF-5 #6 was two
 * irreconcilable latency measurements of one model, and answering it meant
 * measuring the alternatives — see `IMG_MODELS` and `reviews/IMG-LATENCY-2.md`.
 * SPEC §12.5's "~0.8 s" has never been observed by any instrument in this repo.
 */

/**
 * The default model's price for one image. fal bills per megapixel rounded up
 * and every size in `IMG_KINDS` is under 1 MP, so one call is one billing unit.
 *
 * Kept as a named constant because it is the number SPEC §12.5 wrote down; the
 * amount actually reserved and billed comes from `imgUsd(model)` below, since
 * `IMG_MODEL` can point the route at a different endpoint at a different rate.
 */
export const IMG_USD = 0.003;

/** The endpoint the route uses unless `IMG_MODEL` names another one. */
export const IMG_MODEL_DEFAULT = 'fal-ai/flux-1/schnell';

export interface ImgModelSpec {
  /** fal's per-megapixel rate; one call at any of our sizes is one unit of it */
  usd_mp: number;
  /** the endpoint's OWN documented default step count */
  default_steps: number;
  /** the endpoint's documented ceiling, so a per-kind number can never 422 */
  max_steps: number;
}

/**
 * Every text-to-image endpoint fal listed at or below $0.006 an image on
 * 2026-09-17, measured head to head in `reviews/IMG-LATENCY-2.md`. The step
 * counts and ceilings are each endpoint's own, read from its OpenAPI schema
 * (`fal.ai/api/openapi/queue/openapi.json?endpoint_id=…`).
 *
 * All four take an identical request body — `image_size` as a {width,height}
 * object, `num_inference_steps`, `sync_mode`, `output_format`, `seed`,
 * `enable_safety_checker` — which is the only reason `IMG_MODEL` can be a plain
 * env variable instead of a per-provider adapter. An unknown value falls back
 * to the default rather than throwing: a typo in a Railway variable must not
 * take the pictures away from every visitor.
 */
export const IMG_MODELS: Record<string, ImgModelSpec> = {
  'fal-ai/flux-1/schnell': { usd_mp: 0.003, default_steps: 4, max_steps: 12 },
  'fal-ai/z-image/turbo': { usd_mp: 0.005, default_steps: 8, max_steps: 8 },
  'fal-ai/sana/sprint': { usd_mp: 0.0025, default_steps: 2, max_steps: 20 },
  'fal-ai/sana': { usd_mp: 0.001, default_steps: 18, max_steps: 50 },
};

/** `IMG_MODEL` from the environment, validated. Anything unknown is the default. */
export function resolveImgModel(raw: string | undefined): string {
  const v = String(raw || '').trim();
  return v && Object.prototype.hasOwnProperty.call(IMG_MODELS, v) ? v : IMG_MODEL_DEFAULT;
}

/** What one image from this model costs us — reserved before the call, billed after. */
export function imgUsd(model: string): number {
  return IMG_MODELS[model]?.usd_mp ?? IMG_USD;
}

/** Where to POST. `override` is FAL_ENDPOINT, which exists so a test can point this at a fake. */
export function imgEndpoint(model: string, override?: string): string {
  return override || 'https://fal.run/' + model;
}

export type ImgKind = 'wallpaper' | 'icons' | 'photo' | 'faces' | 'tiles' | 'map';
export type ImgScope = 'boot' | 'app' | 'page';

/**
 * T2 — the tile sheet, and the generalisation of `faces`.
 *
 * `faces` was one 4x4 sheet of sixteen invented people, sliced by the runtime
 * into a document's `[data-os-face]` elements — one call and one $0.003 for
 * sixteen pictures, against sixteen calls for sixteen photos. Nothing about
 * that arithmetic is about faces: a catalogue of posters, a shop's product
 * grid, a feed's thumbnails and a shelf of book covers are all sixteen small
 * pictures of one set, and all of them were previously either sixteen calls
 * (which the per-document limit of 2-4 forbids) or nothing.
 *
 * So there is one kind, `tiles`, with a `theme`, and `faces` is the theme it
 * started as. `kind: "faces"` stays accepted verbatim and means
 * `kind: "tiles", theme: "faces"` — same size, same slicing, same bucket — so
 * a kernel that has not shipped the new field keeps its pictures.
 */
export const TILE_THEMES = ['faces', 'posters', 'products', 'thumbnails', 'covers'] as const;
export type TileTheme = (typeof TILE_THEMES)[number];

export function isTileTheme(v: unknown): v is TileTheme {
  return typeof v === 'string' && (TILE_THEMES as readonly string[]).includes(v);
}

/** The theme a sheet request means when it does not say: the one `faces` was. */
export const TILE_THEME_DEFAULT: TileTheme = 'faces';

export interface TilesRequest {
  /** the kind the pipeline should charge, size and slice: `tiles` for both spellings */
  kind: ImgKind;
  /** the theme, for a sheet request; undefined for every other kind */
  theme?: TileTheme;
  /** the client asked with the old spelling (`kind: "faces"`) */
  alias: boolean;
  /** the client named a theme that is not one of ours */
  badTheme?: boolean;
}

/**
 * Normalise one image request's kind + theme. Kept here rather than in the
 * route so the tests can hold the alias table still.
 *
 * A theme that is present and unrecognised is an ERROR, not a fallback: unlike
 * `IMG_MODEL` (a deploy variable whose typo must not take every visitor's
 * pictures away) this field comes from our own kernel, and quietly drawing
 * sixteen faces where sixteen posters were asked for spends $0.003 on the
 * wrong picture and hides the mismatch.
 */
export function normalizeTiles(kind: ImgKind, theme: unknown): TilesRequest {
  if (kind === 'faces') return { kind: 'tiles', theme: isTileTheme(theme) ? theme : TILE_THEME_DEFAULT, alias: true };
  if (kind !== 'tiles') return { kind, alias: false };
  if (theme === undefined || theme === null || theme === '') return { kind: 'tiles', theme: TILE_THEME_DEFAULT, alias: false };
  if (!isTileTheme(theme)) return { kind: 'tiles', alias: false, badTheme: true };
  return { kind: 'tiles', theme, alias: false };
}

export interface ImgKindSpec {
  width: number;
  height: number;
  scope: ImgScope;
}

/**
 * Sizes. All are <= 1 MP, which is one billing unit, so smaller is free money:
 * fal charges the same $0.003 and we stop paying for bytes we never show.
 *
 * v0.2 (reviews/IMG-LATENCY-1.md): SPEC §12.5's 1024x576 wallpaper and
 * 1024x1024 sheet measured 5-7 s end to end against a 2.5 s target, and the
 * download was most of it — 496 KB and 931 KB of PNG through our process and
 * then through a data: URI. 768x432 and 768x768 as jpeg are ~44% of the pixels,
 * CSS scales them to any screen (`background-size: cover`, and a launcher icon
 * renders at ~48 px from a 192 px cell), and nobody can see the difference on a
 * wallpaper behind icons.
 */
export const IMG_KINDS: Record<ImgKind, ImgKindSpec> = {
  /**
   * T3 puts the wallpaper back at SPEC §12.5's 1024x576 — the one picture that
   * fills the whole screen, and the one where 768x432 was visible on a large
   * display. It is still one billing unit (0.59 MP < 1 MP), and `sync_mode`
   * (IMG-LATENCY-2) removed the download leg that made the bigger picture
   * expensive in v0.2: the 5-7 s that argued the wallpaper down was mostly our
   * own second round trip for the bytes, which no longer happens.
   */
  wallpaper: { width: 1024, height: 576, scope: 'boot' },
  icons: { width: 768, height: 768, scope: 'boot' },
  photo: { width: 640, height: 640, scope: 'app' },
  /** the old spelling of `tiles` + `theme: "faces"`; same size, same slicing */
  faces: { width: 768, height: 768, scope: 'page' },
  tiles: { width: 768, height: 768, scope: 'page' },
  map: { width: 768, height: 576, scope: 'app' },
};

/**
 * Steps. schnell is a 1-4 step model and 4 was SPEC §12.5's number.
 *
 * The wallpaper was cut to 2 on the theory that fewer steps is less latency.
 * BAKEOFF-3 measured that theory and it is false: six wallpapers through the
 * shipped template took 2.9-14.1 s at BOTH step counts, indistinguishably —
 * the variance is fal's queue, not the denoiser, and 2 steps therefore bought
 * nothing and paid for it in detail on the one picture that fills the whole
 * screen. Back to 4 (finding 10, closed).
 */
export const IMG_STEPS: Record<ImgKind, number> = {
  wallpaper: 4,
  icons: 4,
  photo: 3,
  faces: 3,
  /**
   * A sheet is sixteen pictures for one call and every one of them is looked
   * at, so it gets the sheet step count rather than the single-picture one —
   * the same reasoning the icon sheet already uses.
   */
  tiles: 4,
  map: 3,
};

/**
 * Steps for one call, given the kind AND the model.
 *
 * The per-kind table above was measured on schnell and is not transferable: a
 * two-step distilled model and an eighteen-step one mean completely different
 * things by "3". So the table applies to the DEFAULT model only, and any other
 * endpoint gets its own documented default, clamped to its own ceiling — which
 * is also what stops a per-kind number of 4 from 422-ing an endpoint whose
 * maximum is 8 or whose minimum is 1.
 */
export function stepsFor(kind: ImgKind, model: string): number {
  const spec = IMG_MODELS[model];
  if (!spec) return IMG_STEPS[kind] ?? 4;
  const want = model === IMG_MODEL_DEFAULT ? (IMG_STEPS[kind] ?? spec.default_steps) : spec.default_steps;
  return Math.min(Math.max(1, want), spec.max_steps);
}

/** SPEC §12.5: <= 4 per boot, <= 4 per app open, <= 2 per page. */
export const SCOPE_LIMITS: Record<ImgScope, number> = { boot: 4, app: 4, page: 2 };

/** Nothing in SPEC caps a whole session, and one visitor looping app opens would
 *  spend the day's image budget alone. This is that backstop. */
export const SESSION_LIMIT = 30;

/**
 * HANDOFF-7 — the starvation the first live browser walk found.
 *
 * A session's 30 was first-come, and app opens come first: a visitor who opened
 * six apps (four pictures each) and then browsed four pages arrived at the
 * catalogue pages with the bucket empty. Measured live on boot 3 of the v0.5
 * run: **15 `/api/img` 429s, every tile sheet of every page refused, 0 of 48
 * tiles shown** — and the tile sheet is the whole reason a page can have
 * pictures at all (one call for sixteen).
 *
 * So the 30 is now a total AND a reservation: no scope may take more than its
 * share of it, which leaves the page's share there when the visitor gets to it.
 * The ceiling on spend is unchanged — this only decides who gets the 30 — and
 * the shares sum to more than 30 on purpose, so a session that never browses
 * still gets its apps' pictures and only a session that does both meets the
 * reservation.
 *
 * HANDOFF-7, second finding: the boot share was first written as 4 — exactly
 * one boot's worth — which silently made the SECOND boot of a session
 * picture-less: no wallpaper, no icon plates, for half an hour (the TTL), on
 * the one surface whose whole job is the first impression. Reloading is the
 * main gesture this product invites ("give me another one"), so the boot's
 * share is six boots and the session total stays the money guard it was.
 */
export const SESSION_SCOPE_LIMITS: Record<ImgScope, number> = { boot: 12, app: 20, page: 12 };

export function isImgKind(v: unknown): v is ImgKind {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(IMG_KINDS, v);
}

export function isImgScope(v: unknown): v is ImgScope {
  return v === 'boot' || v === 'app' || v === 'page';
}

/**
 * S1 — which bucket this request is charged to.
 *
 * The limits SPEC §12.5 sets are per DOCUMENT ("<= 4 per app open, <= 2 per
 * page"), not per kind, and `os.img` lets any document ask for any of
 * photo/faces/map: a contacts app wants `faces`, a listings page wants `photo`.
 * So the kernel may declare the document class it is asking from
 * (`scopeKind` in the body) and the kind's own default is only the fallback.
 * `boot` is never accepted from a client — wallpaper and icons are the boot's
 * two pictures and nothing else may spend from that bucket.
 */
export function scopeForRequest(kind: ImgKind, declared: unknown): ImgScope {
  const own = IMG_KINDS[kind].scope;
  if (own === 'boot') return 'boot';
  if (isImgScope(declared) && declared !== 'boot') return declared;
  return own;
}

export interface ImgDecision {
  allowed: boolean;
  reason?: 'scope' | 'session' | 'session-scope';
  used: number;
  limit: number;
}

/**
 * Per-visitor image counters.
 *
 * `session` is the bucket the SESSION ceiling is charged to and must be
 * something the server derives (the ip hash) — keyed on the client's own
 * session string, one IP rotating it got 44 images out of a documented 30.
 * `sub` is the client's session string, kept only as a sub-key of the scope
 * buckets so two tabs from one machine do not collide. `scopeId` is whatever
 * the kernel calls one app open or one page load; without it every app open in
 * a session shares a rolling bucket, which is the conservative direction.
 */
export class ImgBudget {
  private counts = new Map<string, { n: number; at: number }>();

  constructor(
    private ttlMs = 30 * 60_000,
    private now: () => number = () => Date.now(),
    private sessionLimit = SESSION_LIMIT
  ) {}

  private bump(key: string, limit: number): ImgDecision {
    const t = this.now();
    const cur = this.counts.get(key);
    const rec = cur && t - cur.at < this.ttlMs ? cur : { n: 0, at: t };
    if (rec.n >= limit) {
      this.counts.set(key, rec);
      return { allowed: false, used: rec.n, limit };
    }
    rec.n += 1;
    rec.at = t;
    this.counts.set(key, rec);
    return { allowed: true, used: rec.n, limit };
  }

  /**
   * The reservations are SHARES of the session total, so an operator who raises
   * the ceiling (`IMG_PER_IP_PER_SESSION`) raises them with it; lowering it
   * never lowers a share below the documented baseline, because the total is
   * already the narrower ceiling in that direction.
   */
  private reservation(scope: ImgScope): number {
    const base = SESSION_SCOPE_LIMITS[scope];
    if (this.sessionLimit <= SESSION_LIMIT) return base;
    return Math.max(base, Math.round((base * this.sessionLimit) / SESSION_LIMIT));
  }

  private gc() {
    if (this.counts.size < 5000) return;
    const t = this.now();
    for (const [k, v] of this.counts) if (t - v.at >= this.ttlMs) this.counts.delete(k);
  }

  /**
   * When the kernel names the scope (a window id for an app open, a navigation
   * id for a page) the bucket is exact. When it does not, the bucket falls back
   * to a rolling window: "<= 4 app images a minute" instead of "<= 4 app images
   * for the life of the session", because the latter means four photos on the
   * first Photos open and no image ever again. The session ceiling below is the
   * real money guard either way.
   */
  static FALLBACK_WINDOW_MS = 60_000;

  take(session: string, kind: ImgKind, scopeId = '', sub = '', declaredScope?: ImgScope): ImgDecision {
    this.gc();
    const scope = declaredScope || IMG_KINDS[kind].scope;
    if (!scopeId) scopeId = 'w' + Math.floor(this.now() / ImgBudget.FALLBACK_WINDOW_MS);
    const whole = this.bump(`${session}|*`, this.sessionLimit);
    if (!whole.allowed) return { ...whole, reason: 'session' };
    const refund = (key: string) => {
      const r = this.counts.get(key);
      if (r) r.n = Math.max(0, r.n - 1);
    };
    /**
     * The DOCUMENT's own ceiling first, so the narrowest ceiling is the one
     * that names a refusal: a boot asking for a fifth picture is refused by
     * `scope`, which is what it has always been and what the caller logs.
     */
    const per = this.bump(`${session}|${sub}|${scope}|${scopeId}`, SCOPE_LIMITS[scope]);
    if (!per.allowed) {
      // hand the session slot back: the request never happened
      refund(`${session}|*`);
      return { ...per, reason: 'scope' };
    }
    /** then the reservation: this scope's own share of the session's total */
    const share = this.bump(`${session}|scope|${scope}`, this.reservation(scope));
    if (!share.allowed) {
      refund(`${session}|*`);
      refund(`${session}|${sub}|${scope}|${scopeId}`);
      return { ...share, reason: 'session-scope' };
    }
    return per;
  }
}

export interface ImgResult {
  dataUri: string;
  bytes: number;
  width: number;
  height: number;
  provider_ms: number;
  fetch_ms: number;
}

/** A 32-bit seed from whatever string the kernel is using for this session. */
export function seedInt(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 1;
}

export class ImgError extends Error {
  /**
   * True when fal had already answered 2xx — it rendered the image and charged
   * for it — and the failure is on our side of that line (an empty payload, a
   * binary fetch that failed, bytes over the ceiling, a timeout while
   * downloading). Those cost $0.003 whatever we do with them, so they are
   * booked. A non-2xx or a timeout before the response is free.
   */
  billable = false;

  constructor(
    public code: 'upstream' | 'empty' | 'too-big' | 'timeout',
    public status: number,
    message: string,
    billable = false,
    /** for `timeout`: our own clock, or the caller hanging up */
    public cancelledBy: 'clock' | 'client' | null = null
  ) {
    super(message);
    this.name = 'ImgError';
    this.billable = billable;
  }
}

export const MAX_IMG_BYTES = 3 * 1024 * 1024;

/**
 * HANDOFF-7 §5 / §11.7 — the 7 photo calls in 90 that died `engine_dead` with
 * `bytes: 0` at 3.5-4.6 s.
 *
 * Two things were missing and they are the same gap: the provider's own words
 * (`falImage` put fal's response body in the `ImgError` message and the route
 * logged only the CODE, so eight identical `img upstream` lines said nothing
 * about eight different causes), and any second attempt at all. The body is now
 * logged server-side (`img_err`, `img_status` — never returned to the client,
 * which still reads `image unavailable`), and one retry is allowed under the
 * narrow conditions below.
 *
 * The retry is deliberately narrow because the failure mode it is for is
 * narrow: a FAST non-2xx. A slow failure is a queue or a timeout and retrying
 * it spends the visitor's remaining patience on the same wait; a 429 is fal
 * telling us to stop; and a refusal on the CONTENT of the prompt will refuse
 * the same content twice, so retrying it buys a second refusal and, if fal ever
 * bills one, a second charge.
 */
export const IMG_RETRY_MAX_MS = 6_000;

/**
 * Whether the provider refused the PROMPT rather than failing to serve it.
 *
 * Matched on status plus the body's own words, because fal's content refusals
 * arrive as a 4xx with a JSON detail and not as a documented error code. Any
 * doubt resolves as "moderation" (i.e. do not retry): a false positive costs
 * one empty picture slot, which the kernel already handles gracefully, while a
 * false negative re-sends content the provider has already refused.
 */
const MODERATION_WORDS =
  /\b(?:nsfw|csam|safety|moderat|prohibit|disallow|unsafe|explicit|sexual|minor|flagged|forbidden|content[_ -]?polic|usage[_ -]?polic|blocked)/i;

export function isModerationRefusal(status: number, body: string): boolean {
  if (MODERATION_WORDS.test(body || '')) return true;
  // 403 from a text-to-image endpoint that authenticated fine is a content call
  return status === 403;
}

/**
 * Should this failure be tried once more with a simpler prompt?
 *
 * Only for a provider-side failure that arrived fast, was not a refusal of the
 * content, was not us or the caller hanging up, and was not already billed —
 * `billable` means fal answered 2xx and rendered something, so the money is
 * spent and a retry would spend it twice for a picture we may still not get.
 */
export function shouldRetryImg(err: unknown, elapsedMs: number): boolean {
  if (!(err instanceof ImgError)) return false;
  if (err.billable) return false;
  if (err.code === 'timeout') return false;
  if (elapsedMs >= IMG_RETRY_MAX_MS) return false;
  if (err.status === 429 || err.status === 401 || err.status === 402) return false;
  return !isModerationRefusal(err.status, err.message || '');
}

/**
 * The simpler prompt the one retry sends.
 *
 * "Simplified" means shorter and plainer, never different: the first two
 * comma-separated clauses (the subject and its setting, which is where a
 * document's own `data-os-prompt` puts them), stripped of the bracketing and
 * quoting characters a provider's parser is most likely to choke on, and
 * clamped.
 * A prompt that is already short comes back unchanged, and a prompt that
 * simplifies to nothing is not worth a second call.
 */
export const IMG_RETRY_PROMPT_MAX = 140;

export function simplifyImgPrompt(prompt: string): string {
  const flat = String(prompt || '')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim();
  const clauses = flat
    .split(',')
    .map((c) => c.replace(/["'`<>{}()\[\]|\\*_#~^]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const kept = clauses.slice(0, 2).join(', ');
  return kept.slice(0, IMG_RETRY_PROMPT_MAX).replace(/[,\s]+$/, '').trim();
}

export interface FalOpts {
  key: string;
  timeoutMs?: number;
  /** test-only override of the whole URL (FAL_ENDPOINT); wins over `model` */
  endpoint?: string;
  /** which fal endpoint id (IMG_MODEL); defaults to `IMG_MODEL_DEFAULT` */
  model?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** One synchronous text-to-image call, returned as a data: URI. */
export async function falImage(kind: ImgKind, prompt: string, seed: string, opts: FalOpts): Promise<ImgResult> {
  const spec = IMG_KINDS[kind];
  const f = opts.fetchImpl || fetch;
  const model = resolveImgModel(opts.model);
  const endpoint = imgEndpoint(model, opts.endpoint);
  // the caller always passes cfg.imgTimeoutMs; this is the library default
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const ac = new AbortController();
  /**
   * WHICH clock ran out. BAKEOFF-3 read "img timeout × 15" and assumed fal was
   * slow; the total_ms on those lines was 500-1,400 ms, i.e. nothing like the
   * ceiling — they were the CALLER going away (a window closed, a navigation,
   * a generation superseded), which arrives here as the same AbortError. One
   * word of telemetry separates "fal is slow" from "we cancelled it", and they
   * have opposite fixes.
   */
  let cancelledBy: 'clock' | 'client' | null = null;
  const timer = setTimeout(() => {
    cancelledBy = cancelledBy || 'clock';
    ac.abort();
  }, timeoutMs);
  const onOuter = () => {
    cancelledBy = cancelledBy || 'client';
    ac.abort();
  };
  opts.signal?.addEventListener('abort', onOuter, { once: true });
  const t0 = Date.now();
  /** set once fal has answered 2xx: everything after this line has been paid for */
  let responded = false;
  /**
   * The abort race. `fetch` honours the signal, but nothing else here is
   * allowed to depend on that: one provider that ignores it would hang a
   * request for as long as the socket stays open, which is the 180-second hang
   * BAKEOFF-1 found on the text side.
   */
  const aborted = new Promise<never>((_, reject) => {
    const bail = () => reject(new ImgError('timeout', 504, cancelledBy === 'client' ? 'image cancelled by caller' : 'image timed out', responded, cancelledBy || 'clock'));
    if (ac.signal.aborted) return bail();
    ac.signal.addEventListener('abort', bail, { once: true });
  });
  const race = <T>(p: Promise<T>): Promise<T> => Promise.race([p, aborted]);
  try {
    const res = await race(f(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Key ${opts.key}` },
      body: JSON.stringify({
        prompt,
        image_size: { width: spec.width, height: spec.height },
        num_inference_steps: stepsFor(kind, model),
        num_images: 1,
        enable_safety_checker: true,
        output_format: 'jpeg',
        /**
         * The single biggest latency win (reviews/IMG-LATENCY-1.md). Without it
         * fal answers with a CDN URL and WE then fetch the bytes: a second
         * round trip, TLS included, for 0.5-0.9 MB. `sync_mode` makes the
         * response carry the image inline as a data: URI, which is the exact
         * form the CSP (`img-src data:`) needs anyway — so the download leg
         * disappears instead of being optimised.
         */
        sync_mode: true,
        seed: seedInt(seed + '|' + kind),
      }),
      signal: ac.signal,
    }));
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ImgError('upstream', res.status, detail.slice(0, 200));
    }
    // from here on fal has rendered and billed: every later failure is billable
    responded = true;
    const json: any = await race(res.json());
    const provider_ms = Date.now() - t0;
    const image = Array.isArray(json?.images) ? json.images[0] : null;
    const url: string | undefined = image?.url;
    if (!url) throw new ImgError('empty', 502, 'no image in response', true);
    if (url.startsWith('data:')) {
      return { dataUri: url, bytes: url.length, width: image.width || spec.width, height: image.height || spec.height, provider_ms, fetch_ms: 0 };
    }
    const t1 = Date.now();
    const bin = await race(f(url, { signal: ac.signal }));
    if (!bin.ok) throw new ImgError('upstream', bin.status, 'image fetch failed', true);
    const buf = Buffer.from(await race(bin.arrayBuffer()));
    if (buf.byteLength > MAX_IMG_BYTES) throw new ImgError('too-big', 502, `image ${buf.byteLength} bytes`, true);
    const type = String(image?.content_type || bin.headers.get('content-type') || 'image/jpeg').split(';')[0];
    const safeType = /^image\/(jpeg|png|webp)$/.test(type) ? type : 'image/jpeg';
    return {
      dataUri: `data:${safeType};base64,${buf.toString('base64')}`,
      bytes: buf.byteLength,
      width: image?.width || spec.width,
      height: image?.height || spec.height,
      provider_ms,
      fetch_ms: Date.now() - t1,
    };
  } catch (err: any) {
    if (err instanceof ImgError) throw err;
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError')
      throw new ImgError('timeout', 504, cancelledBy === 'client' ? 'image cancelled by caller' : 'image timed out', responded, cancelledBy || 'clock');
    throw new ImgError('upstream', 0, String(err?.message || err).slice(0, 200), responded);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuter);
  }
}
