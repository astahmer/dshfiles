import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const communicationPanelButton = (page: Page) => page.getByRole('button', { name: 'Communication', exact: true })

When('the Agent communication panel is opened', async ({ page }: { page: Page }) => {
  await expect(communicationPanelButton(page)).toBeVisible()
  await communicationPanelButton(page).click()
  await expect(page.getByRole('heading', { name: 'Communication', exact: true })).toBeVisible()
})

Then('diagnostics show the connected Host and truthful activity history', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'communication-host-connection', async () => {
    await expect(page.getByText('Host connected', { exact: true })).toBeVisible()
    await expect(page.getByText(/Browsing never starts, resumes, or redirects an Agent/)).toBeVisible()
  })
  await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click()
  await recordAssertion(page, 'communication-empty-tool-history', async () => {
    await expect(page.getByText(/No Agent tool activity has been recorded yet/)).toBeVisible()
    await expect(page.getByText('No tool activity recorded yet.', { exact: true })).toBeVisible()
  })
  await page.getByRole('tab', { name: 'Messages', exact: true }).click()
  await recordAssertion(page, 'communication-empty-browser', async () => {
    await expect(page.getByText('No messages in this conversation.', { exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Search messages', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('a human post is browsable and remains passive', async ({ page }: { page: Page }) => {
  await page.getByRole('textbox', { name: 'Channel name', exact: true }).fill('e2e/passive-check')
  await page.getByRole('textbox', { name: 'Write a message…', exact: true }).fill('A stored message, not an Agent turn.')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()

  await recordAssertion(page, 'communication-human-message-stored', async () => {
    await expect(page.getByText('Message stored · 0 recipient(s)', { exact: true })).toBeVisible()
    await expect(page.getByText('A stored message, not an Agent turn.', { exact: true })).toBeVisible()
    await expect(page.getByText('Local browser user', { exact: true })).toBeVisible()
    await expect(page.getByText('Untrusted peer text', { exact: true })).toBeVisible()
    await expect(page.getByText(/Browsing never starts, resumes, or redirects an Agent/)).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('a direct message remains unread until its recipient reads it', async ({ page }: { page: Page }) => {
  await page.getByRole('combobox', { name: 'Message a thread…', exact: true }).click()
  await page.getByRole('option').first().click()
  await page.getByRole('textbox', { name: 'Write a message…', exact: true }).fill('A delayed message stays passive.')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()

  await recordAssertion(page, 'communication-offline-direct-message', async () => {
    await expect(page.getByText('Message stored · 1 recipient(s)', { exact: true })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Idle · completion unknown', exact: true }).first()).toBeVisible()
    await expect(page.getByText('A delayed message stays passive.', { exact: true })).toBeVisible()
    await expect(page.getByText('Local browser user', { exact: true })).toBeVisible()
  })
  await page.getByRole('button', { name: 'Message context', exact: true }).click()
  await recordAssertion(page, 'communication-browser-does-not-read-or-ack', async () => {
    await expect(page.getByText('Not read by Agent', { exact: true })).toBeVisible()
    await expect(page.getByText('Pending', { exact: true })).toBeVisible()
    await expect(page.getByText(/Browsing never starts, resumes, or redirects an Agent/)).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then("workspace diagnostics show the active Agent's workspace subscription", async ({ page }: { page: Page }) => {
  await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click()
  // The Agent joins its workspace channel asynchronously and the panel polls every 30s, so a loaded Host can show the
  // first snapshot without the subscription; Refresh reads it again.
  await expect(async () => {
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(page.getByText('Subscribed', { exact: true })).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 45_000 })
  await recordAssertion(page, 'communication-workspace-subscription-health', async () => {
    await expect(page.getByText('Idle · completion unknown', { exact: true })).toBeVisible()
    await expect(page.getByText('Subscribed', { exact: true })).toBeVisible()
    await expect(page.getByTitle(/^workspace\/[a-f0-9]{24}$/).first()).toBeVisible()
    await expect(page.getByText(/missing a workspace subscription/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Unsubscribe', exact: true })).toBeVisible()
    await expect(page.getByText('Completed', { exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})
