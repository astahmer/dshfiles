import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const communicationPanelButton = (page: Page) => page.getByRole('button', { name: 'Agent communication', exact: true })

When('the Agent communication panel is opened', async ({ page }: { page: Page }) => {
  await expect(communicationPanelButton(page)).toBeVisible()
  await communicationPanelButton(page).click()
  await expect(page.getByRole('heading', { name: 'Agent communication', exact: true })).toBeVisible()
})

Then('diagnostics show the connected Host and truthful empty history', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'communication-diagnostics-load-from-host', async () => {
    await expect(page.getByText('Host connected', { exact: true })).toBeVisible()
    await expect(page.getByText(/Report generated/)).toBeVisible()
    await expect(page.getByText(/No tool activity has been recorded yet\./)).toBeVisible()
    await expect(page.getByText('No activity events recorded yet.', { exact: true })).toBeVisible()
  })

  await page.getByRole('tab', { name: 'Messages', exact: true }).click()
  await recordAssertion(page, 'communication-message-list-empty-state', () => expect(page.getByText('No recent messages.', { exact: true })).toBeVisible())

  await page.getByRole('tab', { name: 'Subscriptions', exact: true }).click()
  await recordAssertion(page, 'communication-subscription-list-empty-state', async () => {
    await expect(page.getByText('No subscriptions.', { exact: true })).toBeVisible()
    await expect(page.getByText(/^session-[0-9a-f-]{36}$/)).toBeVisible()
    await expect(page.getByText(/^Workspace topic: workspace\/[a-f0-9]{24}$/)).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('subscription controls show no configured delivery policy', async ({ page }: { page: Page }) => {
  await page.getByRole('tab', { name: 'Subscriptions', exact: true }).click()
  await recordAssertion(page, 'communication-empty-delivery-policy-state', async () => {
    await expect(page.getByText('No subscriptions.', { exact: true })).toBeVisible()
    await expect(page.getByText('No communication topics.', { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the inbox reports no recent messages', async ({ page }: { page: Page }) => {
  await page.getByRole('tab', { name: 'Messages', exact: true }).click()
  await recordAssertion(page, 'communication-empty-inbox-state', () => expect(page.getByText('No recent messages.', { exact: true })).toBeVisible())
  await finishJourneyAssertions(page)
})
