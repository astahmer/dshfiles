import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

When('a GitHub Copilot account is added', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'AI Accounts', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Provider accounts' })).toBeVisible()
  await page.getByRole('button', { name: 'Add account', exact: true }).click()
  await page.getByRole('menuitem', { name: 'GitHub Copilot account', exact: true }).click()
  await expect(page.getByText('GitHub Copilot 1', { exact: true })).toBeVisible()
})

Then('it offers GitHub device-code sign-in', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-github-copilot-sign-in', async () => {
    await expect(page.getByRole('button', { name: 'Sign in with GitHub', exact: true })).toBeVisible()
    await expect(page.getByText('GitHub device-code sign-in; OAuth is stored in DSH credentials', { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
