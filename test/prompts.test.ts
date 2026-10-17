import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, readPrompt, buildPrompt, pageNoteClass, pageShapeNote, sanitizeId, shapeFromManifest } from '../server/prompts.js';
import { ROOT } from '../server/env.js';
import type { Kind } from '../kernel/contract.js';

const KINDS: Kind[] = ['identity', 'boot', 'desktop', 'app', 'page', 'repair'];

describe('template rendering', () => {
  it('substitutes {{variables}}', () => {
    expect(render('a {{x}} b {{ y }} c', { x: '1', y: '2' })).toBe('a 1 b 2 c');
  });
  it('renders unknown variables as the empty string', () => {
    expect(render('[{{nope}}]', {})).toBe('[]');
    expect(render('[{{nope}}]', { nope: undefined })).toBe('[]');
  });
  it('has no logic and no loops — braces that are not variables survive', () => {
    expect(render('{ "a": 1 } {{x}}', { x: 'v' })).toBe('{ "a": 1 } v');
    expect(render('{{ a-b }}', { 'a-b': 'x' } as any)).toBe('{{ a-b }}');
  });
});

describe('prompt loading', () => {
  it('returns null for a file that is not there', () => {
    expect(readPrompt('system/definitely-not-a-prompt.md')).toBeNull();
  });
  it('refuses to escape the prompts directory', () => {
    expect(readPrompt('../.env')).toBeNull();
    expect(readPrompt('../../package.json')).toBeNull();
  });
});

describe('buildPrompt', () => {
  const vars = {
    identity_json: '{"name":"X"}',
    manifest_json: '{"apps":[]}',
    seed: 'seed123',
    app_id: 'browser',
    app_shape: 'a web browser',
    params_json: '{}',
    url: 'https://google.com/',
    domain: 'google.com',
    path: '/',
    query: '',
    referer_url: '',
    referer_title: '',
    history: '',
    rerouted: 'false',
    missing_hooks: '[data-os-taskbar]',
    videos_json: '[]',
    viewport: '1440x900',
  };

  it('produces a non-empty system message for every kind, with or without prompt files', () => {
    for (const kind of KINDS) {
      const p = buildPrompt(kind, vars);
      expect(p.system.length).toBeGreaterThan(20);
      expect(p.system).not.toMatch(/\{\{\s*[a-z_]+\s*\}\}/i);
    }
  });

  it('defaults the user turn to "Begin." when prompts/user/<kind>.md is absent', () => {
    for (const kind of KINDS) {
      const hasUser = existsSync(resolve(ROOT, 'prompts', 'user', `${kind}.md`));
      const p = buildPrompt(kind, vars);
      if (!hasUser) expect(p.user).toBe('Begin.');
      else expect(p.user.length).toBeGreaterThan(0);
    }
  });

  it('prepends voice.md to every HTML kind and never to identity', () => {
    const voice = readPrompt('system/voice.md');
    if (!voice) return; // the prompt author has not written it yet; the fallback path is covered above
    for (const kind of KINDS.filter((k) => k !== 'identity')) {
      expect(buildPrompt(kind, vars).system.startsWith(render(voice, vars).slice(0, 40))).toBe(true);
    }
    expect(buildPrompt('identity', vars).system.startsWith(render(voice, vars).slice(0, 40))).toBe(false);
  });

  it('reports which files it had to fall back on', () => {
    const p = buildPrompt('desktop', vars);
    const expected = ['system/voice.md', 'system/desktop.md'].filter((f) => !existsSync(resolve(ROOT, 'prompts', f)));
    expect(p.fallbacks.sort()).toEqual(expected.sort());
  });

  it('carries the missing hooks into the repair prompt', () => {
    const p = buildPrompt('repair', { ...vars, missing_hooks: '[data-os-taskbar], [data-os-windows]' });
    expect(p.system).toContain('[data-os-taskbar]');
  });
});

describe('ids and shapes', () => {
  it('sanitizes app ids to something that cannot walk the filesystem', () => {
    expect(sanitizeId('../../etc/passwd')).toBe('etcpasswd');
    expect(sanitizeId('custom:loom-3')).toBe('custom:loom-3');
  });
  it('falls back to the manifest one-liner for a shape', () => {
    const m = { apps: [{ id: 'notes', shape: 'the OS diary' }] };
    expect(shapeFromManifest(m, 'notes')).toBe('the OS diary');
    expect(shapeFromManifest(m, 'nope')).toBe('nope');
  });
});

describe('the app shape file actually reaches the model', () => {
  const base = {
    identity_json: '{"name":"X"}',
    manifest_json: '{"apps":[]}',
    seed: 's',
    params_json: '{}',
    viewport: '1440x900',
  };

  it('kind=app for the browser carries prompts/apps/browser.md, hooks and all', () => {
    const p = buildPrompt('app', { ...base, app_id: 'browser' });
    expect(p.usedFiles).toContain('apps/browser.md');
    // [data-os-page] / [data-os-url] are described NOWHERE else; the manifest
    // one-liner does not mention them.
    expect(p.system).toContain('data-os-page');
    expect(p.system).toContain('data-os-url');
  });

  it('kind=app for the store carries the os.install contract', () => {
    const p = buildPrompt('app', { ...base, app_id: 'store' });
    expect(p.usedFiles).toContain('apps/store.md');
    expect(p.system).toContain('os.install');
  });

  it('every manifest app has a shape file and every file is bigger than its one-liner', () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8')) as {
      apps: { id: string; shape: string }[];
    };
    for (const a of manifest.apps) {
      const file = readPrompt(`apps/${a.id}.md`);
      expect(file, `prompts/apps/${a.id}.md`).toBeTruthy();
      const p = buildPrompt('app', { ...base, app_id: a.id });
      expect(p.usedFiles, a.id).toContain(`apps/${a.id}.md`);
      expect(p.system.length, a.id).toBeGreaterThan(shapeFromManifest(manifest, a.id).length * 2);
    }
  });

  it('a custom app with no file reports the fallback, so the caller can substitute the shape', () => {
    const p = buildPrompt('app', { ...base, app_id: 'custom:dowsing-kit' });
    expect(p.usedFiles).not.toContain('apps/custom:dowsing-kit.md');
    expect(p.fallbacks).toContain('apps/custom:dowsing-kit.md');
    const withShape = buildPrompt('app', { ...base, app_id: 'custom:dowsing-kit', app_shape: 'a divining tool' });
    expect(withShape.system).toContain('a divining tool');
  });
});

describe('optional user-turn fragments', () => {
  it('the video block is only sent when data/videos.json has entries (SPEC §5)', () => {
    const base = { seed: 's', url: 'https://x.com/', domain: 'x.com', path: '/', query: '' };
    const empty = buildPrompt('page', { ...base, videos_json: '[]' });
    expect(empty.user).not.toContain('VIDEO LIBRARY');
    expect(empty.usedFiles).not.toContain('user/page-videos.md');
    const full = buildPrompt('page', { ...base, videos_json: '[{"title":"Wet Cement","url":"https://x/1"}]' });
    expect(full.user).toContain('VIDEO LIBRARY');
    expect(full.user).toContain('Wet Cement');
  });

  it('the reboot lineage is only sent on a reboot (SPEC §4)', () => {
    expect(buildPrompt('identity', { seed: 's' }).user).not.toContain('restarting');
    const reboot = buildPrompt('identity', {
      seed: 's',
      lineage_name: 'GRANITE Desk',
      lineage_version: '4.2',
      lineage_next_version: '4.3',
    });
    expect(reboot.user).toContain('GRANITE Desk');
    expect(reboot.user).toContain('4.3');
  });
});

/**
 * BAKEOFF-3 open issue 6: every wikipedia-shaped page in every boot recited the
 * real Moon, with the divergence rule already written into
 * `prompts/system/page.md`. A rule three thousand tokens above the URL loses to
 * the model's prior, so the rule now also arrives in the user turn, next to the
 * address. The class is every reference shape, not one domain — the encyclopedia
 * is simply the one that got measured.
 */
describe('page shape notes', () => {
  const ref = (d: string, p = '/') => pageNoteClass(d, p);

  it('marks the reference shapes, whatever host they arrive on', () => {
    expect(ref('en.wikipedia.org', '/wiki/Moon')).toBe('reference');
    expect(ref('simple.wiktionary.org', '/wiki/tide')).toBe('reference');
    expect(ref('www.britannica.com', '/topic/kiln')).toBe('reference');
    expect(ref('minecraft.fandom.com', '/wiki/Anvil')).toBe('reference');
    expect(ref('wiki.hallucinos.test', '/Main_Page')).toBe('reference');
    expect(ref('www.merriam-webster.com', '/dictionary/loom')).toBe('reference');
    // by path, on a host that says nothing
    expect(ref('example.test', '/wiki/Harbour')).toBe('reference');
    expect(ref('example.test', '/species/anon')).toBe('reference');
    expect(ref('example.test', '/define/keel')).toBe('reference');
  });

  it('leaves every other shape alone', () => {
    expect(ref('google.com', '/search')).toBeNull();
    expect(ref('reddit.com', '/r/x/comments/1')).toBeNull();
    expect(ref('amazon.com', '/dp/B001')).toBeNull();
    expect(ref('wikipediafanclub.test', '/')).toBeNull();
    // the query is the visitor's own text, never a shape
    expect(pageNoteClass('news.test', '/story')).toBeNull();
  });

  it('renders the note into the page user turn, beside the url', () => {
    const note = pageShapeNote('en.wikipedia.org', '/wiki/Moon');
    expect(note.length).toBeGreaterThan(200);
    const built = buildPrompt('page', { url: 'https://en.wikipedia.org/wiki/Moon', domain: 'en.wikipedia.org', path: '/wiki/Moon', shape_note: note });
    expect(built.user).toContain(note);
    // and nothing is added to a shape that has no note
    expect(pageShapeNote('google.com', '/search')).toBe('');
  });
});
