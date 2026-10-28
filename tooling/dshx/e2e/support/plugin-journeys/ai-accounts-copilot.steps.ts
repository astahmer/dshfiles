import { expect, type Page } from '@playwright/test'
import { globalPanelLink } from '../plugin-view-names.js'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

When('a GitHub Copilot account is added', async ({ page }: { page: Page }) => {
  await globalPanelLink(page, 'AI Accounts: Accounts').click()
  await expect(page.getByRole('complementary', { name: 'Provider accounts' })).toBeVisible()
  await page.getByRole('button', { name: 'Add account', exact: true }).first().click()
  await page.getByRole('dialog', { name: 'Add account', exact: true }).getByRole('button', { name: 'GitHub Copilot account', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Connect GitHub Copilot', exact: true })).toBeVisible()
})

Then('it offers GitHub device-code sign-in', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-github-copilot-sign-in', async () => {
    const dialog = page.getByRole('dialog', { name: 'Connect GitHub Copilot', exact: true })
    await expect(dialog.getByRole('button', { name: 'Sign in with GitHub', exact: true })).toBeVisible()
    await expect(dialog.getByText('Added only after verification.', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Edit account name', exact: true })).toBeVisible()
    // Choosing a provider must not initiate live OAuth; this journey never approves a real GitHub login.
    await expect(dialog.getByRole('button', { name: 'Cancel sign-in', exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('link', { name: /Open GitHub/ })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    const card = page
      .getByRole('complementary', { name: 'Provider accounts' })
      .getByRole('listitem')
      .filter({ has: page.getByText('GitHub Copilot 1', { exact: true }) })
    await expect(card).toHaveCount(0)
    await expect(
      page
        .getByRole('complementary', { name: 'Provider accounts' })
        .getByRole('listitem')
        .filter({ has: page.getByRole('button', { name: / earlier in account order$/ }) }),
    ).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})
