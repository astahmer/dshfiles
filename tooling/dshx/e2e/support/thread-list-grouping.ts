import { expect, type Locator, type Page } from '@playwright/test'

const threadsRegion = (page: Page): Locator => page.getByRole('region', { name: 'Threads', exact: true })

/** Free docking keeps the older Dockview sidebar: its `Sidebar navigation` header, header/footer More menus and panels. */
const sidebarNavigation = (page: Page): Locator => page.getByRole('navigation', { name: 'Sidebar navigation', exact: true })

/**
 * All threads ships grouped by status (Needs you, Working, Ready, Idle, Done; plans/ade-ux §4.3). A journey that asserts
 * the older Active, Parked, Pinned, Settled or Archived section headers picks those drag-to-arrange sections first,
 * through the Group menu, as a user would. Idempotent: a list already arranged manually is left alone.
 */
const arrangeManually = async (page: Page, scope: Locator = threadsRegion(page)): Promise<void> => {
  // The rail may sit on another destination (Settings after an account setup); the list lives under Threads.
  const railThreads = page.getByRole('tab', { name: 'Threads', exact: true })
  if ((await railThreads.count()) > 0 && (await railThreads.first().getAttribute('aria-selected')) !== 'true') await railThreads.first().click()
  const manual = scope.getByRole('button', { name: 'Group: Arrange manually', exact: true })
  if ((await manual.count()) === 0) {
    await scope.getByRole('button', { name: /^Group: /u }).first().click()
    await page.getByRole('menuitemradio', { name: 'Arrange manually', exact: true }).click()
  }
  await expect(manual).toBeVisible()
}

/**
 * The sidebar's New thread button, wherever the layout seats it: the header row beside the history arrows (fixed
 * layout, expanded), the top of the rail (fixed layout, collapsed) or the `Sidebar navigation` header (free docking).
 * Only one of them is visible at a time.
 */
const newThreadButton = (page: Page): Locator => page.getByRole('button', { name: 'New thread', exact: true }).filter({ visible: true }).first()

/**
 * The fixed rail layout is the default (plans/ade-ux §4.1). A journey about the older Dockview sidebar — its header
 * destinations, header and footer More menus, overflow modes, Workbench Threads panel — switches to Settings › Layout ›
 * Free docking first, as a user would. Idempotent: a page already docking is left alone.
 */
const useFreeDocking = async (page: Page): Promise<void> => {
  const rail = page.getByRole('navigation', { name: 'Destinations', exact: true })
  if ((await rail.count()) === 0) return
  await rail.getByRole('tab', { name: 'Settings', exact: true }).click()
  await page.getByRole('radiogroup', { name: 'Layout', exact: true }).getByRole('radio', { name: 'Free docking', exact: true }).click()
  // Free docking drops the rail; its header is `Sidebar navigation` or, in a Workbench profile, a Navigation panel.
  await expect(rail).toHaveCount(0)
}

export class ThreadSidebarJourney {
  static readonly arrangeManually = arrangeManually
  static readonly newThreadButton = newThreadButton
  static readonly useFreeDocking = useFreeDocking
  static readonly sidebarNavigation = sidebarNavigation
}
