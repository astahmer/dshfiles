import { expect, type Locator, type Page } from '@playwright/test'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { sendMessage } from '../threads.js'

const MAIN_LAYOUT_KEY = 'dshfiles.workbench.layout.v1'
const SIDE_LAYOUT_KEY = 'dshfiles.workbench.side-panel-layout.v1'
const DOCK_LAYOUT_KEY = 'dshfiles.workbench.dock-layout.v1'
const BOTTOM_LAYOUT_KEY = 'dshfiles.workbench.bottom-layout.v1'
const JUJUTSU_PANEL_ID = 'dshfiles-jujutsu.dock'

/** The global dock lives in the frame's own right-column seat, not in a session's right sidebar. */
const dockRegion = (page: Page) => page.locator('[data-slot="shell.dock"]')

/** The bottom row is the frame's own seat too: full width below every column. */
const bottomRegion = (page: Page) => page.locator('[data-slot="shell.bottom"]')

/** The seat wrapper carries no box of its own, so a drag targets the Dockview surface it renders. */
const surfaceOf = (region: Locator) => region.locator('.dv-dockview')

/**
 * Dockview starts a tab drag from the pointer gesture itself, so the journey
 * drives real input rather than a synthetic drop: press on the tab, move in
 * steps so the drag is intercepted and every drop target sees the drag-over,
 * then release over the target.
 */
const dragTabOnto = async (page: Page, tab: Locator, target: Locator): Promise<void> => {
  const from = await tab.boundingBox()
  const to = await target.boundingBox()
  if (from === null || to === null) throw new Error(`a drag endpoint is not visible: ${JSON.stringify({ from, to })}`)
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  const steps = 12
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(start.x + ((end.x - start.x) * step) / steps, start.y + ((end.y - start.y) * step) / steps)
  }
  await page.mouse.up()
}

const layoutKeys = (page: Page): Promise<readonly (string | null)[]> =>
  page.evaluate(keys => keys.map(key => localStorage.getItem(key)), [BOTTOM_LAYOUT_KEY, DOCK_LAYOUT_KEY])

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
  const where = await page.evaluate(() =>
    [...document.querySelectorAll('[role="region"]')].map(region => ({
      name: region.getAttribute('aria-label'),
      slot: region.closest('[data-slot]')?.getAttribute('data-slot') ?? null,
    })),
  )
  const setting = await page.evaluate(() => {
    const list = document.querySelector('[role="tablist"][aria-label="Bottom panel"]')
    const selected = list?.querySelector('[aria-selected="true"], [data-state="active"]')
    return { tablist: list !== null, selected: selected?.textContent ?? null, body: document.body.innerText.match(/Bottom panel[\s\S]{0,80}/)?.[0] ?? null }
  })
  console.log('WHERE-DEBUG', JSON.stringify({ where, setting }))
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

/** The plugin's settings live behind the Plugins panel; the surface choice is one select plus Save. */
const setRightPanel = async (page: Page, label: string): Promise<void> => {
  await globalPanel(page, 'Plugins').click()
  // The panel opens on whatever page was last shown: the plugin list, or this
  // plugin's settings page already. The list virtualizes, so give the row a
  // chance to exist before deciding it is already open.
  const view = page.getByRole('button', { name: 'View @dshfiles/workbench', exact: true })
  await view.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined)
  if ((await view.count()) > 0) await view.click()
  await page.getByRole('combobox', { name: 'Right panel', exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
  await page.getByRole('combobox', { name: 'Right panel', exact: true }).selectOption({ label })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
}

When('the right column is set to the global dock in the plugin settings', async ({ page }: { page: Page }) => {
  await setRightPanel(page, 'Global dock (persistent panels in the right column)')
})

When('the right column is set back to the per-thread panel in the plugin settings', async ({ page }: { page: Page }) => {
  await setRightPanel(page, 'Per-thread (the native right sidebar)')
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

When('the Jujutsu panel is moved to the main view from the dock', async ({ page }: { page: Page }) => {
  await dockRegion(page).getByRole('button', { name: 'Move', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Move to main view', exact: true }).click()
})

Then('the main view shows the Jujutsu page and the dock no longer shows it', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-global-dock-moves-a-panel-to-the-main-view', async () => {
    await expect(page.locator('[data-slot="main"]').getByRole('heading', { name: 'Jujutsu', exact: true })).toBeVisible()
    await expect(dockRegion(page).getByRole('region', { name: 'Jujutsu', exact: true })).toHaveCount(0)
  })
})

When('the bottom panel is shown from the dock header', async ({ page }: { page: Page }) => {
  await dockRegion(page).getByRole('button', { name: 'Toggle the bottom panel', exact: true }).click()
})

Then('the bottom panel is open below the columns', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-bottom-panel-opens-under-the-columns', async () => {
    await expect(bottomRegion(page)).toBeVisible()
    await expect(bottomRegion(page).getByRole('heading', { name: 'Panel', exact: true })).toBeVisible()
    await expect(dockRegion(page).getByRole('region', { name: 'Jujutsu', exact: true })).toBeVisible()
  })
})

When('the Jujutsu panel is moved to the bottom panel', async ({ page }: { page: Page }) => {
  await dockRegion(page).getByRole('button', { name: 'Move', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Move to the bottom panel', exact: true }).click()
})


Then('the bottom panel shows the Jujutsu panel and the dock no longer does', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-panel-moves-into-the-bottom-panel', async () => {
    await expect(bottomRegion(page).getByRole('region', { name: 'Jujutsu', exact: true })).toBeVisible()
    await expect(dockRegion(page).getByRole('region', { name: 'Jujutsu', exact: true })).toHaveCount(0)
  })
})

When('the Jujutsu tab is dragged from the dock into the bottom panel', async ({ page }: { page: Page }) => {
  await dragTabOnto(page, dockRegion(page).getByRole('tab', { name: 'Jujutsu', exact: true }), surfaceOf(bottomRegion(page)))
})

Then('the bottom row shows no panel of its own', async ({ page }: { page: Page }) => {
  // A panel lives in exactly one region, so the row waits empty for one to arrive.
  await expect(bottomRegion(page).getByRole('region')).toHaveCount(0)
})

Then('the bottom row took the dragged Jujutsu panel and the dock lost it', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-drag-moves-a-panel-into-the-bottom-row', async () => {
    await expect(bottomRegion(page).getByRole('region', { name: 'Jujutsu', exact: true })).toBeVisible()
    await expect(dockRegion(page).getByRole('region', { name: 'Jujutsu', exact: true })).toHaveCount(0)
    // Each region saves its own layout, so the target holds the panel and the source no longer does.
    const [bottomLayout, dockLayout] = await layoutKeys(page)
    expect(bottomLayout ?? '').toContain(JUJUTSU_PANEL_ID)
    expect(dockLayout ?? '').not.toContain(JUJUTSU_PANEL_ID)
  })
})

When('the Jujutsu tab is dragged from the bottom panel back into the dock', async ({ page }: { page: Page }) => {
  await dragTabOnto(page, bottomRegion(page).getByRole('tab', { name: 'Jujutsu', exact: true }), surfaceOf(dockRegion(page)))
})

Then('the dock took the dragged Jujutsu panel back and the bottom row lost it', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-drag-moves-a-panel-back-into-the-dock', async () => {
    await expect(dockRegion(page).getByRole('region', { name: 'Jujutsu', exact: true })).toBeVisible()
    await expect(bottomRegion(page).getByRole('region', { name: 'Jujutsu', exact: true })).toHaveCount(0)
    const [bottomLayout, dockLayout] = await layoutKeys(page)
    expect(dockLayout ?? '').toContain(JUJUTSU_PANEL_ID)
    expect(bottomLayout ?? '').not.toContain(JUJUTSU_PANEL_ID)
  })
})

When('the bottom panel is hidden again from the dock header', async ({ page }: { page: Page }) => {
  await dockRegion(page).getByRole('button', { name: 'Hide the bottom panel', exact: true }).click()
  await expect(bottomRegion(page)).toHaveCount(0)
  await finishJourneyAssertions(page)
})

/** The Layouts dialog is one surface's own header button; its rows act on the browser store. */
const layoutsDialog = (page: Page) => page.getByRole('dialog')

When('the current layout is saved as {string}', async ({ page }: { page: Page }, name: string) => {
  await dockRegion(page).getByRole('button', { name: 'Layouts', exact: true }).click()
  await layoutsDialog(page).getByLabel('Layout name').fill(name)
  await layoutsDialog(page).getByRole('button', { name: 'Save current layout', exact: true }).click()
  await layoutsDialog(page).getByRole('button', { name: 'Done', exact: true }).click()
  await expect(layoutsDialog(page)).toHaveCount(0)
})

When('the {string} layout is applied', async ({ page }: { page: Page }, name: string) => {
  await dockRegion(page).getByRole('button', { name: 'Layouts', exact: true }).click()
  await layoutsDialog(page).getByRole('button', { name: `Apply ${name}`, exact: true }).click()
})

When('the Jujutsu panel is moved back to the right column', async ({ page }: { page: Page }) => {
  await bottomRegion(page).getByRole('button', { name: 'Move', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Move to the dock', exact: true }).click()
})

Then('the dock shows the Jujutsu panel and the bottom panel does not', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-named-layout-saves-the-arrangement', async () => {
    await expect(dockRegion(page).getByRole('region', { name: 'Jujutsu', exact: true })).toBeVisible()
    await expect(bottomRegion(page).getByRole('region', { name: 'Jujutsu', exact: true })).toHaveCount(0)
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
