import { writeFile } from 'node:fs/promises'
import { globalPanelLink } from '../plugin-view-names.js'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { threadWorkspacePathFor } from './jj-integration.steps.js'

const THREAD_COMPOSER = 'Message or run a task, / commands, @ files or sessions'
const THREAD_CHANGES = [
  { path: 'README.md', content: '# Review fixture\n\nDocumentation change in the Docs scope.\n' },
  { path: 'src/app.ts', content: 'export const reviewFixture = true\n' },
]

const panelButton = (page: Page) => globalPanelLink(page, 'pulls.review: Reviews')

When('the pulls.review panel is opened from the sidebar', async ({ page }: { page: Page }) => {
  await panelButton(page).click()
  await expect(page.getByRole('heading', { name: 'pulls.review', exact: true })).toBeVisible()
})

Then('the pulls.review panel reads the thread workspace against {string}', async ({ page }: { page: Page }, base: string) => {
  await recordAssertion(page, 'pulls-review-reads-thread-workspace', async () => {
    const projectPicker = page.getByRole('button', { name: 'Choose project or workspace', exact: true })
    await expect(projectPicker).toBeVisible()
    await projectPicker.click()
    const pickerDialog = page.getByRole('dialog')
    await expect(pickerDialog).toBeVisible()
    await pickerDialog.getByRole('button', { name: 'Filter by scope', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Workspaces', exact: true }).click()
    const workspaceOption = pickerDialog.getByRole('option').first()
    await expect(workspaceOption).toBeVisible()
    await workspaceOption.click()
    await expect(pickerDialog).toBeHidden()
    await expect(projectPicker).toContainText(/thread-/)
    const baseSelector = page.getByRole('textbox', { name: 'Base branch or bookmark', exact: true })
    await expect(baseSelector).toBeVisible()
    await baseSelector.fill(base)
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
 * The e2e profile has no model provider, so the new thread starts with an empty diff. Add files in two rule-based scopes
 * to prove the panel renders the whole review instead of making the user switch scopes.
 */
When('the thread workspace holds changed files in different scopes', async ({ page }: { page: Page }) => {
  const workspace = threadWorkspacePathFor(page)
  await Promise.all(THREAD_CHANGES.map(file => writeFile(join(workspace, file.path), file.content)))
})

Then("every scope's file diffs appear in the same scrollable review", async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'pulls-review-renders-files-across-scopes', async () => {
    const review = page.getByTestId('pulls-review-diffs')
    await expect(review).toBeVisible({ timeout: 30_000 })
    await expect(review.locator('[data-diff-path="README.md"]')).toBeVisible()
    await expect(review.locator('[data-diff-path="src/app.ts"]')).toBeVisible()
    await expect(review.getByText('Docs', { exact: true })).toBeVisible()
    await expect(review.getByText('Code', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Next scope', exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('all changed files are selected for batch review', async ({ page }: { page: Page }) => {
  await page.getByRole('checkbox', { name: 'Select all files in this review', exact: true }).check()
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
})

Then('marking selected files reviewed updates progress across scopes', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Mark selected reviewed', exact: true }).click()
  await recordAssertion(page, 'pulls-review-batch-marks-cross-scope-selection', async () => {
    await expect(page.getByText('2/2 reviewed', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('2 selected', { exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})
