import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the production builds (`pnpm build` first).
 * The API simulates vehicles but not stand reports, so stand state only changes when a
 * test reports; DEMO_TIME_OF_DAY pins routing to 10:00 IST so results don't depend on the hour.
 *
 *   pnpm e2e                       # uses Playwright's Chromium (CI: `pnpm exec playwright install chromium`)
 *   PW_CHANNEL=chrome pnpm e2e     # use the locally installed Chrome instead
 */
export const PORTS = { api: 3210, web: 4210, driver: 4211 } as const;
export const API = `http://localhost:${PORTS.api}`;
const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: '.',
  fullyParallel: false, // tests share one API process and its stand state
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], channel } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel }, testMatch: /commuter|map|pwa/ },
  ],
  webServer: [
    {
      command: 'node ../apps/server/dist/index.js',
      url: `${API}/health`,
      // Vehicles on (map tests), random stand reports off (deterministic stand state),
      // and a 10:00 routing clock so the suite passes at any hour.
      env: {
        PORT: String(PORTS.api),
        NODE_ENV: 'test',
        SIMULATE_VEHICLES: 'true',
        SIMULATE_REPORTS: 'false',
        DEMO_TIME_OF_DAY: '10:00',
      },
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @transit/web exec vite preview --port ${PORTS.web} --strictPort`,
      url: `http://localhost:${PORTS.web}`,
      env: { API_URL: API },
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @transit/driver-portal exec vite preview --port ${PORTS.driver} --strictPort`,
      url: `http://localhost:${PORTS.driver}`,
      env: { API_URL: API },
      reuseExistingServer: false,
    },
  ],
});
