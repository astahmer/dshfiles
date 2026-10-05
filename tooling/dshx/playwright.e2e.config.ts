import { defineConfig } from '@playwright/test'
import { defineBddProject } from 'playwright-bdd'

/**
 * Behavior E2E for the DSH Web UI.
 *
 * defineBddProject() resolves the feature and step globs and generates one spec
 * per feature, so the feature files stay the record of what a user can do while
 * the selectors live only in the step definitions.
 *
 * These scenarios own a real DSH profile and a real browser: the defects this
 * suite exists for are cross-package client contracts, and a stub would
 * reproduce the assumption under test rather than the system. One worker, because
 * each scenario boots its own Host and boots do not parallelize cheaply.
 */
export default defineConfig({
  ...defineBddProject({
    features: 'e2e/features/*.feature',
    steps: 'e2e/support/steps.ts',
  }),
  timeout: 300_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
