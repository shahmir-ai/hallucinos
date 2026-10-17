import { describe, it, expect } from 'vitest';
import { mockDocument, mockStream } from '../server/mock.js';
import { validateDesktop, validateApp } from '../kernel/contract.js';
import type { GenCtx } from '../server/engines.js';

const ctx = (kind: any, vars: any = {}): GenCtx => ({
  kind,
  vars,
  seed: 'seed1234',
  system: 'sys',
  user: 'Begin.',
  maxTokens: 4500,
  temperature: 1,
});

const APPS = ['browser', 'photos', 'trash', 'calculator', 'store', 'mail', 'messages', 'terminal', 'taskmgr', 'maps', 'weather', 'news', 'notes', 'games', 'update', 'about'];

describe('the mock engine', () => {
  it('never returns the same document twice — nothing here is cacheable', () => {
    const a = mockDocument(ctx('page', { url: 'https://google.com/', domain: 'google.com', path: '/' }));
    const b = mockDocument(ctx('page', { url: 'https://google.com/', domain: 'google.com', path: '/' }));
    expect(a).not.toBe(b);
    expect(a).not.toEqual(b);
  });

  it('produces a desktop that satisfies the contract, launchers included', () => {
    const html = mockDocument(ctx('desktop', { identity_json: '{"name":"TEST OS"}' }));
    expect(validateDesktop(html, APPS)).toEqual({ ok: true, missing: [] });
  });

  it('produces a browser app with the page and url hooks', () => {
    const html = mockDocument(ctx('app', { app_id: 'browser' }));
    expect(validateApp(html, 'browser').ok).toBe(true);
  });

  it('shapes pages from the url', () => {
    expect(mockDocument(ctx('page', { domain: 'google.com', path: '/' }))).toContain('data-mock-shape="search-home"');
    expect(mockDocument(ctx('page', { domain: 'google.com', path: '/search', query: 'q=pizza' }))).toContain('data-mock-shape="results"');
    expect(mockDocument(ctx('page', { domain: 'reddit.com', path: '/r/cats' }))).toContain('data-mock-shape="subreddit"');
  });

  it('renders a wholesome unrelated site when moderation rerouted', () => {
    const html = mockDocument(ctx('page', { domain: 'anything.com', path: '/', rerouted: 'true' }));
    expect(html).toContain('data-mock-rerouted="true"');
    expect(html.toLowerCase()).not.toContain('blocked');
  });

  it('returns identity as JSON', () => {
    const parsed = JSON.parse(mockDocument(ctx('identity')));
    expect(typeof parsed.name).toBe('string');
    expect(parsed.boot_message).toBeTruthy();
  });

  it('carries the no-network probe so the sandbox can be proven', () => {
    const html = mockDocument(ctx('page', { domain: 'example.org', path: '/' }));
    expect(html).toContain('images.example.com');
    expect(html).toContain('beacon.example.com');
  });

  it('streams in many chunks so the paint is progressive', async () => {
    process.env.MOCK_DELAY_MS = '0';
    const chunks: string[] = [];
    for await (const c of mockStream(ctx('desktop', { identity_json: '{}' }))) if (c.text) chunks.push(c.text);
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.join('').startsWith('<!doctype html>')).toBe(true);
  });

  it('reports usage so cost telemetry has numbers', async () => {
    process.env.MOCK_DELAY_MS = '0';
    let usage: any = null;
    for await (const c of mockStream(ctx('app', { app_id: 'notes' }))) if (c.usage) usage = c.usage;
    expect(usage.in).toBeGreaterThan(0);
    expect(usage.out).toBeGreaterThan(0);
  });
});
