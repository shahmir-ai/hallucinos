import { availableEngines, enginesFile, findEngine, type EngineDef } from './engines.js';
import type { Kind } from '../kernel/contract.js';

/**
 * H1 — the routing table.
 *
 * `engine: "auto"` on POST /api/gen (the default on `/`) does not name an
 * engine; it names a POLICY, per kind, read from `engines.json`'s top-level
 * `routes`. An explicit engine id — which is what `/bakeoff/run`'s picker and
 * the bake-off harness send — bypasses routing and hedging entirely, because a
 * single engine that is silently helped by a second one cannot be judged.
 *
 * `ROUTES_JSON` overrides the file for one process (ops lever and the way the
 * tests point a route at two fake upstreams); `ROUTING=off` disables routing
 * altogether and `auto` then behaves exactly like the old default engine.
 */

export const AUTO = 'auto';

export interface RouteEntry {
  primary: string;
  hedge?: string;
}

export type RoutesTable = Record<string, Partial<Record<Kind, RouteEntry>>>;

export interface ResolvedRoute {
  primary: EngineDef;
  hedge: EngineDef | null;
  /** the route table answered for this kind (as opposed to the plain default engine) */
  routed: boolean;
  /** what the table asked for, even where it could not be honoured */
  wanted?: RouteEntry;
}

export function routingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(0|false|no|off)$/i.test(String(env.ROUTING || ''));
}

let warned = false;
export function routesTable(env: NodeJS.ProcessEnv = process.env): RoutesTable {
  if (env.ROUTES_JSON) {
    try {
      const j = JSON.parse(env.ROUTES_JSON);
      if (j && typeof j === 'object') return j as RoutesTable;
    } catch {
      if (!warned) {
        warned = true;
        process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), event: 'bad-routes-json' }) + '\n');
      }
    }
  }
  const t = (enginesFile() as { routes?: RoutesTable }).routes;
  return t && typeof t === 'object' ? t : {};
}

/** The entry for one kind, or null when the table says nothing about it. */
export function routeFor(kind: Kind, env: NodeJS.ProcessEnv = process.env): RouteEntry | null {
  if (!routingEnabled(env)) return null;
  const e = routesTable(env).default?.[kind];
  return e && typeof e.primary === 'string' ? e : null;
}

/**
 * What `engine:"auto"` means for this kind, right now, with the keys this
 * process actually holds. A route whose primary has no key is demoted to its
 * hedge rather than failing; a route with neither falls back to `fallback`.
 */
export function resolveRoute(kind: Kind, fallback: EngineDef, env: NodeJS.ProcessEnv = process.env): ResolvedRoute {
  const want = routeFor(kind, env);
  if (!want) return { primary: fallback, hedge: null, routed: false };
  let primary = findEngine(want.primary, env);
  let hedge = want.hedge ? findEngine(want.hedge, env) : null;
  if (!primary) {
    primary = hedge;
    hedge = null;
  }
  if (!primary) return { primary: fallback, hedge: null, routed: false, wanted: want };
  if (hedge && hedge.id === primary.id) hedge = null;
  return { primary, hedge, routed: true, wanted: want };
}

/** True when `auto` is worth offering at all (the table resolves for the two boot kinds). */
export function autoUsable(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!routingEnabled(env)) return false;
  const ids = new Set(availableEngines(env).map((e) => e.id));
  for (const kind of ['boot', 'desktop'] as Kind[]) {
    const r = routeFor(kind, env);
    if (!r) return false;
    if (!ids.has(r.primary) && !(r.hedge && ids.has(r.hedge))) return false;
  }
  return true;
}

/** The per-kind route, for /api/engines and for the report. */
export function routeSummary(env: NodeJS.ProcessEnv = process.env): Record<string, { primary: string; hedge: string | null }> {
  const out: Record<string, { primary: string; hedge: string | null }> = {};
  for (const kind of ['boot', 'desktop', 'app', 'page'] as Kind[]) {
    const r = routeFor(kind, env);
    if (r) out[kind] = { primary: r.primary, hedge: r.hedge || null };
  }
  return out;
}
