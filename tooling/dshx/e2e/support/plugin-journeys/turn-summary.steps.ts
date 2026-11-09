import { expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { When, Then } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const THREAD_COMPOSER = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/
const WRITE_FILE = `[[call write ${JSON.stringify({ file_path: 'notes/walkthrough.md', content: 'one two' })}]]`
const FAILING_COMMAND = `[[call bash ${JSON.stringify({ command: 'printf "turn-summary-e2e"; exit 7', description: 'Run the failing summary fixture' })}]]`

const runInFreshWorkspace = async (page: Page, message: string): Promise<void> => {
  const root = await createScratchDirectory('dshx-turn-summary-e2e-')
  const workspace = join(root, 'turn-summary-project')
  await mkdir(workspace)
  await registerWorkspaceFolder(page, workspace)
  await startThreadWithModel(page, { project: 'turn-summary-project', model: 'commandcode_work/gpt-6-luna' })
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(message)
  await composer.press('Enter')
  await expect(page.getByText('Tool finished.', { exact: true })).toBeVisible({ timeout: 60_000 })
}

When('the fake model runs a failing bash command in a fresh workspace', async ({ page }: { page: Page }) => {
  await runInFreshWorkspace(page, FAILING_COMMAND)
})

When('the fake model writes a file in a fresh workspace', async ({ page }: { page: Page }) => {
  await runInFreshWorkspace(page, WRITE_FILE)
})

Then('the finished turn opens a walkthrough naming the written file', async ({ page }: { page: Page }) => {
  const toggle = page.getByRole('button', { name: 'Walkthrough', exact: true })
  await recordAssertion(page, 'turn-summary-walkthrough-names-written-file', async () => {
    await expect(toggle).toBeVisible({ timeout: 60_000 })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await page.mouse.move(4, 4)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('[data-dshfiles-turn-walkthrough]')).toContainText('walkthrough.md')
  })
  await recordAssertion(page, 'turn-summary-walkthrough-file-opens', async () => {
    const file = page.locator('[data-dshfiles-turn-walkthrough]').getByRole('button', { name: 'walkthrough.md' })
    await expect(file).toBeVisible()
    await file.click()
  })
  await finishJourneyAssertions(page)
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
