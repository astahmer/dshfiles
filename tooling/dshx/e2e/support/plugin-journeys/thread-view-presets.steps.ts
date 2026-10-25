import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const threadSidebar = (page: Page) => page.getByRole('region', { name: 'Threads' })
const sidebarSettings = (page: Page) => page.getByRole('region', { name: 'Sidebar settings' })
const viewManager = (page: Page) => page.getByRole('dialog')

const openSidebarSettings = async (page: Page): Promise<void> => {
  const sidebar = threadSidebar(page)
  if (await sidebarSettings(page).isVisible()) return
  await sidebar.getByRole('button', { name: 'Sidebar settings', exact: true }).click()
  await expect(sidebarSettings(page)).toBeVisible()
}

const selectViewOption = async (page: Page, label: string, value: string): Promise<void> => {
  const dialog = viewManager(page)
  await dialog.getByRole('combobox', { name: label, exact: true }).click()
  await page.getByRole('option', { name: value, exact: true }).click()
}

const selectViewStatuses = async (page: Page, labels: readonly string[]): Promise<void> => {
  const dialog = viewManager(page)
  for (const label of labels) {
    const checkbox = dialog.getByRole('checkbox', { name: label, exact: true })
    if (!(await checkbox.isChecked())) await checkbox.click()
  }
}

When('saved thread views are created, edited, reordered, disabled, and removed', async ({ page }: { page: Page }) => {
  // Match plain HTTP LAN access: getRandomValues is available, randomUUID is not.
  await page.evaluate(() => Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true }))
  await openSidebarSettings(page)
  await sidebarSettings(page).getByRole('button', { name: 'Manage views', exact: true }).click()
  const dialog = viewManager(page)
  await expect(dialog.getByRole('heading', { name: 'Manage views', exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: 'Add view', exact: true }).click()
  await dialog.getByLabel('View name').fill('Needs focus')
  await selectViewOption(page, 'Group by', 'Date')
  await selectViewStatuses(page, ['Needs attention', 'Archived'])
  await selectViewOption(page, 'Source', 'Main threads')
  await dialog.getByRole('button', { name: 'Save view', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Edit view Needs focus', exact: true })).toBeVisible()
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Needs focus' })).toContainText('Needs attention, Archived')

  for (let step = 0; step < 3; step += 1) {
    await dialog.getByRole('button', { name: 'Move view up Needs focus', exact: true }).click()
  }
  await dialog.getByRole('button', { name: 'Edit view All threads', exact: true }).click()
  await dialog.getByLabel('View name').fill('Everything')
  await dialog.getByRole('button', { name: 'Save view', exact: true }).click()

  const workingEnabled = dialog.getByRole('checkbox', { name: 'Enable view Working', exact: true })
  await workingEnabled.click()
  await expect(workingEnabled).toHaveAttribute('aria-checked', 'false')
  await dialog.getByRole('button', { name: 'Remove view Working', exact: true }).click()
  await dialog.getByRole('button', { name: 'Remove view Done', exact: true }).click()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()

  const sidebar = threadSidebar(page)
  const tabs = sidebar.getByRole('group', { name: 'Thread list view', exact: true })
  await expect(tabs.getByRole('button')).toHaveCount(2)
  await expect(tabs.getByRole('button').nth(0)).toHaveText('Needs focus')
  await expect(tabs.getByRole('button').nth(1)).toHaveText('Everything')
  await tabs.getByRole('button', { name: 'Needs focus', exact: true }).click()
  await expect(sidebar.getByRole('button', { name: 'Group: Date', exact: true })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Filter: Needs attention · Archived · Main threads', exact: true })).toBeVisible()

  await openSidebarSettings(page)
  await sidebarSettings(page).getByRole('checkbox', { name: 'Show group button', exact: true }).click()
  await sidebarSettings(page).getByRole('checkbox', { name: 'Show filter button', exact: true }).click()
  await expect(sidebar.getByRole('button', { name: 'Group: Date', exact: true })).toHaveCount(0)
  await expect(sidebar.getByRole('button', { name: 'Filter: Needs attention · Archived · Main threads', exact: true })).toHaveCount(0)
})

Then('the custom tabs and hidden controls survive reload', async ({ page }: { page: Page }) => {
  await page.reload()
  const sidebar = threadSidebar(page)
  await expect(sidebar).toBeVisible()

  await recordAssertion(page, 'thread-sidebar-custom-view-order-and-visibility-survive-reload', async () => {
    const tabs = sidebar.getByRole('group', { name: 'Thread list view', exact: true })
    await expect(tabs.getByRole('button')).toHaveCount(2)
    await expect(tabs.getByRole('button').nth(0)).toHaveText('Needs focus')
    await expect(tabs.getByRole('button').nth(0)).toHaveAttribute('aria-pressed', 'true')
    await expect(tabs.getByRole('button').nth(1)).toHaveText('Everything')
    await expect(tabs.getByRole('button', { name: /^Working/ })).toHaveCount(0)
    await expect(sidebar.getByRole('button', { name: /^Group:/ })).toHaveCount(0)
    await expect(sidebar.getByRole('button', { name: /^Filter:/ })).toHaveCount(0)

    await openSidebarSettings(page)
    await sidebarSettings(page).getByRole('button', { name: 'Manage views', exact: true }).click()
    const dialog = viewManager(page)
    await expect(dialog.getByRole('button', { name: 'Edit view Needs focus', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Edit view Everything', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Edit view Working', exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})
