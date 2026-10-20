import { expect, type Page } from '@playwright/test'
import { After, Then, When } from '../bdd.js'
import { finishJourneyAssertions, openSettingsDialog, recordAssertion } from '../steps.js'
import { fakeCommandCodeFor, startFakeCommandCode, stopFakeCommandCode } from '../fake-command-code.js'

const providerAccounts = (page: Page) => page.getByRole('complementary', { name: 'Provider accounts' })

const addCommandCodeAccount = async (page: Page, input: { readonly name: string; readonly key: string }): Promise<void> => {
  await providerAccounts(page).getByRole('button', { name: 'Add account', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Command Code account', exact: true }).click()
  await expect(page.getByRole('heading', { name: input.name, exact: true })).toBeVisible()
  const baseUrl = page.getByRole('textbox', { name: 'API base URL', exact: true })
  await baseUrl.fill(fakeCommandCodeFor(page).baseUrl)
  await baseUrl.blur()
  await expect(page.getByRole('status').filter({ hasText: /^(Saved|Changes save automatically)$/ })).toBeVisible()
  await page.getByRole('button', { name: 'Set up key…', exact: true }).click()
  const keyDialog = page.getByRole('dialog', { name: `Configure ${input.name} key`, exact: true })
  await keyDialog.getByRole('textbox', { name: 'API key value', exact: true }).fill(input.key)
  await keyDialog.getByRole('button', { name: 'Store key', exact: true }).click()
  await expect(keyDialog).toBeHidden()
}

const openAccountsPanel = async (page: Page): Promise<void> => {
  if (await providerAccounts(page).isVisible()) return

  const globalPanel = page.getByRole('button', { name: 'AI Accounts', exact: true })
  if (await globalPanel.isVisible()) {
    await globalPanel.click()
  } else {
    await openSettingsDialog(page)
    await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
    await page.getByRole('button', { name: 'Open AI Accounts', exact: true }).click()
  }
  await expect(providerAccounts(page)).toBeVisible()
}

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
  await openSettingsDialog(page)
  await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Failure recovery' })).toBeVisible()
})

When('a Codex account draft is edited in manual save mode', async ({ page }: { page: Page }) => {
  await openSettingsDialog(page)
  await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
  const manualSave = page.getByRole('radio', { name: /Manual/ })
  // The radio follows the stored setting, so it flips after the Host round trip rather than on click.
  await manualSave.click()
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
    // The panel header and the account footer both announce the save.
    await expect(page.getByRole('status').filter({ hasText: 'Saved. New sessions use the updated route settings.' }).first()).toBeVisible()
    await openSettingsDialog(page)
    await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
    await expect(page.getByRole('radio', { name: /Manual/ })).toBeChecked()
    await page.getByRole('button', { name: 'Open AI Accounts', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue('E2E Draft Account')
  })
  await finishJourneyAssertions(page)
})

When('a Codex account is ready for removal', async ({ page }: { page: Page }) => {
  await openAccountsPanel(page)
  await providerAccounts(page).getByRole('button', { name: 'Add account', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Codex account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Codex 1', exact: true })).toBeVisible()
})

Then('account removal can be canceled and confirmed', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-account-removal', async () => {
    const removeButton = page.getByRole('button', { name: 'Remove profile', exact: true })
    await removeButton.click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Remove Codex 1?', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Codex 1', exact: true })).toBeVisible()
    await removeButton.click()
    await dialog.getByRole('button', { name: 'Remove profile', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Removed Codex 1. Credentials were left on disk.' })).toBeVisible()
    await expect(page.getByText('Your accounts, side by side.', { exact: true })).toBeVisible()
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

Then('the price refresh interval and explicit override can be changed and restored', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-pricing-cost-settings', async () => {
    const refreshInterval = page.getByRole('combobox', { name: 'Refresh prices every' })
    const overrides = page.getByRole('textbox', { name: 'Price overrides', exact: true })
    await expect(refreshInterval).toHaveText('24 h')
    await refreshInterval.click()
    await page.getByRole('option', { name: '2 days', exact: true }).click()
    await expect(refreshInterval).toHaveText('2 days')
    await overrides.fill('codex/*=free')
    await overrides.blur()
    await expect(overrides).toHaveValue('codex/* = free')
    await page.getByRole('button', { name: 'Open AI Accounts', exact: true }).click()
    await openSettingsDialog(page)
    await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
    await expect(refreshInterval).toHaveText('2 days')
    await expect(overrides).toHaveValue('codex/* = free')
    await refreshInterval.click()
    await page.getByRole('option', { name: '24 h', exact: true }).click()
    await expect(refreshInterval).toHaveText('24 h')
    await overrides.fill('')
    await overrides.blur()
    await expect(overrides).toHaveValue('')
  })
  await finishJourneyAssertions(page)
})

Then('the exhausted-limit retry default is off and the inline choice is on', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-quota-retry-settings', async () => {
    const exhausted = page.getByRole('group', { name: /Usage exhausted/ })
    const failover = exhausted.getByRole('switch', { name: 'Fail over to the next account' })
    await failover.click()
    await expect(page.getByRole('heading', { name: 'Quota retry', exact: true })).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Automatically resume after reset by default' })).not.toBeChecked()
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

Then('the AI Accounts list on the Models page can be hidden and restored', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-model-curation', async () => {
    const settings = page.getByRole('dialog')
    const accountList = page.getByRole('switch', { name: 'Accounts on the Models page' })
    await expect(accountList).toBeChecked()
    await accountList.click()
    await expect(accountList).not.toBeChecked()
    await settings.getByRole('button', { name: 'Models', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'AI Accounts', exact: true })).toHaveCount(0)
    await settings.getByRole('button', { name: 'AI Accounts', exact: true }).click()
    const restoredAccountList = page.getByRole('switch', { name: 'Accounts on the Models page' })
    await expect(restoredAccountList).not.toBeChecked()
    await restoredAccountList.click()
    await expect(restoredAccountList).toBeChecked()
    await settings.getByRole('button', { name: 'Models', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'AI Accounts', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('a Command Code account backed by a local fake provider is added', async ({ page }: { page: Page }) => {
  await startFakeCommandCode(page)
  await openAccountsPanel(page)
  await addCommandCodeAccount(page, { name: 'Command Code 1', key: 'e2e-fake-key-ALPHA1' })
})

When('a second Command Code account whose billing read fails is added', async ({ page }: { page: Page }) => {
  await addCommandCodeAccount(page, { name: 'Command Code 2', key: 'e2e-fake-key-BROKEN' })
})

Then('the account shows the session and weekly windows the provider reports', async ({ page }: { page: Page }) => {
  await providerAccounts(page)
    .getByRole('button', { name: /^Command Code 1 / })
    .click()
  await recordAssertion(page, 'ai-accounts-quota-windows-follow-the-provider', async () => {
    await expect(page.getByRole('progressbar', { name: 'Current session remaining', exact: true })).toBeVisible()
    await expect(page.getByText('75% left', { exact: true })).toBeVisible()
    await expect(page.getByText(/^Resets in (59|60)m$/)).toBeVisible()
    await expect(page.getByRole('progressbar', { name: 'Weekly limit remaining', exact: true })).toBeVisible()
    await expect(page.getByText('10% left', { exact: true })).toBeVisible()
    await expect(page.getByText(/^Resets in 2d \d+h$/)).toBeVisible()
  })
  await recordAssertion(page, 'ai-accounts-sidebar-foot-shows-the-tightest-window', () =>
    expect(page.getByRole('button', { name: /^Command Code 1: Weekly limit: 10% left, resets in 2d \d+h$/ })).toBeVisible(),
  )
})

Then('the failed account reports the provider error instead of a quota', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-failed-quota-read-is-shown-as-an-error', async () => {
    await expect(page.getByText('Command Code returned 503 for billing.', { exact: true })).toBeVisible()
    await expect(page.getByRole('progressbar', { name: 'Weekly limit remaining', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Command Code 2: Weekly limit/ })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

/** The picker lists the route radios directly on a fresh session, but shows the Model cell that opens them once one is picked. */
const selectAccountModel = async (page: Page, model: string): Promise<void> => {
  const cell = page.getByRole('menuitem', { name: /^Model / })
  const option = page.getByRole('menuitemradio', { name: model, exact: true })
  await expect(option.or(cell).first()).toBeVisible()
  if ((await option.count()) === 0) await cell.click()
  await option.click()
}

const stripMeter = (page: Page) => page.getByRole('group', { name: /^AI accounts usage/ }).getByRole('button', { name: /^Command Code 1: Weekly limit/ })

Then('the usage strip shows its short name, renamed from AI Accounts settings', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-strip-shows-initials-by-default', () => expect(stripMeter(page)).toContainText('CC'))
  await openSettingsDialog(page)
  await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
  await expect(page.getByRole('switch', { name: 'Short names in the strip', exact: true })).toBeChecked()
  const shortName = page.getByRole('textbox', { name: 'Short name for Command Code 1', exact: true })
  await shortName.fill('WRK')
  await shortName.press('Enter')
  await page.keyboard.press('Escape')
  await recordAssertion(page, 'ai-accounts-strip-uses-the-configured-short-name', () => expect(stripMeter(page)).toContainText('WRK'))
})

Then("the strip's context menu hides and shows short names", async ({ page }: { page: Page }) => {
  await stripMeter(page).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Hide short names', exact: true }).click()
  await recordAssertion(page, 'ai-accounts-strip-hides-short-names', () => expect(stripMeter(page)).not.toContainText('WRK'))
  await stripMeter(page).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Show short names', exact: true }).click()
  await recordAssertion(page, 'ai-accounts-strip-shows-short-names-again', () => expect(stripMeter(page)).toContainText('WRK'))
  await finishJourneyAssertions(page)
})

When('a second healthy Command Code account is added', async ({ page }: { page: Page }) => {
  await addCommandCodeAccount(page, { name: 'Command Code 2', key: 'e2e-fake-key-BRAVO2' })
})

const usagePopover = (page: Page) => page.getByRole('region', { name: 'AI account usage', exact: true })
const usageCardTop = async (page: Page, name: string): Promise<number> =>
  (
    await usagePopover(page)
      .getByLabel(new RegExp(`^${name}: drag to reorder`))
      .boundingBox()
  )?.y ?? Number.NaN

const expectUsageCards = async (page: Page, layout: 'stacked' | 'side by side'): Promise<void> =>
  expect
    .poll(async () => {
      const [first, second] = [await usageCardTop(page, 'Command Code 1'), await usageCardTop(page, 'Command Code 2')]
      return Math.abs(first - second) < 1 ? 'side by side' : 'stacked'
    })
    .toBe(layout)

Then('widening the usage popover from its grip lays the accounts out side by side', async ({ page }: { page: Page }) => {
  await stripMeter(page).click()
  await expectUsageCards(page, 'stacked')
  await recordAssertion(page, 'ai-accounts-quota-header-shows-provider-plan', async () => {
    const header = usagePopover(page).locator('article header').filter({ hasText: 'Command Code 1' })
    const plan = header.getByLabel('Subscription plan: individual-pro', { exact: true })
    await expect(plan).toBeVisible()
    await expect(plan).toHaveText('individual-pro')
    await expect(plan).toHaveAttribute('title', 'Subscription plan: individual-pro')
    const bounds = await plan.evaluate(element => {
      const header = element.closest('header')
      if (header === null) throw new Error('The plan badge is not in a quota card header')
      const headerBox = header.getBoundingClientRect()
      const planBox = element.getBoundingClientRect()
      return {
        planTop: planBox.top,
        planBottom: planBox.bottom,
        planWidth: planBox.width,
        headerTop: headerBox.top,
        headerBottom: headerBox.bottom,
        headerWidth: headerBox.width,
      }
    })
    expect(bounds.planTop).toBeGreaterThanOrEqual(bounds.headerTop)
    expect(bounds.planBottom).toBeLessThanOrEqual(bounds.headerBottom + 1)
    expect(bounds.planWidth).toBeLessThanOrEqual(bounds.headerWidth * 0.3 + 1)
  })
  const grip = await usagePopover(page).getByRole('separator', { name: 'Resize usage popover', exact: true }).boundingBox()
  if (grip === null) throw new Error('The usage popover grip is not laid out')
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + 420, grip.y - 40, { steps: 8 })
  await page.mouse.up()
  await recordAssertion(page, 'ai-accounts-wide-usage-popover-shows-a-grid', () => expectUsageCards(page, 'side by side'))
})

Then('the usage popover keeps its size until its grip is double-clicked', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Escape')
  await expect(usagePopover(page)).toBeHidden()
  await stripMeter(page).click()
  await recordAssertion(page, 'ai-accounts-usage-popover-keeps-its-size', () => expectUsageCards(page, 'side by side'))
  await usagePopover(page).getByRole('separator', { name: 'Resize usage popover', exact: true }).dblclick()
  await recordAssertion(page, 'ai-accounts-usage-popover-fits-again', () => expectUsageCards(page, 'stacked'))
  await finishJourneyAssertions(page)
})

When('a rate-limited and a healthy Command Code account share a local fake provider', async ({ page }: { page: Page }) => {
  await startFakeCommandCode(page)
  await openAccountsPanel(page)
  await addCommandCodeAccount(page, { name: 'Command Code 1', key: 'e2e-fake-key-LIMITED' })
  await addCommandCodeAccount(page, { name: 'Command Code 2', key: 'e2e-fake-key-BRAVO2' })
})

When("a new thread asks the first account's model a question", async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await page.getByRole('button', { name: /^Select model/ }).click()
  await selectAccountModel(page, 'commandcode_work/gpt-6-luna')
  await expect(page.getByRole('button', { name: /^Select model, current commandcode_work\/gpt-6-luna/ })).toBeVisible()
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await composer.fill('Which account answers?')
  await composer.press('Enter')
})

Then('the healthy account answers and the rate-limited one cools down', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-pool-fails-over-to-the-healthy-account', async () => {
    await expect(page.getByText('Answered by BRAVO2', { exact: true }).last()).toBeVisible({ timeout: 30_000 })
    const chatKeys = fakeCommandCodeFor(page)
      .requests.filter(request => request.kind === 'turn')
      .map(request => request.key)
    expect(chatKeys[0]).toBe('e2e-fake-key-LIMITED')
    expect(chatKeys.at(-1)).toBe('e2e-fake-key-BRAVO2')
    expect(new Set(chatKeys)).toEqual(new Set(['e2e-fake-key-LIMITED', 'e2e-fake-key-BRAVO2']))
  })
  // The account rail reads runtime health with its usage poll; reopening the app reads it now instead of a minute later.
  await page.reload()
  await page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'AI Accounts', exact: true }).click()
  await recordAssertion(page, 'ai-accounts-rate-limited-account-is-cooling-down', async () => {
    await expect(providerAccounts(page).getByRole('button', { name: 'Command Code 1 Rate limited', exact: true })).toBeVisible()
    await expect(providerAccounts(page).getByRole('button', { name: 'Command Code 2 Authenticated', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('request distribution is set to Priority', async ({ page }: { page: Page }) => {
  const distribution = page.getByRole('combobox', { name: 'Request distribution' })
  await distribution.click()
  await page.getByRole('option', { name: /Priority/ }).click()
  await expect(distribution).toHaveText('Priority')
})

When("a new thread asks the second account's model a question", async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await page.getByRole('button', { name: /^Select model/ }).click()
  await selectAccountModel(page, 'commandcode_work_2/gpt-6-luna')
  await expect(page.getByRole('button', { name: /^Select model, current commandcode_work_2\/gpt-6-luna/ })).toBeVisible()
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await composer.fill('Which account answers first?')
  await composer.press('Enter')
})

Then('the first account is tried, the healthy one answers, and the next request goes straight to it', async ({ page }: { page: Page }) => {
  const turnKeys = (): string[] =>
    fakeCommandCodeFor(page)
      .requests.filter(request => request.kind === 'turn')
      .map(request => request.key)
  await recordAssertion(page, 'ai-accounts-priority-tries-the-first-account', async () => {
    await expect(page.getByText('Answered by BRAVO2', { exact: true }).last()).toBeVisible({ timeout: 30_000 })
    expect(turnKeys()[0]).toBe('e2e-fake-key-LIMITED')
    expect(turnKeys().at(-1)).toBe('e2e-fake-key-BRAVO2')
  })
  const before = turnKeys().length
  const composer = page.getByRole('textbox', { name: /\/ commands, @ files or sessions$/ })
  await composer.fill('And the next request?')
  await composer.press('Enter')
  await recordAssertion(page, 'ai-accounts-priority-skips-the-cooling-account', async () => {
    await expect(page.getByText('Answered by BRAVO2', { exact: true })).toHaveCount(2, { timeout: 30_000 })
    expect(turnKeys().slice(before)).toEqual(['e2e-fake-key-BRAVO2'])
  })
  await finishJourneyAssertions(page)
})

When('a third Command Code account is added', async ({ page }: { page: Page }) => {
  await addCommandCodeAccount(page, { name: 'Command Code 3', key: 'e2e-fake-key-CHAIN3' })
})

const composerPicker = (page: Page) => page.getByRole('button', { name: /, reasoning / })
const fallbacks = (page: Page) => page.getByRole('region', { name: 'Fallbacks', exact: true })

const pickAccountModel = async (page: Page, account: string): Promise<void> => {
  await page
    .getByRole('region', { name: account, exact: true })
    .getByRole('button', { name: /gpt-6-luna/ })
    .click()
  await expect(page.getByRole('region', { name: account, exact: true }).getByRole('button', { name: /gpt-6-luna/ })).toHaveAttribute('aria-pressed', 'true')
}

When('a new thread falls back from the first account to the third one in the composer picker', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await composerPicker(page).click()
  await pickAccountModel(page, 'Command Code 3')
  await fallbacks(page).getByRole('button', { name: 'Add current selection', exact: true }).click()
  await expect(fallbacks(page).getByRole('listitem')).toHaveCount(1)
  await pickAccountModel(page, 'Command Code 1')
  await page.keyboard.press('Escape')
})

When('the thread asks a question', async ({ page }: { page: Page }) => {
  const composer = page.getByRole('textbox', { name: /\/ commands, @ files or sessions$/ })
  await composer.fill('Who takes over?')
  await composer.press('Enter')
})

Then('the third account answers instead of the next account in the list', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-fallback-chain-takes-over', async () => {
    await expect(page.getByText('Answered by CHAIN3', { exact: true }).last()).toBeVisible({ timeout: 30_000 })
    const turnKeys = fakeCommandCodeFor(page)
      .requests.filter(request => request.kind === 'turn')
      .map(request => request.key)
    expect(turnKeys[0]).toBe('e2e-fake-key-LIMITED')
    expect(turnKeys).not.toContain('e2e-fake-key-BRAVO2')
    expect(turnKeys.at(-1)).toBe('e2e-fake-key-CHAIN3')
  })
})

Then('the picker offers to return the thread to its selection', async ({ page }: { page: Page }) => {
  await composerPicker(page).click()
  const serving = fallbacks(page).getByRole('status')
  await recordAssertion(page, 'ai-accounts-fallback-chain-moves-the-picker', async () => {
    await expect(serving).toContainText('Command Code 3')
    await expect(page.getByRole('region', { name: 'Command Code 3', exact: true }).getByRole('button', { name: /gpt-6-luna/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
  await serving.getByRole('button', { name: 'Return to selection', exact: true }).click()
  await recordAssertion(page, 'ai-accounts-fallback-chain-returns-to-the-selection', async () => {
    await expect(serving).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Command Code 1', exact: true }).getByRole('button', { name: /gpt-6-luna/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
  await finishJourneyAssertions(page)
})

const failTurnOnExhaustedAccount = async (page: Page, key: string): Promise<void> => {
  await startFakeCommandCode(page)
  await openAccountsPanel(page)
  await addCommandCodeAccount(page, { name: 'Command Code 1', key })
  // The inline recovery choice exists only while automatic exhausted-limit failover is off.
  await openSettingsDialog(page)
  await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
  const exhausted = page.getByRole('group', { name: /Usage exhausted/ })
  const failover = exhausted.getByRole('switch', { name: 'Fail over to the next account' })
  await failover.click()
  await expect(failover).not.toBeChecked()
  await page.keyboard.press('Escape')
  const threadSidebarNewThreadButton = page.getByRole('button', { name: 'New thread', exact: true })
  if (await threadSidebarNewThreadButton.isVisible()) {
    await threadSidebarNewThreadButton.click()
    await expect.poll(() => new URL(page.url()).searchParams.get('thread'), { timeout: 15_000 }).not.toBeNull()
  } else {
    await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  }
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await composer.waitFor({ state: 'visible', timeout: 15_000 })
  await page.getByRole('button', { name: /^Select model/ }).click()
  await selectAccountModel(page, 'commandcode_work/gpt-6-luna')
  await composer.fill('Recover this turn on another available route.')
  await composer.press('Enter')
}

When('an exhausted Command Code account fails a turn with failover off', async ({ page }: { page: Page }) => {
  await failTurnOnExhaustedAccount(page, 'e2e-fake-key-EXHAUSTED')
})

When('a briefly exhausted Command Code account fails a turn with auto-resume on', async ({ page }: { page: Page }) => {
  await failTurnOnExhaustedAccount(page, 'e2e-fake-key-RESETTING')
  const autoResume = page.getByRole('checkbox', { name: 'Automatically resume 1 minute after reset' })
  await expect(autoResume).toBeEnabled({ timeout: 30_000 })
  await autoResume.click()
  await expect(autoResume).toBeChecked()
})

Then('the turn resumes on its own one minute after the reset', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-exhausted-turn-auto-resumes', async () => {
    // The fake limit resets 5 seconds after the failed turn; the Host resumes 1 minute after that.
    await expect(page.getByText('Answered by ETTING', { exact: true }).last()).toBeVisible({ timeout: 100_000 })
  })
  await finishJourneyAssertions(page)
})

Then('the exhausted turn offers an inline route switch and one-minute auto-resume', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-exhausted-inline-recovery', async () => {
    await expect(page.getByText("Your current account's usage limit is exhausted", { exact: false })).toBeVisible({ timeout: 30_000 })
    // A known reset both dates the notice and enables the one-minute auto-resume opt-in.
    await expect(page.getByRole('checkbox', { name: 'Automatically resume 1 minute after reset' })).toBeEnabled()
    // The route switch renders only once the Host stored this turn's recovery.
    const expand = page.getByRole('button', { name: 'Resume with another model', exact: true })
    await expect(expand).toBeEnabled({ timeout: 30_000 })
    await expand.click()
    await expect(page.getByRole('combobox', { name: 'Provider or account', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Resume with this selection', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

After(async ({ page }: { page: Page }) => {
  await stopFakeCommandCode(page)
})
