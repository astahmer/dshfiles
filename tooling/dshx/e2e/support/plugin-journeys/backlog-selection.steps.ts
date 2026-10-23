import { expect, type Locator, type Page } from '@playwright/test'

import { Then } from '../bdd.js'

const searchInput = (page: Page) => page.getByRole('textbox', { name: 'Search backlog', exact: true })

const selectionRows = (page: Page, view: string): Locator => {
  if (view === 'feed') return page.getByRole('feed', { name: 'Backlog feed' }).getByRole('article', { name: /^Item b:/ })
  if (view === 'search') return page.getByRole('list', { name: 'Search results' }).getByRole('listitem', { name: /^Item b:/ })
  if (view === 'projects')
    return page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Active work', exact: true }) })
      .getByRole('listitem', { name: /^Item b:/ })
  return page.getByRole('listitem', { name: /^Item b:/ })
}

const selectedRows = (rows: Locator) => rows.and(rows.page().locator('[data-selected]'))

const openSelectionList = async (page: Page, view: string): Promise<void> => {
  if (view === 'search') {
    await searchInput(page).fill('Selection')
    await searchInput(page).press('Enter')
    return
  }
  if (view === 'inbox') {
    await page
      .getByRole('navigation', { name: 'Backlog views' })
      .getByRole('button', { name: /^Inbox\b/ })
      .click()
    return
  }
  if (view === 'projects') {
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    await page.getByRole('button', { name: /No project/ }).click()
  }
}

Then('the {string} backlog list supports coherent batch selection', async ({ page }: { page: Page }, view: string) => {
  await openSelectionList(page, view)
  const rows = selectionRows(page, view)
  await expect(rows).toHaveCount(3)
  const first = rows.nth(0)
  const middle = rows.nth(1)
  const last = rows.nth(2)
  const target = (row: Locator) => (view === 'projects' ? row.getByRole('button').first() : row)

  await target(first).click({ position: { x: 8, y: 8 } })
  await expect(page.getByRole('complementary', { name: 'Item detail' })).toBeVisible()
  await target(last).click({ modifiers: ['Shift'], position: { x: 8, y: 8 } })
  await expect(selectedRows(rows)).toHaveCount(3)
  await target(middle).click({ modifiers: ['ControlOrMeta'], position: { x: 8, y: 8 } })
  await expect(selectedRows(rows)).toHaveCount(2)
  await target(middle).click({ modifiers: ['ControlOrMeta'], position: { x: 8, y: 8 } })
  await expect(selectedRows(rows)).toHaveCount(3)

  if (view === 'inbox') {
    await page.getByRole('tab', { name: /^Blocked/ }).click()
    await expect(rows).toHaveCount(0)
    await page.getByRole('tab', { name: /^All/ }).click()
    await expect(rows).toHaveCount(3)
    await expect(selectedRows(rows)).toHaveCount(0)
  } else {
    await searchInput(page).fill('Selection alpha')
    if (view === 'search') await searchInput(page).press('Enter')
    await expect(rows).toHaveCount(1)
    await rows.first().click({ button: 'right' })
    await expect(page.getByRole('menu')).not.toContainText('selected')
    await page.keyboard.press('Escape')
    await searchInput(page).fill(view === 'search' ? 'Selection' : '')
    if (view === 'search') await searchInput(page).press('Enter')
    await expect(rows).toHaveCount(3)
    await expect(selectedRows(rows)).not.toHaveCount(3)
  }
  await target(rows.nth(0)).click({ position: { x: 8, y: 8 } })
  await target(rows.nth(2)).click({ modifiers: ['Shift'], position: { x: 8, y: 8 } })
  await expect(selectedRows(rows)).toHaveCount(3)

  await last.click({ button: 'right' })
  const menu = page.getByRole('menu')
  await expect(menu).toContainText('3 selected')
  await menu.getByRole('menuitem', { name: 'Status (3)', exact: true }).hover()
  await page.getByRole('menu').last().getByRole('menuitemradio', { name: 'Todo', exact: true }).click()
  await expect(selectedRows(rows)).toHaveCount(0)
  for (const row of await rows.all()) {
    await row.click({ button: 'right' })
    await page.getByRole('menu').getByRole('menuitem', { name: 'Status', exact: true }).hover()
    await expect(page.getByRole('menu').last().getByRole('menuitemradio', { name: 'Todo', exact: true })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  }

  await expect(selectedRows(rows)).toHaveCount(0)
})
