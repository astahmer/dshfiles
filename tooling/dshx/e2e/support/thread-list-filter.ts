import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Productivity pass Q5 (T5.3): above the first thread row the list keeps the project picker and one Filter menu. Since
 * filter presets (b:xpvk) its trigger names the active preset, "Filter: <preset>[ (edited)]"; the presets are radios at
 * the top of the menu, Group by, Status and Source are submenus, and Board, Thread list settings and Sidebar settings
 * are items. The Board page keeps its inline Group and
 * Filter buttons, so each helper uses a direct button first when the scope still has one.
 */
const trigger = (scope: Locator): Locator => scope.getByRole('button', { name: /^Filter: /u }).filter({ visible: true }).first()
/** The list's Filter menu (marked); the Board page keeps inline Group and Filter buttons instead. */
const hasMenu = async (scope: Locator): Promise<boolean> => {
  // Wait for the trigger first: right after a view change or a reload it may not be drawn yet.
  const filter = trigger(scope)
  await filter.waitFor({ state: 'visible' })
  return (await filter.getAttribute('data-thread-list-filter')) !== null
}

const open = async (scope: Locator): Promise<void> => {
  await trigger(scope).click()
  // A click that lands while the list re-renders (a view switch, a thread opened by the arrow keys) can be lost.
  const menu = scope.page().getByRole('menu').filter({ visible: true }).first()
  if (await menu.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false)) return
  await trigger(scope).click()
  await menu.waitFor({ state: 'visible' })
}

/** Open the Filter menu, then the submenu whose trigger name starts with `prefix` ("Group:", "Status:", "Source:", the view). */
const openSubmenu = async (page: Page, scope: Locator, prefix: RegExp): Promise<void> => {
  await open(scope)
  const item = page.getByRole('menuitem', { name: prefix }).first()
  await item.hover()
  await item.press('ArrowRight').catch(() => undefined)
}

/**
 * Until the menu has finished closing, Radix keeps the rest of the page aria-hidden: role queries outside the menu
 * (a Dockview tab, a row) find nothing. Every helper that ends with the menu closed waits for that.
 */
const settled = async (page: Page): Promise<void> => {
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(page.locator('[data-aria-hidden="true"]')).toHaveCount(0)
}

const close = async (page: Page): Promise<void> => {
  for (let index = 0; index < 3; index += 1) {
    if ((await page.getByRole('menu').count()) === 0) break
    await page.keyboard.press('Escape')
  }
  await settled(page)
}

/** An item of the Filter menu: Board, Thread list settings, Sidebar settings. */
const clickItem = async (page: Page, scope: Locator, name: string): Promise<void> => {
  await open(scope)
  await page.getByRole('menuitem', { name, exact: true }).click()
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
/** A view radio's name is the former tab's: "Done", "Working (2)", "Done (1), Turn finished". */
const viewName = (name: string): RegExp => new RegExp(`^${escapeRegExp(name)}(?: \\(\\d+\\))?(?:, .+)?$`, 'u')

/**
 * Open the Filter menu; returns its Presets section (filter presets, b:xpvk), which lists the saved views as radios at
 * the top of the menu. The section is a named group, so a status checkbox or a group radio with the same name never
 * matches.
 */
const openViews = async (page: Page, scope: Locator): Promise<Locator> => {
  await open(scope)
  const presets = page.getByRole('menu').filter({ visible: true }).first().getByRole('group', { name: 'Presets', exact: true })
  await expect(presets).toBeVisible()
  return presets
}

/** Pick one of the list's presets (All threads, Working, Done, a custom one); picking the active one drops its edits. */
const selectView = async (page: Page, scope: Locator, name: string): Promise<void> => {
  const presets = await openViews(page, scope)
  await presets.getByRole('menuitemradio', { name: viewName(name) }).click()
  await settled(page)
}

/** An item of the active preset's options submenu: Rename…, Update with current filters, Delete…, Mark all as read / unread, Manage presets…. */
const clickViewItem = async (page: Page, scope: Locator, name: string): Promise<void> => {
  await openSubmenu(page, scope, /^Preset options: /u)
  const menu = page.getByRole('menu', { name: /^Preset options/u })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name, exact: true }).click()
}

/** Customize sidebar: the Fixed layout's Filter menu item, else Free docking's header button. */
const openSidebarSettings = async (page: Page): Promise<void> => {
  const button = page.getByRole('button', { name: 'Sidebar settings', exact: true }).filter({ visible: true })
  if ((await button.count()) > 0) {
    await button.first().click()
    return
  }
  await clickItem(page, page.getByRole('region', { name: 'Threads', exact: true }), 'Sidebar settings')
}

const selectGroup = async (page: Page, scope: Locator, name: string): Promise<void> => {
  if (await hasMenu(scope)) await openSubmenu(page, scope, /^Group: /u)
  else await scope.getByRole('button', { name: /^Group: /u }).filter({ visible: true }).first().click()
  await page.getByRole('menuitemradio', { name, exact: true }).click()
  await settled(page)
}

const selectSource = async (page: Page, scope: Locator, triggerName: string, name: string): Promise<void> => {
  if (await hasMenu(scope)) await openSubmenu(page, scope, /^Source: /u)
  else await scope.getByRole('button', { name: triggerName, exact: true }).click()
  await page.getByRole('menuitemradio', { name, exact: true }).click()
  await settled(page)
}

/** Check exactly `selected` among the status filters (none: All threads), through the trigger named `triggerName`. */
const setStatus = async (page: Page, scope: Locator, triggerName: string, labels: readonly string[], selected: readonly string[]): Promise<void> => {
  if (await hasMenu(scope)) await openSubmenu(page, scope, /^Status: /u)
  else await scope.getByRole('button', { name: triggerName, exact: true }).click()
  for (const label of labels) {
    const item = page.getByRole('menuitemcheckbox', { name: label, exact: true })
    const shouldBeChecked = label === 'All threads' ? selected.length === 0 : selected.includes(label)
    if ((await item.getAttribute('aria-checked')) === String(shouldBeChecked)) continue
    await item.click()
  }
  await close(page)
}

/** The list is grouped by `name`: the Board's inline button, or the Filter menu's Group submenu trigger. */
const expectGroup = async (page: Page, scope: Locator, name: string): Promise<void> => {
  if (!(await hasMenu(scope))) {
    await expect(scope.getByRole('button', { name: `Group: ${name}`, exact: true })).toBeVisible()
    return
  }
  await open(scope)
  await expect(page.getByRole('menuitem', { name: `Group: ${name}`, exact: true })).toBeVisible()
  await close(page)
}

export const ThreadListFilter = { trigger, hasMenu, open, openSubmenu, close, clickItem, viewName, openViews, selectView, clickViewItem, openSidebarSettings, selectGroup, selectSource, setStatus, expectGroup }
