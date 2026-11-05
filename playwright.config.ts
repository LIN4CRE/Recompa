import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the Recompa smoke suite.
 *
 * The suite runs against a real dev server on 127.0.0.1 so cross-origin
 * isolation headers (COOP/COEP) from vite.config.ts are exercised exactly as in
 * production.
 *
 * Browser acquisition is separate from the test logic. CI uses Playwright's own
 * Chromium; in sandboxes where cdn.playwright.dev is unreachable, set
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to any Chromium binary (and optionally
 * PLAYWRIGHT_CHROMIUM_ARGS as a comma-separated flag list). See
 * docs/DEPLOYMENT.md §1.
 */
const customChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() || undefined;
/**
 * Point the suite at an already-running server instead of the dev server, e.g.
 * the production build:
 *
 *   npm run build && npm run preview &
 *   E2E_BASE_URL=http://127.0.0.1:4173 npm run test:e2e
 *
 * This exercises the hashed, minified bundles and the real COOP/COEP headers
 * that ship, rather than Vite's development transform.
 */
const externalBaseUrl = process.env.E2E_BASE_URL?.trim() || undefined;
const extraChromiumArgs = (process.env.PLAYWRIGHT_CHROMIUM_ARGS ?? '')
  .split(',')
  .map((flag) => flag.trim())
  .filter(Boolean);

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: externalBaseUrl ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    // Video needs Playwright's bundled ffmpeg, which is not present when a
    // system Chromium is supplied via PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
    // Traces and failure screenshots remain available in that mode.
    video: customChromium ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: [],
    launchOptions: {
      ...(customChromium ? { executablePath: customChromium } : {}),
      ...(extraChromiumArgs.length > 0 ? { args: extraChromiumArgs } : {}),
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // No webServer when the caller supplies a running server of their own.
  webServer: externalBaseUrl
    ? undefined
    : {
        command: 'npm run dev -- --port 5173 --strictPort',
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
