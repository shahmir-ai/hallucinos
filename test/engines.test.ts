import { describe, it, expect } from 'vitest';
import { allEngines, availableEngines, findEngine, costUsd, maxTokensFor, enginesFile, temperatureFor, timeoutFor } from '../server/engines.js';

describe('engines.json', () => {
  it('lists every engine the spec names, keyed by its env var', () => {
    const byId = Object.fromEntries(allEngines().map((e) => [e.id, e]));
    const expected: Record<string, string | null> = {
      'cerebras-oss120': 'CEREBRAS_API_KEY',
      'cerebras-qwen38': 'CEREBRAS_API_KEY',
      'mercury-2.5': 'INCEPTION_API_KEY',
      'groq-oss20': 'GROQ_API_KEY',
      'groq-oss120': 'GROQ_API_KEY',
      'openai-small': 'OPENAI_API_KEY',
      'anthropic-haiku': 'ANTHROPIC_API_KEY',
      'gemini-flashlite': 'GOOGLE_API_KEY',
      'openrouter-oss120': 'OPENROUTER_API_KEY',
      mock: null,
    };
    for (const [id, keyEnv] of Object.entries(expected)) {
      expect(byId[id], `engine ${id} missing`).toBeTruthy();
      expect(byId[id].keyEnv).toBe(keyEnv);
    }
  });

  it('prices every engine for cost telemetry', () => {
    for (const e of allEngines()) {
      expect(typeof e.usd_in).toBe('number');
      expect(typeof e.usd_out).toBe('number');
    }
  });

  it('records what could not be verified', () => {
    const notes = (enginesFile()._notes || []).join('\n');
    expect(notes).toMatch(/TODO/);
    expect(notes).toMatch(/mercury/i);
  });

  it('uses the token caps from the spec', () => {
    // SPEC §12.1 / I7 cut these: speed is the product, volume is not.
    // identity is the one that went UP in v0.2 (300 -> 500): gpt-oss spends
    // reasoning tokens out of max_tokens, and a 300-token rescue call came back
    // truncated mid-JSON on cerebras. It is only ever paid on the I1 fallback.
    expect(maxTokensFor('identity')).toBe(500);
    // boot 800 -> 1,600 after scripts/boot-budget.mjs measured that Cerebras
    // counts reasoning tokens inside max_tokens: at 800, reasoning of 357-659
    // bound the cap on 2 of 3 calls and one boot screen arrived half written.
    // At 1,600 the model stops on its own at 739-1,005, so nothing is bought
    // that is not needed. See reviews/SERVER-v03.md.
    expect(maxTokensFor('boot')).toBe(1600);
    // desktop stays where SPEC 12.1 put it: p100 of six measured desktops was
    // 1,864 completion tokens, i.e. 1.9x headroom already (reviews/BUDGET-2.md).
    expect(maxTokensFor('desktop')).toBe(3500);
    // app 2,500 -> 4,000 after scripts/kind-budget.mjs reproduced HANDOFF-5's
    // truncated app window: kind=app on `photos` hit finish_reason=length 1 of
    // 3 at 2,500 and left an UNCLOSED document, while the same app at 4,000
    // stopped on its own at 1,927-2,278. Raising a cap did not raise output in
    // 8 of 9 measured pairs -- these documents are prompt-bound, not
    // budget-bound -- so this is headroom, billed only on tokens produced.
    expect(maxTokensFor('app')).toBe(4000);
    // page 2,500 -> 3,200: p100 measured 1,604, but a page's shape varies more
    // than any other kind (article, listing, results, profile, video).
    expect(maxTokensFor('page')).toBe(3200);
    // a repair rewrites the whole document that ran out of room, so it needs
    // the largest document cap, which is now app's.
    expect(maxTokensFor('repair')).toBe(4000);
  });
});

describe('S4 — per-engine wall clock, and json mode', () => {
  it('gives the slow reference engine its own timeout and leaves the rest on the default', () => {
    // BAKEOFF-2 finding 2: haiku's desktops median 25,003 ms against our own
    // 25,000 ms cap, so two of four boots died on OUR clock, not Anthropic's.
    const haiku = allEngines().find((e) => e.id === 'anthropic-haiku')!;
    expect(haiku.timeout_ms).toBe(60000);
    expect(timeoutFor(haiku, 25000)).toBe(60000);
    const cerebras = allEngines().find((e) => e.id === 'cerebras-oss120')!;
    expect(cerebras.timeout_ms).toBeUndefined();
    expect(timeoutFor(cerebras, 25000)).toBe(25000);
    expect(timeoutFor(null, 25000)).toBe(25000);
    // a nonsense override cannot make the clock shorter than a second
    expect(timeoutFor({ ...cerebras, timeout_ms: 5 }, 25000)).toBe(25000);
    expect(timeoutFor({ ...cerebras, timeout_ms: NaN as any }, 25000)).toBe(25000);
  });

  it('declares json mode only where it was verified, and only Cerebras/OpenRouter/OpenAI have it', () => {
    const byId = new Map(allEngines().map((e) => [e.id, e]));
    expect(byId.get('cerebras-oss120')!.json_mode).toBe(true);
    expect(byId.get('or-oss20-groq')!.json_mode).toBe(true);
    expect(byId.get('openai-small')!.json_mode).toBe(true);
    // Anthropic's OpenAI-compatible endpoint does not take response_format
    expect(byId.get('anthropic-haiku')!.json_mode).toBeUndefined();
    expect((enginesFile()._notes || []).join('\n')).toMatch(/json_mode/);
  });
});

describe('availability', () => {
  it('shows an engine only when its key is set, and mock always', () => {
    const none = availableEngines({} as NodeJS.ProcessEnv);
    expect(none.map((e) => e.id)).toEqual(['mock']);
    const groq = availableEngines({ GROQ_API_KEY: 'x' } as any).map((e) => e.id);
    expect(groq).toContain('groq-oss20');
    expect(groq).toContain('groq-oss120');
    expect(groq).not.toContain('openai-small');
  });

  it('findEngine respects availability', () => {
    expect(findEngine('groq-oss20', {} as any)).toBeNull();
    expect(findEngine('mock', {} as any)?.id).toBe('mock');
  });
});

describe('cost', () => {
  it('prices a generation from the per-million table', () => {
    const e = { id: 'x', label: 'x', kind: 'openai', model: 'm', keyEnv: null, usd_in: 1, usd_out: 5 } as any;
    expect(costUsd(e, 1_000_000, 0)).toBeCloseTo(1);
    expect(costUsd(e, 0, 200_000)).toBeCloseTo(1);
    expect(costUsd(e, 0, 0)).toBe(0);
  });
  it('lets an engine override the default temperature', () => {
    const hi = allEngines().find((e) => e.id === 'anthropic-haiku')!;
    expect(temperatureFor(hi)).toBe(1);
    expect(temperatureFor({ ...hi, temperature: undefined })).toBe(enginesFile().defaults.temperature);
  });
});
