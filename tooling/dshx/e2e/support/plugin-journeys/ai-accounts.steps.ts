import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

When('a provider request fails because its credential is missing', async ({ page }: { page: Page }) => {
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await composer.fill('Verify inline recovery for missing provider credentials.')
  await page.getByRole('button', { name: 'Send message', exact: true }).click({ timeout: 10_000 })
  await expect(page.getByText('This turn failed', { exact: false })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Add or fix credentials', exact: true })).toBeVisible()
})

Then('the inline credential action opens AI Accounts', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-credential-recovery-action', async () => {
    await page.getByRole('button', { name: 'Add or fix credentials', exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'Provider accounts' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add account', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the AI Accounts settings section is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Failure recovery' })).toBeVisible()
})

Then('the usage windows per account can be configured and restored', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-usage-window-layout', async () => {
    const layout = page.getByRole('combobox', { name: 'Windows per account' })
    await expect(layout).toHaveText('Most relevant window')
    await layout.click()
    await page.getByRole('option', { name: 'All windows vertically', exact: true }).click()
    await expect(layout).toHaveText('All windows vertically')
    await layout.click()
    await page.getByRole('option', { name: 'Most relevant window', exact: true }).click()
    await expect(layout).toHaveText('Most relevant window')
  })
  await finishJourneyAssertions(page)
})

Then('the rate-limit recovery failover can be changed and restored', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-rate-limit-failover-toggle', async () => {
    const rateLimit = page.getByRole('group', { name: /Rate limited/ })
    const failover = rateLimit.getByRole('switch', { name: 'Fail over to the next account' })
    await expect(rateLimit.getByText('The provider answered 429.')).toBeVisible()
    await expect(failover).toBeChecked()
    await expect(failover).toBeEnabled()
    await failover.click()
    await expect(failover).not.toBeChecked()
    await failover.click()
    await expect(failover).toBeChecked()
  })
  await finishJourneyAssertions(page)
})
