import { maxTokensFor, temperatureFor, type EngineDef, type GenChunk, type GenCtx } from './engines.js';
import type { Kind } from '../kernel/contract.js';
import { streamGen, estTokens, costUsd } from './engines.js';

/**
 * H2 — server-side hedged generation.
 *
 * The problem this exists for, measured three passes running: Cerebras swings by
 * a factor of three between afternoons. The architect watched
 * `cerebras-oss120` do 0.55-0.7 s of provider TTFB in the morning and 2.1-4.7 s
 * at 18:40 the same day, at the same tokens/s. Nothing in the prompt, the kernel
 * or the budget fixes a provider having a bad hour; a second provider does.
 *
 * So a routed kind (H1) starts its primary, and — after that kind's own trigger
 * (`hedgeTriggers` below: 0 for boot, where the whole product is the first
 * second) with no CONTENT token — starts the hedge with the identical prompt.
 * The first stream to produce content wins and is the only one the client
 * ever sees.
 *
 * THE COMMIT POINT, and why the loser is not aborted on the winner's first byte.
 * The seam asks for two things that cannot both be literal: abort the loser the
 * moment the winner yields content, AND fall over to the loser if the winner
 * dies before 64 content characters. A stream that has been aborted cannot be
 * fallen back to, and a client that has already been handed 20 characters of a
 * dead document cannot be handed a second document without breaking SPEC §12.2.
 *
 * So the first `commitChars` (64) characters are held HERE, in this process, and
 * nothing goes to the client until one lane has that many. That is the commit
 * point: at it, the buffer is flushed, the other lane is aborted upstream, and
 * everything after it is a straight pass-through. Before it, a lane that dies or
 * ends without a document costs nothing and the other lane is promoted with the
 * client none the wiser. 64 characters is `<!doctype html>` plus a little, which
 * on every engine measured arrives inside the first one or two chunks; a lane
 * that produces content and then stalls under the threshold is committed anyway
 * after `commitMs`, so a stall cannot hold the page.
 *
 * Reasoning tokens are not content: `openAiStream` yields `delta.content` only,
 * so a gpt-oss lane spending its whole budget on reasoning (one boot probe in
 * three, HANDOFF-4 #2) never starts the clock here and loses to the hedge.
 */

/**
 * T1 — the per-kind hedge trigger, read from the environment at call time.
 *
 * Three numbers, three different bets, and until v0.5 there were two:
 *
 * - `boot` (HEDGE_AFTER_MS_BOOT, default **0**) — always race both lanes. The
 *   boot stream is the first pixel of the product (SPEC §12.1) and the smallest
 *   prompt in it; a second lane costs ~$0.001 and buys the visitor the faster
 *   of two providers on a night when one of them is slow. This is the one kind
 *   where 0 is deliberate rather than an oversight.
 * - `desktop` (HEDGE_AFTER_MS_DESKTOP, default **600**) — the biggest prompt
 *   and the biggest document in the product. Sharing boot's 0 meant every
 *   routed boot bought two desktops (HANDOFF-6 §7 / D6), which is most of a
 *   boot's bill for a lane that loses 19 times in 20. 600 ms is past the
 *   measured good-hour TTFB (0.55-0.7 s is the primary's own first content on a
 *   quiet morning, and its first CONTENT token typically arrives inside that)
 *   and well short of a bad hour (2.1-4.7 s).
 * - everything else (HEDGE_AFTER_MS, default **900**) — app, page, repair,
 *   identity. A window or a page that is late is a smaller loss than a boot
 *   that is late, and these are the kinds a visitor asks for many of.
 *
 * Read per request on purpose: the tests set these around one call, and an
 * operator changing one on Railway should not have to reason about when the
 * module was imported.
 */
export interface HedgeTriggers {
  boot: number;
  desktop: number;
  other: number;
}

const envNum = (env: NodeJS.ProcessEnv, name: string, dflt: number): number => {
  const raw = env[name];
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
};

export function hedgeTriggers(env: NodeJS.ProcessEnv = process.env): HedgeTriggers {
  return {
    boot: envNum(env, 'HEDGE_AFTER_MS_BOOT', 0),
    desktop: envNum(env, 'HEDGE_AFTER_MS_DESKTOP', 600),
    other: envNum(env, 'HEDGE_AFTER_MS', 900),
  };
}

export function hedgeAfterFor(kind: Kind, env: NodeJS.ProcessEnv = process.env): number {
  const t = hedgeTriggers(env);
  return kind === 'boot' ? t.boot : kind === 'desktop' ? t.desktop : t.other;
}

export type StreamFn = (engine: EngineDef, ctx: GenCtx, signal?: AbortSignal) => AsyncGenerator<GenChunk>;

export interface HedgeOpts {
  /** wait this long for a CONTENT token from the primary before starting the hedge; 0 = both at once */
  hedgeAfterMs: number;
  /** characters held before either lane is committed to the client (0 = pass the first chunk straight through) */
  commitChars?: number;
  /** a lane that has content but has not reached commitChars by now is committed anyway */
  commitMs?: number;
  stream?: StreamFn;
  now?: () => number;
}

export interface HedgeReport {
  /** a second lane was actually started */
  hedged: boolean;
  /** the engine whose bytes the client got */
  winner: string;
  /** the engine that lost, when there was one */
  loser?: string;
  /** ms from the hedger starting to the loser's abort */
  loser_aborted_ms?: number;
  /** what the loser billed (usage if the provider reported it before the abort, else estimated) */
  loser_tokens_in?: number;
  loser_tokens_out?: number;
  loser_usd?: number;
  /** the first lane to produce content was not the one that finished the job */
  failed_over?: boolean;
  /** ms from the hedger starting to the winning lane's first content token */
  first_content_ms?: number;
  /** ms from the WINNER's own upstream request to its first content token (provider TTFB, honestly attributed) */
  winner_ttfb_ms?: number;
}

interface Lane {
  engine: EngineDef;
  ctx: GenCtx;
  ac: AbortController;
  startedAt: number;
  /** content characters seen */
  chars: number;
  /** chunks not yet handed to the consumer */
  buf: GenChunk[];
  firstContentAt?: number;
  usage?: { in: number; out: number };
  done: boolean;
  err?: unknown;
  /** we have stopped caring about this lane */
  dropped?: boolean;
  droppedAt?: number;
  pump?: Promise<void>;
}

const sleepUntil = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((res) => {
    if (ms <= 0) return res();
    const t = setTimeout(res, ms);
    const onAbort = () => {
      clearTimeout(t);
      res();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export class Hedger {
  private lanes: Lane[] = [];
  private rep: HedgeReport;
  private stream: StreamFn;
  private now: () => number;
  private t0 = 0;
  private wake: (() => void) | null = null;

  constructor(
    private primary: EngineDef,
    private hedge: EngineDef | null,
    private baseCtx: GenCtx,
    private signal: AbortSignal | undefined,
    private opts: HedgeOpts
  ) {
    this.stream = opts.stream || (streamGen as StreamFn);
    this.now = opts.now || (() => Date.now());
    this.rep = { hedged: false, winner: primary.id };
  }

  report(): HedgeReport {
    return { ...this.rep };
  }

  /** The engine whose bytes are going out. Valid from the first yielded chunk. */
  winnerEngine(): EngineDef {
    const w = this.lanes.find((l) => l.engine.id === this.rep.winner);
    return w ? w.engine : this.primary;
  }

  private notify() {
    const w = this.wake;
    this.wake = null;
    if (w) w();
  }

  private async sleepStep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await Promise.race([
      new Promise<void>((res) => {
        this.wake = res;
      }),
      sleepUntil(ms, this.signal),
    ]);
    this.wake = null;
  }

  private start(engine: EngineDef): Lane {
    const ctx: GenCtx = {
      ...this.baseCtx,
      engineId: engine.id,
      // each lane gets its own engine's budget and temperature: haiku's API caps
      // temperature at 1.0 and qwen has its own token override
      maxTokens: maxTokensFor(this.baseCtx.kind, engine),
      temperature: temperatureFor(engine),
    };
    const lane: Lane = { engine, ctx, ac: new AbortController(), startedAt: this.now(), chars: 0, buf: [], done: false };
    if (this.signal) {
      if (this.signal.aborted) lane.ac.abort();
      else this.signal.addEventListener('abort', () => lane.ac.abort(), { once: true });
    }
    lane.pump = this.pump(lane);
    this.lanes.push(lane);
    return lane;
  }

  private async pump(lane: Lane): Promise<void> {
    try {
      for await (const ch of this.stream(lane.engine, lane.ctx, lane.ac.signal)) {
        if (ch.text) {
          lane.chars += ch.text.length;
          if (!lane.firstContentAt) lane.firstContentAt = this.now();
        }
        if (ch.usage) lane.usage = ch.usage;
        lane.buf.push(ch);
        this.notify();
        if (lane.dropped) break;
      }
    } catch (err) {
      lane.err = err;
    } finally {
      lane.done = true;
      this.notify();
    }
  }

  /** Abort a lane upstream and book what it cost us. */
  private drop(lane: Lane, loser: boolean) {
    if (lane.dropped) return;
    lane.dropped = true;
    lane.droppedAt = this.now();
    try {
      lane.ac.abort();
    } catch {}
    if (!loser) return;
    const tin = lane.usage?.in ?? estTokens(lane.ctx.system + lane.ctx.user);
    const tout = lane.usage?.out ?? (lane.chars ? estTokens('x'.repeat(lane.chars)) : 0);
    this.rep.loser = lane.engine.id;
    this.rep.loser_aborted_ms = Math.max(0, lane.droppedAt - this.t0);
    this.rep.loser_tokens_in = tin;
    this.rep.loser_tokens_out = tout;
    this.rep.loser_usd = costUsd(lane.engine, tin, tout);
  }

  private commitChars(): number {
    const c = this.opts.commitChars;
    return typeof c === 'number' ? Math.max(0, c) : this.hedge ? 64 : 0;
  }

  /**
   * A lane worth committing to: content already, and either past the commit
   * threshold or stalled under it for commitMs. `null` while we should wait.
   */
  private leader(): Lane | null {
    const live = this.lanes.filter((l) => !l.dropped && l.firstContentAt);
    if (!live.length) return null;
    live.sort((a, b) => (a.firstContentAt! - b.firstContentAt!));
    const need = this.commitChars();
    const stallMs = this.opts.commitMs ?? 1500;
    for (const l of live) {
      if (l.chars >= need) return l;
      // it finished without ever reaching the threshold: it is a dud only if
      // somebody else can still do the job (see chooseLane)
      if (l.done) continue;
      if (this.now() - l.firstContentAt! >= stallMs) return l;
    }
    return null;
  }

  /**
   * Phase one: decide which lane the client is going to read, holding the head
   * of it in this process until the decision is safe to make.
   */
  private async chooseLane(): Promise<Lane> {
    const need = this.commitChars();
    while (true) {
      if (this.signal?.aborted) throw new Error('aborted');
      const lead = this.leader();
      if (lead) return lead;

      const hedgeDue = this.hedge && this.lanes.length < 2;
      const primaryLane = this.lanes[0];
      // everything alive has ended without a usable document
      const stillGoing = this.lanes.filter((l) => !l.done && !l.dropped);
      if (!stillGoing.length && !hedgeDue) {
        // a lane that ENDED with content under the threshold is still the best
        // document there is: hand it over rather than inventing a failure
        const withContent = this.lanes.filter((l) => !l.dropped && l.chars > 0).sort((a, b) => b.chars - a.chars)[0];
        if (withContent) return withContent;
        // nothing anywhere produced a character. Prefer a real upstream error so
        // the caller's os-error path says what died; otherwise hand back the
        // empty lane (a reasoning-only stream still has usage to book).
        const failed = this.lanes.find((l) => l.err);
        if (failed) throw failed.err;
        return this.lanes[this.lanes.length - 1];
      }

      if (hedgeDue) {
        const waited = primaryLane ? this.now() - primaryLane.startedAt : 0;
        const dueIn = Math.max(0, this.opts.hedgeAfterMs - waited);
        /**
         * MEASURED BUG (v0.3 verification): this used to read
         * `primaryLane.done || (chars > 0 && chars < need)`, and the second
         * clause fires on the primary's FIRST chunk — every real engine's
         * first chunk is a handful of tokens, well under the 64-character
         * commit threshold — so the hedge started at the primary's TTFB no
         * matter what `hedgeAfterMs` said. Ten real boots at
         * HEDGE_AFTER_MS_BOOT=700 hedged 10/10, and so did two at 60,000: the
         * trigger, which is the whole cost lever for `auto` (BAKEOFF-4 #3),
         * did nothing at all.
         *
         * A primary that has content but has not reached the threshold needs no
         * hedge: `leader()` commits it anyway `commitMs` after its first
         * content, so a second lane started here can almost never win and is
         * pure cost. The case that DOES need the hedge is a primary that ENDED
         * without a usable document (the reasoning-only boot, HANDOFF-4 #2),
         * which is `done`, and that is what this now waits for.
         */
        const primaryDone = !!primaryLane && primaryLane.done;
        if (dueIn === 0 || primaryDone) {
          this.rep.hedged = true;
          this.start(this.hedge!);
          continue;
        }
        await this.sleepStep(dueIn);
        continue;
      }
      await this.sleepStep(50);
    }
  }

  /** The chunks the client gets, from exactly one lane. */
  async *run(): AsyncGenerator<GenChunk> {
    this.t0 = this.now();
    this.start(this.primary);
    if (this.hedge && this.opts.hedgeAfterMs <= 0) {
      this.rep.hedged = true;
      this.start(this.hedge);
    }

    let lane = await this.chooseLane();
    this.rep.winner = lane.engine.id;
    // the first lane to produce a character was not the one that did the job:
    // that is a failover, and it is the number that says the hedge earned its keep
    const firstInk = this.lanes.filter((l) => l.firstContentAt).sort((a, b) => a.firstContentAt! - b.firstContentAt!)[0];
    if (firstInk && firstInk !== lane) this.rep.failed_over = true;
    this.rep.first_content_ms = lane.firstContentAt ? lane.firstContentAt - this.t0 : undefined;
    this.rep.winner_ttfb_ms = lane.firstContentAt ? lane.firstContentAt - lane.startedAt : undefined;
    for (const other of this.lanes) if (other !== lane) this.drop(other, true);

    // flush the held head, then pass everything through. The pump wakes this
    // loop on every chunk; the 60 ms is a backstop, not the cadence.
    while (true) {
      if (lane.buf.length) {
        yield lane.buf.shift()!;
        continue;
      }
      if (lane.done) break;
      if (this.signal?.aborted) break;
      await this.sleepStep(60);
    }
    if (lane.err) throw lane.err;
  }
}
