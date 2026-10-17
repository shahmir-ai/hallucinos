import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './env.js';
import type { Kind } from '../kernel/contract.js';
import { mockStream } from './mock.js';
import type { PromptVars } from './prompts.js';

export interface EngineDef {
  id: string;
  label: string;
  kind: 'openai' | 'anthropic-messages' | 'mock';
  baseUrl?: string;
  model: string;
  keyEnv: string | null;
  usd_in: number;
  usd_out: number;
  temperature?: number;
  /** SPEC §5 allows per-engine overrides of the token caps; merged over defaults. */
  max_tokens?: Partial<Record<Kind, number>>;
  extraBody?: Record<string, unknown>;
  usage?: boolean;
  /**
   * S4 — per-engine wall clock for one generation, overriding GEN_TIMEOUT_MS.
   * BAKEOFF-2 finding 2: `anthropic-haiku`'s desktops have a median total_ms of
   * 25,003 against our own 25,000 ms cap, and two of four boots died on it. A
   * slow reference engine gets its own clock rather than being mis-scored.
   */
  timeout_ms?: number;
  /**
   * The engine accepts `response_format: {type:'json_object'}`. Used ONLY by the
   * I1 identity fallback call: BAKEOFF-2's 25% UNNAMED rate was a parse
   * failure, and the cheapest way to stop parsing prose is to stop being sent
   * prose. No HTML kind ever asks for JSON.
   */
  json_mode?: boolean;
  /**
   * A fixture engine that exists for the test suite only (the second mock lane
   * the hedging tests race against the first). Never offered by
   * `availableEngines` outside a test run or an explicit ALLOW_MOCK.
   */
  test_only?: boolean;
  notes?: string;
}

export interface EnginesFile {
  _notes?: string[];
  defaults: { temperature: number; max_tokens: Record<Kind, number> };
  engines: EngineDef[];
  /** H1 — the routing table `engine:"auto"` resolves through. See server/routes.ts. */
  routes?: Record<string, Partial<Record<Kind, { primary: string; hedge?: string }>>>;
}

let cached: EnginesFile | null = null;
export function enginesFile(): EnginesFile {
  if (!cached) cached = JSON.parse(readFileSync(resolve(ROOT, 'engines.json'), 'utf8')) as EnginesFile;
  return cached;
}

export function allEngines(): EngineDef[] {
  return enginesFile().engines;
}

/**
 * The mock engine has no key, so without a gate it is selectable on a deployed
 * instance — and its fixtures label a rerouted page in the rendered body, which
 * makes it a public oracle for "is this string flagged?", exactly what SPEC
 * §1.4's silent reroute exists to prevent. It is therefore offered only to the
 * test/dev/harness paths, and to a keyless clone that would otherwise not run.
 */
export function mockAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (/^(1|true|yes)$/i.test(String(env.ALLOW_MOCK || ''))) return true;
  if (env.NODE_ENV === 'test') return true;
  if (env.DEFAULT_ENGINE === 'mock') return true;
  return !allEngines().some((e) => e.keyEnv && env[e.keyEnv]);
}

/**
 * Test fixtures are not part of the product's engine list.
 *
 * Deliberately NOT keyed on NODE_ENV: the e2e suite runs the real built server
 * with NODE_ENV=test and asserts that `/api/engines` lists exactly `mock`, so a
 * fixture that appears under NODE_ENV would be a fixture in the product's own
 * contract test. Only the vitest files that race the two lanes set this.
 */
function testEnginesAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes)$/i.test(String(env.ALLOW_TEST_ENGINES || ''));
}

/** An engine appears only when its key env var is set (mock: see mockAllowed). */
export function availableEngines(env: NodeJS.ProcessEnv = process.env): EngineDef[] {
  return allEngines().filter((e) => {
    if (e.test_only && !testEnginesAllowed(env)) return false;
    return e.keyEnv === null ? mockAllowed(env) : !!env[e.keyEnv];
  });
}

export function findEngine(id: string, env: NodeJS.ProcessEnv = process.env): EngineDef | null {
  return availableEngines(env).find((e) => e.id === id) || null;
}

export function maxTokensFor(kind: Kind, engine?: EngineDef): number {
  return engine?.max_tokens?.[kind] ?? enginesFile().defaults.max_tokens[kind] ?? 4500;
}

/** S4: the engine's own wall clock, or the process default. */
export function timeoutFor(engine: EngineDef | null | undefined, dflt: number): number {
  const v = engine?.timeout_ms;
  return Number.isFinite(v) && (v as number) >= 1000 ? (v as number) : dflt;
}

export function temperatureFor(engine: EngineDef): number {
  return engine.temperature ?? enginesFile().defaults.temperature;
}

export function costUsd(engine: EngineDef, tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1e6) * engine.usd_in + (tokensOut / 1e6) * engine.usd_out;
}

/**
 * An upstream failure. The provider's response body often contains fragments of
 * the API key, org and project ids and quota state, so it never leaves this
 * process on the wire: `detail` is for the stdout telemetry line only, and the
 * client is told `engine unavailable` plus the status.
 */
export class EngineHttpError extends Error {
  constructor(
    public engineId: string,
    public status: number,
    public detail: string
  ) {
    super(`engine ${engineId} HTTP ${status}`);
    this.name = 'EngineHttpError';
  }
}

/**
 * Belt and braces for the stdout line: never print something shaped like a key.
 *
 * The prefix list alone missed the formats actually in use — Cerebras `csk-`,
 * Google `AIza…`, a bearer JWT — so the real key values are redacted first,
 * by value, and the patterns are only the fallback for a key we do not hold.
 */
export function redactSecrets(s: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = String(s);
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== 'string' || v.length <= 8) continue;
    if (!/(KEY|TOKEN|SECRET|PASSWORD|SALT)$/i.test(k)) continue;
    if (out.includes(v)) out = out.split(v).join('REDACTED');
  }
  return out
    .replace(/\b(sk|rk|pk|csk|gsk|xai|key|api)[-_][A-Za-z0-9_-]{6,}/gi, '$1-REDACTED')
    .replace(/\bAIza[0-9A-Za-z_-]{10,}/g, 'AIza-REDACTED')
    .replace(/\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, 'JWT-REDACTED')
    .replace(/\b[A-Za-z0-9_-]{6,}\*{3,}[A-Za-z0-9_-]{2,}\b/g, 'REDACTED');
}

export interface GenChunk {
  text?: string;
  usage?: { in: number; out: number };
  /** the provider's own finish_reason; 'length' means it ran out of budget mid-document */
  finish?: string;
}

export interface GenCtx {
  kind: Kind;
  /** which engine this lane is (H2 gives two lanes the same prompt); fixtures read it */
  engineId?: string;
  vars: PromptVars;
  seed: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  /** ask the provider for strict JSON (identity fallback only; see EngineDef.json_mode) */
  jsonMode?: boolean;
}

/** Rough fallback when a provider does not report usage on the stream. */
export const estTokens = (s: string) => Math.max(1, Math.round(s.length / 4));

export async function* streamGen(engine: EngineDef, ctx: GenCtx, signal?: AbortSignal): AsyncGenerator<GenChunk> {
  if (engine.kind === 'mock') {
    yield* mockStream(ctx, signal);
    return;
  }
  if (engine.kind === 'anthropic-messages') {
    yield* anthropicMessagesStream(engine, ctx, signal);
    return;
  }
  yield* openAiStream(engine, ctx, signal);
}

async function* sseLines(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => {});
      return;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield line;
    }
  }
  if (buf.trim()) yield buf.trim();
}

async function* openAiStream(engine: EngineDef, ctx: GenCtx, signal?: AbortSignal): AsyncGenerator<GenChunk> {
  const key = engine.keyEnv ? process.env[engine.keyEnv] : undefined;
  const body: Record<string, unknown> = {
    model: engine.model,
    stream: true,
    max_tokens: ctx.maxTokens,
    temperature: ctx.temperature,
    messages: [
      { role: 'system', content: ctx.system },
      { role: 'user', content: ctx.user },
    ],
    ...(engine.usage === false ? {} : { stream_options: { include_usage: true } }),
    // I1: structured output for the identity fallback, where the engine has it.
    // Placed before extraBody so an engine can still override it by hand.
    ...(ctx.jsonMode && engine.json_mode ? { response_format: { type: 'json_object' } } : {}),
    ...(engine.extraBody || {}),
  };
  const res = await fetch(`${engine.baseUrl!.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new EngineHttpError(engine.id, res.status, detail.slice(0, 400));
  }
  let out = '';
  for await (const line of sseLines(res, signal)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') break;
    let json: any;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    const delta: string | undefined = json?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) {
      out += delta;
      yield { text: delta };
    }
    const finish: string | undefined = json?.choices?.[0]?.finish_reason;
    if (finish) yield { finish };
    if (json?.usage) {
      yield {
        usage: {
          in: json.usage.prompt_tokens ?? json.usage.input_tokens ?? 0,
          out: json.usage.completion_tokens ?? json.usage.output_tokens ?? estTokens(out),
        },
      };
    }
  }
}

/**
 * Thin Messages-API adapter. Not used by any engine in engines.json today —
 * Anthropic's OpenAI-compatible /v1/chat/completions was verified working with
 * stream:true on 2026-09-17 — it is here so switching an engine to
 * kind:"anthropic-messages" needs no code.
 */
async function* anthropicMessagesStream(engine: EngineDef, ctx: GenCtx, signal?: AbortSignal): AsyncGenerator<GenChunk> {
  const key = engine.keyEnv ? process.env[engine.keyEnv] : undefined;
  const res = await fetch(`${(engine.baseUrl || 'https://api.anthropic.com/v1').replace(/\/$/, '')}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(key ? { 'x-api-key': key } : {}),
    },
    body: JSON.stringify({
      model: engine.model,
      stream: true,
      max_tokens: ctx.maxTokens,
      temperature: Math.min(ctx.temperature, 1),
      system: ctx.system,
      messages: [{ role: 'user', content: ctx.user }],
      ...(engine.extraBody || {}),
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new EngineHttpError(engine.id, res.status, detail.slice(0, 400));
  }
  let tokensIn = 0;
  let out = '';
  for await (const line of sseLines(res, signal)) {
    if (!line.startsWith('data:')) continue;
    let json: any;
    try {
      json = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }
    if (json.type === 'message_start') tokensIn = json.message?.usage?.input_tokens ?? 0;
    if (json.type === 'content_block_delta' && typeof json.delta?.text === 'string') {
      out += json.delta.text;
      yield { text: json.delta.text };
    }
    if (json.type === 'message_delta') {
      const stop: string | undefined = json.delta?.stop_reason;
      if (stop) yield { finish: stop === 'max_tokens' ? 'length' : stop };
      if (json.usage) yield { usage: { in: tokensIn, out: json.usage.output_tokens ?? estTokens(out) } };
    }
  }
}
