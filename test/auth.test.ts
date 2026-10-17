import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { authConfig, installAuth, makeToken, tokenValid, AUTH_COOKIE } from '../server/auth.js';

function appWith(password: string, extra: Record<string, string> = {}) {
  const cfg = authConfig({ APP_PASSWORD: password, ...extra } as NodeJS.ProcessEnv);
  const app = new Hono();
  app.use('*', installAuth(app, () => '1.2.3.4', cfg));
  app.get('/healthz', (c) => c.text('ok'));
  app.get('/', (c) => c.text('home'));
  app.post('/api/gen', (c) => c.text('generated'));
  return app;
}

const form = (fields: Record<string, string>) =>
  ({ method: 'POST', body: new URLSearchParams(fields), headers: { 'content-type': 'application/x-www-form-urlencoded' } }) as RequestInit;

describe('password gate', () => {
  it('leaves /healthz open and blocks everything else', async () => {
    const app = appWith('secret pass');
    expect((await app.request('/healthz')).status).toBe(200);
    const home = await app.request('/');
    expect(home.status).toBe(303);
    expect(home.headers.get('location')).toBe('/login?next=%2F');
    expect((await app.request('/api/gen', { method: 'POST' })).status).toBe(401);
  });

  it('rejects a wrong password and accepts the right one with a working cookie', async () => {
    const app = appWith('secret pass');
    expect((await app.request('/login', form({ password: 'nope' }))).status).toBe(401);
    const ok = await app.request('/login', form({ password: 'secret pass', next: '/' }));
    expect(ok.status).toBe(303);
    const cookie = ok.headers.get('set-cookie')!.split(';')[0];
    expect(cookie.startsWith(AUTH_COOKIE + '=')).toBe(true);
    expect(await (await app.request('/', { headers: { cookie } })).text()).toBe('home');
    expect((await app.request('/api/gen', { method: 'POST', headers: { cookie } })).status).toBe(200);
  });

  it('never redirects off-site after login', async () => {
    const app = appWith('pw');
    const r = await app.request('/login', form({ password: 'pw', next: '//evil.example' }));
    expect(r.headers.get('location')).toBe('/');
  });

  it('locks an IP out after ten wrong guesses', async () => {
    const app = appWith('pw');
    for (let i = 0; i < 10; i++) await app.request('/login', form({ password: 'x' }));
    expect((await app.request('/login', form({ password: 'pw' }))).status).toBe(429);
  });

  it('rejects forged, tampered and expired tokens', () => {
    const t = makeToken('k');
    expect(tokenValid('k', t)).toBe(true);
    expect(tokenValid('other', t)).toBe(false);
    expect(tokenValid('k', t.replace(/^\d/, '9'))).toBe(false);
    expect(tokenValid('k', makeToken('k', Date.now() - 31 * 86_400_000))).toBe(false);
  });

  it('is off with no password locally, and fails closed on Railway', async () => {
    expect((await appWith('').request('/')).status).toBe(200);
    const railway = appWith('', { RAILWAY_ENVIRONMENT: 'production' });
    expect((await railway.request('/')).status).toBe(503);
    expect((await railway.request('/api/gen', { method: 'POST' })).status).toBe(503);
    expect((await railway.request('/healthz')).status).toBe(200);
  });
});
