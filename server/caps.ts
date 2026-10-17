import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

/** SPEC §2.1 caps, plus the USD ceiling SPEC §1.8 asks for ("enforced by caps, not by hope"). */

export const BOT_UA =
  /(googlebot|bingbot|yandexbot|duckduckbot|baiduspider|slurp|gptbot|oai-searchbot|chatgpt-user|claudebot|claude-web|anthropic-ai|perplexitybot|ccbot|bytespider|amazonbot|applebot|meta-externalagent|facebookexternalhit|semrushbot|ahrefsbot|mj12bot|dotbot|petalbot|curl\/|wget\/|python-requests|python-urllib|httpx|aiohttp|libwww-perl|okhttp|go-http-client|java\/|scrapy|puppeteer|playwright|headlesschrome|phantomjs|selenium|node-fetch|axios\/)/i;

export function isBotUa(ua: string | undefined | null): boolean {
  if (!ua || !ua.trim()) return true; // no user agent at all is not a browser
  return BOT_UA.test(ua);
}

export function hashIp(ip: string, salt = process.env.IP_SALT || 'hallucinos'): string {
  return createHash('sha256').update(salt + '|' + ip).digest('hex').slice(0, 16);
}

/**
 * The client address.
 *
 * `X-Forwarded-For` is a header any client can send. It is only evidence when a
 * proxy of *ours* terminated the connection, so it is read ONLY when
 * `trustProxy` is on (env `TRUST_PROXY=1`, set on Railway — see DEPLOY.md).
 * Reachable directly — dev, a container port, an edge bypass — the header is
 * ignored entirely and the socket address is the bucket; otherwise rotating
 * `X-Forwarded-For` values hands an attacker an unlimited number of per-IP
 * buckets and the per-IP cap is decorative.
 *
 * When it IS trusted: each proxy appends, so the entries a client sent itself
 * end up on the LEFT and the address our edge saw ends up on the RIGHT.
 * `trustedHops` is how many proxies of ours sit in front of this process
 * (Railway's edge = 0 extra hops to skip: its entry is the last one).
 */
export function clientIpFrom(
  xff: string | null | undefined,
  xReal: string | null | undefined,
  socketAddr: string | null | undefined,
  trustedHops = 0,
  trustProxy = false
): string {
  if (trustProxy) {
    const list = String(xff || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length) {
      const idx = Math.max(0, list.length - 1 - Math.max(0, trustedHops | 0));
      return list[idx];
    }
    if (!socketAddr && xReal) return String(xReal).trim();
  }
  if (socketAddr) return String(socketAddr);
  return '0.0.0.0';
}

export interface CapDecision {
  allowed: boolean;
  reason?: 'ip-hour' | 'day' | 'usd' | 'busy';
  retryAfter: number;
}

/**
 * An admitted generation's hold on the day's budget. The worst case is booked
 * at admission and reconciled to the real cost when the generation ends, so N
 * concurrent generations can never all price themselves against the same
 * balance.
 */
export interface Reservation extends CapDecision {
  settle(actualUsd: number): void;
}

interface Bucket {
  hits: number[];
}

export interface CapsOpts {
  now?: () => number;
  /** JSON file the day counters are mirrored into, so a restart does not reset them. */
  stateFile?: string;
  /** upstream generations allowed in flight at once */
  maxConcurrent?: number;
  /**
   * Image calls allowed in flight at once. Their own ceiling, deliberately:
   * sharing the text lane meant twelve slow wallpapers (IMG_TIMEOUT_MS each)
   * took /api/gen down for everybody while nothing was actually generating.
   */
  maxConcurrentImg?: number;
}

/** Which in-flight ceiling a reservation counts against. */
export type Lane = 'gen' | 'img';

export class Caps {
  private perIp = new Map<string, Bucket>();
  private day = { key: '', count: 0, usd: 0 };
  private now: () => number;
  private stateFile: string | null;
  private lastWrite = 0;
  private inflight = 0;
  private inflightImg = 0;
  private maxConcurrent: number;
  private maxConcurrentImg: number;

  constructor(
    private perIpPerHour: number,
    private maxPerDay: number,
    private maxUsdPerDay: number = Infinity,
    opts: CapsOpts = {}
  ) {
    this.now = opts.now || (() => Date.now());
    this.stateFile = opts.stateFile || null;
    this.maxConcurrent = opts.maxConcurrent && opts.maxConcurrent > 0 ? opts.maxConcurrent : Infinity;
    this.maxConcurrentImg = opts.maxConcurrentImg && opts.maxConcurrentImg > 0 ? opts.maxConcurrentImg : Infinity;
    this.load();
  }

  private dayKey(t: number) {
    return new Date(t).toISOString().slice(0, 10);
  }

  private load() {
    if (!this.stateFile) return;
    try {
      const j = JSON.parse(readFileSync(this.stateFile, 'utf8'));
      if (j && typeof j.key === 'string') {
        this.day = { key: j.key, count: Number(j.count) || 0, usd: Number(j.usd) || 0 };
      }
    } catch {
      /* no state yet, or unreadable: start the day at zero */
    }
  }

  private save(force = false) {
    if (!this.stateFile) return;
    const t = this.now();
    if (!force && t - this.lastWrite < 1000) return;
    this.lastWrite = t;
    try {
      mkdirSync(dirname(this.stateFile), { recursive: true });
      const tmp = this.stateFile + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.day));
      renameSync(tmp, this.stateFile);
    } catch {
      /* the counters stay in memory; a read-only fs is not a reason to stop serving */
    }
  }

  private roll(t: number) {
    const dk = this.dayKey(t);
    if (this.day.key !== dk) {
      this.day = { key: dk, count: 0, usd: 0 };
      this.save(true);
    }
  }

  private untilMidnight(t: number) {
    const d = new Date(t);
    const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    return Math.max(1, Math.ceil((midnight - t) / 1000));
  }

  /** Counts one generation against the count caps and says whether it may proceed. */
  take(ipHash: string): CapDecision {
    const t = this.now();
    this.roll(t);

    if (this.day.count >= this.maxPerDay) {
      return { allowed: false, reason: 'day', retryAfter: this.untilMidnight(t) };
    }

    let b = this.perIp.get(ipHash);
    if (!b) {
      b = { hits: [] };
      this.perIp.set(ipHash, b);
    }
    const hourAgo = t - 3600_000;
    b.hits = b.hits.filter((h) => h > hourAgo);
    if (b.hits.length >= this.perIpPerHour) {
      const oldest = b.hits[0];
      return { allowed: false, reason: 'ip-hour', retryAfter: Math.max(1, Math.ceil((oldest + 3600_000 - t) / 1000)) };
    }
    b.hits.push(t);
    this.day.count += 1;
    this.save();
    if (this.perIp.size > 20000) {
      // bounded memory: drop buckets with no recent hits
      for (const [k, v] of this.perIp) if (!v.hits.some((h) => h > hourAgo)) this.perIp.delete(k);
    }
    return { allowed: true, retryAfter: 0 };
  }

  /**
   * The money cap. `worstCaseUsd` is this generation priced at its full output
   * budget, so the ceiling is never crossed by a generation that is already
   * running.
   */
  affordable(worstCaseUsd: number): CapDecision {
    const t = this.now();
    this.roll(t);
    if (this.day.usd + worstCaseUsd > this.maxUsdPerDay) {
      return { allowed: false, reason: 'usd', retryAfter: this.untilMidnight(t) };
    }
    return { allowed: true, retryAfter: 0 };
  }

  /**
   * Admit one generation and hold `worstCaseUsd` against the day until it ends.
   * `affordable()` above is a pure read and therefore reserves nothing: with it
   * alone, twenty sockets opened at once each saw a $0 balance and twenty worst
   * cases were committed against a one-generation ceiling.
   */
  reserve(worstCaseUsd: number, lane: Lane = 'gen'): Reservation {
    const noop = { settle() {} };
    const t = this.now();
    this.roll(t);
    const img = lane === 'img';
    if (img ? this.inflightImg >= this.maxConcurrentImg : this.inflight >= this.maxConcurrent) {
      return { allowed: false, reason: 'busy', retryAfter: 3, ...noop };
    }
    const worst = Number(worstCaseUsd) > 0 ? Number(worstCaseUsd) : 0;
    if (this.day.usd + worst > this.maxUsdPerDay) {
      return { allowed: false, reason: 'usd', retryAfter: this.untilMidnight(t), ...noop };
    }
    this.day.usd += worst;
    if (img) this.inflightImg += 1;
    else this.inflight += 1;
    this.save();

    let settled = false;
    const self = this;
    return {
      allowed: true,
      retryAfter: 0,
      settle(actualUsd: number) {
        if (settled) return;
        settled = true;
        if (img) self.inflightImg = Math.max(0, self.inflightImg - 1);
        else self.inflight = Math.max(0, self.inflight - 1);
        self.roll(self.now());
        const actual = Number(actualUsd) > 0 ? Number(actualUsd) : 0;
        self.day.usd = Math.max(0, self.day.usd + actual - worst);
        self.save();
      },
    };
  }

  inFlight(): number {
    return this.inflight;
  }

  inFlightImg(): number {
    return this.inflightImg;
  }

  /** Book the actual spend of a finished generation (used where nothing was reserved). */
  spend(usd: number): void {
    if (!(usd > 0)) return;
    this.roll(this.now());
    this.day.usd += usd;
    this.save();
  }

  dayCount(): number {
    return this.day.key === this.dayKey(this.now()) ? this.day.count : 0;
  }

  dayUsd(): number {
    return this.day.key === this.dayKey(this.now()) ? this.day.usd : 0;
  }

  maxUsd(): number {
    return this.maxUsdPerDay;
  }

  /** Flush the mirrored counters (process exit). */
  flush(): void {
    this.save(true);
  }
}


/**
 * A cheap per-key hourly counter for the two free bookkeeping routes
 * (/api/mark, /api/identity-seen). They buy no tokens, so they must not eat the
 * generation cap — but unmetered they are a log-flood and a telemetry-poisoning
 * surface, so they get a bucket of their own.
 */
export class RateBucket {
  private hits = new Map<string, number[]>();

  constructor(
    private perHour: number,
    private now: () => number = () => Date.now()
  ) {}

  take(key: string): boolean {
    const t = this.now();
    const cutoff = t - 3600_000;
    let list = this.hits.get(key);
    if (!list) {
      list = [];
      this.hits.set(key, list);
    }
    if (list.length && list[0] <= cutoff) {
      const kept = list.filter((h) => h > cutoff);
      list.length = 0;
      list.push(...kept);
    }
    if (list.length >= this.perHour) return false;
    list.push(t);
    if (this.hits.size > 20000) {
      for (const [k, v] of this.hits) if (!v.some((h) => h > cutoff)) this.hits.delete(k);
    }
    return true;
  }
}
