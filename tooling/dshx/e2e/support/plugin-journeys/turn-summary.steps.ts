import { expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { When, Then } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const THREAD_COMPOSER = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/
const WRITE_FILE = `[[call write ${JSON.stringify({ file_path: 'notes/walkthrough.md', content: 'one two' })}]]`
const PASSING_COMMAND = `[[call bash ${JSON.stringify({ command: 'printf ok', description: 'Run the passing summary fixture' })}]]`
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

When('the fake model writes a file and runs a command in a fresh workspace', async ({ page }: { page: Page }) => {
  await runInFreshWorkspace(page, `${WRITE_FILE} ${PASSING_COMMAND}`)
})

Then('the footer names the command and the walkthrough card alone names the edited file', async ({ page }: { page: Page }) => {
  const line = page.locator('[data-dshfiles-turn-summary-line]')
  const card = page.locator('[data-dshfiles-turn-walkthrough]')
  await recordAssertion(page, 'turn-summary-footer-leaves-edits-to-walkthrough', async () => {
    await expect(card).toBeVisible({ timeout: 60_000 })
    await expect(line).toContainText('Ran 1 command')
    await expect(line).not.toContainText(/edited/i)
  })
  await recordAssertion(page, 'turn-summary-walkthrough-names-edit-once', async () => {
    await expect(card).toContainText('Changed 1 file')
    await expect(card).not.toContainText('Edited 1 file')
    await expect(card.getByRole('button', { name: 'Review in Changes' })).toBeVisible({ timeout: 60_000 })
  })
})

Then('the walkthrough card opens the edited file', async ({ page }: { page: Page }) => {
  await page.locator('[data-dshfiles-turn-walkthrough]').getByRole('button', { name: 'walkthrough.md', exact: true }).click()
  await recordAssertion(page, 'turn-summary-walkthrough-opens-edited-file', async () => {
    await expect(page.getByRole('tab', { name: /walkthrough\.md/ })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the finished turn shows a walkthrough card naming the written file', async ({ page }: { page: Page }) => {
  const card = page.locator('[data-dshfiles-turn-walkthrough]')
  await recordAssertion(page, 'turn-summary-walkthrough-names-written-file', async () => {
    await expect(card).toBeVisible({ timeout: 60_000 })
    await expect(card).toContainText('Changed 1 file')
    await expect(card).toContainText('walkthrough.md')
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
