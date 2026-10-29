import { expect, type Page } from '@playwright/test'
import { join } from 'node:path'
import { When, Then } from '../bdd.js'
import { DSHFILES_ROOT } from '../../../packages/dshx/src/project/local-bundles.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const THREAD_COMPOSER = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/
const TEST_RUNS_DIRECTORY = join(DSHFILES_ROOT, 'plugins/@dshfiles/test-runs')
const RUN_TESTS_DIRECTIVE = `[[call bash ${JSON.stringify({ command: 'cd . && pnpm exec vitest run src/vitest-report.test.ts', description: 'Run the test-runs Vitest suite' })}]]`

When('the fake model runs the test-runs Vitest suite in the selected workspace', async ({ page }: { page: Page }) => {
  await registerWorkspaceFolder(page, TEST_RUNS_DIRECTORY)
  await startThreadWithModel(page, { project: 'test-runs', model: 'commandcode_work/gpt-6-luna' })
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(RUN_TESTS_DIRECTIVE)
  await composer.press('Enter')
  await expect(page.getByText('Tool finished.', { exact: true })).toBeVisible({ timeout: 60_000 })
})

Then('the finished tool call shows a Vitest results card', async ({ page }: { page: Page }) => {
  await expect(page.getByRole('status').filter({ hasText: /^(Completed|Failed)$/ })).toHaveCount(1, { timeout: 60_000 })
  const card = page.locator('[data-chat-call-id]').first()
  const commandGroup = page.getByText('Ran commands', { exact: true }).last()
  const testCardToggle = card.getByRole('button', { name: /^Ran tests\b/ })
  if (!(await commandGroup.isVisible())) {
    await page
      .getByText(/^Completed in /)
      .last()
      .click()
    await expect(commandGroup).toBeVisible({ timeout: 20_000 })
  }
  if (!(await testCardToggle.isVisible())) await commandGroup.click()
  await expect(testCardToggle).toBeVisible({ timeout: 20_000 })
  await testCardToggle.click()
  await recordAssertion(page, 'test-runs-card-shows-vitest-results', async () => {
    const results = card.locator('[data-test-runs-card]')
    await expect(results).toBeVisible()
    await expect(results.getByRole('tab', { name: /^all \d+$/ })).toBeVisible()
    await expect(results.getByRole('tab', { name: /^failed 0$/ })).toBeVisible()
    await expect(results.getByText(/vitest-report\.test\.ts/)).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
