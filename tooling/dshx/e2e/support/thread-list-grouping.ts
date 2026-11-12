import { expect, type Locator, type Page } from '@playwright/test'
import { StartupDialogs } from '../../packages/dshx/src/project/startup-dialogs.js'
import { ThreadListFilter } from './thread-list-filter.js'

const threadsRegion = (page: Page): Locator => page.getByRole('region', { name: 'Threads', exact: true })

/** Free docking keeps the older Dockview sidebar: its `Sidebar navigation` header, header/footer More menus and panels. */
const sidebarNavigation = (page: Page): Locator => page.getByRole('navigation', { name: 'Sidebar navigation', exact: true })

/**
 * All threads ships grouped by status (Needs you, Working, Ready, Idle, Done; docs/ade-ux §4.3). A journey that asserts
 * the older Active, Parked, Pinned, Settled or Archived section headers picks those drag-to-arrange sections first,
 * through the Group menu, as a user would. Idempotent: a list already arranged manually is left alone.
 */
const arrangeManually = async (page: Page, scope: Locator = threadsRegion(page)): Promise<void> => {
  // The rail may sit on another destination (Settings after an account setup); the list lives under Threads.
  const railThreads = page.getByRole('tab', { name: 'Threads', exact: true })
  if ((await railThreads.count()) > 0 && (await railThreads.first().getAttribute('aria-selected')) !== 'true') await railThreads.first().click()
  // The Group submenu of the list's Filter menu (productivity pass Q5); its trigger names the current grouping.
  await ThreadListFilter.selectGroup(page, scope, 'Arrange manually')
  await ThreadListFilter.expectGroup(page, scope, 'Arrange manually')
}

/**
 * A journey about the inline status verb needs the shipping status grouping: the verb exists only there, because the
 * manual sections keep the older rows. Arranged manually earlier in the same journey, this goes back through the Group
 * menu as a user would.
 */
const groupByStatus = async (page: Page, scope: Locator = threadsRegion(page)): Promise<void> => {
  const railThreads = page.getByRole('tab', { name: 'Threads', exact: true })
  if ((await railThreads.count()) > 0 && (await railThreads.first().getAttribute('aria-selected')) !== 'true') await railThreads.first().click()
  await ThreadListFilter.selectGroup(page, scope, 'Status')
  await ThreadListFilter.expectGroup(page, scope, 'Status')
}

/**
 * The sidebar's New thread button, wherever the layout seats it: the header row beside the history arrows (fixed
 * layout, expanded), the top of the rail (fixed layout, collapsed) or the `Sidebar navigation` header (free docking).
 * Only one of them is visible at a time.
 */
const newThreadButton = (page: Page): Locator => page.getByRole('button', { name: 'New thread', exact: true }).filter({ visible: true }).first()

/** The Workbench's left layout and its once-per-browser merge marker (b:952m), as `@dshfiles/workbench` stores them. */
const LEFT_LAYOUT_KEY = 'dshfiles.workbench.left-layout.v1'
const SHELL_MERGE_KEY = 'dshfiles.workbench.shell-merge.v1'
/** Workbench seats the account Preview once in a docked sidebar; the default Sidebar pane completes that marker. */
const PREVIEW_SEATED_KEY = 'dshfiles.workbench.sidebar-preview-docked.v1'
const NAVIGATION_PANE = 'dshfiles-thread-sidebar.workbench-navigation'
const THREADS_PANE = 'dshfiles-thread-sidebar.workbench-threads'

/**
 * The left region as a former Free docking user kept it: Navigation above Threads, two tab-controlled groups. The
 * merge (b:952m) keeps exactly this layout for that user, so a journey about the docked panes starts from it.
 */
const formerDockingLeftLayout = JSON.stringify({
  grid: {
    root: {
      type: 'branch',
      data: [
        { type: 'leaf', data: { views: [NAVIGATION_PANE], activeView: NAVIGATION_PANE, id: '1' }, size: 160 },
        { type: 'leaf', data: { views: [THREADS_PANE], activeView: THREADS_PANE, id: '2' }, size: 640 },
      ],
      size: 280,
    },
    width: 280,
    height: 800,
    orientation: 'VERTICAL',
  },
  panels: {
    [NAVIGATION_PANE]: { id: NAVIGATION_PANE, contentComponent: 'workbench-panel', title: 'Navigation' },
    [THREADS_PANE]: { id: THREADS_PANE, contentComponent: 'workbench-panel', title: 'Threads' },
  },
  activeGroup: '2',
})

/**
 * One sidebar layout (b:952m): Fixed and Free docking are one docking region whose default is the rail and list as one
 * Sidebar pane. A journey about the docked sidebar panes (Navigation's header destinations, its More menus, the
 * Workbench Threads panel) starts from the arrangement a former Free docking user keeps: Navigation above Threads in the
 * left region. It is seeded as the stored left layout, with the merge already applied in this browser, and the page
 * reloads. Idempotent: a page already showing the Navigation and Threads panes is left alone; a composition without
 * the Workbench has no docked panes and keeps the rail.
 */
const useFreeDocking = async (page: Page): Promise<void> => {
  const rail = page.getByRole('navigation', { name: 'Destinations', exact: true })
  // Right after boot the shell may not have drawn the rail yet: wait briefly before concluding the page has none.
  await rail
    .first()
    .waitFor({ state: 'attached', timeout: 5_000 })
    .catch(() => undefined)
  const panes = page.locator(`[data-workbench-panel-id="${NAVIGATION_PANE}"], [data-workbench-panel-id="${THREADS_PANE}"]`)
  if ((await panes.count()) >= 2) return
  if ((await page.locator('[data-workbench-region="left"]').count()) === 0) return
  await page.evaluate(
    ([layoutKey, mergeKey, previewKey, layout]) => {
      localStorage.setItem(layoutKey ?? '', layout ?? '')
      localStorage.setItem(mergeKey ?? '', 'true')
      // A browser that docked before the merge had the Preview seated on its first docked load, as here.
      localStorage.removeItem(previewKey ?? '')
    },
    [LEFT_LAYOUT_KEY, SHELL_MERGE_KEY, PREVIEW_SEATED_KEY, formerDockingLeftLayout],
  )
  await StartupDialogs.reloadPastProviderSetup(page)
  await expect(page.locator(`[data-workbench-panel-id="${THREADS_PANE}"]`).first()).toBeAttached()
  // The rail lives in the Sidebar pane, which that arrangement does not hold.
  await expect(rail).toHaveCount(0)
  // The merge also kept the row under the list on for that user (showFooter): its Settings launcher and More menu.
  await ThreadListFilter.openSidebarSettings(page)
  const customize = page.getByRole('region', { name: 'Customize sidebar', exact: true })
  const footer = customize.getByRole('checkbox', { name: 'Show the row under the list', exact: true })
  if (!(await footer.isChecked())) await footer.click()
  await expect(footer).toBeChecked()
  await customize.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(customize).toHaveCount(0)
}

export class ThreadSidebarJourney {
  static readonly arrangeManually = arrangeManually
  static readonly groupByStatus = groupByStatus
  static readonly newThreadButton = newThreadButton
  static readonly useFreeDocking = useFreeDocking
  static readonly sidebarNavigation = sidebarNavigation
}
