/**
 * Password gate.
 *
 * Every route except /healthz, /robots.txt and /login sits behind one shared
 * password. Without it nothing can reach /api/gen or /api/img, so nobody who
 * finds the URL — person, crawler or bot — can spend the provider credit the
 * API keys draw on. The keys themselves never leave the server either way.
 *
 * - APP_PASSWORD set   → gate on.
 * - APP_PASSWORD unset → gate off, unless REQUIRE_AUTH=1 or the process runs on
 *   Railway (RAILWAY_ENVIRONMENT is set), in which case it FAILS CLOSED: every
 *   gated route answers 503 instead of quietly opening up.
 *
 * A successful login sets an HttpOnly cookie holding an expiry and an
 * HMAC-SHA256 of it, keyed by AUTH_SECRET (or, if unset, a key derived from the
 * password — changing the password then signs everyone out). No server state.
 * Login attempts are limited per client IP to slow down guessing.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';

export const AUTH_COOKIE = 'hos_auth';
const SESSION_DAYS = 30;
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60_000;

const OPEN_PATHS = new Set(['/healthz', '/robots.txt', '/login', '/logout']);

export interface AuthConfig {
  password: string;
  secret: string;
  failClosed: boolean;
}

export function authConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const password = (env.APP_PASSWORD || '').trim();
  const secret = (env.AUTH_SECRET || '').trim() || (password ? sha256('hallucinos-auth|' + password) : '');
  const failClosed = !password && (env.REQUIRE_AUTH === '1' || !!env.RAILWAY_ENVIRONMENT);
  return { password, secret, failClosed };
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function makeToken(secret: string, now = Date.now()): string {
  const exp = String(now + SESSION_DAYS * 86_400_000);
  return `${exp}.${sign(secret, 'v1:' + exp)}`;
}

export function tokenValid(secret: string, token: string | undefined, now = Date.now()): boolean {
  if (!secret || !token) return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < now) return false;
  return safeEqual(sig, sign(secret, 'v1:' + exp));
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

function isHttps(c: Context): boolean {
  const proto = (c.req.header('x-forwarded-proto') || '').split(',')[0].trim();
  return proto === 'https' || c.req.url.startsWith('https:');
}

function safeNext(raw: string | undefined | null): string {
  const n = String(raw || '/');
  // same-origin paths only: no scheme, no protocol-relative //host
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/';
}

const LOGIN_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

export function loginPage(next: string, error = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>&nbsp;</title>
<style>
html,body{margin:0;height:100%;background:#000;color:#c8c8c8;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
form{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(320px,86vw)}
label{display:block;margin-bottom:8px}
input{width:100%;box-sizing:border-box;padding:10px;background:#111;color:#eee;border:1px solid #444;font:inherit}
button{margin-top:10px;width:100%;padding:10px;background:#222;color:#eee;border:1px solid #555;font:inherit;cursor:pointer}
p{color:#e07070;min-height:1.5em;margin:8px 0 0}
</style></head><body>
<form method="post" action="/login">
<label for="p">password</label>
<input id="p" name="password" type="password" autocomplete="current-password" autofocus required>
<input type="hidden" name="next" value="${escapeHtml(next)}">
<button type="submit">enter</button>
<p>${escapeHtml(error)}</p>
</form></body></html>`;
}

/**
 * Registers /login and /logout and returns the gate middleware. `ipOf` is the
 * server's own client-IP function, so the attempt limit uses the same trusted
 * proxy rules as every other per-IP cap.
 */
export function installAuth(app: any, ipOf: (c: Context) => string, cfg = authConfig()): MiddlewareHandler {
  const attempts = new Map<string, number[]>();
  const tooMany = (ip: string): boolean => {
    const now = Date.now();
    const list = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
    attempts.set(ip, list);
    return list.length >= MAX_ATTEMPTS;
  };
  const noteFail = (ip: string) => {
    const list = attempts.get(ip) || [];
    list.push(Date.now());
    attempts.set(ip, list);
    if (attempts.size > 10_000) attempts.clear();
  };
  const enabled = !!cfg.password;

  app.get('/login', (c: Context) => {
    if (!enabled) return c.redirect('/');
    c.header('content-security-policy', LOGIN_CSP);
    c.header('cache-control', 'no-store');
    return c.html(loginPage(safeNext(c.req.query('next'))));
  });

  app.post('/login', async (c: Context) => {
    if (!enabled) return c.redirect('/');
    c.header('content-security-policy', LOGIN_CSP);
    c.header('cache-control', 'no-store');
    const ip = ipOf(c);
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.parseBody()) as Record<string, unknown>;
    } catch {
      /* empty body → wrong password */
    }
    const next = safeNext(String(body.next || '/'));
    if (tooMany(ip)) return c.html(loginPage(next, 'too many attempts, try again in 15 minutes'), 429);
    const given = String(body.password || '');
    if (!given || !safeEqual(given, cfg.password)) {
      noteFail(ip);
      return c.html(loginPage(next, 'wrong password'), 401);
    }
    attempts.delete(ip);
    const secure = isHttps(c) ? '; Secure' : '';
    c.header(
      'set-cookie',
      `${AUTH_COOKIE}=${encodeURIComponent(makeToken(cfg.secret))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`
    );
    return c.redirect(next, 303);
  });

  app.get('/logout', (c: Context) => {
    c.header('set-cookie', `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return c.redirect(enabled ? '/login' : '/', 303);
  });

  return async (c, next) => {
    const path = c.req.path;
    if (OPEN_PATHS.has(path)) return next();
    if (cfg.failClosed) return c.text('APP_PASSWORD is not set; refusing to serve.', 503);
    if (!enabled) return next();
    if (tokenValid(cfg.secret, readCookie(c.req.header('cookie'), AUTH_COOKIE))) return next();
    if (path.startsWith('/api/')) return c.json({ error: 'login required' }, 401);
    const target = path + (new URL(c.req.url).search || '');
    return c.redirect('/login?next=' + encodeURIComponent(target), 303);
  };
}
