import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration for dicom-model.
 *
 * Key concepts:
 *
 * "webServer" tells Playwright to start your Angular dev server
 * before running tests, and shut it down after. This means you
 * don't need to manually run "npx nx serve" — Playwright handles
 * it. The "reuseExistingServer" flag skips the startup if you
 * already have the dev server running locally (faster iteration).
 *
 * "projects" defines which browsers to test in. We're starting
 * with Chromium only because WebGPU support varies across
 * browsers. Firefox and WebKit have limited or no WebGPU
 * support, so testing them would fail for reasons unrelated
 * to our code.
 *
 * "use.baseURL" sets the default URL so tests can write
 * page.goto('/') instead of page.goto('http://localhost:4200/').
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Fail the CI build if someone left test.only in the code.
  // test.only runs a single test and skips everything else —
  // useful while debugging, but disastrous if committed.
  forbidOnly: !!process.env.CI,
  // Retry failed tests on CI to handle flakiness (network
  // timing, GPU initialization delays). No retries locally
  // so you see failures immediately.
  retries: process.env.CI ? 2 : 0,
  // Single worker on CI to avoid resource contention.
  // Locally, Playwright can run tests in parallel.
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:4200',
    // Capture a trace (timeline of actions, screenshots, DOM
    // snapshots) when a test fails and retries. Invaluable
    // for debugging CI failures you can't reproduce locally.
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Run headed locally for WebGPU support. On CI,
        // run headless — GPU-dependent tests skip anyway.
        headless: !!process.env.CI,
        launchOptions: {
          // Only request the real GPU when running headed.
          // In headless CI mode, this flag causes Chrome to
          // crash because there's no display server.
          args: process.env.CI ? [] : ['--use-angle=default'],
        },
      },
    },

    // WebGPU is Chromium-only for now. Add Firefox and
    // WebKit here when they ship WebGPU support.
  ],

  // Start the Angular dev server before tests run.
  // Playwright waits for the URL to respond before
  // starting any tests.
  webServer: {
    command: 'npx nx serve dicom-model',
    url: 'http://localhost:4200',
    // If you already have the dev server running locally,
    // don't start a second one. On CI, always start fresh.
    reuseExistingServer: !process.env.CI,
    // Angular dev server can take a while to compile on
    // first start. 120 seconds is generous but safe.
    timeout: 120000,
  },
});