import { expect, test, type ConsoleMessage, type ElementHandle, type Locator, type Page } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { tabPanelId } from '../../../../../plugins/@dshfiles/workbench/src/tab-panels.js'
import { OPEN_THREAD_IN_MAIN_TAB_EVENT } from '../../../../../plugins/@dshfiles/thread-sidebar/src/main-tab-request.js'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'
import { After, Given, Then, When } from '../bdd.js'
import { openGlobalPanel, reusableViewName } from '../plugin-view-names.js'
import { bootComposedPluginProfile } from '../boot.js'
import { finishJourneyAssertions, openSettingsDialog, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, selectModelForNewThread, sendMessage } from '../threads.js'

const MAIN_LAYOUT_KEY = 'dshfiles.workbench.layout.v1'
const DOCK_LAYOUT_KEY = 'dshfiles.workbench.dock-layout.v1'
const BOTTOM_LAYOUT_KEY = 'dshfiles.workbench.bottom-layout.v1'
const JUJUTSU_PANEL_ID = 'dshfiles-jujutsu.dock'
/** The global dock lives in the frame's own right-column seat, not in a session's right sidebar. */
const dockRegion = (page: Page) => page.locator('[data-slot="shell.dock"]')

/** The bottom row ends at the right pane's left edge: only left plus centre. */
const bottomRegion = (page: Page) => page.locator('[data-slot="shell.bottom"]')

/** The seat wrapper carries no box of its own, so a drag targets the Dockview surface it renders. */
const surfaceOf = (region: Locator) => region.locator('.dv-dockview')

/**
 * Dockview starts a tab drag from the pointer gesture itself, so the journey
 * drives real input rather than a synthetic drop: press on the tab, move in
 * steps so the drag is intercepted and every drop target sees the drag-over,
 * then release over the target.
 */
const dragTabOnto = async (
  page: Page,
  tab: Locator,
  target: Locator,
  position: { readonly x: number; readonly y: number } = { x: 0.5, y: 0.5 },
): Promise<void> => {
  const from = await tab.boundingBox()
  const to = await target.boundingBox()
  if (from === null || to === null) throw new Error(`a drag endpoint is not visible: ${JSON.stringify({ from, to })}`)
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const end = { x: to.x + to.width * position.x, y: to.y + to.height * position.y }
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

const openWorkbench = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-main-surface="workbench"]')).toBeVisible()
  await expect(mainDock(page)).toBeVisible()
}

const setPluginEnabled = async (page: Page, packageId: string, enabled: boolean): Promise<void> => {
  await openGlobalPanel(page, 'Plugins')
  const toggle = page.getByRole('switch', { name: `Enable ${packageId}`, exact: true })
  await toggle.click()
  if (enabled) await expect(toggle).toBeChecked()
  else await expect(toggle).not.toBeChecked()
}

When('the Workbench is opened', async ({ page }: { page: Page }) => {
  await openWorkbench(page)
})

When('the Editor panel is closed and the page is reloaded', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: `Close ${reusableViewName('Editor')}`, exact: true }).click()
  await expect(page.getByRole('region', { name: reusableViewName('Editor'), exact: true })).toHaveCount(0)
  await StartupDialogs.reloadPastProviderSetup(page)
  await openWorkbench(page)
})

When('the saved Workbench layout is corrupted and the page is reloaded', async ({ page }: { page: Page }) => {
  await page.evaluate(key => localStorage.setItem(key, '{"grid":"truncated'), MAIN_LAYOUT_KEY)
  await StartupDialogs.reloadPastProviderSetup(page)
  await openWorkbench(page)
})

When('the Editor tab is selected and the editor plugin is disabled', async ({ page }: { page: Page }) => {
  // Selecting the chooser card saved this layout, so disabling its owner must preserve the panel identity.
  await dockTab(mainDock(page), 'Editor').click()
  await expect(mainSeat(page).getByRole('region', { name: reusableViewName('Editor'), exact: true })).toBeVisible()
  await setPluginEnabled(page, '@dshfiles/editor', false)
  await dockTab(mainDock(page), 'Editor').click()
})

When('the editor plugin is enabled again', async ({ page }: { page: Page }) => {
  await setPluginEnabled(page, '@dshfiles/editor', true)
  await openWorkbench(page)
})

When('the right pane closes its Jujutsu panel', async ({ page }: { page: Page }) => {
  await setRightPaneVisible(page, true)
  await addRegisteredPanel(page, paneRoot(page, 'right'), 'Jujutsu')
  await dockTab(dockRegion(page), 'Jujutsu')
    .getByRole('button', { name: `Close ${reusableViewName('Jujutsu')}`, exact: true })
    .click()
  await expect(dockTab(dockRegion(page), 'Jujutsu')).toHaveCount(0)
})

Then('the default layout shows the Conversation', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-default-layout-opens-the-conversation', async () => {
    await expect(nativeConversationTab(page)).toBeVisible()
    await expect(dockTab(mainDock(page), 'Editor')).toHaveCount(0)
    await expect(page.locator('[data-main-surface="native"]')).toHaveCount(0)
  })
})

Then('the closed panel stays closed and can be added back', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-layout-survives-reload', async () => {
    await expect(dockTab(mainDock(page), 'Editor')).toHaveCount(0)
    await expect(nativeConversationTab(page)).toBeVisible()
  })
  await addRegisteredPanel(page, mainPane(page), 'Editor')
  await recordAssertion(page, 'workbench-add-panel-restores-the-closed-panel', () =>
    expect(mainSeat(page).getByRole('region', { name: reusableViewName('Editor'), exact: true })).toBeVisible(),
  )
  await paneAction(page, mainPane(page), 'Reset layout')
  await recordAssertion(page, 'workbench-reset-restores-the-default-layout', async () => {
    await expect(nativeConversationTab(page)).toHaveAttribute('aria-selected', 'true')
    await expect(dockTab(mainDock(page), 'Editor')).toHaveCount(0)
  })
})

Then('the Workbench falls back to its default layout', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-malformed-layout-falls-back-to-default', async () => {
    await expect(nativeConversationTab(page)).toBeVisible()
    await expect(dockTab(mainDock(page), 'Editor')).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

Then('the Editor tab stays as a closable placeholder', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-missing-plugin-keeps-a-placeholder', async () => {
    await expect(page.getByRole('tab', { name: reusableViewName('Editor'), exact: true })).toBeVisible()
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
    await page.getByRole('tab', { name: reusableViewName('Editor'), exact: true }).click()
    await expect(page.getByText('Open a session to browse and edit its files.', { exact: true })).toBeVisible()
    await expect(page.getByText(/is not available\. Its plugin may be disabled/)).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

/** Opening belongs to the main pane's menu; closing belongs to the right pane itself. */
const setRightPaneVisible = async (page: Page, shown: boolean): Promise<void> => {
  const surface = surfaceOf(dockRegion(page))
  if (shown && !(await surface.isVisible())) await paneAction(page, mainPane(page), 'Open right pane')
  if (!shown && (await surface.isVisible())) await paneRoot(page, 'right').getByRole('button', { name: 'Close pane', exact: true }).first().click()
  if (shown) await expect(surface).toBeVisible()
  else await expect(surface).toBeHidden()
}

When('the right pane is opened from the main Pane options', async ({ page }: { page: Page }) => {
  await setRightPaneVisible(page, true)
  // Unified panes start empty on the right. Place the test panel through the real picker.
  if ((await dockTab(dockRegion(page), 'Jujutsu').count()) === 0) await addRegisteredPanel(page, paneRoot(page, 'right'), 'Jujutsu')
})

When('the right pane is closed with its own Close pane control', async ({ page }: { page: Page }) => {
  await setRightPaneVisible(page, false)
})

When('a thread is started and the New Session screen opens again', async ({ page }: { page: Page }) => {
  await createWorkbenchWorkspace(page)
  await sendMessage(page, 'dock thread one')
  // Back to the screen with no thread on it: the dock must not depend on a session at all.
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await expect(page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })).toBeVisible()
})

When('the global dock page is reloaded outside any thread', async ({ page }: { page: Page }) => {
  await StartupDialogs.reloadPastProviderSetup(page)
  await expect(paneRoot(page, 'right').getByRole('button', { name: 'Pane options', exact: true })).toBeVisible()
})

Then('the global dock shows the Jujutsu panel', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-global-dock-opens-the-selected-panel', async () => {
    await expect(paneRoot(page, 'right').getByRole('button', { name: 'Pane options', exact: true })).toBeVisible()
    await expect(dockRegion(page).getByRole('region', { name: reusableViewName('Jujutsu'), exact: true })).toBeVisible()
  })
})

Then('the global dock still shows the Jujutsu panel outside a thread', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-global-dock-outlives-the-thread-view', async () => {
    await expect(dockRegion(page).getByRole('region', { name: reusableViewName('Jujutsu'), exact: true })).toBeVisible()
  })
})

Then('the global dock still shows the Jujutsu panel after a reload', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-global-dock-survives-a-reload', async () => {
    await expect(dockRegion(page).getByRole('region', { name: reusableViewName('Jujutsu'), exact: true })).toBeVisible()
    // The surface saves the layout it restored or applied, so the dock's own key holds the panel it shows.
    expect(await page.evaluate(key => localStorage.getItem(key) ?? '', DOCK_LAYOUT_KEY)).toContain('dshfiles-jujutsu.dock')
  })
})

When('the Jujutsu panel is moved to the main view from the dock', async ({ page }: { page: Page }) => {
  await movePanel(page, paneRoot(page, 'right'), 'Move to main view')
})

Then('the main view shows the Jujutsu page and the dock no longer shows it', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-global-dock-moves-a-panel-to-the-main-view', async () => {
    await expect(mainSeat(page).getByRole('region', { name: reusableViewName('Jujutsu'), exact: true })).toBeVisible()
    await expect(dockRegion(page).getByRole('region', { name: reusableViewName('Jujutsu'), exact: true })).toHaveCount(0)
  })
})

When('the bottom panel is shown from Pane options', async ({ page }: { page: Page }) => {
  await paneAction(page, mainPane(page), 'Toggle the bottom panel')
})

Then('the bottom panel is open below the columns', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-bottom-panel-opens-under-the-columns', async () => {
    await expect(bottomRegion(page)).toBeVisible()
    await expect(dockTab(bottomRegion(page), 'New tab')).toBeVisible()
    await expect(chooserIn(bottomRegion(page))).toBeVisible()
    await expect(dockRegion(page).getByRole('region', { name: reusableViewName('Jujutsu'), exact: true })).toBeVisible()
  })
})

When('the Jujutsu panel is moved to the bottom panel', async ({ page }: { page: Page }) => {
  await movePanel(page, paneRoot(page, 'right'), 'Move to the bottom panel')
})

Then('the bottom panel shows the Jujutsu panel and the dock no longer does', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-panel-moves-into-the-bottom-panel', async () => {
    await expect(bottomRegion(page).getByRole('region', { name: reusableViewName('Jujutsu'), exact: true })).toBeVisible()
    await expect(dockRegion(page).getByRole('region', { name: reusableViewName('Jujutsu'), exact: true })).toHaveCount(0)
  })
})

When('the Jujutsu tab is dragged from the dock into the bottom panel', async ({ page }: { page: Page }) => {
  await dragTabOnto(page, dockRegion(page).getByRole('tab', { name: reusableViewName('Jujutsu'), exact: true }), surfaceOf(bottomRegion(page)))
})

Then('the bottom row starts with its own chooser tab', async ({ page }: { page: Page }) => {
  // Empty regions show a real chooser tab while waiting for a registered view.
  await expect(dockTab(bottomRegion(page), 'New tab')).toBeVisible()
  await expect(chooserIn(bottomRegion(page))).toBeVisible()
  await expect(dockTab(bottomRegion(page), 'Jujutsu')).toHaveCount(0)
})

Then('the bottom row took the dragged Jujutsu panel and the dock lost it', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-drag-moves-a-panel-into-the-bottom-row', async () => {
    await expect(bottomRegion(page).getByRole('region', { name: reusableViewName('Jujutsu'), exact: true })).toBeVisible()
    await expect(dockRegion(page).getByRole('region', { name: reusableViewName('Jujutsu'), exact: true })).toHaveCount(0)
    // Each region saves its own layout, so the target holds the panel and the source no longer does.
    const [bottomLayout, dockLayout] = await layoutKeys(page)
    expect(bottomLayout ?? '').toContain(JUJUTSU_PANEL_ID)
    expect(dockLayout ?? '').not.toContain(JUJUTSU_PANEL_ID)
  })
})

When('the Jujutsu tab is dragged from the bottom panel back into the dock', async ({ page }: { page: Page }) => {
  await dragTabOnto(page, bottomRegion(page).getByRole('tab', { name: reusableViewName('Jujutsu'), exact: true }), surfaceOf(dockRegion(page)))
})

Then('the dock took the dragged Jujutsu panel back and the bottom row lost it', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-drag-moves-a-panel-back-into-the-dock', async () => {
    await expect(dockRegion(page).getByRole('region', { name: reusableViewName('Jujutsu'), exact: true })).toBeVisible()
    await expect(bottomRegion(page).getByRole('region', { name: reusableViewName('Jujutsu'), exact: true })).toHaveCount(0)
    const [bottomLayout, dockLayout] = await layoutKeys(page)
    expect(dockLayout ?? '').toContain(JUJUTSU_PANEL_ID)
    expect(bottomLayout ?? '').not.toContain(JUJUTSU_PANEL_ID)
  })
})

When('the bottom panel is hidden again from Pane options', async ({ page }: { page: Page }) => {
  await paneAction(page, mainPane(page), 'Hide the bottom panel')
  await expect(bottomRegion(page)).toHaveCount(0)
  await finishJourneyAssertions(page)
})

/** Layouts lives in Pane options; its rows act on the browser store. */
const layoutsDialog = (page: Page) => page.getByRole('dialog')

When('the current layout is saved as {string}', async ({ page }: { page: Page }, name: string) => {
  await paneAction(page, mainPane(page), 'Layouts')
  await layoutsDialog(page).getByLabel('Layout name').fill(name)
  await layoutsDialog(page).getByRole('button', { name: 'Save current layout', exact: true }).click()
  await layoutsDialog(page).getByRole('button', { name: 'Done', exact: true }).click()
  await expect(layoutsDialog(page)).toHaveCount(0)
})

When('the {string} layout is applied', async ({ page }: { page: Page }, name: string) => {
  await paneAction(page, mainPane(page), 'Layouts')
  await layoutsDialog(page)
    .getByRole('button', { name: `Apply ${name}`, exact: true })
    .click()
})

When('the Jujutsu panel is moved back to the right column', async ({ page }: { page: Page }) => {
  await movePanel(page, paneRoot(page, 'bottom'), 'Move to the dock')
})

Then('the dock shows the Jujutsu panel and the bottom panel does not', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-named-layout-saves-the-arrangement', async () => {
    await expect(dockRegion(page).getByRole('region', { name: reusableViewName('Jujutsu'), exact: true })).toBeVisible()
    await expect(bottomRegion(page).getByRole('region', { name: reusableViewName('Jujutsu'), exact: true })).toHaveCount(0)
  })
})

Then('the main Workbench keeps its own layout', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-right-layout-is-stored-apart', async () => {
    await expect(dockTab(mainDock(page), 'Editor')).toBeVisible()
    await expect(dockTab(dockRegion(page), 'Jujutsu')).toHaveCount(0)
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key) ?? '', MAIN_LAYOUT_KEY)).toContain('dshfiles-editor.main')
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key) ?? '', DOCK_LAYOUT_KEY)).not.toContain(JUJUTSU_PANEL_ID)
  })
  await finishJourneyAssertions(page)
})

// Main-view acceptance deliberately drives only rendered controls. Reading persistence/DOM below is observation;
// no test injects a registry, fires a private event, or creates a synthetic Dockview transfer.
const mainSeat = (page: Page) => page.locator('[data-slot="shell.main"]')
const mainDock = (page: Page) => mainSeat(page).locator('.dv-dockview').first()
const dockTab = (scope: Locator, title: string) => scope.getByRole('tab', { name: reusableViewName(title), exact: true })
const dockBody = (scope: Locator, title: string) =>
  dockTab(scope, title).locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," dv-groupview ")][1]')
const mainPane = (page: Page) => mainSeat(page).locator('[data-workbench-region="main"]').first()
/** Native-only/blank fallback fixture: identify its owner, not a mutable tab label. */
const nativeConversationTab = (page: Page) =>
  mainPane(page)
    .getByRole('tab')
    .filter({ has: page.locator('[data-workbench-tab-id="conversation"]') })
const paneRoot = (page: Page, region: 'left' | 'right' | 'bottom') => page.locator(`[data-workbench-region="${region}"]`).first()
const chooserIn = (scope: Locator) => scope.getByRole('region', { name: 'Choose a view', exact: true }).filter({ visible: true })
const paneOptions = async (page: Page, scope: Locator = mainPane(page)): Promise<void> => {
  await scope.getByRole('button', { name: 'Pane options', exact: true }).filter({ visible: true }).first().click()
  await expect(page.getByRole('menuitem', { name: 'Split right', exact: true })).toBeVisible()
}
const paneAction = async (page: Page, scope: Locator, label: string): Promise<void> => {
  await paneOptions(page, scope)
  await page.getByRole('menuitem', { name: label, exact: true }).click()
}
const movePanel = async (page: Page, scope: Locator, destination: string): Promise<void> => {
  await paneOptions(page, scope)
  const submenu = page.getByRole('menuitem', { name: 'Move tab to', exact: true })
  await submenu.hover()
  await submenu.press('ArrowRight')
  await page.getByRole('menuitem', { name: destination, exact: true }).click()
}
/** Dockview's always renderer portals bodies outside group chrome; join them through the real presentation identity. */
const panelBodyForTab = async (tab: Locator): Promise<Locator> => {
  const identity = tab.locator('[data-workbench-tab-id]')
  await expect(identity).toHaveCount(1)
  const id = await identity.getAttribute('data-workbench-tab-id')
  if (id === null) throw new Error('The selected Workbench tab has no presentation identity.')
  const pane = tab.locator('xpath=ancestor::*[@data-workbench-region][1]')
  const body = pane.locator(`[data-workbench-panel-id=${JSON.stringify(id)}]`)
  await expect(body).toHaveCount(1)
  return body
}
const tabOfChooser = async (chooser: Locator): Promise<Locator> => {
  const id = await chooser.locator('xpath=ancestor::*[@data-workbench-panel-id][1]').getAttribute('data-workbench-panel-id')
  if (id === null) throw new Error('The opened chooser has no public panel identity.')
  const pane = chooser.locator('xpath=ancestor::*[@data-workbench-region][1]')
  const tab = pane.getByRole('tab').filter({ has: chooser.page().locator(`[data-workbench-tab-id=${JSON.stringify(id)}]`) })
  await expect(tab).toHaveCount(1)
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  return tab
}
const chooserForGroup = async (group: Locator): Promise<Locator> => {
  const tab = group.getByRole('tab', { selected: true })
  await expect(tab).toHaveAccessibleName('New tab')
  const body = await panelBodyForTab(tab)
  const chooser = body.getByRole('region', { name: 'Choose a view', exact: true })
  await expect(chooser).toBeVisible()
  return chooser
}
const clickNewTab = async (scope: Locator): Promise<Locator> => {
  const plus = scope.getByRole('button', { name: 'New tab', exact: true }).filter({ visible: true }).first()
  const group = plus.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," dv-groupview ")][1]')
  await plus.click()
  return chooserForGroup(group)
}
const workbenchRoots = new WeakMap<Page, string>()
const workbenchThreads = new WeakMap<Page, { readonly first: string; readonly second: string }>()
const splitPanelIds = new WeakMap<Page, { readonly editor: string; readonly jujutsu: string }>()
const assertionSequence = new WeakMap<Page, number>()
const acceptanceId = (page: Page, suffix: string): string => {
  const index = (assertionSequence.get(page) ?? 0) + 1
  assertionSequence.set(page, index)
  return `workbench-main-${index}-${suffix}`
}

const assertTabPlusAlignment = async (page: Page): Promise<void> => {
  await recordAssertion(page, acceptanceId(page, 'plus-follows-tabs'), async () => {
    await expect
      .poll(async () => {
        const strips = await page.locator('[data-workbench-region] .dv-tabs-and-actions-container').evaluateAll(rows =>
          rows.flatMap(row => {
            const viewport = row.querySelector(':scope > .dv-scrollable')
            const plus = row.querySelector('button[aria-label="New tab"]')
            const tabs = [...row.querySelectorAll('[role="tab"]')]
            const last = tabs.at(-1)
            const box = row.getBoundingClientRect()
            if (viewport === null || plus === null || last === undefined || box.width === 0 || getComputedStyle(row).visibility === 'hidden') return []
            const viewBox = viewport.getBoundingClientRect()
            const plusBox = plus.getBoundingClientRect()
            const lastBox = last.getBoundingClientRect()
            return [
              {
                contiguous: Math.abs(plusBox.left - viewBox.right) <= 2,
                afterLast: lastBox.right > viewBox.right + 1 || Math.abs(plusBox.left - lastBox.right) <= 2,
                reachable: plusBox.width > 0 && plusBox.right <= box.right + 1,
              },
            ]
          }),
        )
        return strips.length > 0 && strips.every(strip => strip.contiguous && strip.afterLast && strip.reachable)
      })
      .toBe(true)
  })
}

When('the unified Workbench is ready', async ({ page }: { page: Page }) => {
  await openWorkbench(page)
})

const addRegisteredPanel = async (_page: Page, pane: Locator, title: string): Promise<void> => {
  const chooser = await clickNewTab(pane)
  await chooser.getByRole('button', { name: reusableViewName(title), exact: true }).click()
  await expect(chooser).toBeHidden()
}

When('the main workbench adds the registered {string} panel', async ({ page }: { page: Page }, title: string) => {
  await addRegisteredPanel(page, mainPane(page), title)
  await expect(dockTab(mainDock(page), title)).toBeVisible()
})

const createWorkbenchWorkspace = async (page: Page): Promise<string> => {
  const root = await createScratchDirectory('dshx-workbench-main-e2e-')
  workbenchRoots.set(page, root)
  const workspace = join(root, 'workbench-project')
  const bootThreadId = new URL(page.url()).searchParams.get('thread')
  await page
    .getByRole('button', { name: 'New thread', exact: true })
    .or(page.getByRole('button', { name: 'New session', exact: true }))
    .first()
    .click()
  // Boot already shows a blank conversation, so New thread opens a second one; wait for it before using its chip.
  if (bootThreadId !== null) await expect.poll(() => new URL(page.url()).searchParams.get('thread')).not.toBe(bootThreadId)
  // The fresh no-project hero deliberately has a disabled composer. Choose the project before waiting for its
  // enabled textbox name; the project chip is already a real usable control.
  await expect(page.getByRole('button', { name: 'Choose workspace', exact: true })).toBeVisible()
  await mkdir(workspace)
  await writeFile(join(workspace, 'preview.txt'), 'Workbench native preview content\n')
  const add = page.getByRole('button', { name: 'Add workspace', exact: true })
  if (await add.isVisible()) await registerWorkspaceFolder(page, workspace)
  else {
    await page.getByRole('button', { name: 'Choose workspace', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose a project', exact: true })
    await expect(picker).toBeVisible()
    const sample = picker.getByRole('option', { name: /^sample(?:\s|$)/i }).first()
    if ((await sample.count()) > 0) await sample.click()
    else {
      // Composed profiles do not all seed sample: register only this scenario's real temporary project through UI.
      const path = picker.getByRole('textbox', { name: 'Search projects or enter a folder path', exact: true })
      await path.fill(workspace)
      await picker.getByRole('button', { name: 'Register project', exact: true }).first().click()
    }
    await expect(picker).toBeHidden()
  }
  if (await page.evaluate(() => localStorage.getItem('dshfiles.main-tabs.v1') !== null)) {
    // The first New thread click above can still be materializing while the
    // project picker closes. Settle that exact owner before a caller requests
    // another Session; otherwise its URL wait can capture this initial request.
    await expect.poll(() => new URL(page.url()).searchParams.get('thread')).not.toBeNull()
    const initialSessionId = new URL(page.url()).searchParams.get('thread')
    if (initialSessionId === null) throw new Error('The initial Workbench Session has no URL identity.')
    const initialPanelId = tabPanelId(`thread:${initialSessionId}`)
    const initialTab = mainPane(page)
      .getByRole('tab')
      .filter({ has: page.locator(`[data-workbench-tab-id=${JSON.stringify(initialPanelId)}]`) })
    await expect(initialTab).toHaveCount(1)
    await expect(initialTab).toHaveAttribute('aria-selected', 'true')
    const initialBody = await panelBodyForTab(initialTab)
    await expect(initialBody.locator('[data-conversation-session]')).toHaveAttribute('data-conversation-session', initialSessionId)
    const initialInput = initialBody
      .getByRole('textbox', { name: /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/ })
      .filter({ visible: true })
    await expect(initialInput).toHaveCount(1)
    await expect(initialInput).toBeVisible()
    await expect(initialInput).toBeEditable()
    await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(initialSessionId)
    // This Session only establishes the project/input precondition. Retire its
    // exact tab before callers create their named chats, so close-all really
    // closes every semantic conversation rather than leaving a hidden fixture.
    // Close the boot conversation first: New thread starts in the project of the conversation closed last.
    const bootTab = mainPane(page)
      .getByRole('tab')
      .filter({ hasNot: page.locator(`[data-workbench-tab-id=${JSON.stringify(initialPanelId)}]`) })
      .getByRole('button', { name: 'Close New thread', exact: true })
    while ((await bootTab.count()) > 0) await bootTab.first().click()
    await initialTab.getByRole('button', { name: 'Close New thread', exact: true }).click()
    await expect(initialTab).toHaveCount(0)
    await expect(chooserIn(mainPane(page))).toBeVisible()
  } else {
    // Stock native New Session can remain an unmaterialized workspace draft
    // until its first send. Readiness is the exact raw owner and editable input,
    // not a thread URL that does not exist yet. Semantic readiness above stays
    // strict because those profiles already materialize their Session.
    const initialTab = nativeConversationTab(page)
    await expect(initialTab).toHaveAttribute('aria-selected', 'true')
    const initialBody = await panelBodyForTab(initialTab)
    const initialInput = initialBody
      .getByRole('textbox', { name: /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/ })
      .filter({ visible: true })
    await expect(initialInput).toHaveCount(1)
    await expect(initialInput).toBeVisible()
    await expect(initialInput).toBeEditable()
  }
  return workspace
}

const newWorkbenchThread = async (page: Page, prompt: string): Promise<string> => {
  const consoleErrors: string[] = []
  const recordError = (message: ConsoleMessage): void => {
    if (message.type() === 'error' && consoleErrors.length < 8)
      consoleErrors.push(
        message
          .text()
          .replace(/https?:\/\/[^\s)]+/gu, '[url]')
          .slice(0, 500),
      )
  }
  page.on('console', recordError)
  try {
    const previous = new URL(page.url()).searchParams.get('thread')
    const semantic = await page.evaluate(() => localStorage.getItem('dshfiles.main-tabs.v1') !== null)
    const newThread = page
      .getByRole('button', { name: 'New thread', exact: true })
      .or(page.getByRole('button', { name: 'New session', exact: true }))
      .first()
    await newThread.click()
    await expect
      .poll(() => {
        const current = new URL(page.url()).searchParams.get('thread')
        return current !== null && current !== previous
      })
      .toBe(true)
    await StartupDialogs.dismissProviderSetupIfShown(page)
    const id = new URL(page.url()).searchParams.get('thread')
    if (id === null) throw new Error('New Workbench thread has no active URL identity.')
    // A URL can update before tab adoption. Bind both actions to that exact new
    // Session's public panel identity, never whichever editor becomes visible next.
    const panelId = semantic ? tabPanelId(`thread:${id}`) : 'conversation'
    try {
      const tab = mainPane(page)
        .getByRole('tab')
        .filter({ has: page.locator(`[data-workbench-tab-id=${JSON.stringify(panelId)}]`) })
      await expect(tab).toHaveCount(1)
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      const body = await panelBodyForTab(tab)
      const blank = body
        .getByRole('textbox', { name: /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/ })
        .filter({ visible: true })
      await expect(blank).toHaveCount(1)
      await expect(blank).toBeVisible()
      await blank.fill(prompt)
      await expect(blank).toHaveText(prompt)
      await blank.press('Enter')
      const chat = mainSeat(page)
        .locator(`[data-conversation-session=${JSON.stringify(id)}]`)
        .filter({ visible: true })
      await expect(chat).toHaveCount(1)
      await expect(chat).toContainText(prompt)
      await expect(chat.getByRole('status').filter({ hasText: /^(Completed|Failed|Stopped|Cancelled)$/ })).toHaveCount(1, { timeout: 60_000 })
      return id
    } catch (error) {
      const ownership = await page.evaluate(
        ({ sessionId, panelId }) => {
          const visible = (element: Element) => {
            const rect = element.getBoundingClientRect()
            return {
              display: getComputedStyle(element).display,
              visibility: getComputedStyle(element).visibility,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            }
          }
          const owner = (element: Element) => ({
            panel: element.closest('[data-workbench-panel-id]')?.getAttribute('data-workbench-panel-id') ?? null,
            session: element.closest('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? null,
          })
          const selectedBody = [...document.querySelectorAll('[data-workbench-panel-id]')].find(
            element => element.getAttribute('data-workbench-panel-id') === panelId,
          )
          return {
            requested: { sessionId, panelId },
            page: { origin: window.location.origin, pathname: window.location.pathname, thread: new URL(window.location.href).searchParams.get('thread') },
            persistedMainTabs: localStorage.getItem('dshfiles.main-tabs.v1')?.slice(0, 12000),
            tabs: [...document.querySelectorAll('[data-workbench-tab-id]')].map(element => ({
              id: element.getAttribute('data-workbench-tab-id'),
              selected: element.closest('[role="tab"]')?.getAttribute('aria-selected'),
              title: element.closest('[role="tab"]')?.getAttribute('aria-label'),
            })),
            bodies: [...document.querySelectorAll('[data-workbench-panel-id]')].map(element => ({
              id: element.getAttribute('data-workbench-panel-id'),
              sessions: [...element.querySelectorAll('[data-conversation-session]')].map(child => child.getAttribute('data-conversation-session')),
              textboxes: element.querySelectorAll('[role="textbox"]').length,
              ...visible(element),
            })),
            textboxes: [...document.querySelectorAll('[role="textbox"]')].map(element => ({
              label: element.getAttribute('aria-label'),
              editable: element.getAttribute('contenteditable'),
              ...owner(element),
              ...visible(element),
            })),
            conversations: [...document.querySelectorAll('[data-conversation-session]')].map(element => ({
              session: element.getAttribute('data-conversation-session'),
              ...owner(element),
              ...visible(element),
            })),
            slotErrors: [...document.querySelectorAll('[data-slot-error]')].map(element => element.textContent?.slice(0, 500)),
            selectedBodyHtml: selectedBody?.outerHTML.slice(0, 4000),
          }
        },
        { sessionId: id, panelId },
      )
      const path = test.info().outputPath('new-thread-dom-ownership.json')
      await writeFile(path, JSON.stringify({ ...ownership, consoleErrors }, null, 2))
      await test.info().attach('new-thread-dom-ownership', { path, contentType: 'application/json' })
      throw error
    }
  } finally {
    page.off('console', recordError)
  }
}

const threadRow = (page: Page, id: string) => page.locator(`article[data-thread-id="${id}"]`)
const openThreadRow = async (page: Page, id: string): Promise<void> => {
  const observation = await page.evaluateHandle(eventName => {
    const requests: Array<{ sessionId: unknown; newTab: unknown; defaultPrevented: boolean; cancelable: boolean }> = []
    const observe = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const detail: unknown = event.detail
      if (typeof detail !== 'object' || detail === null) return
      queueMicrotask(() =>
        requests.push({
          sessionId: 'sessionId' in detail ? detail.sessionId : null,
          newTab: 'newTab' in detail ? detail.newTab : null,
          defaultPrevented: event.defaultPrevented,
          cancelable: event.cancelable,
        }),
      )
    }
    window.addEventListener(eventName, observe, { passive: true })
    return { requests, dispose: () => window.removeEventListener(eventName, observe) }
  }, OPEN_THREAD_IN_MAIN_TAB_EVENT)
  try {
    await threadRow(page, id)
      .locator('button[data-thread-main-action]')
      .click({ position: { x: 24, y: 16 } })
    await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(id)
  } catch (error) {
    const ownership = await page.evaluate(expected => {
      const bounds = (element: Element) => {
        const rect = element.getBoundingClientRect()
        return {
          display: getComputedStyle(element).display,
          visibility: getComputedStyle(element).visibility,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        }
      }
      return {
        expected,
        thread: new URL(window.location.href).searchParams.get('thread'),
        persistedMainTabs: localStorage.getItem('dshfiles.main-tabs.v1')?.slice(0, 16000),
        tabs: [...document.querySelectorAll('[data-workbench-tab-id]')].map(element => ({
          id: element.getAttribute('data-workbench-tab-id'),
          selected: element.closest('[role="tab"]')?.getAttribute('aria-selected'),
          region: element.closest('[data-workbench-region]')?.getAttribute('data-workbench-region'),
        })),
        bodies: [...document.querySelectorAll('[data-workbench-panel-id]')].map(element => ({
          id: element.getAttribute('data-workbench-panel-id'),
          sessions: [...element.querySelectorAll('[data-conversation-session]')].map(child => child.getAttribute('data-conversation-session')),
          ...bounds(element),
        })),
        textboxes: [...document.querySelectorAll('[data-composer-input]')].map(element => ({
          session: element.closest('[data-conversation-session]')?.getAttribute('data-conversation-session'),
          panel: element.closest('[data-workbench-panel-id]')?.getAttribute('data-workbench-panel-id'),
          editable: element.getAttribute('contenteditable'),
          ...bounds(element),
        })),
        sidebarRows: [...document.querySelectorAll('article[data-thread-id]')].map(element => ({
          attributes: Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value])),
          button: Object.fromEntries(
            [...(element.querySelector('button[data-thread-main-action]')?.attributes ?? [])].map(attribute => [attribute.name, attribute.value]),
          ),
        })),
        slotErrors: [...document.querySelectorAll('[data-slot-error]')].map(element => element.textContent?.slice(0, 500)),
      }
    }, id)
    const requests = await observation.evaluate(value => value.requests)
    const path = test.info().outputPath('open-thread-route-ownership.json')
    await writeFile(path, JSON.stringify({ ...ownership, requests }, null, 2))
    await test.info().attach('open-thread-route-ownership', { path, contentType: 'application/json' })
    throw error
  } finally {
    await observation.evaluate(value => value.dispose())
    await observation.dispose()
  }
}
const threadPrompt = (index: 'first' | 'second') => `Workbench ${index} conversation`
const threadDockTab = (page: Page, index: 'first' | 'second') => dockTab(mainDock(page), threadPrompt(index))

When('a disposable Workbench workspace has two real threads', async ({ page }: { page: Page }) => {
  await createWorkbenchWorkspace(page)
  const first = await newWorkbenchThread(page, threadPrompt('first'))
  // Workbench conversation tabs are kept by default; fixture setup must not hide replacement bugs with a double-click.
  const second = await newWorkbenchThread(page, threadPrompt('second'))
  workbenchThreads.set(page, { first, second })
  await page.getByRole('button', { name: 'All threads', exact: true }).click()
  await expect(threadRow(page, first)).toBeVisible()
  await expect(threadRow(page, second)).toBeVisible()
})

Given('an isolated Workbench profile with legacy disabled preview tabs is booted', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: [
      '@dshfiles/frame-layout',
      '@dshfiles/sidebar-right',
      '@dshfiles/workbench',
      '@dshfiles/main-tabs',
      '@dshfiles/settings-shell',
      '@dshfiles/thread-sidebar',
      '@dshfiles/workspace-folder-picker',
      '@dshfiles/session-controller',
      '@dshfiles/rich-composer',
      '@dshfiles/chat',
      '@dshfiles/multi-host',
      '@dshfiles/jj-integration',
      '@dshfiles/ai-accounts',
    ],
    profileLabel: 'workbench-legacy-disabled-preview-tabs',
    // Seed real Loader configuration, not browser state or a private actor event. The Settings assertion below
    // proves these legacy values actually reached the running profile before exercising ordinary sidebar clicks.
    cordisPatch: `- id: dshfiles-main-tabs
  config:
    enabled: false
    openMode: preview
`,
  })
  await visitIsolatedPluginProfile(page, profile)
  await openWorkbench(page)
})

Then('Main tabs settings still show disabled tabs and Preview opening', async ({ page }: { page: Page }) => {
  await openSettingsDialog(page)
  const settings = mainSeat(page).locator('[data-settings-view]')
  await expect(settings).toBeVisible()
  await settings.getByRole('group', { name: 'Plugins', exact: true }).getByRole('button', { name: 'Main tabs', exact: true }).click()
  const controls = settings.getByRole('region', { name: 'Main tabs', exact: true })
  await recordAssertion(page, acceptanceId(page, 'legacy-disabled-preview-settings-are-real'), async () => {
    await expect(controls.getByRole('switch', { name: 'Enabled', exact: true })).not.toBeChecked()
    await expect(controls.getByRole('radio', { name: 'Preview', exact: true })).toBeChecked()
  })
  await mainSeat(page)
    .getByRole('tab', { selected: true })
    .getByRole('button', { name: /^Close / })
    .click()
  await expect(settings).toHaveCount(0)
})

When('two real Workbench threads are opened normally from the sidebar', async ({ page }: { page: Page }) => {
  await createWorkbenchWorkspace(page)
  const first = await newWorkbenchThread(page, threadPrompt('first'))
  const second = await newWorkbenchThread(page, threadPrompt('second'))
  workbenchThreads.set(page, { first, second })
  await page.getByRole('button', { name: 'All threads', exact: true }).click()
  await expect(threadRow(page, first)).toBeVisible()
  await expect(threadRow(page, second)).toBeVisible()
  // Creation may already have opened fixed tabs. Close them so sidebar opening itself must create both tabs.
  // No modifier, double-click, Keep open, chooser occurrence or synthetic runtime action is used here.
  for (const index of ['first', 'second'] as const) {
    const tab = threadDockTab(page, index)
    if ((await tab.count()) > 0) await tab.getByRole('button', { name: `Close ${threadPrompt(index)}`, exact: true }).click()
  }
  await openThreadRow(page, first)
  await openThreadRow(page, second)
})

const fixedConversation = async (page: Page, index: 'first' | 'second'): Promise<Locator> => {
  const ids = workbenchThreads.get(page)
  if (ids === undefined) throw new Error('Workbench thread fixture is missing.')
  const tab = threadDockTab(page, index)
  await expect(tab).toBeVisible()
  await expect(tab.locator('[data-workbench-tab-id]')).toHaveAttribute('data-workbench-tab-id', tabPanelId(`thread:${ids[index]}`))
  const body = await panelBodyForTab(tab)
  // A Current conversation follower would change Session with global selection. The panel's own body must stay
  // bound to its explicit Session, including while the other conversation is selected.
  await expect(body.locator('[data-conversation-session]')).toHaveAttribute('data-conversation-session', ids[index])
  return body
}
const fixedComposer = (body: Locator): Locator => body.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })
const fixedDraft = (index: 'first' | 'second'): string => `Unsent draft owned by the ${index} fixed conversation`

const assertCompleteFixedConversation = async (page: Page, index: 'first' | 'second'): Promise<Locator> => {
  const body = await fixedConversation(page, index)
  await expect(threadDockTab(page, index)).toHaveAttribute('aria-selected', 'true')
  await expect(body).toBeVisible()
  await expect(body.locator('[data-chat-flow]')).toContainText(threadPrompt(index))
  await expect(body.locator('[data-chat-flow]')).not.toContainText(threadPrompt(index === 'first' ? 'second' : 'first'))
  const composer = fixedComposer(body)
  await expect(composer).toHaveCount(1)
  await expect(composer).toBeVisible()
  await expect(composer).toBeEditable()
  await expect(composer).toHaveText(fixedDraft(index))
  // Exercise the actual contenteditable root, not just a cached draft string.
  await composer.press('End')
  await composer.pressSequentially(' editable')
  await expect(composer).toContainText(' editable')
  await composer.fill(fixedDraft(index))
  await expect(composer).toHaveText(fixedDraft(index))
  return body
}

const assertNoGlobalConversationAliases = async (page: Page): Promise<void> => {
  await expect
    .poll(() =>
      page
        .locator('[data-workbench-tab-id]')
        .evaluateAll(elements =>
          elements
            .map(element => element.getAttribute('data-workbench-tab-id'))
            .filter(id => id === 'conversation' || id === 'current-conversation' || id === 'main/conversation' || id?.startsWith('view/current-conversation/')),
        ),
    )
    .toEqual([])
  await expect(page.locator('[data-slot-error]')).toHaveCount(0)
}

Then('ordinary sidebar opens focus fixed tabs and close-all reopens their complete inputs', async ({ page }: { page: Page }) => {
  const ids = workbenchThreads.get(page)
  if (ids === undefined) throw new Error('Workbench lifecycle threads are missing.')
  await recordAssertion(page, 'workbench-fixed-sidebar-close-reopen-inputs', async () => {
    await openThreadRow(page, ids.first)
    const firstBody = await assertCompleteFixedConversation(page, 'first')
    const firstInput = await fixedComposer(firstBody).elementHandle()
    if (firstInput === null) throw new Error('The first fixed input is not mounted.')
    await openThreadRow(page, ids.second)
    await assertCompleteFixedConversation(page, 'second')
    // Global current changed, but the retained first panel's Session never does.
    await expect(firstBody.locator('[data-conversation-session]')).toHaveAttribute('data-conversation-session', ids.first)
    await openThreadRow(page, ids.first)
    await assertCompleteFixedConversation(page, 'first')
    expect(await fixedComposer(firstBody).evaluate((element, original) => element === original, firstInput)).toBe(true)
    await expect(threadDockTab(page, 'first')).toHaveCount(1)
    await expect(threadDockTab(page, 'second')).toHaveCount(1)
    // Close the current Session last. The native default still points at first;
    // clicking that row must explicitly reopen it despite no native change.
    for (const index of ['second', 'first'] as const) {
      await threadDockTab(page, index)
        .getByRole('button', { name: `Close ${threadPrompt(index)}`, exact: true })
        .click()
      await expect(threadDockTab(page, index)).toHaveCount(0)
    }
    await assertNoGlobalConversationAliases(page)
    await expect(mainSeat(page).locator('[data-conversation-session]').filter({ visible: true })).toHaveCount(0)
    await openThreadRow(page, ids.first)
    await assertCompleteFixedConversation(page, 'first')
    await expect(threadDockTab(page, 'first')).toHaveCount(1)
    await openThreadRow(page, ids.second)
    await assertCompleteFixedConversation(page, 'second')
    await openThreadRow(page, ids.first)
    await assertCompleteFixedConversation(page, 'first')
    await expect(threadDockTab(page, 'first')).toHaveCount(1)
    await expect(threadDockTab(page, 'second')).toHaveCount(1)
    await assertNoGlobalConversationAliases(page)
  })
})

Then('the New tab chooser never offers a global current conversation', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-fixed-picker-has-no-current-follower', async () => {
    const chooser = await clickNewTab(mainPane(page))
    for (const query of ['', 'Rich Composer', 'Current conversation', 'Conversation']) {
      await chooser.getByRole('textbox', { name: 'Search views', exact: true }).fill(query)
      await expect(chooser.getByRole('button', { name: /^(?:Rich Composer: )?(?:Current conversation|Conversation)$/i })).toHaveCount(0)
    }
    const chooserTab = await tabOfChooser(chooser)
    await chooserTab.getByRole('button', { name: 'Close New tab', exact: true }).click()
    await assertCompleteFixedConversation(page, 'first')
  })
})

When('legacy global conversation aliases are restored beside the fixed tabs', async ({ page }: { page: Page }) => {
  const ids = workbenchThreads.get(page)
  if (ids === undefined) throw new Error('Workbench lifecycle threads are missing.')
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key) ?? '', MAIN_LAYOUT_KEY)).toContain(tabPanelId(`thread:${ids.first}`))
  const raw = await page.evaluate(key => localStorage.getItem(key), MAIN_LAYOUT_KEY)
  if (raw === null) throw new Error('Workbench lifecycle layout was not saved.')
  const layout = legacyFloatingRecoverySchema.parse(JSON.parse(raw))
  const leaf = layout.grid.root.data[0]
  const original = layout.panels[tabPanelId(`thread:${ids.first}`)]
  if (leaf === undefined || original === undefined) throw new Error('The real fixed panel has no saved root leaf.')
  for (const id of ['conversation', 'current-conversation', 'view/current-conversation/legacy', 'main/conversation']) {
    layout.panels[id] = { ...original, id, title: 'Rich Composer: Current conversation', params: { sourceId: 'current-conversation' } }
    leaf.data.views.push(id)
  }
  // Only browser-persisted legacy presentation data changes: no registry,
  // controller, actor, editor root or host state is injected by this fixture.
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: MAIN_LAYOUT_KEY, value: JSON.stringify(layout) })
  await StartupDialogs.reloadPastProviderSetup(page)
  await openWorkbench(page)
})

Then('reload and Reset keep only complete fixed-session conversations', async ({ page }: { page: Page }) => {
  const ids = workbenchThreads.get(page)
  if (ids === undefined) throw new Error('Workbench lifecycle threads are missing.')
  await recordAssertion(page, 'workbench-fixed-legacy-reload-reset-inputs', async () => {
    await assertNoGlobalConversationAliases(page)
    for (const index of ['first', 'second', 'first'] as const) {
      await openThreadRow(page, ids[index])
      await assertCompleteFixedConversation(page, index)
    }
    await openGlobalPanel(page, 'Plugins')
    await paneAction(page, mainPane(page), 'Reset layout')
    await assertCompleteFixedConversation(page, 'first')
    await assertNoGlobalConversationAliases(page)
    await expect(threadDockTab(page, 'first')).toHaveCount(1)
    await expect(threadDockTab(page, 'second')).toHaveCount(1)
    await StartupDialogs.reloadPastProviderSetup(page)
    await openWorkbench(page)
    await assertCompleteFixedConversation(page, 'first')
    await assertNoGlobalConversationAliases(page)
    await expect(threadDockTab(page, 'first')).toHaveCount(1)
    await expect(threadDockTab(page, 'second')).toHaveCount(1)
    await page.screenshot({ path: test.info().outputPath('unified-fixed-conversation.png'), animations: 'disabled' })
  })
})

Then('both sidebar conversations have their own kept fixed-session tabs', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'legacy-prefs-keep-both-threads'), async () => {
    for (const index of ['first', 'second'] as const) {
      const body = await fixedConversation(page, index)
      await expect(body.locator('[data-chat-flow]')).toContainText(threadPrompt(index))
      await expect(body.locator('[data-chat-flow]')).not.toContainText(threadPrompt(index === 'first' ? 'second' : 'first'))
      await expect(threadDockTab(page, index).locator('[data-preview]')).toHaveCount(0)
    }
    await expect(dockTab(mainDock(page), 'Current conversation')).toHaveCount(0)
    await expect(page.locator('[data-dshfiles-main-tabs]')).toHaveCount(0)
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})

When('each fixed-session conversation receives its own draft', async ({ page }: { page: Page }) => {
  const ids = workbenchThreads.get(page)
  if (ids === undefined) throw new Error('Workbench thread fixture is missing.')
  for (const index of ['first', 'second'] as const) {
    await threadDockTab(page, index).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(ids[index])
    const body = await fixedConversation(page, index)
    await expect(body.locator('[data-chat-flow]')).toContainText(threadPrompt(index))
    await fixedComposer(body).fill(fixedDraft(index))
    await expect(fixedComposer(body)).toHaveText(fixedDraft(index))
  }
})

Then('switching conversation tabs preserves distinct messages and drafts', async ({ page }: { page: Page }) => {
  const ids = workbenchThreads.get(page)
  if (ids === undefined) throw new Error('Workbench thread fixture is missing.')
  await recordAssertion(page, acceptanceId(page, 'fixed-session-drafts-stay-distinct'), async () => {
    for (const index of ['first', 'second', 'first'] as const) {
      await threadDockTab(page, index).click()
      await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(ids[index])
      const body = await fixedConversation(page, index)
      await expect(body).toBeVisible()
      await expect(body.locator('[data-chat-flow]')).toContainText(threadPrompt(index))
      await expect(body.locator('[data-chat-flow]')).not.toContainText(threadPrompt(index === 'first' ? 'second' : 'first'))
      await expect(fixedComposer(body)).toHaveText(fixedDraft(index))
      await fixedConversation(page, index === 'first' ? 'second' : 'first')
    }
  })
})

When('the first fixed-session conversation tab is closed', async ({ page }: { page: Page }) => {
  await page.screenshot({ path: test.info().outputPath('workbench-independent-conversations.png'), animations: 'disabled' })
  await threadDockTab(page, 'first')
    .getByRole('button', { name: `Close ${threadPrompt('first')}`, exact: true })
    .click()
  await expect(threadDockTab(page, 'first')).toHaveCount(0)
})

Then('the second fixed-session conversation keeps its messages and draft', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'close-one-keeps-other-conversation'), async () => {
    await threadDockTab(page, 'second').click()
    const body = await fixedConversation(page, 'second')
    await expect(body).toBeVisible()
    await expect(body.locator('[data-chat-flow]')).toContainText(threadPrompt('second'))
    await expect(body.locator('[data-chat-flow]')).not.toContainText(threadPrompt('first'))
    await expect(fixedComposer(body)).toHaveText(fixedDraft('second'))
    await expect(threadDockTab(page, 'first')).toHaveCount(0)
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})

Then('the conversation is inside a Dockview panel and switching threads changes its messages', async ({ page }: { page: Page }) => {
  const ids = workbenchThreads.get(page)
  if (ids === undefined) throw new Error('Workbench thread fixture is missing.')
  await recordAssertion(page, acceptanceId(page, 'conversation-provider-switch'), async () => {
    await expect(nativeConversationTab(page)).toBeVisible()
    await expect(mainSeat(page).locator('[data-slot="conversation.session"]').filter({ visible: true })).toBeVisible()
    await expect(mainSeat(page).getByText(threadPrompt('second'), { exact: true }).last()).toBeVisible()
    await openThreadRow(page, ids.first)
    await expect(mainSeat(page).getByText(threadPrompt('first'), { exact: true }).last()).toBeVisible()
    await openThreadRow(page, ids.second)
    await expect(mainSeat(page).getByText(threadPrompt('second'), { exact: true }).last()).toBeVisible()
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})

Then('the registered main page and original General controls are docked in the Settings hub', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'main-and-settings-sources'), async () => {
    await expect(dockTab(mainDock(page), 'Jujutsu')).toBeVisible()
    await expect(dockTab(mainDock(page), 'Settings')).toBeVisible()
    const hub = mainSeat(page).locator('[data-settings-workbench-hub]')
    await expect(hub).toBeVisible()
    await expect(hub.locator('[data-settings-view="tab"]')).toBeVisible()
    await expect(hub.locator('[data-slot="settings.section"]')).toBeVisible()
    await expect(mainSeat(page).getByRole('switch', { name: 'Show coding view', exact: true })).toBeVisible()
    await expect(mainSeat(page).getByText(/^Current version: \d/)).toBeVisible()
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})

When('the Settings hub is closed from its Dockview tab', async ({ page }: { page: Page }) => {
  await dockTab(mainDock(page), 'Settings')
    .getByRole('button', { name: `Close ${reusableViewName('Settings')}`, exact: true })
    .click()
})

Then('the Jujutsu panel remains and only the Settings hub is offered in the chooser', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'settings-hub-not-individual-sections'), async () => {
    await expect(dockTab(mainDock(page), 'Jujutsu')).toBeVisible()
    await expect(dockTab(mainDock(page), 'Settings')).toHaveCount(0)
    const chooser = await clickNewTab(mainPane(page))
    await expect(chooser.getByRole('button', { name: reusableViewName('Settings'), exact: true })).toHaveCount(1)
    await expect(chooser.getByRole('button', { name: /^Settings:/ })).toHaveCount(0)
    const search = chooser.getByRole('textbox', { name: 'Search views', exact: true })
    await search.fill('Settings')
    await expect(chooser.getByRole('button')).toHaveCount(1)
    await expect(chooser.getByRole('button', { name: reusableViewName('Settings'), exact: true })).toBeVisible()
    await search.fill('General')
    await expect(chooser.getByRole('button', { name: /^Settings:/ })).toHaveCount(0)
    await expect(chooser.getByText('No matching views.', { exact: true })).toBeVisible()
    await dockTab(mainDock(page), 'New tab').getByRole('button', { name: 'Close New tab', exact: true }).click()
  })
})

When('the four owned sidebar assemblies are opened from New tab', async ({ page }: { page: Page }) => {
  for (const title of ['Threads', 'Sidebar status', 'Sidebar actions', 'Navigation']) {
    await addRegisteredPanel(page, mainPane(page), title)
    await expect(dockTab(mainDock(page), title)).toBeVisible()
  }
})
Then('Threads Sidebar status Sidebar actions and Navigation use their real owned seats', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'owned-sidebar-seats'), async () => {
    const sources = [
      ['Threads', 'dshfiles-thread-sidebar.workbench-threads', 'sidebar.workspaces'],
      ['Sidebar status', 'dshfiles-thread-sidebar.workbench-status', 'sidebar.footer.above'],
      ['Sidebar actions', 'dshfiles-thread-sidebar.workbench-actions', 'sidebar.footer.action'],
    ] as const
    for (const [title, id, slot] of sources) {
      await dockTab(mainDock(page), title).click()
      const panel = mainSeat(page).locator(`[data-sidebar-workbench-source="${id}"]`)
      await expect(panel).toBeVisible()
      await expect(panel.locator(`[data-slot="${slot}"]`)).toBeAttached()
    }
    await dockTab(mainDock(page), 'Navigation').click()
    await expect(
      mainSeat(page)
        .locator('[data-sidebar-workbench-source="dshfiles-thread-sidebar.workbench-navigation"]')
        .getByRole('navigation', { name: 'Navigation', exact: true }),
    ).toBeVisible()
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})

When('the main workbench opens an empty dock and bottom row', async ({ page }: { page: Page }) => {
  await setRightPaneVisible(page, true)
  await expect(surfaceOf(dockRegion(page))).toBeVisible()
  // A previously adopted Jujutsu view must return through the centre's chooser before this drag journey.
  if ((await dockTab(dockRegion(page), 'Jujutsu').count()) > 0) {
    await dockTab(dockRegion(page), 'Jujutsu')
      .getByRole('button', { name: `Close ${reusableViewName('Jujutsu')}`, exact: true })
      .click()
    await addRegisteredPanel(page, mainPane(page), 'Jujutsu')
  }
  await paneAction(page, mainPane(page), 'Toggle the bottom panel')
  await expect(surfaceOf(bottomRegion(page))).toBeVisible()
})

When('the main Jujutsu tab is dragged into the right dock', async ({ page }: { page: Page }) => {
  await dragTabOnto(page, dockTab(mainDock(page), 'Jujutsu'), surfaceOf(dockRegion(page)))
})
When('the dock Jujutsu tab is dragged into the bottom row', async ({ page }: { page: Page }) => {
  await dragTabOnto(page, dockTab(dockRegion(page), 'Jujutsu'), surfaceOf(bottomRegion(page)))
})
When('the bottom Jujutsu tab is dragged into the centre', async ({ page }: { page: Page }) => {
  await dragTabOnto(page, dockTab(bottomRegion(page), 'Jujutsu'), mainDock(page))
})
const assertJujutsuRegion = async (page: Page, target: 'centre' | 'right dock' | 'bottom row'): Promise<void> => {
  const regions = [
    ['centre', mainDock(page)],
    ['right dock', dockRegion(page)],
    ['bottom row', bottomRegion(page)],
  ] as const
  await recordAssertion(page, acceptanceId(page, `jujutsu-${target.replaceAll(' ', '-')}`), async () => {
    for (const [name, scope] of regions) {
      if (name === target) await expect(dockTab(scope, 'Jujutsu')).toBeVisible()
      else await expect(dockTab(scope, 'Jujutsu')).toHaveCount(0)
    }
    const key = target === 'centre' ? MAIN_LAYOUT_KEY : target === 'right dock' ? DOCK_LAYOUT_KEY : BOTTOM_LAYOUT_KEY
    await expect.poll(() => page.evaluate(storageKey => localStorage.getItem(storageKey) ?? '', key)).toContain(JUJUTSU_PANEL_ID)
  })
}
Then('only the right dock holds the Jujutsu panel', async ({ page }: { page: Page }) => assertJujutsuRegion(page, 'right dock'))
Then('only the bottom row holds the Jujutsu panel', async ({ page }: { page: Page }) => assertJujutsuRegion(page, 'bottom row'))
Then('only the centre holds the Jujutsu panel', async ({ page }: { page: Page }) => assertJujutsuRegion(page, 'centre'))
When('the Workbench main page is reloaded', async ({ page }: { page: Page }) => {
  await StartupDialogs.reloadPastProviderSetup(page)
  await expect(mainDock(page)).toBeVisible()
})

Then('the latest Dockview thread tab is kept by default and the old main strip is absent', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'kept-conversation-replaces-old-strip'), async () => {
    await expect(threadDockTab(page, 'second')).toBeVisible()
    await expect(threadDockTab(page, 'second').locator('[data-preview]')).toHaveCount(0)
    await expect(page.locator('[data-dshfiles-main-tabs]')).toHaveCount(0)
  })
})
When('the Dockview thread tab is pinned from its context menu', async ({ page }: { page: Page }) => {
  await threadDockTab(page, 'second').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Keep open', exact: true })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Pin tab', exact: true }).click()
})
Then('the Dockview thread tab is kept and pinned', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'keep-pin'), async () => {
    await expect(threadDockTab(page, 'second').locator('[data-preview]')).toHaveCount(0)
    await expect(threadDockTab(page, 'second').getByLabel('Pinned', { exact: true })).toBeVisible()
  })
})
When('the pinned Workbench thread is moved aside from its real tab menu', async ({ page }: { page: Page }) => {
  await threadDockTab(page, 'second').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open in side panel', exact: true }).click()
})
Then('the right dock alone holds the same pinned Workbench thread', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'thread-aside-preserves-semantic-identity'), async () => {
    const ids = workbenchThreads.get(page)
    if (ids === undefined) throw new Error('Workbench thread fixture is missing.')
    const title = 'Workbench second conversation'
    const panelId = tabPanelId(`thread:${ids.second}`)
    const rightTab = dockTab(dockRegion(page), title)
    await expect(rightTab).toBeVisible()
    await expect(rightTab.getByLabel('Pinned', { exact: true })).toBeVisible()
    await expect(threadDockTab(page, 'second')).toHaveCount(0)
    await expect(page.getByRole('tab', { name: title, exact: true })).toHaveCount(1)
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key) ?? '', DOCK_LAYOUT_KEY)).toContain(panelId)
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key) ?? '', MAIN_LAYOUT_KEY)).not.toContain(panelId)
    const actor = await page.evaluate(() => localStorage.getItem('dshfiles.main-tabs.v1') ?? '')
    expect(actor.split(`"id":${JSON.stringify(`thread:${ids.second}`)}`).length - 1).toBe(1)
    await expect(threadRow(page, ids.second)).toBeVisible()
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})
When('the pinned Workbench thread is dragged from the right dock back into the centre', async ({ page }: { page: Page }) => {
  // Aim at the destination tab strip, not the conversation's editable/file-drop surface.
  const source = dockTab(dockRegion(page), 'Workbench second conversation')
  const target = threadDockTab(page, 'first')
  // Revealing the right pane can still be measuring its tab viewport. Playwright's scroll action waits for
  // stable geometry and exposes an overflowed header before the real pointer gesture reads its coordinates.
  await source.scrollIntoViewIfNeeded()
  await target.scrollIntoViewIfNeeded()
  const viewport = page.viewportSize()
  const endpoints = { source: await source.boundingBox(), target: await target.boundingBox() }
  if (viewport === null || endpoints.source === null || endpoints.target === null) throw new Error('The visible tab drag geometry is missing.')
  for (const box of [endpoints.source, endpoints.target]) {
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
  }
  await test.info().attach('pinned-thread-drag-geometry', { body: JSON.stringify({ viewport, endpoints }), contentType: 'application/json' })
  await dragTabOnto(page, source, target)
})
Then('the centre alone holds that same pinned Workbench thread', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'thread-aside-real-drag-back-keeps-pin'), async () => {
    const ids = workbenchThreads.get(page)
    if (ids === undefined) throw new Error('Workbench thread fixture is missing.')
    const panelId = tabPanelId(`thread:${ids.second}`)
    await expect(threadDockTab(page, 'second')).toBeVisible()
    await expect(threadDockTab(page, 'second').getByLabel('Pinned', { exact: true })).toBeVisible()
    await expect(dockTab(dockRegion(page), 'Workbench second conversation')).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Workbench second conversation', exact: true })).toHaveCount(1)
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key) ?? '', MAIN_LAYOUT_KEY)).toContain(panelId)
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key) ?? '', DOCK_LAYOUT_KEY)).not.toContain(panelId)
    const actor = await page.evaluate(() => localStorage.getItem('dshfiles.main-tabs.v1') ?? '')
    expect(actor.split(`"id":${JSON.stringify(`thread:${ids.second}`)}`).length - 1).toBe(1)
    await expect(threadRow(page, ids.second)).toBeVisible()
  })
})
When('the Workbench New tab control is clicked', async ({ page }: { page: Page }) => {
  await mainPane(page).getByRole('button', { name: 'New tab', exact: true }).click()
})
Then('a focused New tab chooser offers reusable views without changing the pinned thread', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'semantic-new-tab-uses-chooser'), async () => {
    const chooser = chooserIn(mainPane(page))
    await expect(await tabOfChooser(chooser)).toBeVisible()
    await expect(chooser.getByRole('textbox', { name: 'Search views', exact: true })).toBeFocused()
    await expect(chooser.getByRole('button', { name: reusableViewName('Current conversation'), exact: true })).toHaveCount(0)
    await expect(chooser.getByRole('button', { name: threadPrompt('second'), exact: false })).toHaveCount(0)
    await expect(threadDockTab(page, 'second').getByLabel('Pinned', { exact: true })).toBeVisible()
    await expect(mainSeat(page).locator('[data-main-tabs-start]')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('workbench-semantics-provider.png'), animations: 'disabled' })
  })
})
When('the semantic chooser is closed and both conversations are opened from the sidebar', async ({ page }: { page: Page }) => {
  const ids = workbenchThreads.get(page)
  if (ids === undefined) throw new Error('Workbench thread fixture is missing.')
  const chooserTab = await tabOfChooser(chooserIn(mainPane(page)))
  await chooserTab.getByRole('button', { name: 'Close New tab', exact: true }).click()
  await expect(chooserTab).toHaveCount(0)
  await openThreadRow(page, ids.first)
  await openThreadRow(page, ids.second)
})
Then('both fixed Workbench threads remain unique and the second stays pinned', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'chooser-selection-preserves-semantic-pin'), async () => {
    const ids = workbenchThreads.get(page)
    if (ids === undefined) throw new Error('Workbench thread fixture is missing.')
    await expect(chooserIn(mainPane(page))).toHaveCount(0)
    await expect(dockTab(mainDock(page), 'Current conversation')).toHaveCount(0)
    await expect(threadDockTab(page, 'first')).toHaveCount(1)
    await expect(threadDockTab(page, 'second').getByLabel('Pinned', { exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: threadPrompt('second'), exact: true })).toHaveCount(1)
    await expect(
      mainSeat(page).locator(`[data-conversation-session="${ids.second}"]`).filter({ visible: true }).getByText(threadPrompt('second'), { exact: true }).last(),
    ).toBeVisible()
    await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(ids.second)
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})
When('the native New tab shortcut opens the same chooser', async ({ page }: { page: Page }) => {
  await mainPane(page).getByRole('button', { name: 'Pane options', exact: true }).first().focus()
  // Native main-tabs registers web defaults for macOS/Windows, not Linux; this scenario uses the macOS fixture.
  const mac = await page.evaluate(() => navigator.platform.toLowerCase().includes('mac'))
  await page.keyboard.press(mac ? 'Meta+Alt+T' : 'Control+Alt+T')
  await expect(await tabOfChooser(chooserIn(mainPane(page)))).toBeVisible()
  await expect(chooserIn(mainPane(page)).getByRole('textbox', { name: 'Search views', exact: true })).toBeFocused()
  await expect(mainSeat(page).locator('[data-main-tabs-start]')).toHaveCount(0)
})
Then('closing the semantic chooser preserves both fixed threads and the pin', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'native-new-tab-closes-without-resource-loss'), async () => {
    const chooserTab = await tabOfChooser(chooserIn(mainPane(page)))
    await chooserTab.getByRole('button', { name: 'Close New tab', exact: true }).click()
    await expect(chooserTab).toHaveCount(0)
    await expect(dockTab(mainDock(page), 'Current conversation')).toHaveCount(0)
    await expect(threadDockTab(page, 'first')).toHaveCount(1)
    await expect(threadDockTab(page, 'second').getByLabel('Pinned', { exact: true })).toBeVisible()
    const saved = await page.evaluate(() => localStorage.getItem('dshfiles.main-tabs.v1') ?? '')
    expect(saved).not.toContain('"kind":"start"')
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})
When('the first Workbench thread is marked unread from its sidebar row', async ({ page }: { page: Page }) => {
  const ids = workbenchThreads.get(page)
  if (ids === undefined) throw new Error('Workbench thread fixture is missing.')
  await threadRow(page, ids.first).click({ button: 'right', position: { x: 24, y: 16 } })
  await page.getByRole('menuitem', { name: 'Mark unread', exact: true }).click()
})
Then('its Dockview tab shows an unread indicator that clears when opened', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'unread-clears-on-open'), async () => {
    const first = threadDockTab(page, 'first')
    await expect(first.getByLabel(/unread/)).toBeVisible()
    await first.click()
    await expect(first.getByLabel(/unread/)).toHaveCount(0)
    const ids = workbenchThreads.get(page)
    if (ids === undefined) throw new Error('Workbench thread fixture is missing.')
    await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(ids.first)
  })
})
When('a Jujutsu preview is opened and closed from its Dockview tab', async ({ page }: { page: Page }) => {
  await openGlobalPanel(page, 'Jujutsu')
  const tab = dockTab(mainDock(page), 'Jujutsu')
  await expect(tab.locator('[data-preview="true"]')).toBeVisible()
  await tab.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Float panel', exact: true }).click()
  const floating = page.locator('.dv-groupview-floating').filter({ has: page.getByRole('tab', { name: reusableViewName('Jujutsu'), exact: true }) })
  await expect(floating).toBeVisible()
  await floating.getByRole('button', { name: `Close ${reusableViewName('Jujutsu')}`, exact: true }).click()
  await expect(floating).toHaveCount(0)
})
Then('the pinned thread remains open and its conversation can still receive a draft', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'pinned-thread-survives-close'), async () => {
    await threadDockTab(page, 'second').click()
    await expect(threadDockTab(page, 'second').getByLabel('Pinned', { exact: true })).toBeVisible()
    const ids = workbenchThreads.get(page)
    if (ids === undefined) throw new Error('Workbench thread fixture is missing.')
    // A retained previous conversation can still be visible while this tab's
    // activation commits. Bind to the requested Session, not whichever editor
    // happens to be visible when Playwright resolves its action handle.
    await page.evaluate(
      async ({ id, prompt }) => {
        await new Promise<void>((resolve, reject) => {
          let frame = 0
          let readyFrames = 0
          const watchdog = window.setTimeout(() => {
            cancelAnimationFrame(frame)
            reject(new Error('The selected Session did not bind its visible history and editable composer.'))
          }, 15_000)
          const check = (): void => {
            const root = [...document.querySelectorAll<HTMLElement>('[data-slot="shell.main"] [data-conversation-session]')].find(
              element => element.dataset.conversationSession === id && element.checkVisibility(),
            )
            const editor = root?.querySelector<HTMLElement>('[data-conversation-region="composer"] [role="textbox"]')
            const ready =
              root?.querySelector('[data-chat-flow]')?.textContent?.includes(prompt) === true &&
              editor !== undefined &&
              editor !== null &&
              editor.checkVisibility() &&
              editor.getAttribute('aria-disabled') !== 'true' &&
              editor.isContentEditable
            readyFrames = ready ? readyFrames + 1 : 0
            if (readyFrames < 2) {
              frame = requestAnimationFrame(check)
              return
            }
            window.clearTimeout(watchdog)
            resolve()
          }
          frame = requestAnimationFrame(check)
        })
      },
      { id: ids.second, prompt: threadPrompt('second') },
    )
    const subject = mainSeat(page).locator(`[data-conversation-session="${ids.second}"]`).filter({ visible: true })
    const composer = subject.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })
    await composer.fill('Draft after closing a global panel')
    await expect(composer).toHaveText('Draft after closing a global panel')
  })
})

When('a disposable Workbench resource thread edits two real files', async ({ page }: { page: Page }) => {
  await createWorkbenchWorkspace(page)
  await selectModelForNewThread(page, 'commandcode_work/gpt-6-luna')
  const calls = ['alpha.txt', 'beta.txt']
    .map(file => `[[call write ${JSON.stringify({ file_path: file, content: `Workbench ${file} real diff\n` })}]]`)
    .join(' ')
  await sendMessage(page, calls)
  // The provider returns genuine Markdown; the real file-link delegate owns opening its resource.
  await sendMessage(page, '[[answer Open [preview.txt](preview.txt) in the file preview.]]')
})
When('the Workbench thread opens a real file link and its turn review', async ({ page }: { page: Page }) => {
  await nativeConversationTab(page).click()
  await mainSeat(page).getByRole('button', { name: 'preview.txt', exact: true }).click()
  await expect(dockRegion(page).locator('[data-sidebar-resource-panel]').filter({ hasText: 'Workbench native preview content' })).toBeVisible()
  // Return to the conversation through the visible tab rather than opening a synthetic resource address.
  await nativeConversationTab(page).click()
  await mainSeat(page).getByRole('button', { name: 'Review this turn’s changes in the sidebar', exact: true }).first().click()
})
When('the Workbench command palette opens a new native terminal', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Search threads', exact: true }).click()
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
  await expect(palette).toBeVisible()
  await palette.getByRole('tab', { name: 'Everything', exact: true }).click()
  await palette.getByRole('combobox').fill('New terminal')
  await palette
    .getByRole('option', { name: /New terminal/ })
    .first()
    .click()
  await expect(dockRegion(page).locator('[data-sidebar-resource-panel] .xterm')).toBeVisible()
})
Then('file preview diff review and terminal each have a native owned Workbench panel', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'native-resource-owners'), async () => {
    const resources = dockRegion(page).locator('[data-sidebar-resource-panel]')
    await expect(resources).toHaveCount(3)
    await expect(dockRegion(page).locator('[data-slot="sidebar.right.pane.tab"]')).toHaveCount(3)
    await expect(dockRegion(page).locator('.xterm')).toBeVisible()
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
    await expect(dockRegion(page).getByRole('tab', { name: 'preview.txt', exact: true })).toBeVisible()
    await expect(dockRegion(page).getByRole('tab', { name: /^Review\b/ })).toBeVisible()
  })
})
Then('the native resource panels restore with their real contents', async ({ page }: { page: Page }) => {
  await setRightPaneVisible(page, false)
  await StartupDialogs.reloadPastProviderSetup(page)
  await recordAssertion(page, acceptanceId(page, 'resources-closed-reload'), async () => {
    await paneOptions(page)
    await expect(page.getByRole('menuitem', { name: 'Open right pane', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(surfaceOf(dockRegion(page))).toBeHidden()
    await expect(dockRegion(page).locator('[data-sidebar-resource-panel]')).toHaveCount(3)
    await expect(dockRegion(page).locator('[data-sidebar-resource-panel][aria-hidden="true"]')).toHaveCount(3)
  })
  await setRightPaneVisible(page, true)
  await recordAssertion(page, acceptanceId(page, 'resources-reload'), async () => {
    await expect(dockRegion(page).locator('[data-sidebar-resource-panel]')).toHaveCount(3)
    await dockRegion(page).getByRole('tab', { name: 'preview.txt', exact: true }).click()
    await expect(dockRegion(page).getByText('Workbench native preview content', { exact: false })).toBeVisible()
    await dockRegion(page)
      .getByRole('tab', { name: /^Review\b/ })
      .click()
    await expect(dockRegion(page).getByRole('button', { name: 'Choose the file to review', exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('native-resource-panels.png'), animations: 'disabled' })
    await dockRegion(page)
      .getByRole('tab', { name: /^Terminal\b/ })
      .click()
    await expect(dockRegion(page).locator('.xterm')).toBeVisible()
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})

When('the main pane is split right beside Editor through Pane options', async ({ page }: { page: Page }) => {
  await addRegisteredPanel(page, mainPane(page), 'Editor')
  await paneAction(page, dockBody(mainDock(page), 'Editor'), 'Split right')
  await expect(mainDock(page).locator('.dv-groupview')).toHaveCount(2)
  const chooser = chooserIn(mainPane(page))
  await expect(chooser).toBeVisible()
  await chooser.getByRole('button', { name: reusableViewName('Jujutsu'), exact: true }).click()
  const editor = await dockTab(mainDock(page), 'Editor').getAttribute('data-tab-panel-id')
  const jujutsu = await dockTab(mainDock(page), 'Jujutsu').getAttribute('data-tab-panel-id')
  if (editor === null || jujutsu === null) throw new Error('Split panel identities are missing.')
  splitPanelIds.set(page, { editor, jujutsu })
})
Then('Editor and Jujutsu occupy real adjacent groups without a nested container', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'split-right-real-groups'), async () => {
    await expect(mainDock(page).locator('.dv-groupview')).toHaveCount(2)
    await expect(mainSeat(page).locator('[data-workbench-region^="nested/"]')).toHaveCount(0)
    await expect(dockTab(mainDock(page), 'Nested surface')).toHaveCount(0)
    const editor = await dockBody(mainDock(page), 'Editor').boundingBox()
    const jujutsu = await dockBody(mainDock(page), 'Jujutsu').boundingBox()
    if (editor === null || jujutsu === null) throw new Error('Split groups are not visible.')
    expect(jujutsu.x).toBeGreaterThan(editor.x + 50)
    expect(Math.abs(editor.y - jujutsu.y)).toBeLessThanOrEqual(2)
  })
})
When('the split Jujutsu tab is dragged into the Editor group', async ({ page }: { page: Page }) => {
  await dragTabOnto(page, dockTab(mainDock(page), 'Jujutsu'), await panelBodyForTab(dockTab(mainDock(page), 'Editor')))
})
Then('the two panels share one group with their original identities', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'split-drag-merges-groups'), async () => {
    await expect(mainDock(page).locator('.dv-groupview')).toHaveCount(1)
    await assertSplitPanelIdentities(page)
  })
})
When('Jujutsu is split down through its group Pane options', async ({ page }: { page: Page }) => {
  await paneAction(page, dockBody(mainDock(page), 'Jujutsu'), 'Split down')
  await chooserIn(mainPane(page))
    .getByRole('button', { name: reusableViewName('Jujutsu'), exact: true })
    .click()
})
const assertSplitPanelIdentities = async (page: Page): Promise<void> => {
  const ids = splitPanelIds.get(page)
  if (ids === undefined) throw new Error('Split panel fixture is missing.')
  await expect(dockTab(mainDock(page), 'Editor')).toHaveAttribute('data-tab-panel-id', ids.editor)
  await expect(dockTab(mainDock(page), 'Jujutsu')).toHaveAttribute('data-tab-panel-id', ids.jujutsu)
  const saved = await page.evaluate(key => localStorage.getItem(key) ?? '', MAIN_LAYOUT_KEY)
  expect(saved).toContain(ids.editor)
  expect(saved).toContain(ids.jujutsu)
  await expect(page.locator('[data-slot-error]')).toHaveCount(0)
}
Then('the downward split restores both original panels after reload', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'split-down-reload'), async () => {
    await expect(mainDock(page).locator('.dv-groupview')).toHaveCount(2)
    const editor = await dockBody(mainDock(page), 'Editor').boundingBox()
    const jujutsu = await dockBody(mainDock(page), 'Jujutsu').boundingBox()
    if (editor === null || jujutsu === null) throw new Error('Restored split groups are not visible.')
    expect(jujutsu.y).toBeGreaterThan(editor.y + 50)
    await assertSplitPanelIdentities(page)
  })
})
Then(
  'the owned Trajectory view is bound to the first thread without changing the current thread or duplicating its composer',
  async ({ page }: { page: Page }) => {
    await recordAssertion(page, acceptanceId(page, 'scoped-conversation-view'), async () => {
      const ids = workbenchThreads.get(page)
      if (ids === undefined) throw new Error('Missing Workbench thread fixture')
      await dockTab(mainDock(page), `Trajectory — ${threadPrompt('first')}`).click()
      const view = mainSeat(page).locator('[data-workbench-conversation-view="trajectory"]')
      await expect(view).toBeVisible()
      await expect(view).toHaveAttribute('data-workbench-conversation-session', ids.first)
      await expect(view.locator('[data-slot="conversation.view"]')).toBeAttached()
      await expect(view.getByRole('textbox')).toHaveCount(0)
      await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(ids.second)
      await expect(page.locator('[data-slot-error]')).toHaveCount(0)
    })
  },
)

Then('the reusable view picker offers plugins without per-thread trajectories', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'reusable-picker'), async () => {
    const chooser = await clickNewTab(mainPane(page))
    await expect(dockTab(mainDock(page), 'New tab').filter({ visible: true }).last()).toBeVisible()
    await expect(chooser.getByRole('textbox', { name: 'Search views', exact: true })).toBeVisible()
    await expect(chooser.getByRole('button', { name: reusableViewName('Current conversation'), exact: true })).toHaveCount(0)
    await expect(chooser.getByRole('button', { name: /Trajectory|Workbench first conversation|Workbench second conversation/ })).toHaveCount(0)
    await expect(chooser.getByRole('button', { name: reusableViewName('Plugins'), exact: true })).toBeVisible()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await dockTab(mainDock(page), 'New tab').filter({ visible: true }).last().getByRole('button', { name: 'Close New tab', exact: true }).click()
  })
  await assertTabPlusAlignment(page)
})

Then('the left pane content is tab controlled between fixed chrome', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'tabbed-left-pane'), async () => {
    const left = page.locator('[data-workbench-region="left"]')
    await expect(dockTab(left, 'Threads')).toBeVisible()
    await expect(dockTab(left, 'Navigation')).toBeVisible()
    await expect(left.getByRole('tab', { name: 'AI Accounts: Preview', exact: true })).toBeVisible()
    await expect(left.locator('[data-workbench-panel-id="dshfiles-thread-sidebar.workbench-status"]')).toHaveCount(1)
    await expect(left.locator('.dv-tabs-and-actions-container').getByRole('button', { name: 'New tab', exact: true })).toHaveCount(3)
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible()
    const sidebarSettings = left.getByRole('button', { name: 'Sidebar settings', exact: true })
    await expect(sidebarSettings).toBeVisible()
    expect(await sidebarSettings.evaluate(element => element.closest('[data-workbench-panel-id]')?.getAttribute('data-workbench-panel-id'))).toBe(
      'dshfiles-thread-sidebar.workbench-threads',
    )
    await expect(page.getByRole('button', { name: 'Customize sidebar', exact: true })).toHaveCount(0)
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('tabbed-workbench.png'), animations: 'disabled' })
  })
})

When('the real Threads view is opened through every pane chooser', async ({ page }: { page: Page }) => {
  const panes = ['main', 'right', 'bottom', 'left'] as const
  for (const target of panes) {
    const pane = page.locator(`[data-workbench-region="${target}"]`).first()
    await addRegisteredPanel(page, pane, 'Threads')
    await assertTabPlusAlignment(page)
    await recordAssertion(page, acceptanceId(page, `threads-view-in-${target}`), async () => {
      await expect(dockTab(pane, 'Threads')).toBeVisible()
      await expect(pane.locator('[data-sidebar-workbench-source="dshfiles-thread-sidebar.workbench-threads"]')).toBeVisible()
      await expect(pane.locator('[data-slot="sidebar.workspaces"]')).toBeAttached()
      await expect(pane.getByRole('button', { name: 'New thread', exact: true })).toBeVisible()
      await expect(page.getByRole('tab', { name: reusableViewName('Threads'), exact: true })).toHaveCount(1)
      await expect(page.locator('[data-slot-error]')).toHaveCount(0)
      if (target === 'bottom') await page.screenshot({ path: test.info().outputPath('threads-in-bottom-pane.png'), animations: 'disabled' })
    })
  }
})

When('a plugin view is moved into the collapsed left pane', async ({ page }: { page: Page }) => {
  await addRegisteredPanel(page, mainPane(page), 'Jujutsu')
  await dockTab(mainDock(page), 'Jujutsu').click()
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await expect(page.locator('[data-workbench-region="left"]')).toBeHidden()
  await movePanel(page, mainPane(page), 'Move to the left pane')
})
Then('the left pane reveals the explicitly moved plugin view', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'left-move-reveals-collapsed-pane'), async () => {
    const left = page.locator('[data-workbench-region="left"]')
    await expect(left).toBeVisible()
    await expect(dockTab(left, 'Jujutsu')).toBeVisible()
    await expect(dockTab(mainDock(page), 'Jujutsu')).toHaveCount(0)
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})

When('Reset layout is used from a remaining Workbench surface', async ({ page }: { page: Page }) => {
  await paneAction(page, mainPane(page), 'Reset layout')
})

Then('the main chat tab and composer are recovered without losing its pin', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'reset-recovers-conversation'), async () => {
    const tab = threadDockTab(page, 'second')
    await expect(tab).toBeVisible()
    await expect(tab.getByLabel('Pinned', { exact: true })).toBeVisible()
    await expect(dockRegion(page).getByRole('tab', { name: threadPrompt('second'), exact: true })).toHaveCount(0)
    await tab.click()
    await expect(mainSeat(page).getByRole('textbox', { name: /Message or run a task|Describe what you want to build/ })).toBeVisible()
    await expect(mainPane(page).getByRole('button', { name: 'New tab', exact: true }).first()).toBeVisible()
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})

Then('the default centre is the dockable Workbench', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'default-main-surface'), async () => {
    await expect(page.locator('[data-main-surface="workbench"]')).toBeVisible()
    await expect(mainDock(page)).toBeVisible()
    await expect(nativeConversationTab(page)).toBeVisible()
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})
Given('an isolated Workbench profile with saved legacy native preferences is booted', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: [
      '@dshfiles/frame-layout',
      '@dshfiles/workbench',
      '@dshfiles/sidebar-right',
      '@dshfiles/editor',
      '@dshfiles/thread-sidebar',
      '@dshfiles/workspace-folder-picker',
      '@dshfiles/session-controller',
      '@dshfiles/rich-composer',
      '@dshfiles/chat',
      '@dshfiles/multi-host',
      '@dshfiles/jj-integration',
      '@dshfiles/ai-accounts',
    ],
    profileLabel: 'workbench-legacy-native-preferences',
    cordisPatch: `- id: dshfiles-workbench
  config:
    mainSurface: native
    rightPanel: native
    headerToggle: false
    demoPanels: true
`,
  })
  await visitIsolatedPluginProfile(page, profile)
  await paneOptions(page)
  await expect(page.getByRole('menuitem', { name: 'Open right pane', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('dshfiles.workbench.right-pane-visible.v1'))).toBe('false')
})

Then('no native surface choice is exposed in Workbench settings', async ({ page }: { page: Page }) => {
  await openGlobalPanel(page, 'Plugins')
  await page.getByRole('button', { name: 'View @dshfiles/workbench', exact: true }).click()
  await recordAssertion(page, acceptanceId(page, 'unified-settings-no-native-choice'), async () => {
    await expect(
      page.getByText('Show the tabbed bottom pane below the left and centre columns. The right pane remains full height.', { exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Main surface', exact: true })).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Right panel', exact: true })).toHaveCount(0)
    await expect(page.getByRole('radio', { name: 'Native main view', exact: true })).toHaveCount(0)
    await expect(page.getByText('Native main view', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Per-thread (the native right sidebar)', { exact: true })).toHaveCount(0)
    await expect(page.locator('[data-main-surface="native"]')).toHaveCount(0)
    await expect(page.locator('[data-native-rightbar-carrier]')).toBeHidden()
  })
})

When('the unified right pane is revealed from the main Pane options', async ({ page }: { page: Page }) => {
  await setRightPaneVisible(page, true)
})
Then('the migrated right pane visibility survives the reload', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'legacy-preference-migrated-once'), async () => {
    await expect(paneRoot(page, 'right').getByRole('button', { name: 'Close pane', exact: true }).first()).toBeVisible()
    await expect(surfaceOf(dockRegion(page))).toBeVisible()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('dshfiles.workbench.right-pane-visible.v1'))).toBe('true')
    await expect(page.locator('[data-native-rightbar-carrier]')).toBeHidden()
  })
})

const retainedFixedRightInputs = new WeakMap<Page, ElementHandle<SVGElement | HTMLElement>>()
When('the second fixed conversation is moved into the right pane', async ({ page }: { page: Page }) => {
  await threadDockTab(page, 'second').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open in side panel', exact: true }).click()
  await expect(dockTab(dockRegion(page), threadPrompt('second'))).toBeVisible()
  await expect(threadDockTab(page, 'second')).toHaveCount(0)
})
Then('sidebar switching keeps the right conversation fixed while the bottom stays independent', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'right-fixed-thread-keeps-input-owner'), async () => {
    const ids = workbenchThreads.get(page)
    if (ids === undefined) throw new Error('Workbench thread fixture is missing.')
    const rightTab = dockTab(dockRegion(page), threadPrompt('second'))
    const body = await panelBodyForTab(rightTab)
    const composer = fixedComposer(body)
    await expect(composer).toBeVisible()
    await expect(composer).toBeEditable()
    const input = await composer.elementHandle()
    if (input === null) throw new Error('The moved fixed conversation input is missing.')
    retainedFixedRightInputs.set(page, input)
    for (const index of ['first', 'second', 'first'] as const) {
      await openThreadRow(page, ids[index])
      await expect(body.locator('[data-conversation-session]')).toHaveAttribute('data-conversation-session', ids.second)
      await expect(body.locator('[data-chat-flow]')).toContainText(threadPrompt('second'))
      await expect(composer).toBeVisible()
      await expect(composer).toBeEditable()
      await expect(composer).toHaveText(fixedDraft('second'))
      expect(await composer.evaluate((element, previous) => element === previous, input)).toBe(true)
      const first = await fixedConversation(page, 'first')
      await expect(first.locator('[data-conversation-session]')).toHaveAttribute('data-conversation-session', ids.first)
    }
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key) ?? '', DOCK_LAYOUT_KEY)).toContain(tabPanelId(`thread:${ids.second}`))
    await expect(chooserIn(paneRoot(page, 'bottom'))).toBeVisible()
    await expect(page.getByRole('tab', { name: threadPrompt('second'), exact: true })).toHaveCount(1)
    await assertNoGlobalConversationAliases(page)
  })
})

const retainedRightDrafts = new WeakMap<Page, { readonly element: ElementHandle<SVGElement | HTMLElement>; readonly mounts: string }>()
const RIGHT_DRAFT = 'Draft retained across hiding the full-height right pane'

When('the original right sidebar shortcut opens the Workbench pane', async ({ page }: { page: Page }) => {
  await paneOptions(page)
  await expect(page.getByRole('menuitem', { name: 'Open right pane', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  // Use the same platform source as the native shortcut registry, not the browser user agent.
  // Keep focus on the page, outside any editable or terminal-owned shortcut region.
  await mainPane(page).getByRole('button', { name: 'Pane options', exact: true }).first().focus()
  const mac = await page.evaluate(() => (document.documentElement.dataset.platform ?? navigator.platform).toLowerCase().includes('mac'))
  await page.keyboard.press(mac ? 'Meta+Shift+B' : 'Control+Shift+B')
  await expect(paneRoot(page, 'right').getByRole('button', { name: 'Close pane', exact: true }).first()).toBeVisible()
  await expect(surfaceOf(dockRegion(page))).toBeVisible()
  await expect(page.locator('[data-native-rightbar-carrier]')).toBeHidden()
})

const assertFullHeightRightPane = async (page: Page, bottomShown: boolean): Promise<void> => {
  await expect
    .poll(async () => {
      const right = await page.locator('[data-workbench-region="right"]').boundingBox()
      const frame = await page.locator('[data-rightbar-col]').locator('..').boundingBox()
      const bottom = bottomShown ? await page.locator('[data-shell-bottom]').boundingBox() : null
      if (right === null || frame === null || right.width <= 0) return false
      const fullHeight = Math.abs(right.y - frame.y) <= 2 && Math.abs(right.y + right.height - frame.y - frame.height) <= 2
      if (!bottomShown) return fullHeight
      return (
        fullHeight &&
        bottom !== null &&
        bottom.height > 0 &&
        Math.abs(bottom.x + bottom.width - right.x) <= 2 &&
        Math.abs(bottom.y + bottom.height - frame.y - frame.height) <= 2
      )
    })
    .toBe(true)
}

Then('the right Workbench pane fills the frame height', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'right-pane-full-height'), () => assertFullHeightRightPane(page, false))
})
When('a Scratchpad view in the right pane receives a draft', async ({ page }: { page: Page }) => {
  await addRegisteredPanel(page, paneRoot(page, 'right'), 'Scratchpad')
  const textarea = dockRegion(page).getByRole('textbox', { name: 'Scratchpad', exact: true })
  await textarea.fill(RIGHT_DRAFT)
  await expect(dockRegion(page).getByTestId('mounts')).toHaveText('1')
  const element = await textarea.elementHandle()
  if (element === null) throw new Error('The live Scratchpad textarea did not mount.')
  retainedRightDrafts.set(page, { element, mounts: await dockRegion(page).getByTestId('mounts').innerText() })
})
When('the bottom panel is shown from the main Pane options', async ({ page }: { page: Page }) => {
  await paneAction(page, mainPane(page), 'Toggle the bottom panel')
  await expect(surfaceOf(bottomRegion(page))).toBeVisible()
})
Then('the right Workbench pane stays full height and the bottom ends at its left edge', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'right-full-height-beside-bottom'), async () => {
    await assertFullHeightRightPane(page, true)
    await expect(dockRegion(page).getByRole('textbox', { name: 'Scratchpad', exact: true })).toHaveValue(RIGHT_DRAFT)
    await page.screenshot({ path: test.info().outputPath('workbench-full-height-right-and-bottom.png'), animations: 'disabled' })
  })
})

Then('the same right pane draft remains mounted while hidden', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'hidden-dock-retains-live-draft'), async () => {
    const retained = retainedRightDrafts.get(page)
    if (retained === undefined) throw new Error('No right-pane draft fixture was recorded.')
    await expect(surfaceOf(dockRegion(page))).toBeHidden()
    await expect(dockRegion(page).locator('textarea[aria-label="Scratchpad"]')).toHaveValue(RIGHT_DRAFT)
    expect(await retained.element.evaluate(element => element.isConnected)).toBe(true)
    const fixedInput = retainedFixedRightInputs.get(page)
    if (fixedInput !== undefined) expect(await fixedInput.evaluate(element => element.isConnected)).toBe(true)
    await expect(page.locator('[data-native-rightbar-carrier]')).toBeHidden()
  })
})
Then('the same right pane view and draft are restored without remounting', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'right-draft-restores-without-remount'), async () => {
    const retained = retainedRightDrafts.get(page)
    if (retained === undefined) throw new Error('No right-pane draft fixture was recorded.')
    const textarea = dockRegion(page).getByRole('textbox', { name: 'Scratchpad', exact: true })
    await expect(textarea).toBeVisible()
    await expect(textarea).toHaveValue(RIGHT_DRAFT)
    expect(await textarea.evaluate((element, previous) => element === previous, retained.element)).toBe(true)
    await expect(dockRegion(page).getByTestId('mounts')).toHaveText(retained.mounts)
    const fixedInput = retainedFixedRightInputs.get(page)
    if (fixedInput !== undefined) {
      const fixed = await panelBodyForTab(dockTab(dockRegion(page), threadPrompt('second')))
      const composer = fixed.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true, includeHidden: true })
      expect(await composer.evaluate((element, previous) => element === previous, fixedInput)).toBe(true)
      await expect(composer).toHaveText(fixedDraft('second'))
    }
    await assertFullHeightRightPane(page, true)
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})

Then('the quiet pane tab strips fit at 360 480 768 and 1024 pixels', async ({ page }: { page: Page }) => {
  for (const width of [360, 480, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    await assertTabPlusAlignment(page)
    await recordAssertion(page, acceptanceId(page, `header-${width}`), async () => {
      const strips = mainPane(page).locator('.dv-tabs-and-actions-container')
      for (let index = 0; index < (await strips.count()); index += 1) {
        const strip = strips.nth(index)
        await expect.poll(() => strip.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
        for (const label of ['New tab', 'Pane options']) {
          const button = strip.getByRole('button', { name: label, exact: true })
          await expect(button).toBeVisible()
          const box = await button.boundingBox()
          if (box === null) throw new Error(`Missing group action: ${label}`)
          expect(box.x).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
        }
      }
      await expect(mainPane(page).locator(':scope > header')).toHaveCount(0)
      await paneOptions(page)
      for (const label of ['Open right pane', 'Toggle the bottom panel', 'Layouts', 'Move tab to', 'Split right', 'Split down', 'Reset layout'])
        await expect(page.getByRole('menuitem', { name: label, exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await page.screenshot({ path: test.info().outputPath(`workbench-main-${width}.png`), animations: 'disabled' })
      await expect(page.locator('[data-slot-error]')).toHaveCount(0)
    })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
})
When('the main Editor tab is dragged to split beside Jujutsu', async ({ page }: { page: Page }) => {
  await dragTabOnto(page, dockTab(mainDock(page), 'Editor'), mainDock(page).locator('.dv-content-container').first(), { x: 0.95, y: 0.5 })
})
Then('both split groups and their tab strip actions remain reachable', async ({ page }: { page: Page }) => {
  await assertTabPlusAlignment(page)
  await recordAssertion(page, acceptanceId(page, 'responsive-split'), async () => {
    await expect(mainDock(page).locator('.dv-groupview')).toHaveCount(2)
    await expect(dockTab(mainDock(page), 'Editor')).toBeVisible()
    await expect(dockTab(mainDock(page), 'Jujutsu')).toBeVisible()
    for (const [index, group] of (await mainDock(page).locator('.dv-groupview').all()).entries()) {
      await expect(group.getByRole('button', { name: 'New tab', exact: true })).toBeVisible()
      await expect(group.getByRole('button', { name: 'Pane options', exact: true })).toBeVisible()
      await paneOptions(page, group)
      await expect(page.getByRole('menuitem', { name: 'Split down', exact: true })).toBeVisible()
      const menu = page.getByRole('menu', { name: 'Pane options', exact: true })
      const attachMenuFocus = async (phase: string): Promise<void> => {
        const state = await page.evaluate(() => {
          const active = document.activeElement
          return {
            focusedElement:
              active === null ? null : { tag: active.tagName, id: active.id, role: active.getAttribute('role'), slot: active.getAttribute('data-slot') },
            contents: Array.from(document.querySelectorAll('[data-radix-menu-content]')).map(content => ({
              id: content.id,
              state: content.getAttribute('data-state'),
              focused: active === content,
              containsFocus: active !== null && content.contains(active),
            })),
          }
        })
        await test.info().attach(`responsive-split-${index}-${phase}`, { body: JSON.stringify(state, null, 2), contentType: 'application/json' })
      }
      await attachMenuFocus('before-escape')
      // Wait for Radix's own pointer-open autofocus, not Locator.press's forced focus, before dismissing the menu.
      await expect(menu).toBeFocused()
      await menu.press('Escape')
      await attachMenuFocus('after-escape')
      await expect(menu).toHaveCount(0)
    }
    await page.screenshot({ path: test.info().outputPath('workbench-main-split.png'), animations: 'disabled' })
  })
})

When('each empty auxiliary pane presents its own New tab chooser', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'empty-panes-are-chooser-tabs'), async () => {
    for (const region of ['right', 'bottom'] as const) {
      const pane = paneRoot(page, region)
      await expect(pane.getByRole('tab')).toHaveCount(1)
      await expect(dockTab(pane, 'New tab')).toHaveAttribute('aria-selected', 'true')
      await expect(chooserIn(pane)).toHaveCount(1)
      await expect(chooserIn(pane).getByRole('textbox', { name: 'Search views', exact: true })).toBeVisible()
    }
    // Both defaults coexist: no global singleton-chooser assumption.
    await expect(chooserIn(paneRoot(page, 'right'))).toBeVisible()
    await expect(chooserIn(paneRoot(page, 'bottom'))).toBeVisible()
  })
})
When('the main pane gains another chooser group with Split right', async ({ page }: { page: Page }) => {
  await paneAction(page, mainPane(page), 'Split right')
  await expect(mainDock(page).locator('.dv-groupview')).toHaveCount(2)
})
Then('every group plus opens a real searchable New tab instead of a menu', async ({ page }: { page: Page }) => {
  for (const region of ['main', 'right', 'bottom', 'left'] as const) {
    const pane = page.locator(`[data-workbench-region="${region}"]`).first()
    const groups = pane.locator('.dv-groupview')
    const count = await groups.count()
    expect(count).toBeGreaterThan(0)
    for (let index = 0; index < count; index += 1) {
      const group = groups.nth(index)
      await recordAssertion(page, acceptanceId(page, `${region}-group-${index}-real-new-tab`), async () => {
        // A split can expose its group shell before accessibility/layout catches up.
        // Count the actual headers, including overflowed tabs, only after the group has rendered.
        const tabs = group.getByRole('tab', { includeHidden: true })
        await expect(tabs.first()).toBeVisible()
        const before = await tabs.count()
        const originalIds = await group
          .locator('[data-workbench-tab-id]')
          .evaluateAll(headers => headers.map(header => header.getAttribute('data-workbench-tab-id')))
        expect(originalIds).toHaveLength(before)
        const chooser = await clickNewTab(group)
        await expect(tabs).toHaveCount(before + 1)
        const openedIds = await group
          .locator('[data-workbench-tab-id]')
          .evaluateAll(headers => headers.map(header => header.getAttribute('data-workbench-tab-id')))
        expect(openedIds).toEqual(expect.arrayContaining(originalIds))
        const tab = dockTab(group, 'New tab').last()
        await expect(tab).toHaveAttribute('aria-selected', 'true')
        await expect(page.getByRole('menu')).toHaveCount(0)
        await expect(chooser.getByRole('button', { name: reusableViewName('Current conversation'), exact: true })).toHaveCount(0)
        const search = chooser.getByRole('textbox', { name: 'Search views', exact: true })
        await expect(search).toBeFocused()
        await search.fill('Settings')
        await expect(chooser.getByRole('button')).toHaveCount(1)
        await expect(chooser.getByRole('button', { name: reusableViewName('Settings'), exact: true })).toBeVisible()
        await expect(chooser.getByRole('button', { name: /^Settings:/ })).toHaveCount(0)
        await search.fill('Editor')
        await expect(chooser.getByRole('button', { name: reusableViewName('Editor'), exact: true })).toBeVisible()
        await expect(chooser.getByRole('button', { name: reusableViewName('Current conversation'), exact: true })).toHaveCount(0)
        await search.fill('no-view-matches-this-query')
        await expect(chooser.getByRole('button')).toHaveCount(0)
        await expect(chooser.getByText('No matching views.', { exact: true })).toBeVisible()
        await tab.getByRole('button', { name: 'Close New tab', exact: true }).click()
        await expect(tabs).toHaveCount(before)
        await expect
          .poll(() => group.locator('[data-workbench-tab-id]').evaluateAll(headers => headers.map(header => header.getAttribute('data-workbench-tab-id'))))
          .toEqual(originalIds)
      })
    }
  }
  await assertTabPlusAlignment(page)
})
Then('choosing Editor replaces only its chooser tab and preserves the other panes', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'chooser-selection-is-group-local'), async () => {
    const group = mainDock(page).locator('.dv-groupview').last()
    const chooser = await chooserForGroup(group)
    const before = await group.getByRole('tab').count()
    await chooser.getByRole('button', { name: reusableViewName('Editor'), exact: true }).click()
    await expect(chooser).toHaveCount(0)
    await expect(dockTab(group, 'New tab')).toHaveCount(0)
    await expect(dockTab(group, 'Editor')).toBeVisible()
    await expect(group.getByRole('tab')).toHaveCount(before)
    const editor = await panelBodyForTab(dockTab(group, 'Editor'))
    await expect(editor.getByRole('tree', { name: 'Workspace files', exact: true })).toBeVisible()
    await expect(editor.getByRole('treeitem', { name: 'preview.txt', exact: true })).toBeVisible()
    for (const region of ['right', 'bottom'] as const) {
      await expect(dockTab(paneRoot(page, region), 'New tab')).toBeVisible()
      await expect(chooserIn(paneRoot(page, region))).toHaveCount(1)
    }
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})
When('a real Backlog tab is saved inactive beside the current conversation', async ({ page }: { page: Page }) => {
  await threadDockTab(page, 'second').dblclick()
  await addRegisteredPanel(page, dockBody(mainDock(page), threadPrompt('second')), 'Backlog')
  await expect(mainSeat(page).getByRole('textbox', { name: 'Capture', exact: true })).toBeVisible()
  await dockTab(mainDock(page), 'Backlog')
    .getByRole('button', { name: `Close ${reusableViewName('Backlog')}`, exact: true })
    .click()
  // The chooser owns a presentation tab. The Navigation action additionally exercises the saved native tab actor
  // from the original inactive-Backlog reload regression, without injecting a tab or persistence payload.
  await openGlobalPanel(page, 'Backlog')
  await expect(dockTab(mainDock(page), 'Backlog')).toBeVisible()
  await dockTab(mainDock(page), 'Backlog').dblclick()
  await expect(mainSeat(page).getByRole('textbox', { name: 'Capture', exact: true })).toBeVisible()
  await threadDockTab(page, 'second').click()
  await expect(dockTab(mainDock(page), 'Backlog')).toHaveAttribute('aria-selected', 'false')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('dshfiles.main-tabs.v1') ?? '')).toContain('dshfiles-backlog-panel')
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key) ?? '', MAIN_LAYOUT_KEY)).toContain('Backlog')
})
Then('the conversation and saved Backlog tab restore without losing their plugin owners', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'inactive-backlog-reload-preserves-context'), async () => {
    const ids = workbenchThreads.get(page)
    if (ids === undefined) throw new Error('Workbench thread fixture is missing.')
    await expect(dockTab(mainDock(page), 'Backlog')).toHaveAttribute('aria-selected', 'false')
    const conversation = mainSeat(page).locator(`[data-conversation-session="${ids.second}"]`).filter({ visible: true })
    await expect(conversation.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })).toBeVisible()
    await expect(conversation.getByText(threadPrompt('second'), { exact: true }).last()).toBeVisible()
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
    await dockTab(mainDock(page), 'Backlog').click()
    const capture = mainSeat(page).getByRole('textbox', { name: 'Capture', exact: true })
    await expect(capture).toBeVisible()
    await expect(capture).toHaveAttribute('placeholder', 'Capture a thought, a task, a bug… like sending a message')
    await expect(mainSeat(page).getByRole('navigation', { name: 'Backlog views', exact: true })).toBeVisible()
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('saved-backlog-owner-context.png'), animations: 'disabled' })
    await threadDockTab(page, 'second').click()
    await expect(conversation.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })).toBeVisible()
  })
})

const assertQuietPaneChrome = async (page: Page): Promise<void> => {
  for (const region of ['main', 'right', 'bottom'] as const) {
    const pane = page.locator(`[data-workbench-region="${region}"]`).first()
    await expect(pane.locator(':scope > header')).toHaveCount(0)
    await expect(pane.getByRole('heading', { name: /^(Workbench|Panels|Panel)$/ })).toHaveCount(0)
    await expect(pane.getByRole('button', { name: /^(Add panel|Add nested surface|New view)$/ })).toHaveCount(0)
    const groups = pane.locator('.dv-groupview').filter({ visible: true })
    for (let index = 0; index < (await groups.count()); index += 1) {
      const strip = groups.nth(index).locator('.dv-tabs-and-actions-container')
      await expect(strip.getByRole('button', { name: 'New tab', exact: true })).toHaveCount(1)
      await expect(strip.getByRole('button', { name: 'Pane options', exact: true })).toHaveCount(1)
      await expect(strip.getByRole('checkbox')).toHaveCount(0)
      await expect(strip.getByRole('button', { name: /^(Move up|Move down|Up|Down)$/ })).toHaveCount(0)
      await expect(strip.getByRole('button', { name: 'Close pane', exact: true })).toHaveCount(region === 'main' ? 0 : 1)
    }
  }
}
Then('pane chrome has one tab strip with local actions and no duplicate toolbar', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'quiet-pane-chrome'), async () => {
    await assertQuietPaneChrome(page)
    await paneOptions(page)
    for (const label of ['Split right', 'Split down', 'Reset layout', 'Hide the bottom panel', 'Layouts'])
      await expect(page.getByRole('menuitem', { name: label, exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Open right pane', exact: true })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Close right pane', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await assertTabPlusAlignment(page)
    await page.screenshot({ path: test.info().outputPath('quiet-workbench-pane-chrome.png'), animations: 'disabled' })
  })
})
When('the bottom pane is closed with its local Close pane control', async ({ page }: { page: Page }) => {
  // Pane options is modal; dismiss it before querying/clicking outside its
  // aria-hidden scope rather than relying on a screenshot-visible close icon.
  await page.keyboard.press('Escape')
  await paneRoot(page, 'bottom').getByRole('button', { name: 'Close pane', exact: true }).first().click()
  await expect(bottomRegion(page)).toHaveCount(0)
})
Then('the main Pane options offers opening but never closing the right pane', async ({ page }: { page: Page }) => {
  await recordAssertion(page, acceptanceId(page, 'pane-open-close-ownership'), async () => {
    await paneOptions(page)
    await expect(page.getByRole('menuitem', { name: 'Open right pane', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Close right pane', exact: true })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Toggle the bottom panel', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(mainPane(page).getByRole('button', { name: 'Close pane', exact: true })).toHaveCount(0)
  })
})

Then('the workbench main acceptance journey is complete', async ({ page }: { page: Page }) => finishJourneyAssertions(page))

After(async ({ page }: { page: Page }) => {
  const root = workbenchRoots.get(page)
  if (root === undefined) return
  workbenchRoots.delete(page)
  // createScratchDirectory returned this exact owned absolute directory; never remove an arbitrary/computed path.
  if (!root.includes('/dshx-workbench-main-e2e-')) throw new Error(`Refusing unexpected Workbench fixture root: ${root}`)
  await rm(root, { recursive: true, force: true })
})

const bootWorkbenchViewProfile = async (page: Page, recovery = false): Promise<void> => {
  const profile = await bootComposedPluginProfile({
    packageIds: [
      '@dshfiles/frame-layout',
      '@dshfiles/sidebar-right',
      '@dshfiles/workbench',
      '@dshfiles/main-tabs',
      '@dshfiles/editor',
      '@dshfiles/thread-sidebar',
      '@dshfiles/workspace-folder-picker',
      '@dshfiles/session-controller',
      '@dshfiles/rich-composer',
      '@dshfiles/chat',
      '@dshfiles/multi-host',
      '@dshfiles/jj-integration',
      '@dshfiles/ai-accounts',
      ...(recovery ? ['@dshfiles/command-palette'] : []),
    ],
    profileLabel: recovery ? 'workbench-root-reset-recovery' : 'workbench-qualified-view-names',
    // Main Tabs owns the fixed-session tab actor; demo views expose observable mount/draft state.
    cordisPatch: `- id: dshfiles-workbench
  config:
    demoPanels: true
`,
  })
  await visitIsolatedPluginProfile(page, profile)
  await openWorkbench(page)
}

Given('an isolated Workbench view-name profile with Main Tabs and demo views is booted', async ({ page }: { page: Page }) => {
  await bootWorkbenchViewProfile(page)
})
Given('an isolated Workbench recovery profile with Main Tabs and demo views is booted', async ({ page }: { page: Page }) => {
  await bootWorkbenchViewProfile(page, true)
})

const legacyViewLayoutSchema = z.looseObject({
  panels: z.record(z.string(), z.looseObject({ id: z.string(), title: z.string().optional() })),
})
const PREVIEW_SOURCE_ID = 'dshfiles-thread-sidebar.workbench-status'
const SCRATCHPAD_SOURCE_ID = 'dshfiles-workbench.scratchpad'

Then('the view chooser exposes qualified plugin names and AI Accounts search selects its Preview', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-plugin-view-names-qualified-chooser-and-search', async () => {
    const chooser = await clickNewTab(mainPane(page))
    const cards = chooser.getByRole('button')
    const names = await cards.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label') ?? element.textContent?.trim() ?? ''))
    expect(names.length).toBeGreaterThan(0)
    // No alias helper here: every actual reusable card must be qualified, including core presentation adapters.
    expect(names.every(name => /^[^:]+: \S/u.test(name))).toBe(true)
    await expect(chooser.getByRole('button', { name: 'Rich Composer: Current conversation', exact: true })).toHaveCount(0)
    for (const name of [
      'Thread Sidebar: Threads',
      'Thread Sidebar: Navigation',
      'AI Accounts: Preview',
      'Thread Sidebar: Plugin controls',
      'AI Accounts: Accounts',
      'Editor: Files',
      'Workbench: Scratchpad',
      'Plugin Manager: Plugins',
      'Schedule: Automation tasks',
    ])
      await expect(chooser.getByRole('button', { name, exact: true })).toBeVisible()
    // Native/unlabeled footer actions are present in this composition: never falsely attribute their aggregate to AI Accounts.
    await expect(chooser.getByRole('button', { name: 'AI Accounts: Controls', exact: true })).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('plugin-view-names-qualified-chooser.png'), animations: 'disabled' })
    await chooser.getByRole('textbox', { name: 'Search views', exact: true }).fill('AI Accounts')
    const matchingNames = await cards.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label') ?? element.textContent?.trim() ?? ''))
    expect(matchingNames).toEqual(
      expect.arrayContaining(['AI Accounts: Preview', 'AI Accounts: Accounts', 'AI Accounts: Usage history', 'AI Accounts: Quota forecast']),
    )
    await expect(chooser.getByRole('button', { name: 'Thread Sidebar: Plugin controls', exact: true })).toHaveCount(0)
    expect(matchingNames.every(name => name.startsWith('AI Accounts: '))).toBe(true)
    await chooser.getByRole('button', { name: 'AI Accounts: Preview', exact: true }).click()
    await expect(chooser).toBeHidden()
    const tab = mainPane(page).getByRole('tab', { name: 'AI Accounts: Preview', exact: true })
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(tab.locator('[data-workbench-tab-id]')).toHaveAttribute('data-workbench-tab-id', PREVIEW_SOURCE_ID)
    await expect(mainSeat(page).locator(`[data-sidebar-workbench-source="${PREVIEW_SOURCE_ID}"] [data-slot="sidebar.footer.above"]`)).toBeAttached()
    for (const name of ['Sidebar status', 'Sidebar actions', 'Current conversation', 'Threads', 'Plugins', 'Automation tasks'])
      await expect(mainPane(page).getByRole('tab', { name, exact: true })).toHaveCount(0)
  })
})

When('legacy reusable view titles are saved with their original panel IDs and restored', async ({ page }: { page: Page }) => {
  await setRightPaneVisible(page, true)
  await addRegisteredPanel(page, paneRoot(page, 'right'), 'Scratchpad')
  for (const [key, id, oldTitle] of [
    [MAIN_LAYOUT_KEY, PREVIEW_SOURCE_ID, 'Sidebar status'],
    [DOCK_LAYOUT_KEY, SCRATCHPAD_SOURCE_ID, 'Scratchpad'],
  ] as const) {
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key) ?? '', key)).toContain(id)
    const raw = await page.evaluate(key => localStorage.getItem(key), key)
    if (raw === null) throw new Error(`Missing saved layout fixture: ${key}`)
    const layout = legacyViewLayoutSchema.parse(JSON.parse(raw))
    const panel = layout.panels[id]
    if (panel === undefined || panel.id !== id) throw new Error(`Missing original reusable panel identity: ${id}`)
    panel.title = oldTitle
    // The only mutation is the permitted saved-layout fixture. No registry/API/actor event is injected.
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key, value: JSON.stringify(layout) })
  }
  await StartupDialogs.reloadPastProviderSetup(page)
  await openWorkbench(page)
})

Then('restored reusable views have qualified titles with the same IDs and one live mount', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-plugin-view-names-restore-keeps-original-ids', async () => {
    const preview = mainPane(page).getByRole('tab', { name: 'AI Accounts: Preview', exact: true })
    await expect(preview).toBeVisible()
    await expect(preview.locator('[data-workbench-tab-id]')).toHaveAttribute('data-workbench-tab-id', PREVIEW_SOURCE_ID)
    const scratchpad = paneRoot(page, 'right').getByRole('tab', { name: 'Workbench: Scratchpad', exact: true })
    await expect(scratchpad).toBeVisible()
    await expect(scratchpad.locator('[data-workbench-tab-id]')).toHaveAttribute('data-workbench-tab-id', SCRATCHPAD_SOURCE_ID)
    await expect(dockRegion(page).getByTestId('mounts')).toHaveText('1')
    await expect(mainPane(page).getByRole('tab', { name: 'Sidebar status', exact: true })).toHaveCount(0)
    await expect(paneRoot(page, 'right').getByRole('tab', { name: 'Scratchpad', exact: true })).toHaveCount(0)
    // Thread titles are user data, not reusable labels: they remain unqualified and unchanged.
    for (const index of ['first', 'second'] as const) await expect(threadDockTab(page, index)).toHaveAccessibleName(threadPrompt(index))
    await preview.click()
    await page.screenshot({ path: test.info().outputPath('plugin-view-names-restored-preview-scratchpad.png'), animations: 'disabled' })
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})

When('the restored Scratchpad receives a draft and its pane is hidden and reopened', async ({ page }: { page: Page }) => {
  const textarea = dockRegion(page).getByRole('textbox', { name: 'Scratchpad', exact: true })
  await textarea.fill(RIGHT_DRAFT)
  const element = await textarea.elementHandle()
  if (element === null) throw new Error('The restored Scratchpad did not mount.')
  retainedRightDrafts.set(page, { element, mounts: await dockRegion(page).getByTestId('mounts').innerText() })
  await setRightPaneVisible(page, false)
  expect(await element.evaluate(element => element.isConnected)).toBe(true)
  await setRightPaneVisible(page, true)
})

Then('the qualified Scratchpad keeps its same draft DOM and mount count', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-plugin-view-names-restored-draft-keeps-mount', async () => {
    const retained = retainedRightDrafts.get(page)
    if (retained === undefined) throw new Error('The restored Scratchpad draft fixture is missing.')
    const textarea = dockRegion(page).getByRole('textbox', { name: 'Scratchpad', exact: true })
    await expect(paneRoot(page, 'right').getByRole('tab', { name: 'Workbench: Scratchpad', exact: true })).toBeVisible()
    await expect(textarea).toHaveValue(RIGHT_DRAFT)
    expect(await textarea.evaluate((element, previous) => element === previous, retained.element)).toBe(true)
    await expect(dockRegion(page).getByTestId('mounts')).toHaveText(retained.mounts)
    await expect(dockRegion(page).getByTestId('mounts')).toHaveText('1')
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})

/** Floating members are still inside this Dockview, but never count as its centre grid. */
const centreGridGroups = (page: Page): Locator => mainDock(page).locator('.dv-groupview:not(.dv-groupview-floating)')
const floatingScratchpad = (page: Page): Locator =>
  mainPane(page)
    .locator('.dv-groupview-floating')
    .filter({
      has: page.getByRole('tab', { name: 'Workbench: Scratchpad', exact: true }),
    })
const floatingDrafts = new WeakMap<Page, { readonly element: ElementHandle<SVGElement | HTMLElement>; readonly mounts: string }>()
const FLOATING_DRAFT = 'Keep this unsent Scratchpad draft while the centre remains usable'

When('a drafted Scratchpad is the only tab in the centre grid', async ({ page }: { page: Page }) => {
  await addRegisteredPanel(page, mainPane(page), 'Scratchpad')
  const ids = await centreGridGroups(page)
    .locator('[data-workbench-tab-id]')
    .evaluateAll(elements => elements.map(element => element.getAttribute('data-workbench-tab-id')))
  for (const id of ids) {
    if (id === null || id === SCRATCHPAD_SOURCE_ID) continue
    const tab = mainPane(page)
      .getByRole('tab')
      .filter({ has: page.locator(`[data-workbench-tab-id=${JSON.stringify(id)}]`) })
    await tab.getByRole('button', { name: /^Close / }).click()
  }
  await expect(centreGridGroups(page)).toHaveCount(1)
  await expect(centreGridGroups(page).getByRole('tab')).toHaveCount(1)
  const body = await panelBodyForTab(dockTab(mainDock(page), 'Scratchpad'))
  const textarea = body.getByRole('textbox', { name: 'Scratchpad', exact: true })
  await textarea.fill(FLOATING_DRAFT)
  const element = await textarea.elementHandle()
  if (element === null) throw new Error('The centre Scratchpad draft did not mount.')
  await expect(body.getByTestId('mounts')).toHaveText('1')
  floatingDrafts.set(page, { element, mounts: await body.getByTestId('mounts').innerText() })
})

When('the final centre Scratchpad tab is floated with the real Shift gesture', async ({ page }: { page: Page }) => {
  // Dockview 8.5.1 handles Shift+pointerdown itself; no private API mutation or synthetic transfer.
  await dockTab(mainDock(page), 'Scratchpad').click({ modifiers: ['Shift'] })
  await expect(floatingScratchpad(page)).toBeVisible()
})

Then('the last centre grid cannot close into its floating neighbour', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-last-root-survives-real-float', async () => {
    await expect(centreGridGroups(page)).toHaveCount(1)
    await expect(centreGridGroups(page).getByRole('button', { name: 'Close pane', exact: true })).toHaveCount(0)
    await expect(centreGridGroups(page).getByRole('button', { name: 'New tab', exact: true })).toBeVisible()
    await chooserForGroup(centreGridGroups(page))
    await expect(floatingScratchpad(page).getByRole('tab', { name: 'Workbench: Scratchpad', exact: true })).toBeVisible()
  })
})

When('the last centre chooser tab is closed twice', async ({ page }: { page: Page }) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // Floating windows may cover the root strip; the actual keyboard control must remain usable too.
    const close = centreGridGroups(page).getByRole('tab', { name: 'New tab', exact: true }).getByRole('button', { name: 'Close New tab', exact: true })
    await close.focus()
    await close.press('Enter')
    await chooserForGroup(centreGridGroups(page))
  }
})

Then('the centre chooser and the same floating draft remain reachable', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-root-tab-close-keeps-floating-draft', async () => {
    const retained = floatingDrafts.get(page)
    if (retained === undefined) throw new Error('The floating Scratchpad fixture is missing.')
    await expect(centreGridGroups(page)).toHaveCount(1)
    await expect(centreGridGroups(page).getByRole('button', { name: 'Close pane', exact: true })).toHaveCount(0)
    await expect(centreGridGroups(page).getByRole('button', { name: 'New tab', exact: true })).toBeVisible()
    await chooserForGroup(centreGridGroups(page))
    const body = await panelBodyForTab(floatingScratchpad(page).getByRole('tab', { name: 'Workbench: Scratchpad', exact: true }))
    const textarea = body.getByRole('textbox', { name: 'Scratchpad', exact: true })
    await expect(textarea).toBeVisible()
    await expect(textarea).toHaveValue(FLOATING_DRAFT)
    expect(await textarea.evaluate((element, previous) => element === previous, retained.element)).toBe(true)
    await expect(body.getByTestId('mounts')).toHaveText(retained.mounts)
    await expect(body.getByTestId('mounts')).toHaveText('1')
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
})

const resetCurrentThreads = new WeakMap<Page, 'first' | 'second'>()
const captureResetDraftOwners = async (page: Page, phase: string): Promise<void> => {
  const ids = workbenchThreads.get(page)
  if (ids === undefined) throw new Error('Workbench recovery threads are missing.')
  const evidence = {
    phase,
    panels: await page.locator('[data-workbench-panel-id]').evaluateAll(panels =>
      panels.map(panel => ({
        panel: panel.getAttribute('data-workbench-panel-id'),
        session: panel.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session'),
        draft: panel.querySelector('[data-composer-input]')?.textContent,
      })),
    ),
    saved: await page.evaluate(ids => Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, localStorage.getItem(`dsh.conversation.${id}`)])), ids),
  }
  const path = test.info().outputPath(`reset-draft-owners-${phase}.json`)
  await writeFile(path, JSON.stringify(evidence, null, 2))
  await test.info().attach(`reset-draft-owners-${phase}`, { path, contentType: 'application/json' })
}
When('a tool is active while the left thread list is collapsed', async ({ page }: { page: Page }) => {
  // Sessions and their drafts were created before switching away from the default composer.
  await openGlobalPanel(page, 'Plugins')
  // Explicitly select the real semantic tool tab after opening it beside retained conversations.
  const tool = mainPane(page).getByRole('tab', { name: 'Plugin Manager: Plugins', exact: true })
  await tool.click()
  await expect(tool).toHaveAttribute('aria-selected', 'true')
  const toolBody = await panelBodyForTab(tool)
  await expect(toolBody.getByRole('switch', { name: 'Enable @dshfiles/workbench', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await expect(paneRoot(page, 'left')).toBeHidden()
  const ids = workbenchThreads.get(page)
  const currentId = new URL(page.url()).searchParams.get('thread')
  if (ids === undefined || (currentId !== ids.first && currentId !== ids.second)) throw new Error('The active tool lost the current fixture Session.')
  resetCurrentThreads.set(page, currentId === ids.first ? 'first' : 'second')
  await captureResetDraftOwners(page, 'before')
})

const assertVisibleResetChat = async (page: Page): Promise<void> => {
  await recordAssertion(page, acceptanceId(page, 'reset-visible-chat-left'), async () => {
    const ids = workbenchThreads.get(page)
    const currentIndex = resetCurrentThreads.get(page)
    if (ids === undefined || currentIndex === undefined) throw new Error('Workbench recovery threads are missing.')
    const currentId = ids[currentIndex]
    await captureResetDraftOwners(page, acceptanceId(page, 'after'))
    // Reset must reuse the existing current Session's input owner, not create
    // another global-current editor that can detach its Lexical root.
    for (const index of ['first', 'second'] as const) {
      const fixed = await fixedConversation(page, index)
      await expect(fixed.locator('[data-chat-flow]')).toContainText(threadPrompt(index))
      await expect(fixed.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true, includeHidden: true })).toHaveText(
        fixedDraft(index),
      )
    }
    const current = threadDockTab(page, currentIndex)
    await expect(current).toBeVisible()
    await expect(current).toHaveAttribute('aria-selected', 'true')
    await expect(current.locator('[data-workbench-tab-id]')).toHaveAttribute('data-workbench-tab-id', tabPanelId(`thread:${currentId}`))
    await expect(page.locator('[data-workbench-panel-id="current-conversation"]')).toHaveCount(0)
    await expect(mainPane(page).getByRole('tab', { name: 'Rich Composer: Current conversation', exact: true })).toHaveCount(0)
    const body = await panelBodyForTab(current)
    await expect(body).toBeVisible()
    await expect(body.locator('[data-conversation-session]')).toHaveAttribute('data-conversation-session', currentId)
    await expect(body.locator('[data-chat-flow]')).toContainText(threadPrompt(currentIndex))
    await expect(fixedComposer(body)).toBeVisible()
    await expect(fixedComposer(body)).toHaveText(fixedDraft(currentIndex))
    await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(currentId)
    const left = paneRoot(page, 'left')
    await expect(left).toBeVisible()
    await expect(left.getByRole('tab', { name: 'Thread Sidebar: Threads', exact: true })).toBeVisible()
    await expect(left.locator('[data-sidebar-workbench-source="dshfiles-thread-sidebar.workbench-threads"]')).toBeVisible()
    for (const index of ['first', 'second'] as const) {
      await expect(left.locator(`article[data-thread-id="${ids[index]}"]`)).toBeVisible()
    }
    await expect(threadDockTab(page, 'second').getByLabel('Pinned', { exact: true })).toBeVisible()
    const savedTabs = await page.evaluate(() => localStorage.getItem('dshfiles.main-tabs.v1') ?? '')
    expect(savedTabs.split(`"id":${JSON.stringify(`thread:${ids.second}`)}`).length - 1).toBe(1)
    await expect(centreGridGroups(page).getByRole('button', { name: 'New tab', exact: true }).first()).toBeVisible()
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  })
}
Then('Reset visibly restores the left thread list and current chat with history drafts and pin', async ({ page }: { page: Page }) => {
  await assertVisibleResetChat(page)
})

const legacyFloatingRecoverySchema = legacyViewLayoutSchema.extend({
  grid: z.looseObject({
    root: z.looseObject({
      type: z.literal('branch'),
      data: z.array(
        z.looseObject({
          type: z.literal('leaf'),
          data: z.looseObject({ id: z.string(), views: z.array(z.string()) }),
        }),
      ),
    }),
  }),
})

When('a legacy all-floating main layout with collapsed left is restored', async ({ page }: { page: Page }) => {
  const ids = workbenchThreads.get(page)
  const currentIndex = resetCurrentThreads.get(page)
  if (ids === undefined || currentIndex === undefined) throw new Error('Workbench recovery threads are missing.')
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key) ?? '', MAIN_LAYOUT_KEY)).toContain(tabPanelId(`thread:${ids[currentIndex]}`))
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await expect(paneRoot(page, 'left')).toBeHidden()
  const raw = await page.evaluate(key => localStorage.getItem(key), MAIN_LAYOUT_KEY)
  if (raw === null) throw new Error('The recovered main layout was not persisted.')
  const layout = legacyFloatingRecoverySchema.parse(JSON.parse(raw))
  expect(layout.grid.root.data.length).toBeGreaterThan(0)
  const legacy = {
    ...layout,
    grid: { ...layout.grid, root: { ...layout.grid.root, data: [] } },
    floatingGroups: layout.grid.root.data.map(leaf => ({ data: leaf.data, position: { left: 40, top: 80, width: 600, height: 480 } })),
  }
  // The only mutation is an explicit browser-persisted legacy-layout fixture.
  // All original panel/source IDs and semantic actor storage remain untouched.
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: MAIN_LAYOUT_KEY, value: JSON.stringify(legacy) })
  await StartupDialogs.reloadPastProviderSetup(page)
  await openWorkbench(page)
  await expect(mainPane(page).locator('.dv-groupview-floating').first()).toBeVisible()
  await expect(paneRoot(page, 'left')).toBeHidden()
})

const resetWorkbenchFromPalette = async (page: Page): Promise<void> => {
  const mac = await page.evaluate(() => navigator.platform.toLowerCase().includes('mac'))
  await page.keyboard.press(mac ? 'Meta+Shift+P' : 'Control+Shift+P')
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
  await expect(palette).toBeVisible()
  await palette.getByRole('tab', { name: 'Everything', exact: true }).click()
  await palette.getByRole('combobox').fill('Reset layout')
  await palette.getByRole('option', { name: /Workbench: Reset layout/ }).click()
  await expect(palette).toBeHidden()
}
When('the global command palette resets the Workbench without a pane menu', async ({ page }: { page: Page }) => {
  await resetWorkbenchFromPalette(page)
})

const savedSidebarWidth = (page: Page): Promise<number | null> =>
  page.evaluate(() => {
    const raw = localStorage.getItem('dshfiles.frame-layout.v1')
    return raw === null ? null : JSON.parse(raw).sidebar
  })

When('the recovered sidebar is dragged to its maximum wide width', async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  const handle = page.locator('[data-side="sidebar"]').filter({ visible: true })
  await expect(handle).toHaveCount(1)
  const box = await handle.boundingBox()
  if (box === null) throw new Error('The actual frame sidebar resize handle has no visible geometry.')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 600, box.y + box.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => savedSidebarWidth(page)).toBe(420)
  await expect.poll(async () => Math.abs(((await paneRoot(page, 'left').boundingBox())?.width ?? 0) - 420)).toBeLessThanOrEqual(1)
})

Then('global Reset keeps both chat and thread list visible at narrow widths', async ({ page }: { page: Page }) => {
  for (const width of [360, 480, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    await resetWorkbenchFromPalette(page)
    await assertVisibleResetChat(page)
    await recordAssertion(page, acceptanceId(page, `reset-width-${width}`), async () => {
      await expect
        .poll(async () => {
          const left = await paneRoot(page, 'left').boundingBox()
          const centre = await mainPane(page).boundingBox()
          return left !== null && centre !== null && left.width > 0 && centre.width >= width / 2 - 2
        })
        .toBe(true)
      await expect.poll(() => savedSidebarWidth(page)).toBe(420)
    })
  }
})

Then('widening restores the dragged sidebar width without losing chat state', async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await resetWorkbenchFromPalette(page)
  await assertVisibleResetChat(page)
  await recordAssertion(page, acceptanceId(page, 'wide-width-restored'), async () => {
    await expect.poll(() => savedSidebarWidth(page)).toBe(420)
    await expect.poll(async () => Math.abs(((await paneRoot(page, 'left').boundingBox())?.width ?? 0) - 420)).toBeLessThanOrEqual(1)
  })
})
