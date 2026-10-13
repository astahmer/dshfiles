import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { sendMessage } from '../threads.js'

const MAIN_LAYOUT_KEY = 'dshfiles.workbench.layout.v1'
const SIDE_LAYOUT_KEY = 'dshfiles.workbench.side-panel-layout.v1'

const globalPanel = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name, exact: true })

const openWorkbench = async (page: Page): Promise<void> => {
  await globalPanel(page, 'Workbench').click()
  await expect(page.getByRole('heading', { name: 'Workbench', exact: true })).toBeVisible()
}

const regionNames = (page: Page): Promise<readonly (string | null)[]> =>
  page.getByRole('region').evaluateAll(regions => regions.map(region => region.getAttribute('aria-label')))

const setPluginEnabled = async (page: Page, packageId: string, enabled: boolean): Promise<void> => {
  await globalPanel(page, 'Plugins').click()
  const toggle = page.getByRole('switch', { name: `Enable ${packageId}`, exact: true })
  await toggle.click()
  if (enabled) await expect(toggle).toBeChecked()
  else await expect(toggle).not.toBeChecked()
}

When('the Workbench is opened', async ({ page }: { page: Page }) => {
  await openWorkbench(page)
})

When('the Ticker panel is closed and the page is reloaded', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Close Ticker', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Ticker', exact: true })).toHaveCount(0)
  await page.reload()
  await openWorkbench(page)
})

When('the saved Workbench layout is corrupted and the page is reloaded', async ({ page }: { page: Page }) => {
  await page.evaluate(key => localStorage.setItem(key, '{"grid":"truncated'), MAIN_LAYOUT_KEY)
  await page.reload()
  await openWorkbench(page)
})

When('the Editor tab is selected and the editor plugin is disabled', async ({ page }: { page: Page }) => {
  await page.getByRole('tab', { name: 'Editor', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Editor', exact: true })).toBeVisible()
  await setPluginEnabled(page, '@dshfiles/editor', false)
  await openWorkbench(page)
})

When('the editor plugin is enabled again', async ({ page }: { page: Page }) => {
  await setPluginEnabled(page, '@dshfiles/editor', true)
  await openWorkbench(page)
})

When('a thread opens the Workbench side panel and closes its Ticker', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await sendMessage(page, 'workbench side panel thread')
  await page.getByRole('button', { name: 'Toggle the workbench side panel', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Workbench Close', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Ticker', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close Ticker', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Ticker', exact: true })).toHaveCount(0)
})

Then('the default layout shows the first two panels side by side', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-default-layout-splits-the-first-two-panels', async () => {
    await expect.poll(() => regionNames(page)).toEqual(['Scratchpad', 'Ticker'])
    await expect(page.getByRole('region', { name: 'Scratchpad', exact: true }).getByRole('tab')).toHaveText(['Scratchpad', 'Editor', 'Explorer'])
  })
})

Then('the closed panel stays closed and can be added back', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-layout-survives-reload', () => expect.poll(() => regionNames(page)).toEqual(['Scratchpad']))
  await page.getByRole('button', { name: 'Add panel', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Ticker', exact: true }).click()
  await recordAssertion(page, 'workbench-add-panel-restores-the-closed-panel', () => expect(page.getByRole('region', { name: 'Ticker', exact: true })).toBeVisible())
  await page.getByRole('button', { name: 'Close Ticker', exact: true }).click()
  await page.getByRole('button', { name: 'Reset layout', exact: true }).click()
  await recordAssertion(page, 'workbench-reset-restores-the-default-layout', () => expect.poll(() => regionNames(page)).toEqual(['Scratchpad', 'Ticker']))
})

Then('the Workbench falls back to its default layout', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-malformed-layout-falls-back-to-default', () => expect.poll(() => regionNames(page)).toEqual(['Scratchpad', 'Ticker']))
  await finishJourneyAssertions(page)
})

Then('the Editor tab stays as a closable placeholder', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-missing-plugin-keeps-a-placeholder', async () => {
    await expect(page.getByRole('tab', { name: 'Editor', exact: true })).toBeVisible()
    await expect(page.getByText('“dshfiles-editor.main” is not available. Its plugin may be disabled or removed; it comes back here once it registers again.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Close panel', exact: true })).toBeVisible()
  })
})

Then('the Editor tab shows the editor again', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-placeholder-recovers-on-registration', async () => {
    await page.getByRole('tab', { name: 'Editor', exact: true }).click()
    await expect(page.getByText('Open a session to browse and edit its files.', { exact: true })).toBeVisible()
    await expect(page.getByText(/is not available\. Its plugin may be disabled/)).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

Then('the main Workbench keeps its own layout', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-side-panel-layout-is-stored-apart', async () => {
    const [main, side] = await page.evaluate(keys => keys.map(key => localStorage.getItem(key) ?? ''), [MAIN_LAYOUT_KEY, SIDE_LAYOUT_KEY])
    expect(side).toContain('"dshfiles-workbench.scratchpad"')
    expect(side).not.toContain('"dshfiles-workbench.ticker"')
    expect(main ?? '').not.toContain('"dshfiles-workbench.ticker"')
  })
  await openWorkbench(page)
  await recordAssertion(page, 'workbench-main-layout-unaffected-by-side-panel', () => expect.poll(() => regionNames(page)).toEqual(['Scratchpad', 'Ticker']))
  await finishJourneyAssertions(page)
})
