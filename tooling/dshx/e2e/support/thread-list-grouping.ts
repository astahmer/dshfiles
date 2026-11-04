import { expect, type Locator, type Page } from '@playwright/test'

const threadsRegion = (page: Page): Locator => page.getByRole('region', { name: 'Threads', exact: true })

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

export class ThreadSidebarJourney {
  static readonly arrangeManually = arrangeManually
}
