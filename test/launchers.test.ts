import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../server/prompts.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The desktop prompt's contract checklist is only unmistakable if the launcher
 * list actually renders. A missing var renders as the empty string, so this
 * failure is silent and was live for a whole smoke run.
 */
describe('desktop prompt — the launcher list', () => {
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'manifest.json'), 'utf8')) as {
    apps: { id: string }[];
  };
  const app_launchers = manifest.apps.map((a) => `data-os-app="${a.id}"`).join(' ');
  const built = buildPrompt('desktop', {
    identity_json: '{}',
    manifest_json: JSON.stringify(manifest),
    app_launchers,
    app_count: String(manifest.apps.length),
    seed: 's',
    viewport: '1440x900',
  });

  it('renders every app id as a literal launcher attribute in both turns', () => {
    for (const a of manifest.apps) {
      expect(built.system).toContain(`data-os-app="${a.id}"`);
      expect(built.user).toContain(`data-os-app="${a.id}"`);
    }
  });

  it('leaves no unrendered placeholder in either turn', () => {
    expect(built.system).not.toMatch(/\{\{\s*[a-z_]+\s*\}\}/);
    expect(built.user).not.toMatch(/\{\{\s*[a-z_]+\s*\}\}/);
  });

  it('states the app count rather than a hard-coded number', () => {
    expect(built.system).toContain(String(manifest.apps.length));
    expect(readFileSync(resolve(process.cwd(), 'prompts/system/desktop.md'), 'utf8')).not.toMatch(/\bsixteen\b/i);
  });
});
