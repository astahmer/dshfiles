import { expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { When, Then } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const THREAD_COMPOSER = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or (?:threads|sessions)$/
// Two folders: for one file the chips already say everything, so no walkthrough is offered.
const WRITE_FILES = [
  `[[call write ${JSON.stringify({ file_path: 'notes/walkthrough.md', content: 'one two' })}]]`,
  `[[call write ${JSON.stringify({ file_path: 'src/second.ts', content: 'export const second = 2' })}]]`,
].join(' ')
const FAILING_COMMAND = `[[call bash ${JSON.stringify({ command: 'printf "turn-summary-e2e"; exit 7', description: 'Run the failing summary fixture' })}]]`
const BUILD_COMMAND = `[[call bash ${JSON.stringify({ command: 'for i in $(seq 1 12); do echo output line number $i of the build; done', description: 'Build the project' })}]]`

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

When('the fake model runs one build command in a fresh workspace', async ({ page }: { page: Page }) => {
  await runInFreshWorkspace(page, BUILD_COMMAND)
})

Then("choosing the build command under the finished turn opens the turn and shows the command's output", async ({ page }: { page: Page }) => {
  await expect(page.getByRole('status').filter({ hasText: /^(Worked|Completed|Failed)$/ })).toHaveCount(1, { timeout: 60_000 })
  const summary = page.locator('[data-dshfiles-turn-summary]')
  const output = page.getByText('output line number 1 of the build').first()
  await recordAssertion(page, 'turn-summary-command-output-folded-away', async () => {
    // The settled turn folds its one call behind "Worked for": the output is not on screen.
    await expect(page.locator('button[data-turn-process]')).toHaveAttribute('aria-expanded', 'false')
    await expect(output).toBeHidden()
  })
  await summary.getByRole('button', { name: /^Ran 1 command$/ }).click()
  await summary.getByRole('button', { name: 'Show the output of Build the project', exact: true }).click()
  await recordAssertion(page, 'turn-summary-command-opens-its-output', async () => {
    await expect(page.locator('button[data-turn-process]')).toHaveAttribute('aria-expanded', 'true')
    await expect(output).toBeVisible({ timeout: 10_000 })
    await expect(output).toBeInViewport()
  })
  await finishJourneyAssertions(page)
})

When('the fake model writes files in two folders in a fresh workspace', async ({ page }: { page: Page }) => {
  await runInFreshWorkspace(page, WRITE_FILES)
})

Then('the finished turn opens a walkthrough naming the written files by folder', async ({ page }: { page: Page }) => {
  const toggle = page.getByRole('button', { name: 'Walkthrough', exact: true })
  await recordAssertion(page, 'turn-summary-walkthrough-names-written-file', async () => {
    await expect(toggle).toBeVisible({ timeout: 60_000 })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await page.mouse.move(4, 4)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('[data-dshfiles-turn-walkthrough]')).toContainText('walkthrough.md')
    await expect(page.locator('[data-dshfiles-turn-walkthrough]')).toContainText('second.ts')
    // The folder header counts its files; the walkthrough does not say "Edited 1 file" again under it.
    await expect(page.locator('[data-dshfiles-turn-walkthrough]')).not.toContainText('Edited')
  })
  await recordAssertion(page, 'turn-summary-walkthrough-file-opens', async () => {
    const file = page.locator('[data-dshfiles-turn-walkthrough]').getByRole('button', { name: 'walkthrough.md' })
    await expect(file).toBeVisible()
    await file.click()
  })
  await finishJourneyAssertions(page)
})

Then('the finished turn names the failed command and its outcome', async ({ page }: { page: Page }) => {
  await expect(page.getByRole('status').filter({ hasText: /^(Worked|Completed|Failed)$/ })).toHaveCount(1, { timeout: 60_000 })
  const summary = page.locator('[data-dshfiles-turn-summary]')
  await recordAssertion(page, 'turn-summary-shows-tool-count-and-failure', async () => {
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('Ran 1 command')
    await expect(summary.getByRole('button', { name: /1 command failed/ })).toBeVisible()
  })
  await summary.getByRole('button', { name: /1 command failed/ }).click()
  await recordAssertion(page, 'turn-summary-expands-failed-command-outcome', async () => {
    await expect(summary.getByText('Run the failing summary fixture', { exact: true })).toBeVisible()
    await expect(summary.getByText('exit 7', { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
