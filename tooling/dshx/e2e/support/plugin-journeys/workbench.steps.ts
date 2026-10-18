import { expect, type Page } from '@playwright/test'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { sendMessage } from '../threads.js'

const MAIN_LAYOUT_KEY = 'dshfiles.workbench.layout.v1'
const SIDE_LAYOUT_KEY = 'dshfiles.workbench.side-panel-layout.v1'
const DOCK_LAYOUT_KEY = 'dshfiles.workbench.dock-layout.v1'

/** The global dock lives in the frame's own right-column seat, not in a session's right sidebar. */
const dockRegion = (page: Page) => page.locator('[data-slot="shell.dock"]')

const globalPanel = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name, exact: true })

const openWorkbench = async (page: Page): Promise<void> => {
  await globalPanel(page, 'Workbench').click()
  await expect(page.getByRole('heading', { name: 'Workbench', exact: true })).toBeVisible()
}

const regionNames = (page: Page): Promise<readonly (string | null)[]> =>
  page.getByRole('region').evaluateAll(regions => regions.map(region => region.getAttribute('aria-label')))

/**
 * The workbench header toggle is off by default, so the side panel opens the way the rail does: from its own guide page.
 * The rail is collapsed until something opens it, which is also the state a fresh journey context starts in.
 */
const openWorkbenchSidePanel = async (page: Page): Promise<void> => {
  const entry = page.locator('[data-slot="rightbar.session"] [data-slot="sidebar.right.tab.guide.entry"]').getByRole('button', { name: 'Workbench' })
  if (!(await entry.isVisible())) await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click()
  await entry.click()
}

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

When('the Editor panel is closed and the page is reloaded', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Close Editor', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Editor', exact: true })).toHaveCount(0)
  await StartupDialogs.reloadPastProviderSetup(page)
  await openWorkbench(page)
})

When('the saved Workbench layout is corrupted and the page is reloaded', async ({ page }: { page: Page }) => {
  await page.evaluate(key => localStorage.setItem(key, '{"grid":"truncated'), MAIN_LAYOUT_KEY)
  await StartupDialogs.reloadPastProviderSetup(page)
  await openWorkbench(page)
})

When('the Editor tab is selected and the editor plugin is disabled', async ({ page }: { page: Page }) => {
  // Only a saved layout keeps placeholders; the untouched default (the Editor alone) is rebuilt from what registers.
  // Closing the Editor and adding it back is the smallest change that saves the layout.
  await page.getByRole('button', { name: 'Close Editor', exact: true }).click()
  await page.getByRole('button', { name: 'Add panel', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Editor', exact: true }).click()
  await page.getByRole('tab', { name: 'Editor', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Editor', exact: true })).toBeVisible()
  await setPluginEnabled(page, '@dshfiles/editor', false)
  await openWorkbench(page)
})

When('the editor plugin is enabled again', async ({ page }: { page: Page }) => {
  await setPluginEnabled(page, '@dshfiles/editor', true)
  await openWorkbench(page)
})

When('a thread opens the Workbench side panel and closes its Editor', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await sendMessage(page, 'workbench side panel thread')
  await openWorkbenchSidePanel(page)
  await expect(page.getByRole('tab', { name: 'Workbench Close', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Editor', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close Editor', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Editor', exact: true })).toHaveCount(0)
})

Then('the default layout shows the Editor alone', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-default-layout-opens-the-editor-alone', async () => {
    await expect.poll(() => regionNames(page)).toEqual(['Editor'])
    await expect(page.getByRole('region', { name: 'Editor', exact: true }).getByRole('tab')).toHaveText(['Editor'])
    await expect(page.getByRole('region', { name: 'Scratchpad', exact: true })).toHaveCount(0)
  })
})

Then('the closed panel stays closed and can be added back', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-layout-survives-reload', () => expect.poll(() => regionNames(page)).toEqual([]))
  await page.getByRole('button', { name: 'Add panel', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Editor', exact: true }).click()
  await recordAssertion(page, 'workbench-add-panel-restores-the-closed-panel', () =>
    expect(page.getByRole('region', { name: 'Editor', exact: true })).toBeVisible(),
  )
  await page.getByRole('button', { name: 'Close Editor', exact: true }).click()
  await page.getByRole('button', { name: 'Reset layout', exact: true }).click()
  await recordAssertion(page, 'workbench-reset-restores-the-default-layout', () => expect.poll(() => regionNames(page)).toEqual(['Editor']))
})

Then('the Workbench falls back to its default layout', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-malformed-layout-falls-back-to-default', () => expect.poll(() => regionNames(page)).toEqual(['Editor']))
  await finishJourneyAssertions(page)
})

Then('the Editor tab stays as a closable placeholder', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-missing-plugin-keeps-a-placeholder', async () => {
    await expect(page.getByRole('tab', { name: 'Editor', exact: true })).toBeVisible()
    await expect(
      page.getByText('“dshfiles-editor.main” is not available. Its plugin may be disabled or removed; it comes back here once it registers again.', {
        exact: true,
      }),
    ).toBeVisible()
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

When('the right column is set to the global dock in the plugin settings', async ({ page }: { page: Page }) => {
  await globalPanel(page, 'Plugins').click()
  await page.getByRole('button', { name: 'View @dshfiles/workbench', exact: true }).click()
  await page.getByRole('combobox', { name: 'Right panel', exact: true }).selectOption({ label: 'Global dock (persistent panels in the right column)' })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
})

When('a thread is started and the New Session screen opens again', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await sendMessage(page, 'dock thread one')
  // Back to the screen with no thread on it: the dock must not depend on a session at all.
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await expect(page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })).toBeVisible()
})

When('the global dock page is reloaded outside any thread', async ({ page }: { page: Page }) => {
  await StartupDialogs.reloadPastProviderSetup(page)
  await expect(page.getByRole('heading', { name: 'Panels', exact: true })).toBeVisible()
})

Then('the global dock shows the Jujutsu panel', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-global-dock-opens-its-default-panel', async () => {
    await expect(page.getByRole('heading', { name: 'Panels', exact: true })).toBeVisible()
    await expect(dockRegion(page).getByRole('region', { name: 'Jujutsu', exact: true })).toBeVisible()
  })
})

Then('the global dock still shows the Jujutsu panel outside a thread', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-global-dock-outlives-the-thread-view', async () => {
    await expect(dockRegion(page).getByRole('region', { name: 'Jujutsu', exact: true })).toBeVisible()
  })
})

Then('the global dock still shows the Jujutsu panel after a reload', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-global-dock-survives-a-reload', async () => {
    await expect(dockRegion(page).getByRole('region', { name: 'Jujutsu', exact: true })).toBeVisible()
    // The surface saves the layout it restored or applied, so the dock's own key holds the panel it shows.
    expect(await page.evaluate(key => localStorage.getItem(key) ?? '', DOCK_LAYOUT_KEY)).toContain('dshfiles-jujutsu.dock')
  })
})

Then('the main Workbench keeps its own layout', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-side-panel-layout-is-stored-apart', async () => {
    const [main, side] = await page.evaluate(keys => keys.map(key => localStorage.getItem(key) ?? ''), [MAIN_LAYOUT_KEY, SIDE_LAYOUT_KEY])
    expect(side).not.toContain('"dshfiles-editor.main"')
    expect(main ?? '').not.toContain('"dshfiles-editor.main"')
  })
  await openWorkbench(page)
  await recordAssertion(page, 'workbench-main-layout-unaffected-by-side-panel', () => expect.poll(() => regionNames(page)).toEqual(['Editor']))
  await finishJourneyAssertions(page)
})
