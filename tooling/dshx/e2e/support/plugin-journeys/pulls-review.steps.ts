import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

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
  await finishJourneyAssertions(page)
})
