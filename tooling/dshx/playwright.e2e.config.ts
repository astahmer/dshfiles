import { defineConfig } from '@playwright/test'
import { defineBddProject } from 'playwright-bdd'
import { E2E_VIEWPORT } from './e2e/support/evidence.js'

/**
 * Behavior E2E for the DSH Web UI.
 *
 * defineBddProject() resolves the feature and step globs and generates one spec
 * per feature, so the feature files stay the record of what a user can do while
 * the selectors live only in the step definitions.
 *
 * These scenarios own a real DSH profile and a real browser: the defects this
 * suite exists for are cross-package client contracts, and a stub would
 * reproduce the assumption under test rather than the system. One worker by
 * default, because each scenario boots its own Host; `DSHX_E2E_WORKERS` raises
 * it for a measured run.
 *
 * Every wait is bounded, because an unbounded one is the suite's worst cost: with no `actionTimeout` a locator that
 * never appears waits out the whole test timeout, and one broad run measured four owners burning 1302s of 2594s on 15
 * such hangs. A step that needs longer passes its own `timeout`, and a scenario that needs more than
 * `DSHX_E2E_TEST_TIMEOUT_MS` calls `test.slow()` or `test.setTimeout()`.
 */
const testTimeoutMs = Number(process.env.DSHX_E2E_TEST_TIMEOUT_MS ?? 150_000)
const workers = Number(process.env.DSHX_E2E_WORKERS ?? 1)

export default defineConfig({
  ...defineBddProject({
    name: 'web-e2e',
    features: 'e2e/features/*.feature',
    steps: ['e2e/support/steps.ts', 'e2e/support/plugin-journeys/*.steps.ts'],
  }),
  timeout: testTimeoutMs,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['./e2e/support/evidence-reporter.ts'], ['./e2e/support/summary-reporter.ts']]
    : [['list'], ['./e2e/support/evidence-reporter.ts'], ['./e2e/support/summary-reporter.ts']],
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'only-on-failure',
    viewport: E2E_VIEWPORT,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
