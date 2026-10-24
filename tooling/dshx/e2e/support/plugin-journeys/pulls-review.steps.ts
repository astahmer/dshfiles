import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { threadWorkspacePathFor } from './jj-integration.steps.js'

const THREAD_COMPOSER = 'Message or run a task, / commands, @ files or sessions'
const THREAD_CHANGE = 'batch-review.md'

const panelButton = (page: Page) =>
  page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'pulls.review', exact: true })

When('the pulls.review panel is opened from the sidebar', async ({ page }: { page: Page }) => {
  await panelButton(page).click()
  await expect(page.getByRole('heading', { name: 'pulls.review', exact: true })).toBeVisible()
})

Then('the pulls.review panel reads the thread workspace against {string}', async ({ page }: { page: Page }, base: string) => {
  await recordAssertion(page, 'pulls-review-reads-thread-workspace', async () => {
    await expect(page.getByText(`${base}..@`, { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/^\d+ files?$/).first()).toBeVisible({ timeout: 30_000 })
  })
})

/** Cucumber reads a bare `/` as an alternation, so the command name escapes it. */
When('the \\/pulls command runs in the current thread', async ({ page }: { page: Page }) => {
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER, exact: true })
  await composer.fill('/pulls')
  await composer.press('Enter')
})

Then('the thread shows the pulls.review scope report', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'pulls-review-command-report', async () => {
    await expect(page.getByText(/pulls\.review · main\.\.@/)).toBeVisible({ timeout: 30_000 })
  })
  await finishJourneyAssertions(page)
})

/**
 * The e2e profile boots no model provider, so a started thread's workspace is clean against main and the panel lists
 * no file to review. Write one working-copy change into that thread's checkout: the panel reads it like any agent edit.
 */
When('the thread workspace holds one changed file', async ({ page }: { page: Page }) => {
  const workspace = threadWorkspacePathFor(page)
  await writeFile(join(workspace, THREAD_CHANGE), '# Batch review fixture\n\nOne changed file to review.\n')
})

When('the scope files are selected for batch review', async ({ page }: { page: Page }) => {
  await page.getByRole('checkbox', { name: 'Select all files in this scope', exact: true }).check()
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible()
})

Then('marking the selection reviewed marks every file reviewed', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Mark selected reviewed', exact: true }).click()
  await recordAssertion(page, 'pulls-review-batch-marks-the-scope', async () => {
    await expect(page.getByText('1/1 reviewed', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('1 selected', { exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})
