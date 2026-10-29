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
