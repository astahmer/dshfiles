import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { ThreadListFilter } from '../thread-list-filter.js'

const threadSidebar = (page: Page) => page.getByRole('region', { name: 'Threads' })
const sidebarSettings = (page: Page) => page.getByRole('region', { name: 'Thread list settings' })
const viewManager = (page: Page) => page.getByRole('dialog')

const openSidebarSettings = async (page: Page): Promise<void> => {
  const sidebar = threadSidebar(page)
  if (await sidebarSettings(page).isVisible()) return
  await ThreadListFilter.clickItem(page, sidebar, 'Thread list settings')
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
  // The views are the Filter menu's presets (Q5, b:xpvk); Show group / filter button now say whether
  // that menu offers the Group submenu and the Status and Source submenus.
  const tabs = await ThreadListFilter.openViews(page, sidebar)
  await expect(tabs.getByRole('menuitemradio')).toHaveCount(2)
  await expect(tabs.getByRole('menuitemradio').nth(0)).toContainText('Needs focus')
  await expect(tabs.getByRole('menuitemradio').nth(1)).toContainText('Everything')
  await tabs.getByRole('menuitemradio', { name: 'Needs focus', exact: true }).click()
  await ThreadListFilter.expectGroup(page, sidebar, 'Date')
  // Filter presets (b:xpvk): the trigger names the preset, not the filters it holds.
  await expect(sidebar.getByRole('button', { name: 'Filter: Needs focus', exact: true })).toBeVisible()

  await openSidebarSettings(page)
  await sidebarSettings(page).getByRole('checkbox', { name: 'Show group button', exact: true }).click()
  await sidebarSettings(page).getByRole('checkbox', { name: 'Show filter button', exact: true }).click()
  await ThreadListFilter.open(sidebar)
  await expect(page.getByRole('menuitem', { name: /^Group:/u })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: /^Status:/u })).toHaveCount(0)
  await ThreadListFilter.close(page)
})

Then('the custom tabs and hidden controls survive reload', async ({ page }: { page: Page }) => {
  await page.reload()
  const sidebar = threadSidebar(page)
  await expect(sidebar).toBeVisible()

  await recordAssertion(page, 'thread-sidebar-custom-view-order-and-visibility-survive-reload', async () => {
    const tabs = await ThreadListFilter.openViews(page, sidebar)
    await expect(tabs.getByRole('menuitemradio')).toHaveCount(2)
    await expect(tabs.getByRole('menuitemradio').nth(0)).toContainText('Needs focus')
    await expect(tabs.getByRole('menuitemradio').nth(0)).toHaveAttribute('aria-checked', 'true')
    await expect(tabs.getByRole('menuitemradio').nth(1)).toContainText('Everything')
    await expect(tabs.getByRole('menuitemradio', { name: /^Working/ })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: /^Group:/u })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: /^Status:/u })).toHaveCount(0)
    await ThreadListFilter.close(page)

    await openSidebarSettings(page)
    await sidebarSettings(page).getByRole('button', { name: 'Manage views', exact: true }).click()
    const dialog = viewManager(page)
    await expect(dialog.getByRole('button', { name: 'Edit view Needs focus', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Edit view Everything', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Edit view Working', exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

// Filter presets (b:xpvk): save, switch (menu, ⌘K, [ and ]), edit → Save changes, delete → Undo, reload.
const filterTrigger = (page: Page, name: string) => threadSidebar(page).getByRole('button', { name: `Filter: ${name}`, exact: true })

const saveCurrentFiltersAs = async (page: Page, name: string): Promise<void> => {
  const presets = await ThreadListFilter.openViews(page, threadSidebar(page))
  await presets.getByRole('menuitem', { name: 'Save current filters as preset…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Save filters as a preset' })
  await dialog.getByLabel('Preset name').fill(name)
  await dialog.getByRole('button', { name: 'Save preset', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

const statusLabels = ['All threads', 'Working', 'Needs attention', 'Archived'] as const

When('two filter presets are saved from the Filter menu', async ({ page }: { page: Page }) => {
  const sidebar = threadSidebar(page)
  await ThreadListFilter.selectView(page, sidebar, 'All threads')
  await ThreadListFilter.setStatus(page, sidebar, '', statusLabels, ['Working'])
  await expect(filterTrigger(page, 'All threads (edited)')).toBeVisible()
  await saveCurrentFiltersAs(page, 'Busy')
  await expect(filterTrigger(page, 'Busy')).toBeVisible()
  await ThreadListFilter.setStatus(page, sidebar, '', statusLabels, ['Archived'])
  await expect(filterTrigger(page, 'Busy (edited)')).toBeVisible()
  await saveCurrentFiltersAs(page, 'Stored')
  await expect(filterTrigger(page, 'Stored')).toBeVisible()
})

Then('the presets switch from the Filter menu, the command palette and the bracket keys', async ({ page }: { page: Page }) => {
  const sidebar = threadSidebar(page)
  await recordAssertion(page, 'thread-sidebar-filter-presets-switch', async () => {
    await ThreadListFilter.selectView(page, sidebar, 'Busy')
    await expect(filterTrigger(page, 'Busy')).toBeVisible()
    // Busy kept its own filters when Stored was saved from its edits.
    await ThreadListFilter.openSubmenu(page, sidebar, /^Status: /u)
    await expect(page.getByRole('menuitemcheckbox', { name: 'Working', exact: true })).toHaveAttribute('aria-checked', 'true')
    await ThreadListFilter.close(page)

    await page.keyboard.press('Meta+K')
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    await palette.getByRole('combobox').fill('Filter: Stored')
    await palette
      .getByRole('option', { name: /Filter: Stored/u })
      .first()
      .click()
    await expect(filterTrigger(page, 'Stored')).toBeVisible()

    // [ and ] belong to the thread list, like J and K: they fire once the list is focused or was last clicked. A click
    // near the bottom of its scroller makes it that region without opening a row.
    const list = sidebar.getByTestId('thread-sidebar-scroll')
    const box = await list.boundingBox()
    if (box === null) throw new Error('The thread list is not on screen.')
    await list.click({ position: { x: box.width / 2, y: box.height - 8 } })
    await page.keyboard.press('[')
    await expect(filterTrigger(page, 'Busy')).toBeVisible()
    await page.keyboard.press(']')
    await expect(filterTrigger(page, 'Stored')).toBeVisible()
  })
})

Then('an edited preset saves its changes and a deleted preset comes back with Undo', async ({ page }: { page: Page }) => {
  const sidebar = threadSidebar(page)
  await recordAssertion(page, 'thread-sidebar-filter-presets-save-changes', async () => {
    await ThreadListFilter.selectSource(page, sidebar, '', 'Main threads')
    await expect(filterTrigger(page, 'Stored (edited)')).toBeVisible()
    const presets = await ThreadListFilter.openViews(page, sidebar)
    await presets.getByRole('menuitem', { name: 'Save changes to “Stored”', exact: true }).click()
    await expect(filterTrigger(page, 'Stored')).toBeVisible()
    await ThreadListFilter.openSubmenu(page, sidebar, /^Source: /u)
    await expect(page.getByRole('menuitemradio', { name: 'Main threads', exact: true })).toHaveAttribute('aria-checked', 'true')
    await ThreadListFilter.close(page)
  })
  await recordAssertion(page, 'thread-sidebar-filter-presets-delete-undo', async () => {
    await ThreadListFilter.clickViewItem(page, sidebar, 'Delete…')
    const confirm = page.getByRole('alertdialog', { name: 'Delete “Stored”?' })
    await confirm.getByRole('button', { name: 'Delete preset', exact: true }).click()
    await expect(filterTrigger(page, 'Stored')).toHaveCount(0)
    await sidebar.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(filterTrigger(page, 'Stored')).toBeVisible()
  })
  await page.reload()
  await expect(threadSidebar(page)).toBeVisible()
  await recordAssertion(page, 'thread-sidebar-filter-presets-survive-reload', async () => {
    await expect(filterTrigger(page, 'Stored')).toBeVisible()
    const presets = await ThreadListFilter.openViews(page, threadSidebar(page))
    // A preset that lists working threads names its count too: "Busy (0)".
    await expect(presets.getByRole('menuitemradio', { name: ThreadListFilter.viewName('Busy') })).toBeVisible()
    await expect(presets.getByRole('menuitemradio', { name: ThreadListFilter.viewName('Stored') })).toHaveAttribute('aria-checked', 'true')
    await ThreadListFilter.close(page)
  })
  await finishJourneyAssertions(page)
})
