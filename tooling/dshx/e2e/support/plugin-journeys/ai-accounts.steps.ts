import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

When('the AI Accounts settings section is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Failure recovery' })).toBeVisible()
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
