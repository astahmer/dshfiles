import { expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { When, Then } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const THREAD_COMPOSER = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/
const FAILING_COMMAND = `[[call bash ${JSON.stringify({ command: 'printf "turn-summary-e2e"; exit 7', description: 'Run the failing summary fixture' })}]]`

When('the fake model runs a failing bash command in a fresh workspace', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-turn-summary-e2e-')
  const workspace = join(root, 'turn-summary-project')
  await mkdir(workspace)
  await registerWorkspaceFolder(page, workspace)
  await startThreadWithModel(page, { project: 'turn-summary-project', model: 'commandcode_work/gpt-6-luna' })
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(FAILING_COMMAND)
  await composer.press('Enter')
  await expect(page.getByText('Tool finished.', { exact: true })).toBeVisible({ timeout: 60_000 })
})

Then('the finished turn names the failed command and its outcome', async ({ page }: { page: Page }) => {
  await expect(page.getByRole('status').filter({ hasText: /^(Completed|Failed)$/ })).toHaveCount(1, { timeout: 60_000 })
  const summary = page.locator('[data-dshfiles-turn-summary]')
  await recordAssertion(page, 'turn-summary-shows-tool-count-and-failure', async () => {
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('Ran 1 command')
    await expect(summary.getByRole('button', { name: /1 failed/ })).toBeVisible()
  })
  await summary.getByRole('button', { name: /1 failed/ }).click()
  await recordAssertion(page, 'turn-summary-expands-failed-command-outcome', async () => {
    await expect(summary.getByText('Run the failing summary fixture', { exact: true })).toBeVisible()
    await expect(summary.getByText('exit 7', { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
