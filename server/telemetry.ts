import type { Kind } from '../kernel/contract.js';

/** SPEC §2.1: one JSON line per generation on stdout, plus /api/stats for the day. */

export type LogKind = Kind | 'img' | 'mark' | 'gen';

export interface GenLog {
  ts: string;
  kind: LogKind;
  engine: string;
  ip_hash: string;
  tokens_in: number;
  tokens_out: number;
  ttfb_ms: number;
  total_ms: number;
  tok_per_s: number;
  usd: number;
  contract_ok: boolean | null;
  /** SPEC §12.1 / I6: where the time actually went, so slowness is attributable. */
  moderation_ms?: number;
  server_ms?: number;
  provider_ttfb_ms?: number;
  /** filled in later by POST /api/mark, which the kernel calls (I6) */
  first_paint_ms?: number;
  /**
   * H3 — the first moment the document had a box on screen, as distinct from
   * `first_paint_ms`, which is only "the first chunk was written".
   *
   * HANDOFF-4's headline: on `cerebras-oss120` a meaningful fraction of boots
   * emit the identity comment and then nothing, and `first_paint_ms` reported
   * 4,176 ms on a boot frame the harness could prove was empty. The comment
   * alone satisfied it. `ink_ms` is the honest number and it is what the HUD
   * and the reports now call first paint; a line with `first_paint_ms` and no
   * `ink_ms` is a document that streamed and never showed anything.
   */
  ink_ms?: number;
  /**
   * When the document became clickable. For an app or a page that is the FIRST
   * chunk (the runtime attaches delegation inside openDoc, SPEC §12.2), not the
   * end of the stream — the end of the stream is `complete_ms`.
   */
  interactive_ms?: number;
  /** end of stream, for the kinds whose interactivity arrives before it */
  complete_ms?: number;
  /** the id the kernel quotes back on /api/mark */
  gen_id?: string;
  /** the model's identity comment was unusable and the server made one identity call (I1) */
  identity_fallback?: boolean;
  /**
   * Why the identity comment was unusable: `missing` (no comment in the head at
   * all), `bad-json` (a comment that did not parse), `invalid` (parsed but a
   * required field was absent or wrong). Written only when identity_fallback is.
   */
  identity_fail?: 'missing' | 'bad-json' | 'invalid';
  /** how the fallback identity call was made, and whether it needed its retry */
  identity_fallback_mode?: 'json' | 'text';
  identity_fallback_tries?: number;
  /**
   * The first characters the model actually wrote, verbatim, when the identity
   * comment failed. Only written under IDENTITY_DEBUG=1: it is model output,
   * never a secret, but it is bulky and it is a diagnostic, not telemetry.
   */
  identity_head?: string;
  /** and what the rescue call answered, same gate */
  identity_fb_head?: string;
  /**
   * BAKEOFF-2 finding 1: "a queue screen and a dead engine are
   * indistinguishable in the numbers". Every refusal and every failure now says
   * which it was — `queue` (one of our own caps said no and nothing was bought)
   * or `engine_dead` (the provider refused, hung or died mid-stream).
   */
  refusal?: 'queue' | 'engine_dead';
  /** remote moderation flagged after the stream had started (SPEC §12.1) */
  reroute_mid_stream?: boolean;
  /** the wall-clock GEN_TIMEOUT_MS fired and the stream ended with an os-error sentinel */
  timed_out?: boolean;
  rerouted?: boolean;
  /**
   * Why a request was refused before anything was generated (a cap, the money
   * ceiling, the in-flight ceiling, moderation). A refusal used to return before
   * telemetry.record() and left no trace anywhere, which is the blindness that
   * voided BAKEOFF-1.
   */
  blocked?: string;
  /** the client went away mid-stream; nothing here describes a finished document */
  aborted?: boolean;
  /** only written when moderation actually fired (SPEC §8) */
  mod_hash?: string;
  /** the server stopped the stream at the per-kind output hard cap */
  truncated?: boolean;
  /**
   * H2 — the hedge. `hedged` says a second lane was actually started; `winner`
   * is the engine whose bytes the client got (the `engine` field is the same
   * thing, so aggregates are per winner); `loser` is what we also paid for.
   * `loser_aborted_ms` is measured from the start of the race, and
   * `failed_over` means the lane that inked first was not the one that finished
   * the document — the case the whole mechanism exists for.
   */
  hedged?: boolean;
  winner?: string;
  loser?: string;
  loser_aborted_ms?: number;
  loser_tokens_in?: number;
  loser_tokens_out?: number;
  failed_over?: boolean;
  /** image lines only: the download leg (0 under fal sync_mode), the bucket, the pixels */
  img_fetch_ms?: number;
  img_scope?: string;
  img_px?: number;
  /** which fal endpoint drew it (IMG_MODEL). Two models at two prices on one
   *  day's telemetry are indistinguishable without it. */
  img_model?: string;
  /** tile sheets (T2): which theme was drawn */
  img_theme?: string;
  /**
   * HANDOFF-7 §11.7 — the provider's own account of an image failure, and its
   * HTTP status. `error: "img upstream"` was all eight of HANDOFF-6's and all
   * seven of HANDOFF-7's dead pictures ever said about themselves, so the cause
   * of 8% of the photos bought was unknowable. Logged to stdout only; the
   * client's 502/504 body is still `image unavailable`.
   */
  img_err?: string;
  img_status?: number;
  /**
   * How many extra calls this picture took (1 = one retry, with the simplified
   * prompt). `img_err_first` / `img_status_first` are the failure that caused
   * the retry, kept even when the retry succeeded — a picture that only ever
   * arrives on the second call is a prompt problem worth seeing.
   */
  img_retry?: number;
  img_err_first?: string;
  img_status_first?: number;
  /**
   * T4 — what the KERNEL had to patch into this document before a visitor could
   * use it, reported through POST /api/mark against this generation's gen_id.
   *
   * The contract's own `contract_ok` answers "were the hooks present"; this
   * answers "were they USABLE", which is a different and newer question. A
   * desktop can carry `[data-os-close]` and still be unclosable because the
   * element is invisible or zero-sized (the architect's live test, D2), and the
   * kernel then inserts a bare unstyled strip and records `chrome` here. A rate
   * per engine is the point: one boot needing a chrome patch is a model having a
   * bad idea, a fifth of them needing it is a prompt or an engine problem.
   */
  contract_patch?: string[];
  error?: string;
}

/**
 * T4 — the patch kinds the counters know about. An unrecognised one is bucketed
 * as `other` rather than minted as a key: the field arrives over HTTP and the
 * per-engine map would otherwise grow without a ceiling.
 *
 *  - `chrome`  the window template had no usable title bar or close control
 *  - `task`    the taskbar entry template had none either
 *  - `label`   a launcher's label had no rendered text box after the pictures landed
 *  - `hooks`   a missing contract hook was injected (§3.2's own repair)
 *  - `archetype` / `clock`  §12.3's two extra hooks, patched onto the document
 */
export const CONTRACT_PATCH_KINDS = ['chrome', 'task', 'label', 'hooks', 'archetype', 'clock', 'other'] as const;
export type ContractPatchKind = (typeof CONTRACT_PATCH_KINDS)[number];

/** At most this many patch kinds are recorded for one generation. */
export const CONTRACT_PATCH_MAX = 8;

/** Whatever arrived on the wire, as a clean, deduplicated, bounded list of known kinds. */
export function normalizePatchKinds(v: unknown): ContractPatchKind[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
  const out: ContractPatchKind[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const k = item.trim().toLowerCase().slice(0, 24);
    if (!k) continue;
    const known = (CONTRACT_PATCH_KINDS as readonly string[]).includes(k) ? (k as ContractPatchKind) : 'other';
    if (!out.includes(known)) out.push(known);
    if (out.length >= CONTRACT_PATCH_MAX) break;
  }
  return out;
}

export interface EngineStats {
  gens: number;
  tokens_in: number;
  tokens_out: number;
  usd: number;
  errors: number;
  /**
   * T4 — generations over which a patch rate means anything: the ones the
   * contract was checked on (desktop, repair, app). A page has no hooks to
   * patch, so counting patches against every generation would report a lower
   * rate for an engine that simply served more pages.
   */
  contract_gens: number;
  /** generations that needed at least one kernel patch */
  patch_gens: number;
  /** how many generations needed each kind of patch */
  patches: Record<string, number>;
}

const MARK_FIELDS = ['first_paint_ms', 'ink_ms', 'interactive_ms', 'complete_ms'] as const;
export type MarkFields = Partial<Record<(typeof MARK_FIELDS)[number], number>>;
/** what POST /api/mark may report: the four timings plus T4's patch list */
export type MarkPayload = MarkFields & { contract_patch?: unknown };

export class Telemetry {
  private day = '';
  private byEngine = new Map<string, EngineStats>();
  private gens = 0;
  private refusals: Record<string, number> = {};
  private lines: GenLog[] = [];
  /**
   * Marks that arrived before the generation they belong to finished. The boot
   * document paints ~200 ms BEFORE its own stream ends, so its first paint —
   * the one number SPEC §12.1 leads with — was reported against a line that did
   * not exist yet and was dropped. They are held here and folded in on record().
   */
  private earlyMarks = new Map<string, MarkFields & { contract_patch?: ContractPatchKind[] }>();

  constructor(private sink: (line: string) => void = (l) => process.stdout.write(l + '\n')) {}

  private roll(ts: string) {
    const d = ts.slice(0, 10);
    if (this.day !== d) {
      this.day = d;
      this.byEngine.clear();
      this.gens = 0;
      this.refusals = {};
      this.lines = [];
      // earlyMarks deliberately survives the roll: a generation that started
      // before midnight records after it, and its first paint is not a day's
      // aggregate — it is one line's field. The map is bounded in mark().
    }
  }

  record(log: GenLog): void {
    this.roll(log.ts);
    if (log.blocked) {
      this.refusals[log.blocked] = (this.refusals[log.blocked] || 0) + 1;
      // A refusal that spent nothing is not a generation: it gets its own
      // counter and a stdout line and stays out of the per-engine aggregates,
      // so a day of 429s does not read as a productive one. One that DID spend
      // (the image whose late moderation hit after it was rendered and billed)
      // falls through and is aggregated like any other cost.
      if (!log.usd && !log.tokens_in && !log.tokens_out) {
        this.lines.push(log);
        if (this.lines.length > 500) this.lines.shift();
        this.sink(JSON.stringify(log));
        return;
      }
    }
    this.gens += 1;
    const s = this.engineStats(log.engine);
    s.gens += 1;
    s.tokens_in += log.tokens_in;
    s.tokens_out += log.tokens_out;
    s.usd += log.usd;
    if (log.error) s.errors += 1;
    if (log.contract_ok !== null && log.contract_ok !== undefined) s.contract_gens += 1;
    const early = log.gen_id ? this.earlyMarks.get(log.gen_id) : undefined;
    if (early) {
      const heldPatch = early.contract_patch;
      Object.assign(log, early);
      if (heldPatch) log.contract_patch = heldPatch;
      this.earlyMarks.delete(log.gen_id!);
    }
    if (log.contract_patch?.length) this.countPatches(log.engine, log.contract_patch as ContractPatchKind[], true);
    this.lines.push(log);
    if (this.lines.length > 500) this.lines.shift();
    this.sink(JSON.stringify(log));
  }

  private engineStats(engine: string): EngineStats {
    let s = this.byEngine.get(engine);
    if (!s) {
      s = { gens: 0, tokens_in: 0, tokens_out: 0, usd: 0, errors: 0, contract_gens: 0, patch_gens: 0, patches: {} };
      this.byEngine.set(engine, s);
    }
    return s;
  }

  /**
   * T4 — count one generation's patches. `firstForLine` says this is the first
   * patch list this generation has reported, so the per-generation counter moves
   * once however many kinds arrive and however many marks carry them.
   */
  private countPatches(engine: string, kinds: ContractPatchKind[], firstForLine: boolean): void {
    if (!kinds.length) return;
    const s = this.engineStats(engine);
    if (firstForLine) s.patch_gens += 1;
    for (const k of kinds) s.patches[k] = (s.patches[k] || 0) + 1;
  }

  stats() {
    const engines: Record<string, EngineStats & { patch_rate: number | null }> = {};
    const patches: Record<string, number> = {};
    let patch_gens = 0;
    let contract_gens = 0;
    let usd = 0;
    let tokens_in = 0;
    let tokens_out = 0;
    for (const [k, v] of this.byEngine) {
      engines[k] = {
        ...v,
        patches: { ...v.patches },
        usd: round(v.usd),
        /**
         * The number the seam asks for: how often a visitor of this engine got
         * a desktop the kernel had to repair before it was usable. `null` when
         * no generation of this engine was contract-checked at all, because
         * 0/0 is not 0%.
         */
        patch_rate: v.contract_gens ? Math.round((v.patch_gens / v.contract_gens) * 1000) / 1000 : null,
      };
      usd += v.usd;
      tokens_in += v.tokens_in;
      tokens_out += v.tokens_out;
      patch_gens += v.patch_gens;
      contract_gens += v.contract_gens;
      for (const [pk, pv] of Object.entries(v.patches)) patches[pk] = (patches[pk] || 0) + pv;
    }
    const refusals = { ...this.refusals };
    const refused = Object.values(refusals).reduce((a, b) => a + b, 0);
    return {
      day: this.day || new Date().toISOString().slice(0, 10),
      gens: this.gens,
      tokens_in,
      tokens_out,
      usd: round(usd),
      engines,
      refused,
      refusals,
      /** T4, across every engine */
      contract_gens,
      contract_patch_gens: patch_gens,
      contract_patches: patches,
      contract_patch_rate: contract_gens ? Math.round((patch_gens / contract_gens) * 1000) / 1000 : null,
    };
  }

  recent(n = 20): GenLog[] {
    return this.lines.slice(-n);
  }

  /**
   * I6 — the kernel reports the two numbers only it can see (first paint and
   * interactive) against the gen_id the server handed it. The stored line is
   * patched so /api/stats and the bake-off harness see one record per
   * generation, and a `mark` line goes to stdout for the log stream.
   */
  mark(genId: string, fields: MarkPayload): boolean {
    if (!genId) return false;
    const hit = this.lines.find((l) => l.gen_id === genId);
    const held = this.earlyMarks.get(genId) || {};
    /**
     * T4 — the patch list is a SET, not a measurement, so unlike the timings it
     * unions rather than first-writer-wins: the chrome check runs when the
     * desktop mounts and again on the first window, and a label is re-shown
     * after the pictures land, so one generation legitimately reports twice.
     * Only the kinds that are new to this line are counted.
     */
    const patch = normalizePatchKinds(fields.contract_patch);
    let newPatch: ContractPatchKind[] = [];
    if (patch.length) {
      const before = (hit ? hit.contract_patch : held.contract_patch) || [];
      newPatch = patch.filter((k) => !before.includes(k));
      const merged = [...before, ...newPatch].slice(0, CONTRACT_PATCH_MAX) as ContractPatchKind[];
      if (hit) {
        const first = !before.length;
        hit.contract_patch = merged;
        if (newPatch.length) this.countPatches(hit.engine, newPatch, first);
      } else {
        this.earlyMarks.set(genId, { ...held, contract_patch: merged });
      }
    }
    const patch2: Record<string, number> = {};
    for (const f of MARK_FIELDS) {
      const v = fields[f];
      if (!Number.isFinite(v as number)) continue;
      // first writer wins: a mark is a measurement of one moment, and letting a
      // second one overwrite it makes the field forgeable by anyone who can
      // guess a gen_id (and made a legitimate retry rewrite history).
      if (hit && hit[f] !== undefined) continue;
      if (!hit && held[f] !== undefined) continue;
      patch2[f] = Math.max(0, Math.round(v as number));
    }
    if (hit) {
      Object.assign(hit, patch2);
      // Only a mark that landed on a real line is logged. An early one is held
      // silently and appears in that generation's own line when it records;
      // logging the misses turned the route into a log-flood amplifier.
      this.sink(
        JSON.stringify({
          ts: new Date().toISOString(),
          kind: 'mark',
          gen_id: genId,
          ...patch2,
          ...(newPatch.length ? { contract_patch: newPatch } : {}),
          matched: true,
        })
      );
      return true;
    }
    if (Object.keys(patch2).length) {
      // the stream has not ended yet: hold the numbers for record() (I6)
      this.earlyMarks.set(genId, { ...this.earlyMarks.get(genId), ...held, ...patch2 });
      if (this.earlyMarks.size > 200) this.earlyMarks.delete(this.earlyMarks.keys().next().value as string);
    }
    return false;
  }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
