import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Productivity pass Q5 (T5.3): above the first thread row the list keeps the project picker and one Filter control. Since
 * filter presets (b:xpvk) its trigger names the active preset, "Filter: <preset>[ (edited)]". Since round nine it opens
 * one panel (a dialog named Filters; a bottom sheet on a phone) instead of a menu of submenus: the presets are radios,
 * Status is a row of toggle chips with no Any chip (the rarer ones under More statuses, a Clear in its heading), Source and Group by are radio chips, and Board,
 * Thread list settings and Sidebar settings are buttons at its foot. The active preset's own verbs (Rename…, Delete…,
 * Mark N shown as read) stay in a small "Preset options" menu beside the Presets heading. The Board page keeps its inline
 * Group and Filter buttons, so each helper uses a direct button first when the scope still has one.
 */
/**
 * The trigger named `name` ("Filter: Working"), with or without the filters-on count its name ends with since round 30
 * ("Filter: Working, 1 filter on").
 */
const triggerNamed = (name: string): RegExp => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:, \\d+ filters? on)?$`, 'u')
const trigger = (scope: Locator): Locator => scope.getByRole('button', { name: /^Filter: /u }).filter({ visible: true }).first()
/** The list's Filter panel (marked); the Board page keeps inline Group and Filter buttons instead. */
const hasMenu = async (scope: Locator): Promise<boolean> => {
  // Wait for the trigger first: right after a view change or a reload it may not be drawn yet.
  const filter = trigger(scope)
  await filter.waitFor({ state: 'visible' })
  return (await filter.getAttribute('data-thread-list-filter')) !== null
}

/** The open Filter panel. */
const panel = (page: Page): Locator => page.getByRole('dialog', { name: 'Filters', exact: true })

const open = async (scope: Locator): Promise<Locator> => {
  const page = scope.page()
  if (await panel(page).isVisible()) return panel(page)
  await trigger(scope).click()
  // A click that lands while the list re-renders (a view switch, a thread opened by the arrow keys) can be lost.
  if (await panel(page).waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false)) return panel(page)
  await trigger(scope).click()
  await panel(page).waitFor({ state: 'visible' })
  return panel(page)
}

/** Nothing of the Filter control is open, and no menu keeps the rest of the page aria-hidden. */
const settled = async (page: Page): Promise<void> => {
  await expect(panel(page)).toHaveCount(0)
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(page.locator('[data-aria-hidden="true"]')).toHaveCount(0)
}

/**
 * The panel never scrolls sideways (council round 29, item 4: a 390 px phone sheet did, by 2 px at rest and 49 px with an
 * edited preset). Checked every time a journey closes it, in whatever state it reached.
 */
const expectNoSidewaysScroll = async (page: Page): Promise<void> => {
  const body = panel(page).locator('[data-thread-list-filter-panel]').first()
  if (!(await body.isVisible().catch(() => false))) return
  const width = await body.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }))
  expect(width.scroll, 'the Filters panel scrolls sideways').toBe(width.client)
}

const close = async (page: Page): Promise<void> => {
  await expectNoSidewaysScroll(page)
  for (let index = 0; index < 3; index += 1) {
    if ((await panel(page).count()) === 0 && (await page.getByRole('menu').count()) === 0) break
    await page.keyboard.press('Escape')
  }
  await settled(page)
}

/** A place at the panel's foot: Board, Thread list settings, Sidebar settings. Each closes the panel. */
const clickItem = async (page: Page, scope: Locator, name: string): Promise<void> => {
  // A Host dialog that opens late (the provider setup notice after a reload) takes focus and closes the panel under the
  // click; the button is then detached for good, so open the panel again rather than wait on it.
  await expect(async () => {
    await (await open(scope)).getByRole('button', { name, exact: true }).click({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
/** A preset radio's name is the former tab's: "Done", "Working (2)", "Done (1), Turn finished". */
const viewName = (name: string): RegExp => new RegExp(`^${escapeRegExp(name)}(?: \\(\\d+\\))?(?:, .+)?$`, 'u')

/** Open the Filter panel; returns its Presets radios (filter presets, b:xpvk), the saved views in order. */
const openViews = async (page: Page, scope: Locator): Promise<Locator> => {
  const presets = (await open(scope)).getByRole('radiogroup', { name: 'Presets', exact: true })
  await expect(presets).toBeVisible()
  return presets
}

/** Pick one of the list's presets (All threads, Working, Done, a custom one); the active one again is a no-op (round 29). */
const selectView = async (page: Page, scope: Locator, name: string): Promise<void> => {
  const presets = await openViews(page, scope)
  await presets.getByRole('radio', { name: viewName(name) }).click()
  await close(page)
}

/** An item of the presets' options menu: Save as new preset…, Rename…, Save changes to “‹preset›”, Delete…, Manage presets…, then Mark N shown as read / unread (match those by pattern). */
const clickViewItem = async (page: Page, scope: Locator, name: string | RegExp): Promise<void> => {
  await (await open(scope)).getByRole('button', { name: /^Preset options: /u }).click()
  const menu = page.getByRole('menu', { name: /^Preset options/u })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', typeof name === 'string' ? { name, exact: true } : { name }).click()
}

/** Customize sidebar: the Fixed layout's Filter panel button, else Free docking's header button. */
const openSidebarSettings = async (page: Page): Promise<void> => {
  const button = page.getByRole('button', { name: 'Sidebar settings', exact: true }).filter({ visible: true })
  if ((await button.count()) > 0) {
    await button.first().click()
    return
  }
  await clickItem(page, page.getByRole('region', { name: 'Threads', exact: true }), 'Sidebar settings')
}

/** The panel's segment reads "Custom" and is named "Custom, arrange manually" (round 32, item 6); the Board keeps "Arrange manually". */
const panelGroupName = (name: string): string => (name === 'Arrange manually' ? 'Custom, arrange manually' : name)

const selectGroup = async (page: Page, scope: Locator, name: string): Promise<void> => {
  if (await hasMenu(scope)) {
    await (await open(scope)).getByRole('radiogroup', { name: 'Group by', exact: true }).getByRole('radio', { name: panelGroupName(name), exact: true }).click()
    await close(page)
    return
  }
  await scope.getByRole('button', { name: /^Group: /u }).filter({ visible: true }).first().click()
  await page.getByRole('menuitemradio', { name, exact: true }).click()
  await settled(page)
}

/** The panel names the Subagents segment by its label (round 29, item 17); the Board's menu keeps "Subagent threads". */
const panelSourceName = (name: string): string => (name === 'Subagent threads' ? 'Subagents' : name)

/** Pick a source; in the panel the chips read All / Main / Subagents and keep the full names ("Main threads"). */
const selectSource = async (page: Page, scope: Locator, triggerName: string, name: string): Promise<void> => {
  if (await hasMenu(scope)) {
    await (await open(scope)).getByRole('radiogroup', { name: 'Source', exact: true }).getByRole('radio', { name: panelSourceName(name), exact: true }).click()
    await close(page)
    return
  }
  await scope.getByRole('button', { name: triggerNamed(triggerName) }).click()
  await page.getByRole('menuitemradio', { name, exact: true }).click()
  await settled(page)
}

/** A status chip of the open panel, opening More statuses when it sits there. */
const statusChip = async (filter: Locator, label: string): Promise<Locator> => {
  const chip = filter.getByRole('button', { name: label, exact: true })
  // More statuses reads Fewer statuses while open (round 29, item 3).
  if ((await chip.count()) === 0) await filter.getByRole('button', { name: 'More statuses', exact: true }).click()
  return chip
}

/** Check exactly `selected` among the status filters (none: All threads), through the trigger named `triggerName`. */
const setStatus = async (page: Page, scope: Locator, triggerName: string, labels: readonly string[], selected: readonly string[]): Promise<void> => {
  if (await hasMenu(scope)) {
    const filter = await open(scope)
    // No status on means All threads (round 28: there is no Any chip), so only the named statuses are toggled.
    for (const label of labels.filter(candidate => candidate !== 'All threads')) {
      const chip = await statusChip(filter, label)
      const shouldBeOn = selected.includes(label)
      if ((await chip.getAttribute('aria-pressed')) === String(shouldBeOn)) continue
      await chip.click()
    }
    await close(page)
    return
  }
  await scope.getByRole('button', { name: triggerNamed(triggerName) }).click()
  for (const label of labels) {
    const item = page.getByRole('menuitemcheckbox', { name: label, exact: true })
    const shouldBeChecked = label === 'All threads' ? selected.length === 0 : selected.includes(label)
    if ((await item.getAttribute('aria-checked')) === String(shouldBeChecked)) continue
    await item.click()
  }
  await close(page)
}

/** The status chip `label` is on (pressed) in the open panel. */
const expectStatus = async (page: Page, scope: Locator, label: string): Promise<void> => {
  const chip = await statusChip(await open(scope), label)
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await close(page)
}

/** The source `name` ("Main threads") is the one checked in the open panel. */
const expectSource = async (page: Page, scope: Locator, name: string): Promise<void> => {
  const source = (await open(scope)).getByRole('radiogroup', { name: 'Source', exact: true })
  await expect(source.getByRole('radio', { name: panelSourceName(name), exact: true })).toHaveAttribute('aria-checked', 'true')
  await close(page)
}

/** The list is grouped by `name`: the Board's inline button, or the Filter panel's checked Group by chip. */
const expectGroup = async (page: Page, scope: Locator, name: string): Promise<void> => {
  if (!(await hasMenu(scope))) {
    await expect(scope.getByRole('button', { name: `Group: ${name}`, exact: true })).toBeVisible()
    return
  }
  const group = (await open(scope)).getByRole('radiogroup', { name: 'Group by', exact: true })
  await expect(group.getByRole('radio', { name: panelGroupName(name), exact: true })).toHaveAttribute('aria-checked', 'true')
  await close(page)
}

export const ThreadListFilter = {
  triggerNamed,
  trigger,
  hasMenu,
  panel,
  open,
  close,
  clickItem,
  viewName,
  openViews,
  selectView,
  clickViewItem,
  openSidebarSettings,
  selectGroup,
  selectSource,
  setStatus,
  expectStatus,
  expectSource,
  expectGroup,
}
