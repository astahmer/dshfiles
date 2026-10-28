import { expect, test, type Locator, type Page } from '@playwright/test'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'
import { Then, When } from '../bdd.js'
import { recordAssertion, finishJourneyAssertions } from '../steps.js'

const THREADS = 'Thread Sidebar: Threads'
const ID = 'dshfiles-thread-sidebar.workbench-threads'
const panel = (page: Page): Locator => page.locator(`[data-workbench-panel-id=${JSON.stringify(ID)}]`)
const gear = (page: Page): Locator => panel(page).getByRole('button', { name: 'Sidebar settings', exact: true })
const editor = (page: Page): Locator => panel(page).getByRole('region', { name: 'Customize sidebar', exact: true })
const left = (page: Page): Locator => page.locator('[data-workbench-region="left"]').first()
const right = (page: Page): Locator => page.locator('[data-workbench-region="right"]').first()
const openSettings = async (page: Page): Promise<void> => {
  await gear(page).click()
  await expect(editor(page)).toBeVisible()
  expect(await editor(page).evaluate(element => element.closest('[data-workbench-panel-id]')?.getAttribute('data-workbench-panel-id'))).toBe(ID)
}

Then('the sidebar settings gear belongs to the Threads panel instead of fixed chrome', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-sidebar-panel-gear-authority', async () => {
    await expect(gear(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sidebar settings', exact: true })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Customize sidebar', exact: true })).toHaveCount(0)
    await expect(gear(page).locator('svg.lucide-settings')).toHaveCount(1)
    expect(await gear(page).evaluate(element => element.closest('[data-sidebar-workbench-source]')?.getAttribute('data-sidebar-workbench-source'))).toBe(ID)
  })
})
When('the panel gear changes and saves the Search threads visibility preference', async ({ page }: { page: Page }) => {
  await openSettings(page)
  // Exercise narrow screens in the default left seat. The existing frame does
  // not expose its right column at mobile widths; moved-right ownership is
  // checked separately at the normal desktop size below.
  for (const width of [360, 480, 768, 1024]) {
    await editor(page).getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await page.setViewportSize({ width, height: 900 })
    // The native mobile frame collapses its sidebar on resize. Reopen it as a
    // user would rather than treating a hidden column as a failed settings UI.
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
    await openSettings(page)
    await expect
      .poll(() =>
        editor(page).evaluate(element => {
          const bounds = element.getBoundingClientRect()
          return bounds.left >= -1 && bounds.right <= window.innerWidth + 1
        }),
      )
      .toBe(true)
  }
  await page.setViewportSize({ width: 1280, height: 800 })
  const visible = editor(page).getByRole('checkbox', { name: 'Show item: Search threads', exact: true })
  await expect(visible).toBeChecked()
  await visible.click()
  await expect(visible).not.toBeChecked()
  await editor(page).getByRole('button', { name: 'Done', exact: true }).click()
  await expect(editor(page)).toHaveCount(0)
  await expect(panel(page).getByRole('button', { name: 'Search threads', exact: true })).toHaveCount(0)
})
Then('that same sidebar preference survives reload and can be restored through the gear', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-sidebar-panel-settings-original-preference', async () => {
    await StartupDialogs.reloadPastProviderSetup(page)
    await expect(gear(page)).toBeVisible()
    await expect(panel(page).getByRole('button', { name: 'Search threads', exact: true })).toHaveCount(0)
    await openSettings(page)
    const visible = editor(page).getByRole('checkbox', { name: 'Show item: Search threads', exact: true })
    await expect(visible).not.toBeChecked()
    await visible.click()
    await expect(visible).toBeChecked()
    await editor(page).getByRole('button', { name: 'Done', exact: true }).click()
    await expect(panel(page).getByRole('button', { name: 'Search threads', exact: true })).toBeVisible()
  })
})
When('the Threads panel is moved right and its tab row is hidden', async ({ page }: { page: Page }) => {
  await page.locator('[data-workbench-region="main"]').getByRole('button', { name: 'Pane options', exact: true }).first().click()
  await page.getByRole('menuitem', { name: 'Open right pane', exact: true }).click()
  const source = left(page).getByRole('tab', { name: THREADS, exact: true })
  const destination = right(page).locator('[data-workbench-surface]').first()
  const from = await source.boundingBox()
  const to = await destination.boundingBox()
  if (from === null || to === null) throw new Error('Moved sidebar view has no real drag endpoint')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 14, from.y + from.height / 2, { steps: 3 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 24 })
  await page.mouse.up()
  await expect(right(page).getByRole('tab', { name: THREADS, exact: true })).toBeVisible()
  await right(page).getByRole('tab', { name: 'New tab', exact: true }).getByRole('button', { name: 'Close New tab', exact: true }).click()
  await right(page).getByRole('tab', { name: THREADS, exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Hide tab row', exact: true }).click()
  await expect(right(page).getByRole('tab', { name: THREADS, exact: true })).toHaveCount(0)
  await expect(gear(page)).toBeVisible()
})
Then('its settings editor stays inside that panel even with the left sidebar collapsed', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-sidebar-panel-settings-follow-view-not-shell', async () => {
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await expect(left(page)).toBeHidden()
    await openSettings(page)
    await expect(left(page)).toBeHidden()
    await expect(right(page)).toBeVisible()
    const pane = await panel(page).boundingBox()
    const settings = await editor(page).boundingBox()
    if (pane === null || settings === null) throw new Error('Settings editor is not visible within its moved owner')
    expect(settings.x).toBeGreaterThanOrEqual(pane.x - 1)
    expect(settings.y).toBeGreaterThanOrEqual(pane.y - 1)
    expect(settings.x + settings.width).toBeLessThanOrEqual(pane.x + pane.width + 1)
    expect(settings.y + settings.height).toBeLessThanOrEqual(pane.y + pane.height + 1)
    await expect(page.getByRole('region', { name: 'Customize sidebar', exact: true })).toHaveCount(1)
    await page.screenshot({ path: test.info().outputPath('panel-owned-sidebar-settings.png'), animations: 'disabled' })
    await editor(page).getByRole('button', { name: 'Done', exact: true }).click()
    await expect(editor(page)).toHaveCount(0)
    await expect(gear(page)).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
