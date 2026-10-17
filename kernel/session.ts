import type { Box } from './geometry.js';
import type { Identity } from './contract.js';

export interface AppSpec {
  id: string;
  shape: string;
  /** the model's display name for the app (Store installs); ids are not labels */
  name?: string;
  affordances?: string;
}

export interface WinState {
  id: string;
  app: string;
  params: Record<string, unknown>;
  title: string;
  geometry: Box;
  z: number;
  minimized: boolean;
  /** browser windows only: the fake internet history of this window */
  history: string[];
  cursor: number;
}

export interface SessionState {
  sessionId: string;
  seed: string;
  engine: string;
  identity: Identity | null;
  manifest: { apps: AppSpec[] };
  windows: WinState[];
}

const KEY_PREFIX = 'hallucinos:session:';

export function newSession(engine: string): SessionState {
  const sessionId = rnd(10);
  // Reload of the tab is a new boot (SPEC §2.2): drop everything a previous
  // session left behind rather than resuming it.
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.indexOf(KEY_PREFIX) === 0) sessionStorage.removeItem(k);
    }
  } catch {}
  return { sessionId, seed: rnd(12), engine, identity: null, manifest: { apps: [] }, windows: [] };
}

export function persist(s: SessionState): void {
  try {
    sessionStorage.setItem(
      KEY_PREFIX + s.sessionId,
      JSON.stringify({ seed: s.seed, engine: s.engine, identity: s.identity, manifest: s.manifest, windows: s.windows.map(stripWin) })
    );
  } catch {}
}

function stripWin(w: WinState) {
  return { id: w.id, app: w.app, title: w.title, geometry: w.geometry, z: w.z, minimized: w.minimized, history: w.history, cursor: w.cursor };
}

export function rnd(n: number): string {
  let s = '';
  const alpha = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(n);
  (crypto as Crypto).getRandomValues(buf);
  for (let i = 0; i < n; i++) s += alpha[buf[i] % alpha.length];
  return s;
}

/** Read-only snapshot handed to generated documents via os.state(). */
export function snapshot(s: SessionState) {
  return {
    os: s.identity ? { name: s.identity.name, version: s.identity.version, tagline: s.identity.tagline } : null,
    apps: s.manifest.apps.map((a) => a.id),
    windows: s.windows.map((w) => ({ id: w.id, app: w.app, title: w.title, minimized: w.minimized })),
  };
}
