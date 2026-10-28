import { expect, test, type Locator, type Page } from '@playwright/test'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'
import { Then } from '../bdd.js'
import { recordAssertion, finishJourneyAssertions } from '../steps.js'

const right = (page: Page): Locator => page.locator('[data-workbench-region="right"]').first()
const openRight = async (page: Page): Promise<void> => {
  await page.locator('[data-workbench-region="main"]').getByRole('button', { name: 'Pane options', exact: true }).first().click()
  await page.getByRole('menuitem', { name: 'Open right pane', exact: true }).click()
  await expect(right(page)).toBeVisible()
}
const choose = async (page: Page, name: string): Promise<void> => {
  const picker = right(page).getByRole('region', { name: 'Choose a view', exact: true }).filter({ visible: true })
  await expect(picker).toHaveCount(1)
  await picker.getByRole('textbox', { name: 'Search views', exact: true }).fill(name)
  await picker.getByRole('button', { name, exact: true }).click()
  await expect(picker).toBeHidden()
}
const closeTab = async (page: Page, name: string): Promise<void> => {
  await right(page)
    .getByRole('tab', { name, exact: true })
    .getByRole('button', { name: `Close ${name}`, exact: true })
    .click()
}

Then('closing one of two right tabs keeps the other view and closing the last hides the pane', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-right-last-close-not-chooser-repair', async () => {
    // The shared add-view path creates its own chooser. Retire the original
    // empty-pane chooser while Scratchpad still keeps this pane populated.
    await closeTab(page, 'New tab')
    await expect(right(page).getByRole('tab')).toHaveCount(1)
    await right(page).getByRole('button', { name: 'New tab', exact: true }).first().click()
    await choose(page, 'Workbench: Ticker')
    await expect(right(page).getByRole('tab')).toHaveCount(2)
    await closeTab(page, 'Workbench: Scratchpad')
    await expect(right(page)).toBeVisible()
    await expect(right(page).getByRole('tab', { name: 'Workbench: Ticker', exact: true })).toBeVisible()
    await expect(right(page).getByTestId('mounts')).toHaveText('1')
    await closeTab(page, 'Workbench: Ticker')
    await expect(right(page)).toBeHidden()
    await expect(right(page).getByRole('tab', { includeHidden: true })).toHaveCount(0)
    await expect(page.locator('[data-workbench-region="main"]')).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('right-last-tab-auto-closed.png'), animations: 'disabled' })
  })
})
Then('manual right-pane reopen offers one stable chooser that can close the pane again', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-right-empty-manual-reopen', async () => {
    await openRight(page)
    await expect(right(page).getByRole('region', { name: 'Choose a view', exact: true })).toBeVisible()
    await expect(right(page).getByRole('tab')).toHaveCount(1)
    await expect(right(page).getByRole('tab', { name: 'New tab', exact: true })).toBeVisible()
    await closeTab(page, 'New tab')
    await expect(right(page)).toBeHidden()
  })
})
Then('a reload keeps the empty right pane closed and a real view can reopen it', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-right-empty-close-persists-and-accepts-view', async () => {
    await StartupDialogs.reloadPastProviderSetup(page)
    await expect(right(page)).toBeHidden()
    await openRight(page)
    await choose(page, 'AI Accounts: Preview')
    await expect(right(page).getByRole('tab')).toHaveCount(1)
    await expect(right(page).getByRole('tab', { name: 'AI Accounts: Preview', exact: true })).toBeVisible()
    await expect(right(page).getByRole('button', { name: 'Add AI account', exact: true })).toBeVisible()
    await closeTab(page, 'AI Accounts: Preview')
    await expect(right(page)).toBeHidden()
  })
  await finishJourneyAssertions(page)
})
