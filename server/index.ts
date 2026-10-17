import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { serve } from '@hono/node-server';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, loadEnv, config, num } from './env.js';
import {
  availableEngines,
  findEngine,
  maxTokensFor,
  temperatureFor,
  costUsd,
  streamGen,
  timeoutFor,
  estTokens,
  redactSecrets,
  EngineHttpError,
  type GenCtx,
} from './engines.js';
import { buildPrompt, pageShapeNote, shapeFromManifest, sanitizeId, type PromptVars } from './prompts.js';
import { HtmlStreamFilter, extractJson } from './htmlstream.js';
import { validate, coerceIdentity, nextVersion, type Kind } from '../kernel/contract.js';
import { moderateLocalSync, moderateRemote, collectStrings } from './moderation.js';
import { Caps, RateBucket, isBotUa, hashIp, clientIpFrom } from './caps.js';
import { Telemetry, type GenLog } from './telemetry.js';
import { kernelPage, ROBOTS } from './page.js';
import { loadDice, loadReality, rollDice, rollReality, rngFrom, NamesRing, clampName } from './dice.js';
import {
  BootIdentityGate,
  coerceBootIdentity,
  renderIdentityComment,
  validIdentityPayload,
  type BootIdentity,
  type IdentityFail,
} from './identity.js';
import {
  IMG_KINDS,
  ImgBudget,
  ImgError,
  falImage,
  imgUsd,
  isImgKind,
  isImgScope,
  normalizeTiles,
  resolveImgModel,
  scopeForRequest,
  SESSION_LIMIT,
  shouldRetryImg,
  simplifyImgPrompt,
  type ImgKind,
} from './img.js';
import { buildImgPrompt, buildTilesPrompt, serverOwnsPrompt } from './imgprompt.js';
import { BootMemory } from './sessions.js';
import { Hedger, hedgeAfterFor, hedgeTriggers, type HedgeReport } from './hedge.js';
import { AUTO, autoUsable, resolveRoute, routeSummary, routingEnabled } from './routes.js';
import { bakeoffLanding, measuredFor } from './bakeoffpage.js';
import { randomUUID } from 'node:crypto';
import { installAuth } from './auth.js';

loadEnv();
const cfg = config();
const KINDS: Kind[] = ['identity', 'boot', 'desktop', 'app', 'page', 'repair'];

const caps = new Caps(cfg.genPerIpPerHour, cfg.maxGenPerDay, cfg.maxUsdPerDay, {
  stateFile: cfg.capsStateFile || undefined,
  maxConcurrent: cfg.maxConcurrentGen,
  maxConcurrentImg: cfg.maxConcurrentImg,
});
const telemetry = new Telemetry();

/**
 * The gen ids this process actually issued (or adopted from a sane client id),
 * with the kind they belong to.
 *
 * Both free bookkeeping routes are gated on it. /api/mark without it accepted a
 * mark for ANY id — including a real one, overwriting SPEC §12.1's headline
 * numbers on a live generation — and /api/identity-seen without it let a
 * stranger rewrite the {{never_names}} ring that is spliced into every later
 * boot prompt. Bounded and insertion-ordered: the oldest is dropped first.
 */
const ISSUED_MAX = 4000;
/**
 * `nameUsed` is how the one-name-per-generation rule is enforced. It is NOT
 * enforced by deleting the entry: the same id is /api/mark's ticket, and the
 * identity comment arrives ~100 ms BEFORE the boot document paints — deleting
 * it on the name threw away every boot's first-paint mark, which is the one
 * number SPEC §12.1 leads with. (Found on a real cerebras-oss120 boot, not on
 * the mock.)
 */
interface IssuedGen {
  kind: Kind;
  nameUsed?: boolean;
}
const issuedGenIds = new Map<string, IssuedGen>();
function issueGenId(id: string, kind: Kind): void {
  if (!id) return;
  issuedGenIds.delete(id);
  issuedGenIds.set(id, { kind });
  while (issuedGenIds.size > ISSUED_MAX) {
    const oldest = issuedGenIds.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    issuedGenIds.delete(oldest);
  }
}
/** Neither route buys tokens, so neither may eat the generation cap — but neither is free to flood. */
const markRate = new RateBucket(num('MARK_PER_IP_PER_HOUR', 600));
const nameRate = new RateBucket(num('NAME_PER_IP_PER_HOUR', 60));
/** SPEC §12.4: the last 200 OS names, so the next boot can be told not to reuse one. */
const namesRing = new NamesRing(cfg.namesRingFile || null);
/** SPEC §12.5: per-session image counters (<=4 per boot, <=4 per app open, <=2 per page). */
/**
 * The session bucket is keyed on the IP hash, not on the client's session
 * string (`server/img.ts`: one IP rotating the string got 44 images out of a
 * documented 30), which is right for production and makes a multi-boot
 * measurement from one machine look like one abusive visitor: HANDOFF-7's
 * first v0.5 run lost the wallpaper AND the icon sheet on boots 3 through 8
 * to `blocked: session`, and read it as a picture defect for half an hour.
 * So the ceiling is a variable — left at SESSION_LIMIT everywhere but a
 * measurement run, exactly like GEN_PER_IP_PER_HOUR.
 */
const imgBudget = new ImgBudget(30 * 60_000, () => Date.now(), num('IMG_PER_IP_PER_SESSION', SESSION_LIMIT));
/**
 * What the server remembers about a boot: the identity it parsed (so S3 can
 * build the image prompts itself) and whether the desktop generation has
 * started (so BAKEOFF-2 finding 6 — a failed boot buying its icon sheet —
 * cannot happen). No generated content, ever; ruling 1.1 stands.
 */
const boots = new BootMemory();
/**
 * How long an icon-sheet request waits for the desktop generation to produce its
 * first chunk before it is refused. BAKEOFF-2 finding 6: haiku spent 8 image
 * calls across 4 boots of which 2 booted. The wallpaper still starts at identity
 * time (SPEC §12.5) — it is the one picture a boot screen can use.
 */
const IMG_ICONS_GATE_MS = num('IMG_ICONS_GATE_MS', 6000);
/**
 * H2 / T1 — how long a routed generation waits for a CONTENT token from its
 * primary before it starts the hedge. The numbers, and why each is what it is,
 * live in `server/hedge.ts` `hedgeTriggers`; they are read per request so an
 * ops change needs a restart of nothing but the variable.
 */
/** characters held in this process before one lane is committed to the client (see server/hedge.ts) */
const HEDGE_COMMIT_CHARS = num('HEDGE_COMMIT_CHARS', 64);
const HEDGE_COMMIT_MS = num('HEDGE_COMMIT_MS', 1500);
/** IDENTITY_DEBUG=1 puts the raw model head on the telemetry line (scripts/identity-sweep.mjs). */
const debugIdentity = /^(1|true|yes)$/i.test(String(process.env.IDENTITY_DEBUG || ''));
const BUILD_ID = String(Date.now());

/** Hard limits on anything client-supplied that ends up inside a prompt (§2.1 cost control). */
const LIMITS = {
  body: 32 * 1024,
  url: 2048,
  refererTitle: 200,
  historyEntries: 3,
  historyEntry: 512,
  paramsJson: 4096,
  manifestApps: 32,
  customShape: 200,
  appName: 60,
  missingHooks: 12,
  imgPrompt: 700,
  /** bytes of model output per generation = tokens * 4 chars * 25% slack */
  outputSlack: 4 * 1.25,
};

interface ManifestApp {
  id: string;
  shape: string;
  name?: string;
  affordances?: string;
}

const manifestFile = () => JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8')) as { apps: ManifestApp[] };
const videosJson = () => {
  try {
    return readFileSync(resolve(ROOT, 'data/videos.json'), 'utf8').trim();
  } catch {
    return '[]';
  }
};

const app = new Hono();

/** Password gate in front of everything except /healthz, /robots.txt and /login (server/auth.ts). */
app.use('*', installAuth(app, (c) => clientIp(c)));

const PAGE_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; " +
  "media-src data: blob:; connect-src 'self'; frame-src 'self' data: blob:; form-action 'none'; base-uri 'none'";

/** The landing page has no script of its own and needs nothing but its inline style. */
const LANDING_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'";

app.get('/healthz', (c) => c.text('ok'));
app.get('/robots.txt', (c) => c.text(ROBOTS));

app.get('/', (c) => {
  c.header('content-security-policy', PAGE_CSP);
  c.header('cache-control', 'no-store');
  return c.html(kernelPage('plain', BUILD_ID, enginePinned() || ''));
});

/**
 * SPEC §12.6 / I8 — /bakeoff is a LANDING PAGE now. It lists the keyed engines
 * with the numbers the last bake-off measured and boots nothing until a Boot
 * button is clicked. This is the only route that renders our own markup.
 */
app.get('/bakeoff', (c) => {
  c.header('content-security-policy', LANDING_CSP);
  c.header('cache-control', 'no-store');
  const { speeds, source } = measuredFor(resolve(ROOT, 'reviews'));
  /**
   * H1 — `auto` gets a Boot button of its own, first, and is marked the
   * default. Without it the only way to boot what a visitor actually gets is to
   * type `?engine=auto` by hand; with it, `/bakeoff` can compare the routed
   * pair against each single engine, which is the comparison that decides
   * whether the hedge is worth its 29%.
   */
  const routes = routeSummary();
  const auto = autoUsable()
    ? [
        {
          id: AUTO,
          label: 'auto (routed, hedged)',
          model: 'routed',
          usd_in: 0,
          usd_out: 0,
          notes: Object.entries(routes)
            .map(([k, r]) => `${k}: ${r.primary}${r.hedge ? ' + ' + r.hedge : ''}`)
            .join('; '),
        },
      ]
    : [];
  return c.html(bakeoffLanding([...auto, ...availableEngines()], speeds, source, advertisedDefault()));
});

/** The old auto-boot behaviour with the HUD, one click away. */
app.get('/bakeoff/run', (c) => {
  c.header('content-security-policy', PAGE_CSP);
  c.header('cache-control', 'no-store');
  return c.html(kernelPage('bakeoff', BUILD_ID));
});

app.get('/kernel.js', (c) => {
  const f = resolve(ROOT, 'public/kernel.js');
  if (!existsSync(f)) return c.text('// kernel bundle missing: run npm run build', 404, { 'content-type': 'application/javascript' });
  c.header('content-type', 'application/javascript; charset=utf-8');
  c.header('cache-control', 'no-store');
  return c.body(readFileSync(f, 'utf8'));
});

function defaultEngine(): string {
  const list = availableEngines();
  const want = process.env.DEFAULT_ENGINE;
  if (want && list.some((e) => e.id === want)) return want;
  // a fixture engine is never the product's default (H2 added a second one)
  const real = list.find((e) => e.kind !== 'mock');
  return real ? real.id : 'mock';
}

/**
 * H1 / T1 — what `/` boots on.
 *
 * `auto` is not an engine: it is the routing table, and it is the default
 * wherever the table resolves, so a visitor gets the hedge without asking.
 *
 * T1 (D6) closes the hole HANDOFF-6 §2 reproduced three times: a
 * `DEFAULT_ENGINE` naming a REAL keyed engine used to be ignored here — only a
 * mock was honoured — so the documented deploy recipe
 * (`DEFAULT_ENGINE=cerebras-oss120`) left `/` on the routed, hedged path and
 * the only way to pin it was `ROUTING=off`, which also throws the hedge away
 * everywhere. Now: an explicit DEFAULT_ENGINE that this process actually holds
 * a key for IS the advertised default, mock or not, and `auto` is what you get
 * when the variable is empty or says `auto`. `enginePinned()` is the same
 * verdict as a boolean, published on /api/engines and stamped on the kernel
 * page so the kernel's own chooseEngine can honour the pin on `/` (it prefers
 * `auto` there whenever the list carries it).
 */
function advertisedDefault(): string {
  const pin = enginePinned();
  if (pin) return pin;
  return autoUsable() ? AUTO : defaultEngine();
}

/**
 * The engine `/` is pinned to, or null when nothing is pinned. A pin must name
 * an engine this process holds a key for — a typo in a Railway variable falls
 * through to `auto` rather than taking the product off the air.
 */
function enginePinned(): string | null {
  const want = String(process.env.DEFAULT_ENGINE || '').trim();
  if (!want || want === AUTO) return null;
  const hit = availableEngines().find((e) => e.id === want);
  return hit ? hit.id : null;
}

app.get('/api/engines', (c) => {
  c.header('cache-control', 'no-store');
  const real = availableEngines().map((e) => ({
    id: e.id,
    label: e.label,
    model: e.model,
    usd_in: e.usd_in,
    usd_out: e.usd_out,
    notes: e.notes ?? null,
  }));
  const routes = routeSummary();
  // the first entry, and the one `/` uses: the policy, not a model
  const auto = autoUsable()
    ? [
        {
          id: AUTO,
          label: 'auto (routed, hedged)',
          model: 'routed',
          usd_in: 0,
          usd_out: 0,
          notes:
            'H1/H2: per-kind primary with a second provider started on it. ' +
            Object.entries(routes)
              .map(([k, r]) => `${k}: ${r.primary}${r.hedge ? ' + ' + r.hedge : ''}`)
              .join('; '),
          routes,
        },
      ]
    : [];
  return c.json({
    default: advertisedDefault(),
    /**
     * T1 — non-null when DEFAULT_ENGINE names a keyed engine, i.e. `/` is meant
     * to be that one engine and not the router. The kernel's chooseEngine reads
     * this (or `<body data-engine>`) to honour the pin on `/`.
     */
    pinned: enginePinned(),
    routing: routingEnabled() && autoUsable(),
    routes,
    engines: [...auto, ...real],
  });
});

app.get('/api/stats', (c) => {
  c.header('cache-control', 'no-store');
  return c.json({
    ...telemetry.stats(),
    caps: {
      day_count: caps.dayCount(),
      max_per_day: cfg.maxGenPerDay,
      per_ip_per_hour: cfg.genPerIpPerHour,
      day_usd: Math.round(caps.dayUsd() * 1e6) / 1e6,
      max_usd_per_day: cfg.maxUsdPerDay,
    },
  });
});

app.get('/api/manifest', (c) => {
  c.header('cache-control', 'no-store');
  return c.json(manifestFile());
});

/**
 * SPEC §12.4 / I2 — the kernel tells the server which OS name it just parsed,
 * and the server keeps a ring of the last 200 so the next boot prompt can say
 * "never use these". Costs nothing and buys no tokens, so it is outside the
 * generation caps; the name is clamped and the body is tiny.
 *
 * It is, however, global prompt state: whatever lands here is spliced into
 * every later boot and identity prompt as {{never_names}}. So it is gated three
 * ways — the name must belong to a boot or identity generation THIS process
 * issued (one name per generation, the id is spent on use), it is moderated
 * like any other user string, and the route has its own per-IP hourly bucket.
 * Unguarded, 220 writes replaced the whole ring in seconds and added 58% to
 * every other visitor's boot prompt.
 */
app.post(
  '/api/identity-seen',
  bodyLimit({ maxSize: 2048, onError: (c) => c.json({ error: 'too big' }, 413) }),
  async (c) => {
    if (isBotUa(c.req.header('user-agent'))) return c.json({ error: 'no' }, 403);
    const ipHash = hashIp(clientIp(c));
    if (!nameRate.take(ipHash)) {
      c.header('retry-after', '60');
      telemetry.record(freeLog(ipHash, 'identity-seen', 'name-rate'));
      return c.json({ ok: false, count: namesRing.count() }, 429);
    }
    let body: { name?: unknown; gen_id?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'bad json' }, 400);
    }
    const genId = String(body?.gen_id || '').slice(0, 64);
    const ticket = genId ? issuedGenIds.get(genId) : undefined;
    if (!ticket || ticket.nameUsed || (ticket.kind !== 'boot' && ticket.kind !== 'identity')) {
      // silent: a refusal here is not the visitor's business, and a
      // distinguishable one is an oracle for which ids exist
      return c.json({ ok: false, count: namesRing.count() });
    }
    const name = typeof body.name === 'string' ? clampName(body.name) : '';
    if (!name) return c.json({ ok: false, count: namesRing.count() });
    // a name is a user-visible string that goes straight into the next prompt
    if (moderateLocalSync([name], cfg.moderation).flagged) {
      ticket.nameUsed = true;
      return c.json({ ok: false, count: namesRing.count() });
    }
    ticket.nameUsed = true; // one name per generation, and the id stays a mark ticket
    const added = namesRing.add(name);
    c.header('cache-control', 'no-store');
    return c.json({ ok: added, count: namesRing.count() });
  }
);

/**
 * I6 — the two numbers only the browser can see, reported against the gen_id
 * the server put in the `x-os-gen-id` response header (and in the telemetry
 * sentinel) of that generation.
 */
app.post(
  '/api/mark',
  bodyLimit({ maxSize: 2048, onError: (c) => c.json({ error: 'too big' }, 413) }),
  async (c) => {
    if (isBotUa(c.req.header('user-agent'))) return c.json({ error: 'no' }, 403);
    const ipHash = hashIp(clientIp(c));
    if (!markRate.take(ipHash)) {
      c.header('retry-after', '60');
      telemetry.record(freeLog(ipHash, 'mark', 'mark-rate'));
      return c.json({ ok: false, matched: false }, 429);
    }
    let body: {
      gen_id?: unknown;
      first_paint_ms?: unknown;
      ink_ms?: unknown;
      interactive_ms?: unknown;
      complete_ms?: unknown;
      /** T4 — what the kernel had to patch into this document (server/telemetry.ts) */
      contract_patch?: unknown;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'bad json' }, 400);
    }
    const genId = String(body?.gen_id || '').slice(0, 64);
    if (!genId) return c.json({ error: 'gen_id required' }, 400);
    c.header('cache-control', 'no-store');
    // A mark for an id this process never issued is dropped without a log line
    // and without being held: client gen_ids are accepted verbatim on /api/gen,
    // so an ungated hold is a way to pre-poison a future generation's numbers.
    if (!issuedGenIds.has(genId)) return c.json({ ok: true, matched: false });
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 3600_000 ? v : undefined);
    const matched = telemetry.mark(genId, {
      first_paint_ms: n(body.first_paint_ms),
      // H3: ink, not the first chunk. The runtime reports it the first time the
      // document has an element with a non-zero box that is not script/style/meta.
      ink_ms: n(body.ink_ms),
      interactive_ms: n(body.interactive_ms),
      complete_ms: n(body.complete_ms),
      /**
       * T4 — a list of patch kinds, normalised and bucketed in telemetry.ts.
       * Unlike the timings it is a set and may be reported more than once for
       * one generation (the chrome check runs at mount and again on the first
       * window); only kinds new to the line are counted.
       */
      contract_patch: body.contract_patch,
    });
    return c.json({ ok: true, matched });
  }
);

/** One telemetry line for a refusal on a route that buys nothing. */
function freeLog(ipHash: string, route: string, blocked: string): GenLog {
  return {
    ts: new Date().toISOString(),
    kind: 'mark',
    engine: '-',
    ip_hash: ipHash,
    tokens_in: 0,
    tokens_out: 0,
    ttfb_ms: 0,
    total_ms: 0,
    tok_per_s: 0,
    usd: 0,
    contract_ok: null,
    blocked,
    ...({ route } as object),
  } as GenLog;
}

/**
 * SPEC §12.5 / I3 — one fal text-to-image call, returned as a data: URI.
 *
 * No FAL_KEY -> 404, and the kernel keeps its SVG fallback. The prompt is
 * moderated exactly like text; a flagged prompt is silently refused (404) rather
 * than answered with a refusal, because SPEC §1.4's reroute must stay invisible.
 * Cost is flat per call (the model's own per-megapixel rate, since every size in
 * IMG_KINDS is under 1 MP) and counts against the same day USD ceiling as tokens.
 *
 * Which endpoint is `IMG_MODEL` (reviews/IMG-LATENCY-2.md); it defaults to
 * `fal-ai/flux-1/schnell` and an unrecognised value falls back to that rather
 * than 500-ing, because a typo in a deploy variable must not take the pictures
 * away from every visitor.
 */
app.post(
  '/api/img',
  bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ error: 'too big' }, 413) }),
  async (c) => {
    const started = Date.now();
    const key = process.env.FAL_KEY;
    // FAL_ENDPOINT exists so a test can point this at a local fake. Under
    // NODE_ENV=test a real fal call is refused outright: no suite of ours is
    // ever allowed to buy an image by accident.
    const endpoint = process.env.FAL_ENDPOINT || undefined;
    if (!key || (process.env.NODE_ENV === 'test' && !endpoint)) return c.json({ error: 'no image engine' }, 404);
    /** read per request, not at module load, so a test can set it around one call */
    const imgModel = resolveImgModel(process.env.IMG_MODEL);
    const usd = imgUsd(imgModel);
    if (isBotUa(c.req.header('user-agent'))) return c.json({ error: 'no' }, 403);

    const ipHash = hashIp(clientIp(c));
    const decision = caps.take(ipHash);
    if (!decision.allowed) {
      c.header('retry-after', String(decision.retryAfter));
      telemetry.record(imgLog(ipHash, 'unknown', 0, 0, started, { blocked: decision.reason, refusal: 'queue' }));
      return c.json({ queue: true, retryAfter: decision.retryAfter, reason: decision.reason }, 429);
    }

    let body: { kind?: unknown; theme?: unknown; prompt?: unknown; seed?: unknown; session?: unknown; scope?: unknown; scopeKind?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'bad json' }, 400);
    }
    const asked = body?.kind;
    if (!isImgKind(asked)) return c.json({ error: 'bad kind' }, 400);
    /**
     * T2 — `faces` and `tiles` are one pipeline. `normalizeTiles` maps the old
     * spelling onto `{kind:'tiles', theme:'faces'}` and refuses a theme that is
     * not one of ours (a wrong theme is a wrong $0.003 picture, and this field
     * comes from our own kernel).
     */
    const norm = normalizeTiles(asked, body.theme);
    if (norm.badTheme) return c.json({ error: 'bad theme' }, 400);
    const kind = norm.kind;
    const theme = norm.theme;
    const seed = clamp(body.seed, 64) || Math.random().toString(36).slice(2);
    /**
     * The SESSION ceiling is charged to the ip hash, never to the client's own
     * session string: keyed on the latter, one IP rotating `session` per call
     * got 44 images out of a documented 30. The client's value survives only as
     * a sub-key of the per-scope buckets, so two tabs on one machine each get
     * their own four-per-app-open without either being able to mint budget.
     */
    const sessionSub = clamp(body.session, 64);
    const scopeId = clamp(body.scope, 64);
    /** which boot is asking (server/sessions.ts: seed, then session id, then IP) */
    const bootKeys = { seed: body.seed ? seed : undefined, session: sessionSub || undefined, client: ipHash };
    /**
     * S3 — for the boot's two pictures the SERVER writes the words, from the
     * identity it parsed out of the boot stream plus this seed's dice. Any
     * `prompt` in the body is ignored for those kinds: a model that never sees
     * the picture wrote v0.1's wallpaper prompts and BAKEOFF-2's verdict was
     * "beautiful and mostly wrong".
     *
     * For the `os.img` kinds (photo / map, seam S1) the prompt is the
     * document's own `data-os-prompt` and arrives here to be moderated and
     * clamped, exactly as before. A tile sheet (T2) is the case in between:
     * the words are half ours and half the document's — see below.
     */
    let prompt: string;
    const bootRec = boots.resolve(bootKeys);
    /**
     * Which document class is asking. Computed before the prompt because a tile
     * sheet's prompt depends on it: SPEC §3.1 gives identity to apps and never
     * to pages, and a sheet for a page must therefore carry no palette words.
     */
    const imgScope = scopeForRequest(kind, body.scopeKind);
    if (serverOwnsPrompt(kind)) {
      prompt = buildImgPrompt(kind, {
        identity: bootRec?.identity || null,
        // the same roll the boot prompt got: the dice replay from the seed, so
        // the wallpaper's decade is the machine's decade and not a second one
        roll: rollDice(loadDice(), rngFrom(bootRec?.seed || seed)),
        apps: manifestFile().apps.slice(0, 16),
      });
    } else if (kind === 'tiles') {
      /**
       * T2 — half ours, half the document's: the theme clause and the grid
       * geometry are the server's (the runtime slices this sheet at quarters and
       * flux will not produce a sliceable sheet without them), the set
       * description is the group's own `data-os-prompt`, and the palette is the
       * machine's — for an app. It is optional: a document that names a theme
       * and nothing else still gets a coherent sheet.
       */
      prompt = buildTilesPrompt(theme || 'faces', clamp(body.prompt, LIMITS.imgPrompt), {
        identity: imgScope === 'app' ? bootRec?.identity || null : null,
        roll: imgScope === 'app' ? rollDice(loadDice(), rngFrom(bootRec?.seed || seed)) : null,
        apps: [],
      }, { identity: imgScope === 'app' });
    } else {
      prompt = clamp(body.prompt, LIMITS.imgPrompt).trim();
      if (!prompt) return c.json({ error: 'prompt required' }, 400);
    }
    const modStart = Date.now();
    const local = moderateLocalSync([prompt], cfg.moderation);
    const moderation_ms = Date.now() - modStart;
    if (local.flagged) {
      telemetry.record(imgLog(ipHash, kind, 0, 0, started, { moderation_ms, blocked: 'moderation', mod_hash: local.hash }));
      return c.json({ error: 'no image engine' }, 404);
    }

    /**
     * BAKEOFF-2 finding 6 — a failed boot still buys its images.
     *
     * The wallpaper may start at identity time (SPEC §12.5: it is the one
     * picture the boot screen itself can use). The icon sheet waits for the
     * desktop generation to produce its first chunk, because a boot whose
     * desktop never starts is a boot nobody will ever see icons on. Haiku spent
     * $0.024 on eight sheets and wallpapers for two OSes.
     */
    if (kind === 'icons' && !(await boots.waitForDesktop(bootKeys, IMG_ICONS_GATE_MS))) {
      telemetry.record(imgLog(ipHash, kind, 0, 0, started, { moderation_ms, blocked: 'no-desktop', refusal: 'engine_dead' }));
      return c.json({ error: 'no image engine' }, 404);
    }

    const budget = imgBudget.take(ipHash, kind, scopeId, sessionSub, imgScope);
    if (!budget.allowed) {
      telemetry.record(imgLog(ipHash, kind, 0, 0, started, { moderation_ms, blocked: budget.reason, refusal: 'queue' }));
      return c.json({ error: 'image budget', reason: budget.reason, limit: budget.limit }, 429);
    }

    // an image lane of its own: a slow fal must never be able to serve /api/gen
    // the over-capacity screen (SPEC §2.1's MAX_CONCURRENT_GEN is for tokens)
    const reservation = caps.reserve(usd, 'img');
    if (!reservation.allowed) {
      c.header('retry-after', String(reservation.retryAfter));
      telemetry.record(imgLog(ipHash, kind, 0, 0, started, { moderation_ms, blocked: reservation.reason, refusal: 'queue' }));
      return c.json({ queue: true, retryAfter: reservation.retryAfter, reason: reservation.reason }, 429);
    }

    // The remote half of moderation runs while the image is being drawn; a hit
    // simply means the result is dropped (SPEC §12.5: image prompts are
    // moderated the same way as text).
    const remote = cfg.moderation === 'auto' ? moderateRemote(local.inputs).catch(() => null) : Promise.resolve(null);

    /**
     * HANDOFF-7 §11.7 — one retry, for a FAST provider-side failure only.
     *
     * 7 of 90 photo calls died `engine_dead` with `bytes: 0` at 3.5-4.6 s, and
     * the cause was unknowable because the provider's body was in the error's
     * message and only its CODE was logged. Both halves are fixed here: the
     * body goes into `img_err` / `img_status` on the telemetry line (stdout
     * only — the client still reads `image unavailable` and never the
     * provider's words), and `shouldRetryImg` decides whether a second call is
     * worth it. It is, only when fal never answered 2xx (nothing billed), the
     * failure arrived inside IMG_RETRY_MAX_MS, it was not a rate limit or an
     * auth failure, and it does not read as a refusal of the CONTENT — a
     * refusal refuses the same words twice.
     *
     * The second call sends `simplifyImgPrompt(prompt)`: the first two clauses
     * of the same prompt, plainer. That cut keeps the subject of a single
     * picture (`photo`'s own brief, and the projection clause of the map and
     * the wallpaper, which are the server's own first two clauses) and destroys
     * a SHEET's grid geometry, which the kernel's quarter-slice depends on — an
     * unsliceable sheet being worse than an empty one. So the retry is allowed
     * for `photo`, `map` and `wallpaper`, and never for `tiles` or `icons`.
     */
    const retryable = kind === 'photo' || kind === 'map' || kind === 'wallpaper';
    let img_retry: number | undefined;
    /** the failure that caused the retry, flattened at the point of the retry so
     *  the outer catch does not have to reason about a narrowed binding */
    let firstErrText: string | undefined;
    let firstErrStatus: number | undefined;
    const callFal = (p: string, timeoutMs = cfg.imgTimeoutMs) =>
      falImage(kind, p, theme ? seed + '|' + theme : seed, {
        key,
        endpoint,
        model: imgModel,
        timeoutMs,
        signal: c.req.raw.signal,
      });
    try {
      // the theme is part of the seed: two sheets of one document must not be
      // the same sixteen pictures drawn twice
      const attemptAt = Date.now();
      let out;
      try {
        out = await callFal(prompt);
      } catch (err: any) {
        const simpler = simplifyImgPrompt(prompt);
        if (!retryable || !simpler || !shouldRetryImg(err, Date.now() - attemptAt)) throw err;
        firstErrText = imgErrText(err instanceof ImgError ? err : null) || String(err?.message || err).slice(0, 300);
        firstErrStatus = err instanceof ImgError ? err.status : undefined;
        img_retry = 1;
        /**
         * The retry does NOT get a second full IMG_TIMEOUT_MS: `imgTimeoutMs`
         * is generous by design (20 s — nothing on screen waits for a picture)
         * and two of them back to back would hold this request, and one of the
         * six image-lane slots, for 26 s over a slot the kernel gave up on long
         * before. It gets what is left of the first call's budget, floored at
         * 3 s so the second attempt is never born already dead.
         */
        out = await callFal(simpler, Math.max(3_000, cfg.imgTimeoutMs - (Date.now() - attemptAt)));
      }
      if ((await remote) === true) {
        reservation.settle(usd);
        telemetry.record(imgLog(ipHash, kind, usd, out.bytes, started, { moderation_ms, img_model: imgModel, blocked: 'moderation-late', mod_hash: local.hash }));
        return c.json({ error: 'no image engine' }, 404);
      }
      reservation.settle(usd);
      telemetry.record(
        imgLog(ipHash, kind, usd, out.bytes, started, {
          moderation_ms,
          img_model: imgModel,
          provider_ttfb_ms: out.provider_ms,
          server_ms: Date.now() - started - out.provider_ms - out.fetch_ms,
          // reviews/IMG-LATENCY-1.md reads these: `fetch_ms` is 0 once
          // sync_mode is on, which is the whole point of turning it on
          img_fetch_ms: out.fetch_ms,
          img_scope: imgScope,
          ...(theme ? { img_theme: theme } : {}),
          img_px: out.width * out.height,
          ...(img_retry ? { img_retry, img_err: firstErrText, img_status: firstErrStatus } : {}),
        })
      );
      c.header('cache-control', 'no-store');
      // `kind` echoes what the CLIENT asked for, so a kernel that still says
      // `faces` reads its own word back; `theme` is the normalised one.
      return c.json({
        dataUri: out.dataUri,
        kind: asked,
        ...(theme ? { theme } : {}),
        width: out.width,
        height: out.height,
        bytes: out.bytes,
      });
    } catch (err: any) {
      // Charged when fal already answered 2xx — it rendered the image and
      // billed for it, and the failure is on our side of that line (empty
      // payload, a binary fetch we could not keep, bytes over the ceiling).
      // Free only for a non-2xx or a timeout before the response.
      const billed = err instanceof ImgError && err.billable ? usd : 0;
      reservation.settle(billed);
      const code = err instanceof ImgError ? err.code : 'upstream';
      // BAKEOFF-3: a picture the caller hung up on and a picture fal was too
      // slow to draw were the same line of telemetry, and they are not the
      // same bug.
      const by = err instanceof ImgError ? err.cancelledBy : null;
      telemetry.record(
        imgLog(ipHash, kind, billed, 0, started, {
          moderation_ms,
          img_model: imgModel,
          error: `img ${code}${by ? ' (' + by + ')' : ''}`,
          refusal: 'engine_dead',
          /**
           * HANDOFF-7 §11.7 — the provider's own words, server-side only.
           * `img ${code}` was every failure's whole account of itself, which is
           * why 7 photo deaths in 90 were unexplained for a whole pass. The
           * client's response is unchanged (`image unavailable`): nothing the
           * provider says about a prompt is echoed to a visitor.
           */
          img_err: imgErrText(err instanceof ImgError ? err : null) || String(err?.message || err).slice(0, 300),
          ...(err instanceof ImgError && err.status ? { img_status: err.status } : {}),
          ...(img_retry ? { img_retry, img_err_first: firstErrText, img_status_first: firstErrStatus } : {}),
          // which document was asking: a cancelled app picture and a cancelled
          // page picture mean different things (the page is gone; the app is not)
          img_scope: imgScope,
          ...(theme ? { img_theme: theme } : {}),
        })
      );
      return c.json({ error: 'image unavailable' }, code === 'timeout' ? 504 : 502);
    }
  }
);

/**
 * One telemetry line for a generation that was refused before anything was
 * bought. `engine` is '-' when the refusal happened before the body was even
 * read, which is where the per-IP and per-day caps fire.
 */
function refusalLog(ipHash: string, kind: string, blocked: string, started: number, engineId = '-'): GenLog {
  return {
    ts: new Date().toISOString(),
    /**
     * BAKEOFF-2 finding 1: "a queue screen and a dead engine are
     * indistinguishable in the numbers", which is how two engines looked dead
     * for a whole run while they were only rate-limited. Every one of OUR
     * refusals says `queue`; every upstream failure says `engine_dead`.
     */
    refusal: 'queue',
    kind: (KINDS as string[]).includes(kind) ? (kind as Kind) : 'gen',
    engine: engineId,
    ip_hash: ipHash,
    tokens_in: 0,
    tokens_out: 0,
    ttfb_ms: 0,
    total_ms: Date.now() - started,
    tok_per_s: 0,
    usd: 0,
    contract_ok: null,
    blocked,
  } as GenLog;
}

/**
 * The provider's own error text for the log, trimmed and flattened.
 *
 * `falImage` already clamps fal's body to 200 characters when it builds the
 * `ImgError`; this only makes it one line and bounds it again, so a provider
 * that answers with a wall of HTML cannot turn one telemetry line into a page.
 */
function imgErrText(err: ImgError | null): string | undefined {
  if (!err) return undefined;
  const t = String(err.message || '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 300) : undefined;
}

/** One telemetry line for an image call (SPEC §12.5 asks for {kind:"img", ...}). */
function imgLog(
  ipHash: string,
  imgKind: string,
  usd: number,
  bytes: number,
  started: number,
  extra: Record<string, unknown> = {}
): GenLog {
  return {
    ts: new Date().toISOString(),
    kind: 'img',
    // the endpoint is IMG_MODEL now; `img_model` in `extra` carries which one,
    // and this field stays a stable bucket for "this line is an image"
    engine: 'fal',
    ip_hash: ipHash,
    tokens_in: 0,
    tokens_out: 0,
    ttfb_ms: 0,
    total_ms: Date.now() - started,
    tok_per_s: 0,
    usd,
    contract_ok: null,
    ...({ img_kind: imgKind, bytes, width: IMG_KINDS[imgKind as keyof typeof IMG_KINDS]?.width } as object),
    ...extra,
  } as GenLog;
}

function clientIp(c: any): string {
  return clientIpFrom(
    c.req.header('x-forwarded-for'),
    c.req.header('x-real-ip'),
    c.env?.incoming?.socket?.remoteAddress,
    cfg.trustedProxyHops,
    cfg.trustProxy
  );
}

interface GenBody {
  kind?: string;
  engine?: string;
  seed?: string;
  /**
   * The kernel's retry after a mid-stream <!--os-reroute--> (SPEC §12.1). The
   * server derives `rerouted` from the local list only, so the retry of the
   * same URL would lose the same race with the remote call forever. It is OR-ed
   * with the server's own verdict and can therefore only ever make a page MORE
   * wholesome: a client setting it gets a wholesome site, which is not an
   * escape from anything.
   */
  rerouted?: unknown;
  /**
   * The kernel's session id, when it sends it. Optional: it exists only so
   * `POST /api/img` can find this boot's identity by the same name the kernel
   * uses there (S3). See server/sessions.ts for the alias order.
   */
  session?: unknown;
  identity?: unknown;
  params?: Record<string, unknown>;
  context?: {
    app_id?: string;
    url?: string;
    referer_url?: string;
    referer_title?: string;
    history?: string[];
    missing_hooks?: string[];
    viewport?: string;
    manifest?: { apps: ManifestApp[] };
    lineage?: { name?: string; version?: string };
  };
}

function parseUrlParts(raw: string | undefined): { url: string; domain: string; path: string; query: string } {
  if (!raw) return { url: '', domain: '', path: '', query: '' };
  let s = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  try {
    const u = new URL(s);
    return { url: u.href, domain: u.hostname, path: u.pathname || '/', query: u.search.replace(/^\?/, '') };
  } catch {
    return { url: raw, domain: raw, path: '/', query: '' };
  }
}

const clamp = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '');

/**
 * The manifest the model is shown. A client may only *name* apps, never
 * redescribe them: ids the server knows keep the server's own shape, and the
 * only free text accepted is a Store-installed `custom:` app's short shape.
 * Without this, `context.manifest` was an unbounded, unmoderated prompt
 * injection surface (and a 25x input-token amplifier).
 */
function safeManifest(client: { apps?: unknown } | undefined): { apps: ManifestApp[]; customStrings: string[] } {
  const server = manifestFile();
  const byId = new Map(server.apps.map((a) => [a.id, a]));
  if (!client || !Array.isArray(client.apps)) return { apps: server.apps, customStrings: [] };

  const out: ManifestApp[] = [];
  const customStrings: string[] = [];
  const seen = new Set<string>();
  for (const raw of (client.apps as unknown[]).slice(0, LIMITS.manifestApps)) {
    if (!raw || typeof raw !== 'object') continue;
    const id = sanitizeId(String((raw as any).id || ''));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const known = byId.get(id);
    if (known) {
      out.push(known); // the server's shape, never the client's copy of it
      continue;
    }
    if (!id.startsWith('custom:')) continue; // unknown non-custom ids are dropped
    const shape = clamp((raw as any).shape, LIMITS.customShape) || id.slice(7);
    const name = clamp((raw as any).name, LIMITS.appName);
    const affordances = clamp((raw as any).affordances, LIMITS.customShape);
    out.push({ id, shape, ...(name ? { name } : {}), ...(affordances ? { affordances } : {}) });
    customStrings.push(shape, name, affordances);
  }
  if (!out.length) return { apps: server.apps, customStrings: [] };
  return { apps: out, customStrings: customStrings.filter(Boolean) };
}

app.post(
  '/api/gen',
  bodyLimit({
    maxSize: LIMITS.body,
    onError: (c) => c.json({ error: 'too big' }, 413),
  }),
  async (c) => {
    const started = Date.now();
    const ua = c.req.header('user-agent');
    if (isBotUa(ua)) return c.json({ error: 'no' }, 403);

    // caps before the body is read: an over-cap client costs us nothing
    const ipHash = hashIp(clientIp(c));
    const decision = caps.take(ipHash);
    if (!decision.allowed) {
      c.header('retry-after', String(decision.retryAfter));
      // A refusal used to return before telemetry.record() and leave no trace
      // on stdout or /api/stats at all: that blindness is what voided
      // BAKEOFF-1 (two engines looked dead and were only rate-limited).
      telemetry.record(refusalLog(ipHash, 'gen', decision.reason || 'cap', started));
      return c.json({ queue: true, retryAfter: decision.retryAfter, reason: decision.reason }, 429);
    }

    let body: GenBody;
    try {
      body = await c.req.json<GenBody>();
    } catch {
      return c.json({ error: 'bad json' }, 400);
    }

    const kind = (body.kind || '') as Kind;
    if (!KINDS.includes(kind)) return c.json({ error: 'bad kind' }, 400);

    /**
     * H1 — `auto` resolves through the routing table for THIS kind; an explicit
     * engine id bypasses routing and hedging entirely, which is what keeps the
     * bake-off's per-engine verdicts meaningful. `engine` below is the primary
     * (or only) lane; `hedgeEngine` is the second one, when there is one.
     */
    const askedEngine = String(body.engine || 'mock');
    const routeFallback = findEngine(defaultEngine()) || findEngine('mock')!;
    const explicitEngine = askedEngine === AUTO ? null : findEngine(askedEngine);
    const route =
      askedEngine === AUTO
        ? resolveRoute(kind, routeFallback)
        : { primary: explicitEngine || findEngine('mock') || routeFallback, hedge: null, routed: false };
    const engine = route.primary;
    const hedgeEngine = route.hedge;
    const seed = String(body.seed || Math.random().toString(36).slice(2)).slice(0, 64);
    const ctxIn = body.context || {};
    const paramsIn = body.params && typeof body.params === 'object' ? body.params : {};
    const { apps: manifestApps, customStrings } = safeManifest(ctxIn.manifest);
    const manifest = { apps: manifestApps };

    const urlRaw = clamp(ctxIn.url, LIMITS.url);
    const urlParts = parseUrlParts(urlRaw);
    const refererUrl = clamp(ctxIn.referer_url, LIMITS.url);
    const refererTitle = clamp(ctxIn.referer_title, LIMITS.refererTitle);
    const history = (Array.isArray(ctxIn.history) ? ctxIn.history : [])
      .slice(-LIMITS.historyEntries)
      .map((h) => clamp(h, LIMITS.historyEntry))
      .filter(Boolean);
    let paramsJson = JSON.stringify(paramsIn);
    if (paramsJson.length > LIMITS.paramsJson) paramsJson = paramsJson.slice(0, LIMITS.paramsJson) + '…"}';

    // Moderation over the WHOLE user-controlled surface (SPEC §8), not just the
    // URL and top-level params: referer, history and Store-authored shapes all
    // reach the model too.
    const userStrings: string[] = [
      urlRaw,
      refererUrl,
      refererTitle,
      ...history,
      ...collectStrings(paramsIn),
      ...customStrings,
    ].filter(Boolean);
    // SPEC §12.1: the local list is microseconds and runs here; the remote call
    // runs in parallel with the generation and, if it flags late, aborts the
    // stream with an <!--os-reroute--> sentinel the kernel acts on.
    const modStart = Date.now();
    const mod = moderateLocalSync(userStrings, cfg.moderation);
    const moderationMs = Date.now() - modStart;
    const clientRerouted = body.rerouted === true;
    let rerouted = mod.flagged || clientRerouted;
    const remoteMod: Promise<boolean | null> =
      !rerouted && cfg.moderation === 'auto' && process.env.OPENAI_API_KEY
        ? moderateRemote(mod.inputs).catch(() => null)
        : Promise.resolve(null);

    /** the alias set this boot is remembered under (server/sessions.ts) */
    const bootKeys = { seed, session: clamp(body.session, 64) || undefined, client: ipHash };
    const appId = sanitizeId(String(ctxIn.app_id || (paramsIn as any).app_id || ''));
    const identity = body.identity ? coerceBootIdentity(body.identity, seed, rngFrom(seed)) : null;
    const lineageName = clamp(ctxIn.lineage?.name, LIMITS.appName);
    const lineageVersion = clamp(ctxIn.lineage?.version, 40);
    const videos = videosJson();
    /**
     * SPEC §12.4 — the SERVER rolls era/setting/temperament/two materials and
     * passes them as hard constraints, plus the ring of names never to reuse.
     * Only the two kinds that invent an identity pay the input tokens for them.
     */
    const rolls = kind === 'boot' || kind === 'identity';
    const dice = rolls ? rollDice(loadDice(), rngFrom(seed)) : null;
    /**
     * H5 — the reality offset, rolled from the session seed so every page and
     * every app of one session lives in the same slightly wrong world, and
     * rendered only into the two kinds that state facts. A boot screen and a
     * desktop have no measurements to get right, and the input tokens are not
     * free.
     */
    const reality = kind === 'page' || kind === 'app' ? rollReality(loadReality(), rngFrom(seed + ':reality')) : null;

    const vars: PromptVars = {
      // SPEC §3.1: pages never receive identity.
      identity_json: kind === 'page' ? '' : identity ? JSON.stringify(identity) : '',
      manifest_json: JSON.stringify(manifest),
      // the launcher attributes spelled out literally; cheap models copy a list
      // far more reliably than they re-derive one from the manifest JSON
      app_launchers: manifest.apps.map((a) => `data-os-app="${a.id}"`).join(' '),
      app_count: String(manifest.apps.length),
      seed,
      app_id: appId || undefined,
      params_json: paramsJson,
      url: urlParts.url,
      domain: urlParts.domain,
      path: urlParts.path,
      query: urlParts.query,
      referer_url: refererUrl,
      referer_title: refererTitle,
      history: history.join('\n'),
      rerouted: rerouted ? 'true' : 'false',
      // a note about this url's shape, next to the url (prompts/notes/<class>.md)
      shape_note: kind === 'page' ? pageShapeNote(urlParts.domain, urlParts.path) : '',
      missing_hooks: (Array.isArray(ctxIn.missing_hooks) ? ctxIn.missing_hooks : [])
        .slice(0, LIMITS.missingHooks)
        .map((h) => clamp(h, 64))
        .join(', '),
      // SPEC §5: the slot is offered to the model only when it has entries
      videos_json: videos && videos !== '[]' ? videos : '',
      viewport: clamp(ctxIn.viewport, 32),
      ...(dice ? { dice_json: JSON.stringify(dice), never_names: namesRing.joined() } : {}),
      ...(reality ? { reality_json: JSON.stringify(reality) } : {}),
      // I5: the desktop must be built to the archetype the identity declared
      ...(identity ? { archetype: identity.archetype } : {}),
      ...(lineageName ? { lineage_name: lineageName, lineage_version: lineageVersion, lineage_next_version: nextVersion(lineageVersion) } : {}),
    };

    let built = buildPrompt(kind, vars);
    // prompts/apps/<id>.md is the app's brief. Only when there is no such file
    // (a Store-installed custom app) does the manifest one-liner stand in.
    if (appId && !built.usedFiles.includes(`apps/${appId}.md`)) {
      built = buildPrompt(kind, { ...vars, app_shape: shapeFromManifest(manifest, appId) });
    }

    // the hedge may carry a different per-engine override; the byte cap has to
    // fit whichever lane wins
    const maxTokens = Math.max(maxTokensFor(kind, engine), hedgeEngine ? maxTokensFor(kind, hedgeEngine) : 0);
    const promptTokens = estTokens(built.system + built.user);

    // SPEC §1.8: the money ceiling, HELD against this generation's worst case
    // (full output budget, plus the identity fallback a boot may need) before a
    // single token is bought, and reconciled to the real cost when it ends.
    // H2: the hold covers BOTH lanes. A hedge we might buy is money we might
    // spend, and the ceiling is not allowed to find out afterwards.
    const worstFor = (e: typeof engine) =>
      costUsd(e, promptTokens, maxTokensFor(kind, e)) +
      (kind === 'boot' ? costUsd(e, promptTokens, maxTokensFor('identity', e)) : 0);
    const worstCase = worstFor(engine) + (hedgeEngine ? worstFor(hedgeEngine) : 0);
    const reservation = caps.reserve(worstCase);
    if (!reservation.allowed) {
      c.header('retry-after', String(reservation.retryAfter));
      telemetry.record(refusalLog(ipHash, kind, reservation.reason || 'cap', started, engine.id));
      return c.json({ queue: true, retryAfter: reservation.retryAfter, reason: reservation.reason }, 429);
    }

    const genCtx: GenCtx = {
      kind,
      engineId: engine.id,
      vars,
      seed,
      system: built.system,
      user: built.user,
      maxTokens: maxTokensFor(kind, engine),
      temperature: temperatureFor(engine),
    };
    /**
     * H2 — which engine is actually being billed for the document going out.
     * It is the primary until the race is decided and the winner's id replaces
     * it, and everything that spends money afterwards (the identity rescue call,
     * the cost line, the reservation) reads THIS and not `engine`.
     */
    let billEngine = engine;
    let hedgeReport: HedgeReport | null = null;
    const hedgeLog = (): Partial<GenLog> =>
      hedgeReport
        ? {
            ...(hedgeReport.hedged ? { hedged: true } : {}),
            ...(hedgeReport.hedged || route.routed ? { winner: hedgeReport.winner } : {}),
            ...(hedgeReport.loser ? { loser: hedgeReport.loser } : {}),
            ...(hedgeReport.loser_aborted_ms !== undefined ? { loser_aborted_ms: hedgeReport.loser_aborted_ms } : {}),
            ...(hedgeReport.loser_tokens_in !== undefined ? { loser_tokens_in: hedgeReport.loser_tokens_in } : {}),
            ...(hedgeReport.loser_tokens_out !== undefined ? { loser_tokens_out: hedgeReport.loser_tokens_out } : {}),
            ...(hedgeReport.failed_over ? { failed_over: true } : {}),
          }
        : {};
    /** what the losing lane billed us, added to this generation's cost */
    const loserUsd = () => hedgeReport?.loser_usd || 0;

    // one controller per request: a browser that goes away stops the meter.
    // I4: an untaken speculative generation is aborted by the kernel, which
    // aborts this fetch, which aborts the upstream call and stops the spend.
    const ac = new AbortController();
    const abortUpstream = () => {
      try {
        ac.abort();
      } catch {}
    };
    /**
     * The client went away (an untaken speculative generation is exactly this).
     * Tracked separately from the wall clock and the reroute, because an engine
     * whose iterator ends cleanly on the signal — the mock does, and so do the
     * real ones — otherwise falls straight through to the contract validator and
     * is logged as a FINISHED generation with a verdict over a half-written
     * document. The bake-off's headline contract-miss rate counts those.
     */
    let clientAborted = false;
    const onClientAbort = () => {
      clientAborted = true;
      abortUpstream();
    };
    try {
      c.req.raw.signal?.addEventListener('abort', onClientAbort, { once: true });
    } catch {}

    /**
     * The id the kernel quotes back on /api/mark (I6). The kernel mints one of
     * its own before the response exists (it needs an id to report first paint
     * against), so a sane one in the body is adopted rather than replaced —
     * otherwise every early mark lands on a gen_id the server never used.
     */
    const clientGenId = String((body as any).gen_id || '');
    const genId = /^[A-Za-z0-9_:.-]{1,64}$/.test(clientGenId) ? clientGenId : randomUUID().slice(0, 18);
    // both free bookkeeping routes only accept ids that appear here
    issueGenId(genId, kind);
    /**
     * I1: BAKEOFF-1 saw a page hang for 180 s. Nothing runs longer than this.
     * S4: the clock is per engine — `timeout_ms` in engines.json, falling back
     * to GEN_TIMEOUT_MS. BAKEOFF-2 finding 2: haiku's desktops median 25,003 ms
     * against our own 25,000 ms cap, so half its boots died on OUR clock.
     */
    const genTimeoutMs = Math.max(
      1000,
      timeoutFor(engine, cfg.genTimeoutMs),
      hedgeEngine ? timeoutFor(hedgeEngine, cfg.genTimeoutMs) : 0
    );
    let timedOut = false;
    let rerouteMidStream = false;
    const genTimer = setTimeout(() => {
      timedOut = true;
      abortUpstream();
    }, genTimeoutMs);
    /** set the moment the upstream request is issued, so provider TTFB is separable */
    let upstreamAt = 0;
    let providerTtfb = 0;
    remoteMod.then((flag) => {
      if (flag !== true) return;
      rerouted = true;
      rerouteMidStream = true;
      abortUpstream();
    });

    const log = (extra: Partial<GenLog>, tokensIn: number, tokensOut: number, ttfb: number, contractOk: boolean | null) => {
      clearTimeout(genTimer);
      const total = Date.now() - started;
      const usd = costUsd(billEngine, tokensIn, tokensOut) + loserUsd();
      reservation.settle(usd);
      telemetry.record({
        ts: new Date().toISOString(),
        kind,
        gen_id: genId,
        engine: billEngine.id,
        ip_hash: ipHash,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        ttfb_ms: ttfb,
        total_ms: total,
        tok_per_s: total > 0 ? Math.round((tokensOut / total) * 1000) : 0,
        usd,
        contract_ok: contractOk,
        rerouted,
        // I6: where the time went
        moderation_ms: moderationMs,
        server_ms: upstreamAt ? upstreamAt - started : Date.now() - started,
        provider_ttfb_ms: providerTtfb,
        ...(timedOut ? { timed_out: true } : {}),
        ...(rerouteMidStream ? { reroute_mid_stream: true } : {}),
        // SPEC §8: the hash exists to spot repeat abuse of a flagged string, so
        // it is written only when something actually fired.
        ...(rerouted && mod.hash ? { mod_hash: mod.hash } : {}),
        ...extra,
      });
    };

    /** What the client is allowed to learn about an upstream failure. */
    const clientError = (err: unknown): { message: string; status: number } => {
      if (err instanceof EngineHttpError) return { message: 'engine unavailable', status: err.status };
      return { message: 'engine unavailable', status: 0 };
    };
    const logDetail = (err: any): string =>
      redactSecrets(err instanceof EngineHttpError ? `${err.message}: ${err.detail}` : String(err?.message || err)).slice(0, 400);

    // identity is JSON, not HTML (SPEC §2.1). I1 retires this from the boot
    // path — the kernel no longer calls it — but it stays for tests and it is
    // what the server itself falls back to when a model's own identity comment
    // in the boot stream turns out to be unusable.
    if (kind === 'identity') {
      genCtx.jsonMode = true;
      let raw = '';
      let ttfb = 0;
      let usage: { in: number; out: number } | null = null;
      try {
        upstreamAt = Date.now();
        for await (const chunk of streamGen(engine, genCtx, ac.signal)) {
          if (chunk.text) {
            if (!ttfb) {
              ttfb = Date.now() - started;
              providerTtfb = Date.now() - upstreamAt;
            }
            raw += chunk.text;
          }
          if (chunk.usage) usage = chunk.usage;
        }
      } catch (err: any) {
        log({ error: timedOut ? 'timeout' : logDetail(err), refusal: 'engine_dead' }, promptTokens, 0, ttfb, null);
        const e = clientError(err);
        return c.json({ error: 'engine', status: e.status || undefined }, timedOut ? 504 : 502);
      }
      let identityOut: BootIdentity;
      try {
        identityOut = coerceBootIdentity(extractJson(raw), seed, rngFrom(seed + ':arch'));
      } catch {
        identityOut = coerceBootIdentity({}, seed, rngFrom(seed + ':arch'));
      }
      namesRing.add(identityOut.name);
      boots.rememberIdentity(bootKeys, identityOut);
      const tin = usage?.in ?? promptTokens;
      const tout = usage?.out ?? estTokens(raw);
      log({}, tin, tout, ttfb, null);
      c.header('cache-control', 'no-store');
      c.header('x-os-gen-id', genId);
      return c.json({
        identity: identityOut,
        engine: engine.id,
        seed,
        gen_id: genId,
        telemetry: { ttfb_ms: ttfb, tokens_in: tin, tokens_out: tout, usd: costUsd(engine, tin, tout) },
      });
    }

    const filter = new HtmlStreamFilter();
    const encoder = new TextEncoder();
    const maxBytes = Math.ceil(maxTokens * LIMITS.outputSlack);
    let ttfb = 0;
    let accumulated = '';
    let truncated = false;
    // the provider's own finish_reason: 'length' means the model ran out of
    // budget mid-document. Without this a desktop that stopped at exactly
    // max_tokens was reported as a clean contract miss instead of a truncation.
    let finish: string | null = null;
    let usage: { in: number; out: number } | null = null;
    /** tokens bought by the I1 fallback identity call, if one was needed */
    let fbIn = 0;
    let fbOut = 0;
    let identityFallback = false;
    /** why the model's own comment was unusable, for the telemetry line */
    let identityFail: IdentityFail | undefined;
    let identityMode: 'json' | 'text' | undefined;
    let identityTries = 0;
    /** IDENTITY_DEBUG=1: the head the model actually wrote, when it failed */
    let identityHead: string | undefined;
    /** IDENTITY_DEBUG=1: what the rescue call answered, which is the other half of the diagnosis */
    let identityFbHead: string | undefined;
    /** the I1 diagnosis, on every line that reports a boot */
    const identityLog = (): Partial<GenLog> => ({
      ...(identityFallback
        ? {
            identity_fallback: true,
            ...(identityFail ? { identity_fail: identityFail } : {}),
            ...(identityMode ? { identity_fallback_mode: identityMode } : {}),
            ...(identityTries ? { identity_fallback_tries: identityTries } : {}),
          }
        : {}),
      // under IDENTITY_DEBUG the head goes out on EVERY boot, pass or fail:
      // scripts/identity-sweep.mjs replays the same twenty heads through a
      // changed parser, which is the only way to get a before/after on one
      // sample instead of two.
      ...(identityHead ? { identity_head: identityHead } : {}),
      ...(identityFbHead ? { identity_fb_head: identityFbHead } : {}),
    });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const emit = (s: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(s));
          } catch {
            closed = true;
          }
        };
        const push = (s: string) => {
          if (!s || truncated) return;
          accumulated += s;
          emit(s);
          // SPEC §2.1 output hard cap per kind. max_tokens is a request to the
          // provider; this is the part we control.
          if (accumulated.length >= maxBytes) {
            truncated = true;
            abortUpstream();
          }
        };

        /**
         * I1 — the identity comment, guaranteed.
         *
         * The gate holds the head of a boot stream until `<!--os-identity:…-->`
         * closes (or 400 tokens go by), validates it, and — when it is missing
         * or malformed — buys one `kind=identity` call on the same engine and
         * injects a valid comment itself. The kernel is therefore never the
         * thing that has to cope with UNNAMED/VAUF.
         */
        const gate = kind === 'boot' ? new BootIdentityGate(seed) : null;
        let gateDone = gate === null;

        /**
         * The rescue call. BAKEOFF-2's 25% UNNAMED rate had two halves: the
         * comment did not parse (fixed in identity.ts), and this call then
         * failed to rescue it, because it asked for JSON in prose and got prose
         * back. So:
         *   - JSON mode / structured outputs where the engine supports it
         *     (`json_mode` in engines.json: Cerebras and OpenRouter do),
         *   - ONE retry, and the retry drops the temperature: a second sample
         *     at 1.1 fails the same way about as often as the first.
         * Two attempts of ~150 tokens on the boot engine is ~$0.0002, against a
         * whole characterless OS.
         */
        const fallbackIdentity = async (): Promise<BootIdentity> => {
          const b = buildPrompt('identity', vars);
          identityMode = billEngine.json_mode ? 'json' : 'text';
          const attempt = async (n: number): Promise<unknown> => {
            const idCtx: GenCtx = {
              kind: 'identity',
              engineId: billEngine.id,
              vars,
              seed,
              system: b.system,
              user: b.user,
              maxTokens: maxTokensFor('identity', billEngine),
              // the retry samples colder: the same prompt at the same
              // temperature is the same coin flip twice
              temperature: n === 0 ? temperatureFor(billEngine) : Math.min(temperatureFor(billEngine), 0.7),
              jsonMode: true,
            };
            let raw = '';
            let got: { in: number; out: number } | null = null;
            identityTries = n + 1;
            try {
              for await (const ch of streamGen(billEngine, idCtx, ac.signal)) {
                if (ch.text) raw += ch.text;
                if (ch.usage) got = ch.usage;
              }
            } catch {
              /* an engine that cannot even write 150 tokens of JSON still gets a
                 valid (if dull) machine below, rather than a dead boot */
            }
            fbIn += got?.in ?? estTokens(b.system + b.user);
            fbOut += got?.out ?? estTokens(raw);
            if (debugIdentity) identityFbHead = ((identityFbHead || '') + ' |' + n + '| ' + raw).slice(0, 600);
            try {
              return extractJson(raw);
            } catch {
              return null;
            }
          };
          let json = await attempt(0);
          // one retry, and only when there is still time on this generation's
          // clock: a boot that is already past its deadline must not buy more
          if (!validIdentityPayload(json) && !ac.signal.aborted && Date.now() - started < genTimeoutMs - 1500) {
            const second = await attempt(1);
            if (validIdentityPayload(second)) json = second;
            else if (!validIdentityPayload(json)) json = second ?? json;
          }
          return coerceBootIdentity(json, seed, rngFrom(seed + ':arch'));
        };

        const flushGate = async () => {
          if (!gate || gateDone) return;
          gateDone = true;
          const r = gate.result(rngFrom(seed + ':arch'));
          let id = r.identity;
          // the raw head is the only way to diagnose the next failure class
          // rather than guess at it (scripts/identity-sweep.mjs reads this)
          if (debugIdentity) {
            // 1,200 chars, not 400: a complete identity comment is ~700 and a
            // clip that cuts it in half looks exactly like a model that never
            // closed it, which makes the replay sample (test/identity-heads)
            // unreadable.
            identityHead = gate.buffered().slice(0, 1200);
          }
          if (!id) {
            identityFallback = true;
            identityFail = r.fail;
            id = await fallbackIdentity();
          }
          namesRing.add(id.name);
          // this boot's identity, for the server-built image prompts (S3)
          boots.rememberIdentity(bootKeys, id);
          // the comment goes out raw: the HTML filter drops everything before
          // <!doctype, which is exactly where this line has to live.
          push(renderIdentityComment(id) + '\n');
          if (r.rest) push(filter.push(r.rest));
        };

        /**
         * H2 — one or two lanes, one stream out. With no hedge engine the
         * hedger holds nothing back (commitChars 0) and this is byte-for-byte
         * the v0.2 path; with one, the first 64 characters are held until a lane
         * is committed. See server/hedge.ts.
         */
        const hedger = new Hedger(engine, hedgeEngine, genCtx, ac.signal, {
          hedgeAfterMs: hedgeAfterFor(kind),
          commitChars: hedgeEngine ? HEDGE_COMMIT_CHARS : 0,
          commitMs: HEDGE_COMMIT_MS,
        });
        try {
          upstreamAt = Date.now();
          for await (const chunk of hedger.run()) {
            if (chunk.text) {
              if (!ttfb) {
                ttfb = Date.now() - started;
                hedgeReport = hedger.report();
                billEngine = hedger.winnerEngine();
                // the winner's OWN provider TTFB, not the race's: a hedge that
                // started 900 ms in must not be scored as a 900 ms slower engine
                providerTtfb = hedgeReport.winner_ttfb_ms ?? Date.now() - upstreamAt;
                // BAKEOFF-2 finding 6: the icon sheet is waiting for exactly
                // this — the desktop has begun, so the boot is real and its
                // pictures are worth buying.
                if (kind === 'desktop' || kind === 'repair') boots.noteDesktopStarted(bootKeys);
              }
              if (!gateDone && gate) {
                if (gate.push(chunk.text)) await flushGate();
              } else {
                push(filter.push(chunk.text));
              }
            }
            if (chunk.usage) usage = chunk.usage;
            if (chunk.finish) finish = chunk.finish;
            if (truncated || rerouteMidStream || timedOut) break;
          }
          hedgeReport = hedger.report();
          billEngine = hedger.winnerEngine();
          if (!rerouteMidStream && !timedOut) {
            await flushGate();
            push(filter.end());
          }
        } catch (err: any) {
          hedgeReport = hedger.report();
          billEngine = hedger.winnerEngine();
          const tin = (usage?.in ?? promptTokens) + fbIn;
          log(
            {
              ...(clientAborted ? { aborted: true } : {}),
              error: rerouteMidStream ? 'rerouted' : timedOut ? 'timeout' : clientAborted ? 'client aborted' : logDetail(err),
              // a reroute and a client that went away are ours; a timeout and an
              // upstream error are the engine's (BAKEOFF-2 finding 1)
              ...(rerouteMidStream || clientAborted ? {} : { refusal: 'engine_dead' as const }),
              ...identityLog(),
              ...hedgeLog(),
            },
            tin,
            (usage?.out ?? estTokens(accumulated)) + fbOut,
            ttfb,
            null
          );
          emit(
            rerouteMidStream
              ? `\n<!--os-reroute:${JSON.stringify({ reason: 'moderation' })}-->\n`
              : `\n<!--os-error:${JSON.stringify({ message: timedOut ? 'timeout' : clientError(err).message })}-->\n`
          );
          controller.close();
          return;
        }
        if (timedOut) {
          // I1 — the wall clock won. An engine that aborts cleanly on the
          // signal (the mock does) lands here rather than in the catch above,
          // and the kernel must still be told to regenerate this one document.
          log({ error: 'timeout', refusal: 'engine_dead', ...hedgeLog() }, (usage?.in ?? promptTokens) + fbIn, (usage?.out ?? estTokens(accumulated)) + fbOut, ttfb, null);
          emit(`\n<!--os-error:${JSON.stringify({ message: 'timeout' })}-->\n`);
          controller.close();
          return;
        }
        if (rerouteMidStream) {
          // SPEC §12.1: remote moderation flagged after the stream had started.
          // The kernel throws this document away and asks for the rerouted one;
          // nothing about the hit is ever shown to the visitor (SPEC §1.4).
          log({ ...identityLog(), ...hedgeLog() }, (usage?.in ?? promptTokens) + fbIn, (usage?.out ?? estTokens(accumulated)) + fbOut, ttfb, null);
          emit(`\n<!--os-reroute:${JSON.stringify({ reason: 'moderation' })}-->\n`);
          controller.close();
          return;
        }
        const tin = (usage?.in ?? promptTokens) + fbIn;
        const tout = (usage?.out ?? estTokens(accumulated)) + fbOut;
        if (clientAborted) {
          // Half a document. No verdict over it, in either direction, and the
          // line says plainly that nothing finished.
          log({ aborted: true, ...identityLog(), ...hedgeLog() }, tin, tout, ttfb, null);
          controller.close();
          return;
        }
        const contract =
          kind === 'desktop' || kind === 'repair'
            ? validate('desktop', accumulated, { appIds: manifest.apps.map((a) => a.id) })
            : kind === 'app'
              ? validate('app', accumulated, { appId })
              : { ok: true, missing: [] as string[] };
        const usd = costUsd(billEngine, tin, tout) + loserUsd();
        const total = Date.now() - started;
        const contractOk = kind === 'desktop' || kind === 'repair' || kind === 'app' ? contract.ok : null;
        if (finish === 'length') truncated = true;
        log(
          { ...(truncated ? { truncated: true } : {}), ...identityLog(), ...hedgeLog() },
          tin,
          tout,
          ttfb,
          contractOk
        );
        const sentinel = {
          gen_id: genId,
          engine: billEngine.id,
          kind,
          ...(hedgeReport?.hedged ? { hedged: true, winner: hedgeReport.winner, loser: hedgeReport.loser } : {}),
          ...(hedgeReport?.failed_over ? { failed_over: true } : {}),
          ttfb_ms: ttfb,
          total_ms: total,
          tokens_in: tin,
          tokens_out: tout,
          tok_per_s: total > 0 ? Math.round((tout / total) * 1000) : 0,
          usd,
          contract_ok: contractOk,
          missing: contract.missing,
          truncated,
          prompt_fallbacks: built.fallbacks,
          // I6: the breakdown, so "it feels slow" is attributable
          moderation_ms: moderationMs,
          server_ms: upstreamAt ? upstreamAt - started : 0,
          provider_ttfb_ms: providerTtfb,
          ...(identityFallback ? { identity_fallback: true, ...(identityFail ? { identity_fail: identityFail } : {}) } : {}),
          // NOTE: `rerouted` is deliberately absent. SPEC §1.4 wants the reroute
          // invisible; it lives in the stdout telemetry line instead.
        };
        emit(`\n<!--os-telemetry:${JSON.stringify(sentinel)}-->\n`);
        controller.close();
      },
      cancel() {
        // the browser went away mid-stream (I4: an untaken speculative
        // generation is exactly this): stop paying for the rest of it, and
        // settle the hold at what was actually streamed.
        clientAborted = true;
        abortUpstream();
        clearTimeout(genTimer);
        reservation.settle(costUsd(billEngine, promptTokens + fbIn, estTokens(accumulated) + fbOut) + loserUsd());
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
        'x-accel-buffering': 'no',
        'x-os-gen-id': genId,
      },
    });
  }
);

app.notFound((c) => c.text('not here', 404));

const port = cfg.port;
if (!process.env.HALLUCINOS_NO_LISTEN) {
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      caps.flush();
      process.exit(0);
    });
  }
  serve({ fetch: app.fetch, port, ...(cfg.host ? { hostname: cfg.host } : {}) }, (info) => {
    const engines = availableEngines().map((e) => e.id).join(', ');
    process.stdout.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'listening',
        url: `http://localhost:${info.port}`,
        /** which interfaces: '*' is every one of them, IPv4 and IPv6 (README) */
        host: cfg.host || '*',
        engines,
        /**
         * T1 — the two lines an operator has to be able to read off a boot log:
         * what `/` will actually use, and when a second lane gets bought.
         * HANDOFF-6 §2 existed because neither was printed anywhere.
         */
        default_engine: advertisedDefault(),
        pinned: enginePinned(),
        hedge_after_ms: hedgeTriggers(),
        moderation: cfg.moderation,
        caps: {
          per_ip_per_hour: cfg.genPerIpPerHour,
          max_per_day: cfg.maxGenPerDay,
          max_usd_per_day: cfg.maxUsdPerDay,
          state_file: cfg.capsStateFile || 'memory only',
        },
        kernel: existsSync(resolve(ROOT, 'public/kernel.js'))
          ? `public/kernel.js ${statSync(resolve(ROOT, 'public/kernel.js')).size}b`
          : 'MISSING — run npm run build',
      }) + '\n'
    );
  });
}

export default app;
export { app, telemetry, caps };
