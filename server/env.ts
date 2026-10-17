import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Project root (the repo root), resolved from this file's location at build time or runtime. */
export const ROOT = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  // running from server/ (tsx/dev) or dist/ (built) -> parent is the project root
  return resolve(here, '..');
})();

/** Minimal .env loader: no dependency, never overwrites an already-set variable. */
export function loadEnv(file = resolve(ROOT, '.env')): void {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

export function num(name: string, dflt: number): number {
  const v = process.env[name];
  if (!v) return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

export const config = () => ({
  port: num('PORT', 8790),
  /**
   * Which interfaces to listen on. Empty (the default) means the node wildcard
   * — every interface, IPv4 and IPv6 — which is what makes `http://<laptop LAN
   * ip>:<port>/` work from a phone on the same Wi-Fi (README, "Test it on your
   * phone") and what Railway needs in production.
   *
   * It is a variable rather than a hard `0.0.0.0` on purpose: binding that
   * literal string would DROP IPv6, and `localhost` resolves to `::1` first on
   * macOS — which is the address the e2e suite and every `curl localhost` here
   * use. So the default keeps both families and `HOST=127.0.0.1` is available
   * to anyone who wants the server off their network.
   */
  host: (process.env.HOST || '').trim(),
  genPerIpPerHour: num('GEN_PER_IP_PER_HOUR', 60),
  maxGenPerDay: num('MAX_GEN_PER_DAY', 10000),
  /** SPEC §1.8: production must not be able to spend more than ~$25/day. */
  maxUsdPerDay: num('MAX_USD_PER_DAY', 25),
  /** How many proxies of ours sit in front of this process; see caps.clientIpFrom. */
  trustedProxyHops: num('TRUSTED_PROXY_HOPS', 0),
  /**
   * Whether X-Forwarded-For is evidence. Off by default: the header is only
   * meaningful when a proxy of ours terminated the connection, and anywhere this
   * process is reachable directly a client can rotate it to mint per-IP buckets.
   * Set TRUST_PROXY=1 on Railway (see DEPLOY.md), nowhere else.
   */
  trustProxy: /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || ''),
  /** Upstream generations allowed in flight at once (the USD ceiling's second half). */
  maxConcurrentGen: num('MAX_CONCURRENT_GEN', 12),
  /**
   * Image calls allowed in flight at once — a lane of their own. Sharing the
   * text lane meant six visitors' wallpapers could hold every slot for
   * IMG_TIMEOUT_MS and every later visitor got the kernel's over-capacity
   * screen while nothing was generating.
   */
  maxConcurrentImg: num('MAX_CONCURRENT_IMG', 6),
  /**
   * Where the day counters are mirrored so a redeploy or crash does not reset
   * them. Point it at a Railway volume in production (see DEPLOY.md). Empty
   * string, or a test run, keeps them in memory only.
   */
  capsStateFile:
    process.env.NODE_ENV === 'test'
      ? ''
      : process.env.CAPS_STATE_FILE === undefined
        ? resolve(ROOT, 'data/caps-state.json')
        : process.env.CAPS_STATE_FILE,
  /** auto = OpenAI omni-moderation when OPENAI_API_KEY is set, else the local list. local = always the list. off = disabled. */
  moderation: (process.env.MODERATION || 'auto') as 'auto' | 'local' | 'off',
  /**
   * I1 — a wall-clock ceiling on one generation. BAKEOFF-1 saw a page hang for
   * 180 s; on timeout the stream ends with an <!--os-error--> sentinel and the
   * kernel regenerates that one document once.
   */
  genTimeoutMs: num('GEN_TIMEOUT_MS', 25000),
  /**
   * How long one fal image call may take before it is abandoned (SPEC §12.5).
   *
   * 20 s was too long and 5 s is too short. Measured on the real endpoint:
   * schnell itself answers in ~2.6 s, and then WE download the bytes (496 KB
   * for a wallpaper, 931 KB for an icon sheet) — 6.6 s and 4.9 s end to end. A
   * 5 s ceiling killed the wallpaper on every real boot, and because a failure
   * after fal's 2xx is now billed, the day's USD total looked identical. 10 s
   * covers the measured distribution with headroom; a call that is still
   * running past it is only holding an image lane slot.
   *
   * Raised to 18 s after BAKEOFF-3 (2026-09-17 evening). That measurement was
   * taken on one afternoon and fal is not that afternoon every day: on the
   * evening of the same day six wallpaper calls through the same code took
   * 2.9-14.1 s, and in the bake-off the boot's own pictures came back in a
   * median 4.5 s (wallpaper) and 8.4 s (icon sheet) — with one of each dying on
   * the 10 s ceiling, and fifteen of sixteen app pictures dying on it. Nothing
   * on screen waits for an image (they fade in late by design) and the image
   * lane is not the text lane, so the cost of a generous ceiling is a held lane
   * slot, while the cost of a tight one is an empty grey square in the product.
   *
   * v0.5 (T3): 20,000. HANDOFF-6 §3 asked for it as the one-variable mitigation
   * for the picture most often lost, and its own second pass (R4) found the
   * number it was arguing against was already 18,000 — so this is the last
   * 2,000 ms of that argument, not a new theory. The measured tail that
   * justifies it: an icon sheet at 13.0 s on a quiet boot and 14.2 s under the
   * stress runner, both of which land inside 20 s and neither inside 10 s.
   */
  imgTimeoutMs: num('IMG_TIMEOUT_MS', 20000),
  /** SPEC §12.4's ring buffer of recent OS names. Empty string = memory only. */
  namesRingFile:
    process.env.NODE_ENV === 'test'
      ? ''
      : process.env.NAMES_RING_FILE === undefined
        ? resolve(ROOT, 'data/names-ring.json')
        : process.env.NAMES_RING_FILE,
  /** mock engine: force a contract miss, for the repair/fallback path. '', 'desktop-once', 'desktop-always' */
  mockBreak: process.env.MOCK_BREAK || '',
  mockDelayMs: num('MOCK_DELAY_MS', 8),
});
