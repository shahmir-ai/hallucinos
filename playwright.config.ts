import { defineConfig, devices } from '@playwright/test';

/**
 * Five servers, all on the mock engine, each wired for one thing the suite has to
 * prove. They are separate processes rather than test-only backdoors in the
 * server: caps, mock breakage and stream speed are environment, not request data.
 */
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Every provider key is blanked: the suite must never be able to spend money,
 * and `/api/engines` listing exactly `mock` is one of the things it asserts.
 * NODE_ENV=test also keeps the caps state file out of the repo.
 */
const base = {
  DEFAULT_ENGINE: 'mock',
  MODERATION: 'local',
  IP_SALT: 'e2e',
  NODE_ENV: 'test',
  OPENAI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  CEREBRAS_API_KEY: '',
  GROQ_API_KEY: '',
  INCEPTION_API_KEY: '',
  GOOGLE_API_KEY: '',
  OPENROUTER_API_KEY: '',
  CAPS_STATE_FILE: '',
} as Record<string, string>;

const server = (port: number, env: Record<string, string> = {}) => ({
  command: 'node dist/server.js',
  url: `http://localhost:${port}/healthz`,
  reuseExistingServer: false,
  timeout: 30_000,
  stdout: 'pipe' as const,
  env: { ...base, ...env, PORT: String(port) },
});

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8770',
    userAgent: CHROME_UA,
    viewport: { width: 1280, height: 860 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], userAgent: CHROME_UA } }],
  webServer: [
    // the main server must not rate-limit the suite itself: the per-IP cap is
  // proved on 8771, and every test here comes from the same address
  server(8770, { GEN_PER_IP_PER_HOUR: '100000' }),
    server(8771, { GEN_PER_IP_PER_HOUR: '1' }),
    server(8772, { MOCK_BREAK: 'desktop-always' }),
    server(8773, { MOCK_DELAY_MS: '60' }),
    server(8774, { MOCK_BREAK: 'desktop-once' }),
    server(8775, { MOCK_BREAK: 'content-collapse' }),
    // a crawling stream, so a mid-stream click can be aimed at without racing it
    server(8776, { MOCK_DELAY_MS: '250' }),
    /**
     * SPEC §12.1's late reroute. The remote moderation call is the only thing
     * that can flag AFTER a stream has started, so it is pointed at the fake on
     * 8778 (below), which flags one magic URL and nothing else. A slow stream
     * guarantees the verdict lands mid-document.
     */
    server(8777, {
      MOCK_DELAY_MS: '120',
      MODERATION: 'auto',
      OPENAI_API_KEY: 'e2e-not-a-real-key',
      MODERATION_ENDPOINT: 'http://127.0.0.1:8778/moderations',
    }),
    {
      command: 'node scripts/fake-mod.mjs',
      url: 'http://127.0.0.1:8778/healthz',
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe' as const,
      env: { PORT: '8778', FAKE_MOD_DELAY_MS: '250', FAKE_MOD_MAGIC: 'reroute-me' },
    },
    // MOCK_BREAK=app-error-once: the first app document dies half way through,
    // which is what GEN_TIMEOUT_MS looks like from the kernel's side.
    server(8779, { MOCK_DELAY_MS: '120', MOCK_BREAK: 'app-error-once' }),
    /**
     * MOCK_BREAK=stack-inverted: a desktop that declares its windows layer
     * before its launcher area and gives the launchers a z-index, which is how
     * two of nine real desktops in BAKEOFF-3 painted every window behind the
     * icons.
     */
    server(8780, { MOCK_BREAK: 'stack-inverted', GEN_PER_IP_PER_HOUR: '100000' }),
  ],
});
