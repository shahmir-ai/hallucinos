import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BootIdentityGate } from '../server/identity.js';

/**
 * The regression test for BAKEOFF-2's biggest variety bug, run against the real
 * thing rather than against what we imagine a model writes.
 *
 * `scripts/identity-sweep.mjs --heads=reviews/identity-heads-N.json` captures
 * the first 400 characters of every boot stream from a live engine, pass or
 * fail. This replays all of them through the current gate, for free, and fails
 * if the parse rate drops. When a future change to the parser or the prompt
 * breaks a class of head, this is what says so — and a new capture (a cent's
 * worth of tokens) extends the sample.
 *
 * The bar is deliberately a rate rather than "all of them": a head that is
 * genuinely EMPTY (cerebras occasionally spends the whole boot budget on
 * reasoning and returns no content at all — 2 of 20 in identity-heads-1) cannot
 * be parsed by anybody, and the server's answer to that one is the rescue call,
 * not the parser.
 */
const DIR = resolve(import.meta.dirname, '../reviews');

interface Head {
  engine: string;
  seed: string;
  head: string;
  name?: string;
  fallback?: boolean;
  fail?: string | null;
}

const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /^identity-heads-.*\.json$/.test(f)) : [];

describe('I1 — captured boot heads from a live engine', () => {
  it('has at least one capture to replay', () => {
    expect(files.length, `no identity-heads-*.json in ${DIR} — run npm run identity-sweep -- --heads=…`).toBeGreaterThan(0);
  });

  for (const f of files) {
    const heads = JSON.parse(readFileSync(resolve(DIR, f), 'utf8')) as Head[];

    it(`${f}: every non-empty head parses into a named machine`, () => {
      // A capture is clipped (the server writes the first 1,200 characters), so
      // a head whose comment was still open at the clip is inconclusive rather
      // than failed — it is the CAPTURE that ended, not the model.
      const clipped = (h: Head) => h.head.includes('<!--os-identity') && !h.head.includes('-->');
      const nonEmpty = heads.filter((h) => h.head && h.head.trim().length > 20 && !clipped(h));
      expect(nonEmpty.length).toBeGreaterThan(0);
      const failed: string[] = [];
      for (const h of nonEmpty) {
        // the budget is raised: the capture is already clipped to 400 chars, so
        // the gate must decide on what is there rather than wait for more
        const g = new BootIdentityGate(h.seed || 'replay', 1 << 20);
        g.push(h.head);
        const r = g.result();
        if (!r.identity || /^UNNAMED\//.test(r.identity.name)) failed.push(`${h.seed}: ${r.fail || 'unnamed'} :: ${h.head.slice(0, 80)}`);
      }
      expect(failed, failed.join('\n')).toEqual([]);
    });

    it(`${f}: an empty head is reported as missing, not as a name`, () => {
      for (const h of heads.filter((x) => !x.head || !x.head.trim())) {
        const g = new BootIdentityGate(h.seed || 'replay', 1 << 20);
        g.push(h.head || '');
        const r = g.result();
        expect(r.identity).toBeNull();
        expect(r.fail).toBe('missing');
      }
    });

    it(`${f}: nothing before the document is left in the stream`, () => {
      for (const h of heads.filter((x) => x.head && x.head.includes('<!doctype'))) {
        const g = new BootIdentityGate(h.seed || 'replay', 1 << 20);
        g.push(h.head);
        const r = g.result();
        // whatever the verdict, the identity comment never reaches the kernel
        // twice: the server writes exactly one and strips the model's
        expect(r.rest.includes('os-identity')).toBe(false);
      }
    });
  }
});
