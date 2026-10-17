import type { BootIdentity } from './identity.js';

/**
 * The little the server remembers about a boot in progress.
 *
 * It exists for two reasons, both new in v0.2, and for nothing else — no
 * generated content is stored here (ruling 1.1 stands; reload still
 * regenerates everything):
 *
 *  1. **S3 — the server owns the image wording.** Image prompts are built from
 *     identity + dice by the server, and the kernel sends `{kind, session}` and
 *     nothing else, so `POST /api/img` has to be able to find the identity that
 *     boot declared. The boot stream is where the server learns it (the I1 gate
 *     parses it out), so the gate records it here. The dice need no storing:
 *     they are `rollDice(loadDice(), rngFrom(seed))` and replay exactly from the
 *     seed, which is stored.
 *  2. **BAKEOFF-2 finding 6 — a failed boot still buys its images.** Haiku spent
 *     eight image calls across four boots of which two booted: $0.024 for two
 *     OSes. The icon sheet is therefore gated on the desktop generation having
 *     produced its first chunk, which is a fact only the server sees.
 *
 * KEYS. One record, several aliases, because the two routes do not agree on a
 * name for a boot and one of them is not ours to change:
 *   - the session seed        (`/api/gen`, always present)
 *   - the kernel's session id (`/api/gen` body `session`, when the kernel sends
 *     it; `/api/img` body `session`, always)
 *   - the client's ip hash    (the server's own, always available on both)
 * `/api/img` resolves in that order. The ip-hash alias is the one that fires
 * today, and it is right in practice — the visitor asking for a wallpaper is the
 * visitor who just booted. Two tabs from one IP can cross wallpapers; that costs
 * nothing and is invisible.
 *
 * Bounded and insertion-ordered (oldest evicted first) with a TTL, so a busy day
 * cannot grow it without limit and a stale key cannot be probed for someone
 * else's machine hours later.
 */

export interface BootRecord {
  at: number;
  seed: string;
  identity?: BootIdentity;
  /** the desktop generation for this boot has produced at least one chunk */
  desktopStarted?: boolean;
  /** resolvers waiting on that first chunk (the icon-sheet gate) */
  waiters?: (() => void)[];
}

export class BootMemory {
  /** alias -> record. Several aliases share one record object. */
  private map = new Map<string, BootRecord>();

  constructor(
    private limit = 4000,
    private ttlMs = 30 * 60_000,
    private now: () => number = () => Date.now()
  ) {}

  private evict() {
    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  private alias(key: string | undefined, rec: BootRecord) {
    if (!key) return;
    this.map.delete(key);
    this.map.set(key, rec);
  }

  /**
   * Start (or refresh) the record for one boot. Called on every generation, so
   * that the desktop's first chunk and the boot's identity land on the same
   * record even though they arrive on different requests.
   */
  touch(keys: { seed: string; session?: string; client?: string }): BootRecord {
    const t = this.now();
    const existing = this.resolve(keys);
    const rec = existing && t - existing.at < this.ttlMs ? existing : { at: t, seed: keys.seed };
    rec.at = t;
    if (keys.seed) rec.seed = keys.seed;
    this.alias(keys.seed, rec);
    this.alias(keys.session, rec);
    this.alias(keys.client, rec);
    this.evict();
    return rec;
  }

  /** First live record among the aliases, in order of how much we trust them. */
  resolve(keys: { seed?: string; session?: string; client?: string }): BootRecord | null {
    for (const k of [keys.seed, keys.session, keys.client]) {
      if (!k) continue;
      const rec = this.map.get(k);
      if (!rec) continue;
      if (this.now() - rec.at >= this.ttlMs) {
        this.map.delete(k);
        continue;
      }
      return rec;
    }
    return null;
  }

  rememberIdentity(keys: { seed: string; session?: string; client?: string }, identity: BootIdentity): void {
    this.touch(keys).identity = identity;
  }

  /** The desktop generation for this boot has started streaming. */
  noteDesktopStarted(keys: { seed: string; session?: string; client?: string }): void {
    const r = this.touch(keys);
    if (r.desktopStarted) return;
    r.desktopStarted = true;
    const ws = r.waiters;
    r.waiters = undefined;
    if (ws) for (const w of ws) w();
  }

  /**
   * Resolves true once the desktop for this boot has started, false if it has
   * not within `ms`. The icon sheet waits on this: a boot whose desktop never
   * starts is a failed boot and must not buy a $0.003 sheet.
   */
  waitForDesktop(keys: { seed?: string; session?: string; client?: string }, ms: number): Promise<boolean> {
    const rec = this.resolve(keys);
    if (rec?.desktopStarted) return Promise.resolve(true);
    if (!rec || ms <= 0) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (v: boolean) => {
        if (done) return;
        done = true;
        resolve(v);
      };
      const timer = setTimeout(() => finish(false), ms);
      (rec.waiters ||= []).push(() => {
        clearTimeout(timer);
        finish(true);
      });
    });
  }

  size(): number {
    return this.map.size;
  }
}
