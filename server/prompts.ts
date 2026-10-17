import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './env.js';
import type { Kind } from '../kernel/contract.js';

/**
 * PROMPT FILE INTERFACE (contract with the prompt author)
 *  - prompts/system/voice.md            prepended to every HTML kind
 *  - prompts/system/{identity,boot,desktop,app,page,repair}.md
 *  - prompts/user/{kind}.md             optional user turn; absent -> "Begin."
 *  - prompts/apps/{appId}.md            shape + affordances for one app
 * Rendering is plain text with {{variable}} placeholders. Unknown variables render
 * as the empty string. No logic, no loops.
 */

const PROMPTS = resolve(ROOT, 'prompts');

/** Read a prompt file, or null when it is not there (a parallel author may not have written it yet). */
export function readPrompt(rel: string): string | null {
  const p = resolve(PROMPTS, rel);
  if (!p.startsWith(PROMPTS)) return null;
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

export function render(tpl: string, vars: Record<string, string | undefined>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? '' : String(v);
  });
}

/**
 * Minimal built-in fallbacks. These exist so the code path is exercised when
 * prompts/ is empty; they are deliberately terse — the real wording lives in
 * prompts/ and is owned by the prompt author.
 */
const BUILTIN_VOICE =
  'You write one HTML document and nothing else. Start with <!doctype html>. No code fences, no commentary. ' +
  'Inline CSS only. No external resources, no <img> with an http src — use inline SVG, CSS shapes, emoji. ' +
  'Invent everything: names, prices, people, dates. Never mention AI, models or prompts. Never break character.';

const BUILTIN: Record<Kind, string> = {
  identity:
    'Invent an operating system. Reply with JSON only, no prose, no fences: ' +
    '{"name","tagline","version","era","personality","palette_words":[],"font_words":[],"mascot","boot_message",' +
    '"archetype":"taskbar"|"dock"}. Constraints you must honour: {{dice_json}}. ' +
    'Never use any of these names: {{never_names}}. Seed: {{seed}}.',
  // SPEC §12.1 / I1: the identity rides in the boot stream, ahead of the document.
  boot:
    'First output exactly one line, before anything else:\n' +
    '<!--os-identity:{"name":…,"tagline":…,"version":…,"era":…,"personality":…,"palette_words":[…],"font_words":[…],' +
    '"mascot":…,"boot_message":…,"archetype":"taskbar" or "dock"}-->\n' +
    'Then one HTML document: the full-screen boot screen of that OS, matching that identity. ' +
    'Constraints you must honour: {{dice_json}}. Never use any of these names: {{never_names}}. Seed: {{seed}}.',
  desktop:
    'One HTML document: the desktop of this OS. Identity: {{identity_json}}. Apps: {{manifest_json}}. Seed: {{seed}}. ' +
    'Launchers, one element each, copied exactly: {{app_launchers}}. ' +
    'It must contain [data-os-desktop], [data-os-windows], [data-os-taskbar], ' +
    'a <template data-os-window> containing [data-os-title] [data-os-content] [data-os-close] [data-os-drag], ' +
    'a <template data-os-task> containing [data-os-title], and one [data-os-app="<id>"] launcher per app id. ' +
    // SPEC §12.3 / I5
    'Pick ONE archetype, taskbar (bar along the bottom, icon grid on the wallpaper) or dock (menu bar on top, dock of icons), ' +
    'put data-os-archetype="taskbar" or data-os-archetype="dock" on <body>, and give the ticking clock [data-os-clock]. ' +
    'Archetype to use: {{archetype}}.',
  app:
    'One HTML document: the window contents of the app "{{app_id}}". Shape: {{app_shape}}. ' +
    'This world differs from the real one exactly here, and every number you write obeys it: {{reality_json}}. ' +
    'Identity: {{identity_json}}. Params: {{params_json}}. Seed: {{seed}}. ' +
    'If this app is the browser it must contain [data-os-page] (empty) and an [data-os-url] text input.',
  page:
    'One HTML document: the website at {{url}} (domain {{domain}}, path {{path}}, query {{query}}). ' +
    'Came from {{referer_url}} titled {{referer_title}}. Recent history: {{history}}. Seed: {{seed}}. ' +
    'Rerouted: {{rerouted}}. Infer the shape from the URL and invent every word of the content. ' +
    'This world differs from the real one exactly here, and every number you write obeys it: {{reality_json}}.',
  repair:
    'Your previous document was missing required hooks: {{missing_hooks}}. ' +
    'Write the whole document again, same idea, with every one of those present. Identity: {{identity_json}}. Apps: {{manifest_json}}.',
};

export interface PromptVars {
  identity_json?: string;
  manifest_json?: string;
  app_launchers?: string;
  app_count?: string;
  seed?: string;
  app_id?: string;
  app_shape?: string;
  lineage_name?: string;
  lineage_version?: string;
  lineage_next_version?: string;
  params_json?: string;
  url?: string;
  domain?: string;
  path?: string;
  query?: string;
  referer_url?: string;
  referer_title?: string;
  history?: string;
  rerouted?: string;
  missing_hooks?: string;
  videos_json?: string;
  viewport?: string;
  kind?: string;
  /** SPEC §12.4: the five dice the SERVER rolls, as JSON, for identity/boot */
  dice_json?: string;
  /** SPEC §12.4: comma-separated last 200 OS names, "never use these" */
  never_names?: string;
  /** I1: the archetype the model chose, echoed into the desktop prompt */
  archetype?: string;
  /**
   * H5 — the per-session reality offset (server/dice.ts `rollReality`), as JSON,
   * rendered into kind=page and kind=app only. The calendar, the unit system,
   * the scale factor, the two place names and the invented historical event are
   * the SERVER's roll, in the shape §12.4 already uses for identity, because a
   * prompt sentence lost to the model's prior twice in a row (HANDOFF-4 #4).
   */
  reality_json?: string;
  /**
   * A note about THIS url's shape, rendered into the user turn beside the
   * address it is about (`prompts/notes/<class>.md`). It exists because a rule
   * three thousand tokens up in the system prompt loses to the model's prior:
   * BAKEOFF-3 wrote the real Moon into every wikipedia page on every boot with
   * the divergence rule already in `prompts/system/page.md`.
   */
  shape_note?: string;
}

/**
 * Which page shapes get a note (see `shape_note`). One class so far: pages
 * whose job is to state facts, which are the pages a model recites into.
 * Matching is on the host and the path, never on the query — what someone
 * searched for is their text, not a shape.
 */
export function pageNoteClass(domain: string, path: string): string | null {
  const host = String(domain || '').toLowerCase();
  const p = String(path || '').toLowerCase();
  const reference =
    /(^|\.)(wikipedia|wikimedia|wiktionary|wikidata|britannica|encyclopedia|encyclopaedia|dictionary|merriam-webster|thesaurus|almanac|fandom|wikia)\./.test(host) ||
    /(^|\.)wiki\./.test(host) ||
    /^\/(wiki|wikis|encyclopedia|encyclopaedia|dictionary|define|almanac|gazetteer|species|taxon)(\/|$)/.test(p);
  return reference ? 'reference' : null;
}

/** The note itself, or '' when this url's shape has none (or the file is absent). */
export function pageShapeNote(domain: string, path: string): string {
  const cls = pageNoteClass(domain, path);
  if (!cls) return '';
  return (readPrompt('notes/' + cls + '.md') || '').trim();
}

export interface BuiltPrompt {
  system: string;
  user: string;
  usedFiles: string[];
  fallbacks: string[];
}

export function buildPrompt(kind: Kind, vars: PromptVars): BuiltPrompt {
  const usedFiles: string[] = [];
  const fallbacks: string[] = [];

  const all: Record<string, string | undefined> = { ...vars, kind };

  // app_shape comes from prompts/apps/{app_id}.md
  if (vars.app_id && all.app_shape === undefined) {
    const id = sanitizeId(vars.app_id);
    const shape = readPrompt(`apps/${id}.md`);
    if (shape) {
      usedFiles.push(`apps/${id}.md`);
      all.app_shape = shape;
    } else {
      fallbacks.push(`apps/${id}.md`);
    }
  }

  let system = '';
  if (kind !== 'identity') {
    const voice = readPrompt('system/voice.md');
    if (voice) {
      usedFiles.push('system/voice.md');
      system += voice;
    } else {
      fallbacks.push('system/voice.md');
      system += BUILTIN_VOICE;
    }
  }

  const kindFile = readPrompt(`system/${kind}.md`);
  if (kindFile) {
    usedFiles.push(`system/${kind}.md`);
    system += (system ? '\n\n' : '') + kindFile;
  } else {
    fallbacks.push(`system/${kind}.md`);
    system += (system ? '\n\n' : '') + BUILTIN[kind];
  }

  const userFile = readPrompt(`user/${kind}.md`);
  let user: string;
  if (userFile) {
    usedFiles.push(`user/${kind}.md`);
    user = userFile;
  } else {
    user = 'Begin.';
  }

  // Optional user-turn fragments, appended only when their slot has content.
  for (const frag of OPTIONAL_FRAGMENTS) {
    if (frag.kind !== kind || !frag.when(all)) continue;
    const text = readPrompt(frag.file);
    if (!text) continue;
    usedFiles.push(frag.file);
    user += '\n\n' + text;
  }

  return { system: render(system, all), user: render(user, all), usedFiles, fallbacks };
}

const nonEmptyJsonArray = (s: string | undefined) => !!s && s.trim() !== '' && s.trim() !== '[]';

/**
 * SPEC §5 offers the video library to the model "when non-empty"; SPEC §4's
 * update app needs to know what it is rebooting out of. Both are per-request
 * extras rather than part of the fixed user turn.
 */
const OPTIONAL_FRAGMENTS: { kind: Kind; file: string; when: (v: Record<string, string | undefined>) => boolean }[] = [
  { kind: 'page', file: 'user/page-videos.md', when: (v) => nonEmptyJsonArray(v.videos_json) },
  // H5: the reality offset next to the url, where the reference note proved a
  // constraint actually lands (HANDOFF-4 issue 6). Optional: the file is the
  // prompt author's, and the JSON is in the system turn either way.
  { kind: 'page', file: 'user/reality.md', when: (v) => !!v.reality_json },
  { kind: 'app', file: 'user/reality.md', when: (v) => !!v.reality_json },
  { kind: 'identity', file: 'user/identity-lineage.md', when: (v) => !!v.lineage_name },
];

export function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 64);
}

/** The app shape as the manifest knows it, used when prompts/apps/<id>.md is absent. */
export function shapeFromManifest(manifest: { apps: { id: string; shape: string }[] }, id: string): string {
  const hit = manifest.apps.find((a) => a.id === id);
  return hit ? hit.shape : id;
}
