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

When('a Codex account draft is edited in manual save mode', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
  const manualSave = page.getByRole('radio', { name: /Manual/ })
  await manualSave.check()
  await expect(manualSave).toBeChecked()
  await page.getByRole('button', { name: 'Open AI Accounts', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Provider accounts' })).toBeVisible()
  await page.getByRole('button', { name: 'Add account', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Codex account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Codex 1', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('E2E Draft Account')
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes.' })).toBeVisible()
})

Then('the manual draft saves and persists when AI Accounts is reopened', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-manual-draft-persistence', async () => {
    const saveChanges = page.getByRole('button', { name: 'Save changes', exact: true })
    await saveChanges.click()
    await expect(saveChanges).toBeDisabled()
    await expect(page.getByRole('status').filter({ hasText: 'Saved. New sessions use the updated route settings.' })).toBeVisible()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
    await expect(page.getByRole('radio', { name: /Manual/ })).toBeChecked()
    await page.getByRole('button', { name: 'Open AI Accounts', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue('E2E Draft Account')
  })
  await finishJourneyAssertions(page)
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

Then('the usage history cadence and retention can be changed and restored', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-history-retention', async () => {
    const recordEvery = page.getByRole('combobox', { name: 'Record every' })
    const keepHistory = page.getByRole('combobox', { name: 'Keep history for' })
    await expect(recordEvery).toHaveText('5 min')
    await recordEvery.click()
    await page.getByRole('option', { name: '10 min', exact: true }).click()
    await expect(recordEvery).toHaveText('10 min')
    await expect(keepHistory).toHaveText('90 days')
    await keepHistory.click()
    await page.getByRole('option', { name: '180 days', exact: true }).click()
    await expect(keepHistory).toHaveText('180 days')
    await recordEvery.click()
    await page.getByRole('option', { name: '5 min', exact: true }).click()
    await expect(recordEvery).toHaveText('5 min')
    await keepHistory.click()
    await page.getByRole('option', { name: '90 days', exact: true }).click()
    await expect(keepHistory).toHaveText('90 days')
  })
  await finishJourneyAssertions(page)
})

Then('the exhausted-limit retry default is off and the inline choice is on', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-quota-retry-settings', async () => {
    const exhausted = page.getByRole('group', { name: /Usage exhausted/ })
    const failover = exhausted.getByRole('switch', { name: 'Fail over to the next account' })
    await failover.click()
    await expect(page.getByRole('heading', { name: 'Quota retry', exact: true })).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Automatically retry after reset by default' })).not.toBeChecked()
    await expect(page.getByRole('switch', { name: 'Show the per-turn choice' })).toBeChecked()
    await failover.click()
    await expect(page.getByRole('heading', { name: 'Quota retry', exact: true })).toHaveCount(0)
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

When('two Codex accounts are added with Priority distribution', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'AI Accounts', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Provider accounts' })).toBeVisible()
  for (const accountName of ['Codex 1', 'Codex 2']) {
    await page.getByRole('button', { name: 'Add account', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Codex account', exact: true }).click()
    await expect(page.getByRole('heading', { name: accountName, exact: true })).toBeVisible()
  }
  const distribution = page.getByRole('combobox', { name: 'Request distribution' })
  await distribution.click()
  await page.getByRole('option', { name: /Priority/ }).click()
  await expect(distribution).toHaveText('Priority')
})

Then('the account order controls Priority routing', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-priority-order', async () => {
    const moveCodexEarlier = page.getByRole('button', { name: 'Move Codex 2 earlier in account order', exact: true })
    await expect(moveCodexEarlier).toBeEnabled()
    await moveCodexEarlier.click()
    await expect(moveCodexEarlier).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Move Codex 2 later in account order', exact: true })).toBeEnabled()
  })
  await finishJourneyAssertions(page)
})
