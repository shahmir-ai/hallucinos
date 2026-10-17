import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bakeoffLanding, latestBakeoffReport, measuredFor, parseBakeoffSpeeds } from '../server/bakeoffpage.js';

const REPORT = `# BAKEOFF-2

| engine | full boots | judged |
|---|---|---|
| \`cerebras-oss120\` | **3** | yes |

## Speed

| engine | boot screen first paint | desktop live | tok/s (HUD, page generations) | $/desktop |
|---|---|---|---|---|
| \`cerebras-oss120\` | **1.1 s** | **2.3 s** | 1,038–1,240 | $0.0028 |
| \`or-oss20-groq\` | 1.6 s | 4.3 s | 638 | $0.0012 |
| \`anthropic-haiku\` | 8.2 s | 21.4 s | 174–184 | $0.026 |
`;

describe('I8 — the /bakeoff landing page', () => {
  it('reads the numbers out of the last report', () => {
    const s = parseBakeoffSpeeds(REPORT);
    expect(s['cerebras-oss120']).toEqual({
      first_paint: '1.1 s',
      desktop: '2.3 s',
      tok_per_s: '1,038–1,240',
      usd_each: '$0.0028',
    });
    expect(s['or-oss20-groq'].tok_per_s).toBe('638');
    expect(s['anthropic-haiku'].desktop).toBe('21.4 s');
  });

  it('never invents a number out of prose', () => {
    expect(parseBakeoffSpeeds('nothing here at all')).toEqual({});
    expect(parseBakeoffSpeeds('| engine | tok/s |\n|---|---|\n| not backticked | 900 |')).toEqual({});
  });

  it('takes the highest-numbered report, and copes with none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hallucinos-reviews-'));
    expect(latestBakeoffReport(dir)).toBeNull();
    expect(measuredFor(dir)).toEqual({ speeds: {}, source: null });
    expect(measuredFor(join(dir, 'nope'))).toEqual({ speeds: {}, source: null });
    writeFileSync(join(dir, 'BAKEOFF-0-mock-rehearsal.md'), '# old');
    writeFileSync(join(dir, 'BAKEOFF-1.md'), '# one');
    writeFileSync(join(dir, 'BAKEOFF-11.md'), REPORT);
    writeFileSync(join(dir, 'SMOKE-1.md'), '# not a bake-off');
    expect(latestBakeoffReport(dir)!.endsWith('BAKEOFF-11.md')).toBe(true);
    const m = measuredFor(dir);
    expect(m.source).toBe('BAKEOFF-11.md');
    expect(m.speeds['cerebras-oss120'].tok_per_s).toBe('1,038–1,240');
  });

  it('renders one Boot button per engine and no kernel', () => {
    const html = bakeoffLanding(
      [
        { id: 'mock', label: 'mock', model: 'fixtures', usd_in: 0, usd_out: 0 },
        { id: 'cerebras-oss120', label: 'Cerebras gpt-oss-120b', model: 'gpt-oss-120b', usd_in: 0.25, usd_out: 0.69 },
      ],
      parseBakeoffSpeeds(REPORT),
      'BAKEOFF-2.md',
      'cerebras-oss120'
    );
    expect(html).toContain('/bakeoff/run?engine=mock');
    expect(html).toContain('/bakeoff/run?engine=cerebras-oss120');
    expect(html).toContain('1,038–1,240');
    expect(html).toContain('not measured'); // the mock has no numbers
    expect(html).toContain('default');
    expect(html).not.toContain('<script');
  });

  it('escapes what it prints and says so when nothing is keyed', () => {
    const html = bakeoffLanding([{ id: 'x', label: '<img onerror=alert(1)>', model: '"', usd_in: 0, usd_out: 0 }], {}, null, 'x');
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img onerror');
    expect(bakeoffLanding([], {}, null, '')).toContain('No engines are keyed');
  });
});
