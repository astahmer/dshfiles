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
    await expect(results.getByRole('radio', { name: /^all \d+$/ })).toBeVisible()
    await expect(results.getByRole('radio', { name: /^failed 0$/ })).toBeVisible()
    await expect(results.getByText(/vitest-report\.test\.ts/)).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

const CRASH_DIRECTIVE = `[[call bash ${JSON.stringify({
  command: `node -e "const total = () => { throw new TypeError('price is not a number') }; total()"`,
  description: 'Run a crashing Node script',
})}]]`

When('the fake model runs a crashing Node script in the selected workspace', async ({ page }: { page: Page }) => {
  await registerWorkspaceFolder(page, TEST_RUNS_DIRECTORY)
  await startThreadWithModel(page, { project: 'test-runs', model: 'commandcode_work/gpt-6-luna' })
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(CRASH_DIRECTIVE)
  await composer.press('Enter')
  await expect(page.getByText('Tool finished.', { exact: true })).toBeVisible({ timeout: 60_000 })
})

Then('the finished tool call shows a stack trace card', async ({ page }: { page: Page }) => {
  await expect(page.getByRole('status').filter({ hasText: /^(Completed|Failed)$/ })).toHaveCount(1, { timeout: 60_000 })
  const card = page.locator('[data-chat-call-id]').first()
  const commandGroup = page.getByText('Ran commands', { exact: true }).last()
  const traceToggle = card.getByRole('button', { name: /^Stack trace\b/ })
  if (!(await commandGroup.isVisible())) {
    await page
      .getByText(/^(Completed|Failed) in /)
      .last()
      .click()
    await expect(commandGroup).toBeVisible({ timeout: 20_000 })
  }
  if (!(await traceToggle.isVisible())) await commandGroup.click()
  await expect(traceToggle).toBeVisible({ timeout: 20_000 })
  if ((await card.locator('[data-stack-trace]').count()) === 0) await traceToggle.click()
  await recordAssertion(page, 'test-runs-card-shows-stack-trace', async () => {
    const trace = card.locator('[data-stack-trace]')
    await expect(trace).toBeVisible()
    await expect(card.getByText('TypeError: price is not a number').first()).toBeVisible()
    await expect(trace.getByRole('heading')).toHaveCount(0)
    await expect(trace.getByRole('list', { name: 'Stack frames' })).toContainText('total')
  })
  await finishJourneyAssertions(page)
})
