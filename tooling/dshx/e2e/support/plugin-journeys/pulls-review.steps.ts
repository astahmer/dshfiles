import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const THREAD_COMPOSER = 'Message or run a task, / commands, @ files or sessions'

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
