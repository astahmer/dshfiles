import type { Locator, Page } from '@playwright/test'

/** Fixture vocabulary only: selectors require the exact qualified UI name, never a legacy fallback. */
const reusableViewNames = new Map([
  ['Current conversation', 'Rich Composer: Current conversation'],
  ['Threads', 'Thread Sidebar: Threads'],
  ['Navigation', 'Thread Sidebar: Navigation'],
  ['Sidebar status', 'AI Accounts: Preview'],
  // Shared Workbench fixtures include native/unlabeled footer actions, so this aggregate has mixed owners.
  ['Sidebar actions', 'Thread Sidebar: Plugin controls'],
  ['Settings', 'Settings Shell: Settings'],
  ['Backlog', 'Backlog: Items'],
  ['Editor', 'Editor: Files'],
  ['Jujutsu', 'Jujutsu: Revision graph'],
  ['Scratchpad', 'Workbench: Scratchpad'],
  ['Ticker', 'Workbench: Ticker'],
  ['Plugins', 'Plugin Manager: Plugins'],
  ['Automation tasks', 'Schedule: Automation tasks'],
])

export const reusableViewName = (fixtureName: string): string => reusableViewNames.get(fixtureName) ?? fixtureName

/** Core-owned navigation metadata stays original outside Workbench; the owned Navigation seat qualifies it. */
const globalPanelName = (fixtureName: string): string =>
  fixtureName === 'Plugins' || fixtureName === 'Automation tasks' ? fixtureName : reusableViewName(fixtureName)

export const globalPanelLink = (page: Page, fixtureName: string): Locator =>
  page
    .locator('[data-sidebar-workbench-source="dshfiles-thread-sidebar.workbench-navigation"]')
    .getByRole('navigation', { name: 'Navigation', exact: true })
    .getByRole('button', { name: reusableViewName(fixtureName), exact: true })
    .or(page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: globalPanelName(fixtureName), exact: true }))
    .or(page.getByRole('navigation', { name: 'Sidebar navigation', exact: true }).getByRole('button', { name: reusableViewName(fixtureName), exact: true }))
    .first()

const moreDestinationsButton = (page: Page): Locator =>
  page
    .locator('[data-sidebar-workbench-source="dshfiles-thread-sidebar.workbench-navigation"]')
    .getByRole('navigation', { name: 'Navigation', exact: true })
    .or(page.getByRole('navigation', { name: 'Sidebar navigation', exact: true }))
    .getByRole('button', { name: 'More sidebar destinations', exact: true })
    .first()

/**
 * Where each former left-nav page lives in the thread sidebar's fixed rail (plans/ade-ux Phase 3a): destination tab,
 * then section. Mirrors KNOWN_SECTIONS in @dshfiles/thread-sidebar/destinations; the sidebar's own test pins those.
 */
const railLocations = new Map<string, { readonly destination: string; readonly section: string }>([
  ['Thread Sidebar: Board', { destination: 'Threads', section: 'Board' }],
  ['Inbox', { destination: 'Inbox', section: 'Needs you' }],
  ['JJ Integration: Thread integration', { destination: 'Land', section: 'Workspaces' }],
  ['pulls.review: Reviews', { destination: 'Land', section: 'Review' }],
  ['Jujutsu: Revision graph', { destination: 'Land', section: 'History' }],
  ['Jujutsu: Source Control', { destination: 'Land', section: 'Source control' }],
  ['Backlog: Items', { destination: 'Work', section: 'Backlog' }],
  ['Schedule: Automation tasks', { destination: 'Work', section: 'Schedules' }],
  ['Agents: Directory', { destination: 'Agents', section: 'Directory' }],
  ['Agent Communication: Messages', { destination: 'Agents', section: 'Messages' }],
  ['Agent Toolkit: Capabilities', { destination: 'Agents', section: 'Capabilities' }],
  ['Usage: Analytics', { destination: 'Observe', section: 'Usage' }],
  ['AI Accounts: Usage history', { destination: 'Observe', section: 'Quota history' }],
  ['AI Accounts: Quota forecast', { destination: 'Observe', section: 'Quota forecast' }],
  ['Activity Timeline: Activity', { destination: 'Observe', section: 'Activity' }],
  ['Traces: Explorer', { destination: 'Observe', section: 'Traces' }],
  ['Background Jobs: Jobs', { destination: 'Observe', section: 'Jobs' }],
  ['Worktree Memory: RAM', { destination: 'Observe', section: 'RAM' }],
  ['Multi-host: Hosts', { destination: 'Observe', section: 'Hosts' }],
  ['Memory: Browser', { destination: 'Knowledge', section: 'Memory' }],
  ['Resource Packs: Resources', { destination: 'Knowledge', section: 'Resources' }],
  ['AI Accounts: Accounts', { destination: 'Settings', section: 'AI accounts' }],
  ['MCP Servers: Servers', { destination: 'Settings', section: 'MCP servers' }],
  ['Secret Catalog: Secrets', { destination: 'Settings', section: 'Secrets' }],
  ['Plugin Manager: Plugins', { destination: 'Settings', section: 'Plugins' }],
  // Shortened navigation labels some pages registered on main before the rail.
  ['Agents', { destination: 'Agents', section: 'Directory' }],
  ['Messages', { destination: 'Agents', section: 'Messages' }],
  ['Memory', { destination: 'Knowledge', section: 'Memory' }],
  ['Secrets', { destination: 'Settings', section: 'Secrets' }],
])

const destinationTabs = (page: Page): Locator => page.getByRole('tablist', { name: 'Destinations', exact: true })

/**
 * Where a former left-nav page starts: its rail destination tab in the fixed layout, else its docked or native link.
 * Use it to assert navigation is available without opening the page.
 */
export const globalPanelEntryPoint = (page: Page, fixtureName: string): Locator => {
  const rail = railLocations.get(reusableViewName(fixtureName))
  const link = globalPanelLink(page, fixtureName)
  return rail === undefined ? link : destinationTabs(page).getByRole('tab', { name: rail.destination, exact: true }).or(link).first()
}

/**
 * The entry that names one page, with its glyph (and any badge the glyph draws): the rail section once its destination
 * is shown, else the docked or native link.
 */
export const globalPanelEntry = (page: Page, fixtureName: string): Locator => {
  const rail = railLocations.get(reusableViewName(fixtureName))
  const link = globalPanelLink(page, fixtureName)
  if (rail === undefined) return link
  return page
    .getByRole('navigation', { name: `${rail.destination} pages`, exact: true })
    .getByRole('button', { name: rail.section, exact: true })
    .or(link)
    .first()
}

/** Whether openGlobalPanel can reach this page right now (rail or link), without opening it. */
export const canOpenGlobalPanel = async (page: Page, fixtureName: string): Promise<boolean> =>
  (railLocations.has(reusableViewName(fixtureName)) && (await destinationTabs(page).isVisible())) || (await globalPanelLink(page, fixtureName).isVisible())

/**
 * Opens a sidebar destination as a user would: through the rail when the fixed layout shows it, else its icon when
 * the docked row shows it, otherwise the ⋮ menu, which is the only way to reach a destination the `menu` overflow mode
 * moved out of the row.
 */
export const openGlobalPanel = async (page: Page, fixtureName: string): Promise<void> => {
  const rail = railLocations.get(reusableViewName(fixtureName))
  if (rail !== undefined && (await destinationTabs(page).isVisible())) {
    await destinationTabs(page).getByRole('tab', { name: rail.destination, exact: true }).click()
    await page
      .getByRole('navigation', { name: `${rail.destination} pages`, exact: true })
      .getByRole('button', { name: rail.section, exact: true })
      .click()
    return
  }
  const link = globalPanelLink(page, fixtureName)
  const more = moreDestinationsButton(page)
  await link.or(more).first().waitFor({ state: 'visible' })
  if (await link.isVisible()) {
    await link.click()
    return
  }
  await more.click()
  await page
    .getByRole('dialog')
    .filter({ has: page.getByPlaceholder('Filter destinations…') })
    .getByRole('option', { name: reusableViewName(fixtureName), exact: true })
    .click()
}
