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
  await expect(page.getByRole('textbox', { name: 'Filter changed files', exact: true })).toBeVisible({ timeout: 30_000 })
})

Then('the pulls.review panel reads the thread workspace against {string}', async ({ page }: { page: Page }, base: string) => {
  await recordAssertion(page, 'pulls-review-reads-thread-workspace', async () => {
    await expect(page.getByText(`${base}..@`, { exact: false }).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/· \d+ files? ·/).first()).toBeVisible({ timeout: 30_000 })
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
 * The e2e profile boots no model provider, so a started thread's workspace is clean against main and the review lists
 * no file. Write one working-copy change into that thread's checkout: the surface reads it like any agent edit.
 */
When('the thread workspace holds one changed file', async ({ page }: { page: Page }) => {
  const workspace = threadWorkspacePathFor(page)
  await writeFile(join(workspace, THREAD_CHANGE), '# Review fixture\n\nOne changed file to review.\n')
})

When('the changed file is marked viewed', async ({ page }: { page: Page }) => {
  await page.getByRole('checkbox', { name: `Mark ${THREAD_CHANGE} as viewed`, exact: true }).check()
})

Then('the review reads every changed file as viewed', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'pulls-review-progress-marks-the-file', async () => {
    await expect(page.getByText('1/1 viewed', { exact: true })).toBeVisible({ timeout: 15_000 })
  })
  await finishJourneyAssertions(page)
})

When('every changed file is marked viewed from the review menu', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Review actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Mark all viewed', exact: true }).click()
})

Then('the review reports all files viewed', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'pulls-review-progress-marks-all', async () => {
    await expect(page.getByText('1/1 viewed', { exact: true })).toBeVisible({ timeout: 15_000 })
  })
  await finishJourneyAssertions(page)
})
