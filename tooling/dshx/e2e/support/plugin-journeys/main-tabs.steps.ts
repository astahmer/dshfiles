import { expect, type Page } from '@playwright/test'
import { rm } from 'node:fs/promises'
import { basename } from 'node:path'
import { After, Then, When } from '../bdd.js'
import { globalPanelLink as globalPanel, reusableViewName } from '../plugin-view-names.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'
import { createScratchDirectory, registerWorkspaceFolder } from '../threads.js'

const STORAGE_KEY = 'dshfiles.main-tabs.v1'

const strip = (page: Page) => page.getByRole('tablist', { name: 'Open views', exact: true })
// Native core page titles stay original outside Workbench; owned producer labels are qualified.
const nativeTabName = (name: string): string => (name === 'Plugins' || name === 'Automation tasks' || name === 'Settings' ? name : reusableViewName(name))
const tab = (page: Page, name: string) => strip(page).getByRole('tab', { name: nativeTabName(name), exact: true })
/** Each tab as "<name>" plus "*" when active, "(preview)" and "(pinned)" markers, in strip order. */
const tabSummary = (page: Page): Promise<readonly string[]> =>
  strip(page)
    .getByRole('tab')
    .evaluateAll(nodes =>
      nodes.map(node => {
        const element = node instanceof HTMLElement ? node : null
        const name = node.getAttribute('aria-label') ?? ''
        const active = node.getAttribute('aria-selected') === 'true' ? '*' : ''
        const preview = element?.dataset.preview === undefined ? '' : ' (preview)'
        const pinned = element?.dataset.pinned === undefined ? '' : ' (pinned)'
        return `${name}${active}${preview}${pinned}`
      }),
    )

const openKept = async (page: Page, name: string): Promise<void> => {
  await globalPanel(page, name).click()
  await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true')
  // Installed ui-plugin-manager registers keyed main `plugins` (not an owned Editor main page).
  if (name === 'Plugins') await expect(tab(page, name)).toHaveAttribute('data-tab-id', 'panel:plugins')
  await tab(page, name).dblclick()
  await expect(tab(page, name)).not.toHaveAttribute('data-preview')
}

/**
 * Where the strip landed, read from the DOM: a DSH upgrade that drops the `main` slot outlet or reshapes the main
 * column fails here instead of hiding the strip silently.
 */
const stripPlacement = (page: Page) =>
  page.evaluate(() => {
    const hosts = document.querySelectorAll('[data-dshfiles-main-tabs]')
    const host = hosts[0]
    const outlet = host?.nextElementSibling
    const strip = host?.querySelector('[role="tablist"]')?.closest('[data-dshfiles-main-tabs] > *')
    let panel = outlet?.matches('[data-slot="main"]') === true ? outlet.firstElementChild : null
    while (panel !== null && panel !== undefined && getComputedStyle(panel).display === 'contents') panel = panel.firstElementChild
    const stripBox = strip?.getBoundingClientRect()
    const panelBox = panel?.getBoundingClientRect()
    return {
      hosts: hosts.length,
      anchoredBeforeMainOutlet: outlet?.matches('[data-slot="main"]') === true,
      aboveMainPanel: stripBox !== undefined && panelBox !== undefined && stripBox.height > 0 && stripBox.bottom <= panelBox.top + 1,
      sameColumn:
        stripBox !== undefined && panelBox !== undefined && Math.abs(stripBox.left - panelBox.left) <= 1 && Math.abs(stripBox.right - panelBox.right) <= 1,
    }
  })

const expectedPlacement = { hosts: 1, anchoredBeforeMainOutlet: true, aboveMainPanel: true, sameColumn: true }

/** This feature's @platform-macos visitor owns the shortcuts, not the Linux process running Playwright. */
const primary = (): string => 'Meta'
const threadSidebar = (page: Page) => page.getByRole('region', { name: 'Threads', exact: true })
const sidebarThreadRow = (page: Page, sessionId: string) => threadSidebar(page).locator(`article[data-thread-id="${sessionId}"]`)
const threadTab = (page: Page, sessionId: string) => strip(page).locator(`[data-tab-id="thread:${sessionId}"]`)

const nativeWorkspaceRoots = new WeakMap<Page, string>()
const nativePanelMoves = new WeakMap<Page, string>()
const newThreadButton = (page: Page) =>
  page
    .getByRole('button', { name: 'New thread', exact: true })
    .or(page.getByRole('button', { name: 'New session', exact: true }))
    .first()

When('the standalone native tab strip is ready', async ({ page }: { page: Page }) => {
  await expect(page.locator('[data-main-surface="native"]')).toBeVisible()
  await expect(page.locator('[data-slot="shell.main"]')).toHaveCount(0)
  await expect(page.locator('[data-workbench-region]')).toHaveCount(0)
  // A fresh strip's tablist has no tabs and legitimately occupies zero pixels.
  // Its visible New tab action proves the fallback mounted without inventing a tab.
  await expect(strip(page)).toBeAttached()
  await expect(newTabButton(page)).toBeVisible()
})

When('a disposable native-tabs workspace is selected', async ({ page }: { page: Page }) => {
  await expect(page.locator('[data-main-surface="native"]')).toBeVisible()
  await expect(page.locator('[data-workbench-region]')).toHaveCount(0)
  const root = await createScratchDirectory('dshx-main-tabs-e2e-')
  nativeWorkspaceRoots.set(page, root)
  await newThreadButton(page).click()
  await StartupDialogs.dismissProviderSetupIfShown(page)
  const addWorkspace = page.getByRole('button', { name: 'Add workspace', exact: true })
  if (await addWorkspace.isVisible()) await registerWorkspaceFolder(page, root)
  else {
    // Owned sidebar profiles use the composer's public project picker rather than the native Add workspace button.
    await page.getByRole('button', { name: 'Choose workspace', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose a project', exact: true })
    await expect(picker).toBeVisible()
    await picker.getByRole('textbox', { name: 'Search projects or enter a folder path', exact: true }).fill(root)
    await picker.getByRole('button', { name: 'Register project', exact: true }).first().click()
    await expect(picker).toBeHidden()
  }
  await expect(page.getByRole('button', { name: 'Choose workspace', exact: true })).toHaveText(basename(root))
})

const startNativeThread = async (page: Page, prompt: string): Promise<string> => {
  const root = nativeWorkspaceRoots.get(page)
  if (root === undefined) throw new Error("Select this scenario's disposable native-tabs workspace before creating threads.")
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  // Workspace setup can already own a visible blank draft. Starting another native Session here is asynchronous
  // and can replace that composer after fill; reuse it rather than racing an unnecessary navigation.
  if (!(await composer.isVisible())) await newThreadButton(page).click()
  await StartupDialogs.dismissProviderSetupIfShown(page)
  await expect(page.getByRole('button', { name: 'Choose workspace', exact: true })).toHaveText(basename(root))
  await composer.fill(prompt)
  const send = page.getByRole('button', { name: 'Send message', exact: true })
  await expect(send).toBeEnabled()
  await send.click()
  // The stock sidebar can reuse its empty prewarmed Session. Read the actual
  // submitted actor tab instead of requiring a different id from that blank draft.
  const submitted = tab(page, prompt)
  await expect(submitted).toHaveAttribute('aria-selected', 'true')
  const tabId = await submitted.getAttribute('data-tab-id')
  if (tabId === null || !tabId.startsWith('thread:')) throw new Error('Submitted native thread has no actor identity.')
  return tabId.slice('thread:'.length)
}

const startSidebarThread = async (page: Page, prompt: string): Promise<string> => {
  const sessionId = await startNativeThread(page, prompt)
  await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(sessionId)
  await expect(sidebarThreadRow(page, sessionId)).toBeVisible()
  return sessionId
}

After(async ({ page }: { page: Page }) => {
  const root = nativeWorkspaceRoots.get(page)
  if (root === undefined) return
  nativeWorkspaceRoots.delete(page)
  // Only remove the exact real temporary directory created and retained by this scenario.
  if (!/^\/.*\/dshx-main-tabs-e2e-[^/]+$/u.test(root)) throw new Error(`Refusing unexpected native-tabs fixture directory: ${root}`)
  await rm(root, { recursive: true, force: true })
})

When('the Plugins and then Jujutsu are opened from the sidebar', async ({ page }: { page: Page }) => {
  await globalPanel(page, 'Plugins').click()
  await expect(tab(page, 'Plugins')).toBeVisible()
  await globalPanel(page, 'Jujutsu').click()
})

Then('Jujutsu replaced the Plugins preview tab', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-preview-tab-is-replaced', () => expect.poll(() => tabSummary(page)).toEqual(['Jujutsu: Revision graph* (preview)']))
})

When('the Jujutsu tab is kept, the Plugins page is opened again and a thread is started', async ({ page }: { page: Page }) => {
  await tab(page, 'Jujutsu').dblclick()
  await openKept(page, 'Plugins')
  await startNativeThread(page, 'tabs thread')
})

Then('each of them has its own tab and the thread tab is active', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-panels-and-threads-get-tabs', () =>
    expect.poll(() => tabSummary(page)).toEqual(['Jujutsu: Revision graph', 'Plugins', 'tabs thread* (preview)']),
  )
  await tab(page, 'tabs thread').dblclick()
})

Then('the thread tab context menu copies its ID and clean link', async ({ page }: { page: Page }) => {
  const threadTab = strip(page).locator('[data-tab-id^="thread:"]').first()
  const threadTabId = await threadTab.getAttribute('data-tab-id')
  if (threadTabId === null) throw new Error('The active thread tab has no session ID.')
  const sessionId = threadTabId.slice('thread:'.length)
  const origin = new URL(page.url()).origin
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })

  await threadTab.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Copy thread ID', exact: true }).click()
  await recordAssertion(page, 'main-tabs-context-menu-copies-thread-id', async () => {
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(sessionId)
    await expect(page.getByRole('status').filter({ hasText: /^Thread ID copied\.$/ })).toHaveText('Thread ID copied.')
  })

  await threadTab.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Copy thread link', exact: true }).click()
  const copiedLink = new URL(await page.evaluate(() => navigator.clipboard.readText()))
  await recordAssertion(page, 'main-tabs-context-menu-copies-clean-thread-link', async () => {
    expect(copiedLink.origin).toBe(origin)
    expect(copiedLink.searchParams.get('thread')).toBe(sessionId)
    expect(copiedLink.searchParams.has('token')).toBe(false)
    expect(copiedLink.hash).toBe('')
    expect([...copiedLink.searchParams.keys()].every(key => key === 'thread' || key === 'workspace')).toBe(true)
    await expect(page.getByRole('status').filter({ hasText: /^Thread link copied\.$/ })).toHaveText('Thread link copied.')
  })
})

Then('that menu reports an unavailable side panel while no plugin offers one', async ({ page }: { page: Page }) => {
  await strip(page).locator('[data-tab-id^="thread:"]').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open in side panel', exact: true }).click()
  await recordAssertion(page, 'main-tabs-tab-menu-reports-a-missing-side-panel', async () => {
    await expect(page.getByRole('status').filter({ hasText: /^The side panel is not available here\.$/ })).toHaveText('The side panel is not available here.')
    await expect(page.locator('[data-dshfiles-thread-aside]')).toHaveCount(0)
  })
})

When('the Plugins tab is pinned and the thread tab is dragged before Jujutsu', async ({ page }: { page: Page }) => {
  await tab(page, 'Plugins').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pin tab', exact: true }).click()
  await tab(page, 'tabs thread').dragTo(tab(page, 'Jujutsu'), { targetPosition: { x: 4, y: 10 } })
})

Then('the pinned tab leads and the thread tab moved', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-pin-and-reorder', () =>
    expect.poll(() => tabSummary(page)).toEqual(['Plugins (pinned)', 'tabs thread*', 'Jujutsu: Revision graph']),
  )
})

When('the Jujutsu tab is closed with a middle click and other tabs are closed from the thread tab', async ({ page }: { page: Page }) => {
  await tab(page, 'Jujutsu').click({ button: 'middle' })
  await expect(tab(page, 'Jujutsu')).toHaveCount(0)
  await openKept(page, 'Jujutsu')
  await tab(page, 'tabs thread').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Close other tabs', exact: true }).click()
})

Then('only the pinned Plugins and the thread remain', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-close-others-keeps-pinned', async () => {
    await expect.poll(() => tabSummary(page)).toEqual(['Plugins (pinned)', 'tabs thread*'])
    await expect(page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the Plugins page is opened as a tab', async ({ page }: { page: Page }) => {
  await globalPanel(page, 'Plugins').click()
  await expect(tab(page, 'Plugins')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Plugins', exact: true })).toBeVisible()
})

Then('the tab strip sits directly above the main panel, anchored before the main slot outlet', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-strip-mounts-above-main-panel', () => expect.poll(() => stripPlacement(page)).toEqual(expectedPlacement))
})

When('a thread is started beside the Plugins tab', async ({ page }: { page: Page }) => {
  await tab(page, 'Plugins').dblclick()
  await startNativeThread(page, 'mount thread')
  await expect(tab(page, 'mount thread')).toHaveAttribute('aria-selected', 'true')
})

Then('the tab strip still sits directly above the main panel', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-strip-follows-panel-changes', async () => {
    await expect.poll(() => stripPlacement(page)).toEqual(expectedPlacement)
    await expect(page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the Plugins and Jujutsu are opened and kept as tabs', async ({ page }: { page: Page }) => {
  await openKept(page, 'Plugins')
  await openKept(page, 'Jujutsu')
})

Then('the tab shortcuts jump to the first and last tab and cycle between them', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-keyboard-jump-and-cycle', async () => {
    await page.keyboard.press(`${primary()}+Alt+Digit1`)
    await expect(tab(page, 'Plugins')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: 'Plugins', exact: true })).toBeVisible()
    await page.keyboard.press(`${primary()}+Alt+Digit9`)
    await expect(tab(page, 'Jujutsu')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press(`${primary()}+Alt+BracketRight`)
    await expect(tab(page, 'Plugins')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press(`${primary()}+Alt+BracketLeft`)
    await expect(tab(page, 'Jujutsu')).toHaveAttribute('aria-selected', 'true')
  })
  await finishJourneyAssertions(page)
})

When('the Plugins tab is pinned and the page is reloaded', async ({ page }: { page: Page }) => {
  await tab(page, 'Plugins').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pin tab', exact: true }).click()
  await expect(tab(page, 'Plugins')).toHaveAttribute('data-pinned', 'true')
  await page.reload()
})

When('a thread is double-clicked in the sidebar before another is opened', async ({ page }: { page: Page }) => {
  const firstThreadId = await startSidebarThread(page, 'sidebar double click first thread')
  const secondThreadId = await startSidebarThread(page, 'sidebar double click second thread')
  const firstThreadButton = sidebarThreadRow(page, firstThreadId).locator('button[data-thread-main-action]')
  await firstThreadButton.click({ position: { x: 20, y: 16 } })
  await expect(threadTab(page, firstThreadId)).toHaveAttribute('data-preview', 'true')
  await firstThreadButton.dblclick({ position: { x: 20, y: 16 } })
  await expect(threadTab(page, firstThreadId)).not.toHaveAttribute('data-preview')
  await sidebarThreadRow(page, secondThreadId)
    .locator('button[data-thread-main-action]')
    .click({ position: { x: 20, y: 16 } })
  await expect(threadTab(page, secondThreadId)).toHaveAttribute('data-preview', 'true')
})

Then('its tab stays open beside the next preview tab', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-sidebar-double-click-keeps-thread', async () => {
    await expect.poll(() => tabSummary(page)).toHaveLength(2)
    await expect(page.locator('[data-tab-id^="thread:"]')).toHaveCount(2)
    await expect(page.locator('[data-tab-id][data-preview="true"]')).toHaveCount(1)
  })
  await finishJourneyAssertions(page)
})

When("a thread tab's context menu opens it in the side panel", async ({ page }: { page: Page }) => {
  const sessionId = await startSidebarThread(page, 'tab aside thread')
  await threadTab(page, sessionId).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open in side panel', exact: true }).click()
})

Then('the side panel hosts that thread beside the main view', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-tab-menu-opens-thread-aside', async () => {
    await expect(page.locator('[data-dshfiles-thread-aside]')).toHaveCount(1)
    await expect(page.locator('[data-dockkit-tab]').filter({ hasText: 'tab aside thread' })).toHaveCount(1)
  })
  await finishJourneyAssertions(page)
})

When('a kept thread tab is present while text is typed into Backlog', async ({ page }: { page: Page }) => {
  const sessionId = await startSidebarThread(page, 'Backlog capture typing')
  await threadTab(page, sessionId).dblclick()
  const navigation = page.getByRole('navigation', { name: 'Sidebar navigation', exact: true })
  const destination = navigation.getByRole('button', { name: 'Backlog: Items', exact: true })
  if (await destination.isVisible()) await destination.click()
  else {
    // Backlog contributes sidebar.panellist, which the owned sidebar hosts in
    // its footer overflow, not the separate sidebar.header destination menu.
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('button', { name: 'Backlog: Items', exact: true }).click()
  }
  await expect(tab(page, 'Backlog')).toHaveAttribute('aria-selected', 'true')
  const capture = page.getByRole('textbox', { name: 'Capture', exact: true })
  await capture.pressSequentially('Keyboard capture from Backlog')
  await expect(tab(page, 'Backlog')).toHaveAttribute('aria-selected', 'true')
  await capture.press('Enter')
  await expect(tab(page, 'Backlog')).toHaveAttribute('aria-selected', 'true')
})

Then('Backlog remains the active main tab after capture typing', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-backlog-remains-active-during-capture-typing', async () => {
    await expect(tab(page, 'Backlog')).toHaveAttribute('aria-selected', 'true')
  })
  await finishJourneyAssertions(page)
})

/** The thread a scenario moved into the side panel, so its post-move assertions name the same session. */
const movedAsideSessions = new WeakMap<Page, string>()

When('a second thread tab is dragged onto the side panel', async ({ page }: { page: Page }) => {
  const keptSessionId = await startSidebarThread(page, 'kept aside thread')
  await threadTab(page, keptSessionId).dblclick()
  const currentSessionId = await startSidebarThread(page, 'moved aside thread')
  await threadTab(page, currentSessionId).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open in side panel', exact: true }).click()
  await expect(page.locator('[data-dshfiles-thread-aside]')).toHaveCount(1)
  movedAsideSessions.set(page, keptSessionId)
  await threadTab(page, keptSessionId).dragTo(page.locator('[data-slot="rightbar"] [data-dockkit-surface]').first())
})

Then('the side panel hosts that thread and its main tab is gone', async ({ page }: { page: Page }) => {
  const sessionId = movedAsideSessions.get(page) ?? ''
  await recordAssertion(page, 'main-tabs-drag-tab-into-side-panel', async () => {
    await expect(page.locator('[data-dockkit-tab]').filter({ hasText: 'kept aside thread' })).toHaveCount(1)
    await expect(threadTab(page, sessionId)).toHaveCount(0)
  })
})

When("the moved aside tab's menu moves that thread to the main area", async ({ page }: { page: Page }) => {
  await page.locator('[data-dockkit-tab]').filter({ hasText: 'kept aside thread' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move to main area', exact: true }).click()
})

Then('the thread is a main tab again and the side panel dropped its tab', async ({ page }: { page: Page }) => {
  const sessionId = movedAsideSessions.get(page) ?? ''
  await recordAssertion(page, 'main-tabs-move-aside-back-to-main', async () => {
    await expect(threadTab(page, sessionId)).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('[data-dockkit-tab]').filter({ hasText: 'kept aside thread' })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('the Jujutsu panel tab is dragged onto the side panel', async ({ page }: { page: Page }) => {
  const sessionId = await startNativeThread(page, 'panel move host thread')
  nativePanelMoves.set(page, sessionId)
  const threadTab = strip(page).locator(`[data-tab-id="thread:${sessionId}"]`)
  await expect(threadTab).toBeVisible()
  await threadTab.dblclick()
  await expect(threadTab).not.toHaveAttribute('data-preview')
  // Keep the real native guide as the drop target; no Workbench renderer is installed.
  await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click()
  await expect(page.locator('[data-slot="rightbar"] [data-dockkit-surface]').first()).toBeVisible()
  await globalPanel(page, 'Jujutsu').click()
  await expect(tab(page, 'Jujutsu')).toHaveAttribute('aria-selected', 'true')
  await threadTab.click()
  await expect(page.locator('[data-slot="rightbar"]')).not.toHaveCount(0)
  await tab(page, 'Jujutsu').dragTo(page.locator('[data-slot="rightbar"] [data-dockkit-surface]').first())
})

Then('the side panel hosts Jujutsu and its main tab is gone', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-drag-panel-into-side-panel', async () => {
    const sessionId = nativePanelMoves.get(page)
    if (sessionId === undefined) throw new Error('Native panel move has no source thread.')
    const rightbar = page.locator('[data-slot="rightbar"]')
    await expect(page.locator('[data-dockkit-tab]').filter({ hasText: 'Jujutsu' })).toHaveCount(1)
    await expect(rightbar.locator('[data-dockkit-tab]').filter({ hasText: 'Plugins' })).toHaveCount(0)
    await expect(tab(page, 'Jujutsu')).toHaveCount(0)
    await expect(tab(page, 'Plugins')).toHaveCount(0)
    await expect(threadTab(page, sessionId)).toHaveAttribute('aria-selected', 'true')
    await expect(threadTab(page, sessionId)).not.toHaveAttribute('data-preview')
  })
})

When("the moved aside Jujutsu tab's menu moves it to the main area", async ({ page }: { page: Page }) => {
  await page.locator('[data-dockkit-tab]').filter({ hasText: 'Jujutsu' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move to main area', exact: true }).click()
})

Then('Jujutsu is a main tab again and the side panel dropped its tab', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-move-panel-aside-back-to-main', async () => {
    const sessionId = nativePanelMoves.get(page)
    if (sessionId === undefined) throw new Error('Native panel move has no source thread.')
    await expect(tab(page, 'Jujutsu')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('[data-dockkit-tab]').filter({ hasText: 'Jujutsu' })).toHaveCount(0)
    await expect(page.locator('[data-slot="rightbar"] [data-dockkit-tab]').filter({ hasText: 'Plugins' })).toHaveCount(0)
    await expect(tab(page, 'Plugins')).toHaveCount(0)
    await expect(threadTab(page, sessionId)).not.toHaveAttribute('data-preview')
  })
  await finishJourneyAssertions(page)
})

Then('the tabs come back with the pin and the Jujutsu tab is active again', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-restore-after-reload', async () => {
    await expect.poll(() => tabSummary(page)).toEqual(['Plugins (pinned)', 'Jujutsu: Revision graph*'])
    await expect(page.getByRole('heading', { name: 'Jujutsu', exact: true })).toBeVisible()
  })
})

When('the saved tabs are corrupted and the page is reloaded', async ({ page }: { page: Page }) => {
  await page.evaluate(key => localStorage.setItem(key, '{"sets":"truncated'), STORAGE_KEY)
  await page.reload()
  await globalPanel(page, 'Plugins').click()
})

Then('the strip starts over from what the main view shows', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-malformed-storage-starts-over', () => expect.poll(() => tabSummary(page)).toEqual(['Plugins* (preview)']))
  await finishJourneyAssertions(page)
})

/** What a tab looks like, compared between the main strip and DSH's dock-kit strip in the right panel. */
const tabLook = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate(node => {
      const style = getComputedStyle(node)
      const box = node.getBoundingClientRect()
      return {
        height: box.height,
        top: box.top,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontFamily: style.fontFamily,
        padding: `${style.paddingLeft} ${style.paddingRight}`,
        radius: style.borderRadius,
        color: style.color,
        background: style.backgroundColor,
      }
    })

const MAIN_TAB = '[role="tablist"][aria-label="Open views"] [role="tab"]'
const DOCK_TAB = '[data-dockkit-tab]'

When('a thread is started and the right panel is opened beside it', async ({ page }: { page: Page }) => {
  await globalPanel(page, 'Plugins').click()
  await tab(page, 'Plugins').dblclick()
  await startNativeThread(page, 'look thread')
  await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click()
  await page.locator('[data-sidebar-right-guide-entry]').filter({ hasText: 'Editor' }).click()
  await page.locator('[data-dockkit-add-tab]').click()
  await expect(page.locator(`${DOCK_TAB}[aria-selected="true"]`)).toBeVisible()
  await page.mouse.move(0, 0)
})

Then("the active and inactive main tabs share the right panel tabs' metrics and colors", async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-native-tab-look', async () => {
    expect(await tabLook(page, `${MAIN_TAB}[aria-selected="true"]`)).toEqual(await tabLook(page, `${DOCK_TAB}[aria-selected="true"]`))
    expect(await tabLook(page, `${MAIN_TAB}[aria-selected="false"]`)).toEqual(await tabLook(page, `${DOCK_TAB}[aria-selected="false"]`))
  })
  await finishJourneyAssertions(page)
})

const newTabButton = (page: Page) => strip(page).locator('xpath=..').getByRole('button', { name: 'New tab', exact: true })
const startPage = (page: Page) => page.getByRole('listbox', { name: 'Open in this tab', exact: true })
const startPageColumnCount = (page: Page) => startPage(page).evaluate(element => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/u).length)
const suggestion = (page: Page, name: string) => startPage(page).getByRole('option', { name: nativeTabName(name), exact: true })
const suggestionNames = (page: Page): Promise<readonly string[]> =>
  startPage(page)
    .getByRole('option')
    .evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label') ?? ''))

When('the Plugins page is kept as a tab and "+" is pressed', async ({ page }: { page: Page }) => {
  await openKept(page, 'Plugins')
  await newTabButton(page).click()
})

Then(
  'a Start tab follows the Plugins with its search input focused and suggestions for a new thread, panels and Settings',
  async ({ page }: { page: Page }) => {
    await recordAssertion(page, 'main-tabs-plus-opens-start-page', async () => {
      await expect.poll(() => tabSummary(page)).toEqual(['Plugins', 'Start*'])
      await expect(page.getByRole('heading', { name: 'Plugins', exact: true })).toBeHidden()
      const names = await suggestionNames(page)
      expect(names[0]).toBe('New thread')
      expect(names).toEqual(expect.arrayContaining(['Plugins', 'Jujutsu: Revision graph']))
      expect(names).not.toContain('Workbench')
      expect(names.at(-1)).toBe('Settings')
      await expect(suggestion(page, 'New thread')).toHaveAttribute('aria-keyshortcuts', /.+/)
      await expect(suggestion(page, 'Settings')).toHaveAttribute('aria-keyshortcuts', /.+/)
      await expect(page.getByRole('combobox', { name: 'Search tabs and panels' })).toBeFocused()

      const originalViewport = page.viewportSize()
      if (originalViewport === null) throw new Error('Expected a fixed browser viewport')
      await page.setViewportSize({ width: 1280, height: originalViewport.height })
      await expect.poll(() => startPageColumnCount(page)).toBe(2)
      await page.setViewportSize({ width: 480, height: originalViewport.height })
      await expect.poll(() => startPageColumnCount(page)).toBe(1)
      await page.setViewportSize(originalViewport)
    })
  },
)

When('Jujutsu is typed into the Start search and Enter picks it', async ({ page }: { page: Page }) => {
  const search = page.getByRole('combobox', { name: 'Search tabs and panels' })
  await search.fill('Jujutsu')
  await expect(suggestion(page, 'Jujutsu')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
})

Then('Jujutsu replaced the Start tab', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-start-page-pick-replaces-tab', async () => {
    await expect.poll(() => tabSummary(page)).toEqual(['Plugins', 'Jujutsu: Revision graph*'])
    await expect(page.getByRole('heading', { name: 'Jujutsu', exact: true })).toBeVisible()
  })
})

When('a new tab is opened from the keyboard and Settings is picked', async ({ page }: { page: Page }) => {
  await page.keyboard.press(`${primary()}+Alt+KeyT`)
  await expect(tab(page, 'Start')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('End')
  await expect(suggestion(page, 'Settings')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
})

Then('Settings opens and the Start tab is gone', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-start-page-opens-settings', async () => {
    await expect(page.getByRole('dialog').getByText('Keyboard shortcuts', { exact: true })).toBeVisible()
    await expect.poll(() => tabSummary(page)).toEqual(['Plugins', 'Jujutsu: Revision graph*'])
  })
  await finishJourneyAssertions(page)
})

interface MentionJourney {
  readonly threadId: string
}

const mentionJourneys = new WeakMap<Page, MentionJourney>()

const mentionComposer = (page: Page) => page.getByRole('textbox').first()
const mentionChips = (page: Page) => mentionComposer(page).locator('[data-composer-chip="reference"]')

When('a thread tab is mentioned from its context menu', async ({ page }: { page: Page }) => {
  const threadId = await startSidebarThread(page, 'mention target thread')
  // Keep the target's preview tab so it survives starting the thread that receives the mention.
  await threadTab(page, threadId).dblclick()
  await expect(threadTab(page, threadId)).not.toHaveAttribute('data-preview')
  await startSidebarThread(page, 'mention host thread')
  await threadTab(page, threadId).click({ button: 'right' })
  const mentionItem = page.getByRole('menuitem', { name: '@Mention thread', exact: true })
  await expect(mentionItem).toBeVisible()
  await mentionItem.click()
  mentionJourneys.set(page, { threadId })
})

Then('its native mention chip joins the composer draft', async ({ page }: { page: Page }) => {
  if (mentionJourneys.get(page) === undefined) throw new Error('No thread mention journey was recorded for this browser page.')
  await recordAssertion(page, 'main-tabs-thread-tab-menu-mentions-into-the-composer', async () => {
    await expect(mentionChips(page)).toHaveCount(1, { timeout: 15_000 })
  })
})

When('the mentioned thread is dragged from its sidebar row into the composer', async ({ page }: { page: Page }) => {
  const journey = mentionJourneys.get(page)
  if (journey === undefined) throw new Error('No thread mention journey was recorded for this browser page.')
  // The hover action strip covers the row's right half, so grab the trigger from the left a reader would use.
  await sidebarThreadRow(page, journey.threadId)
    .locator(':scope > div > button')
    .first()
    .dragTo(mentionComposer(page), { sourcePosition: { x: 24, y: 16 } })
})

Then('a second mention chip joins the draft', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-dragging-a-thread-row-mentions-into-the-composer', async () => {
    await expect(mentionChips(page)).toHaveCount(2, { timeout: 15_000 })
  })
})

When("the mentioned thread's tab is dragged into the composer", async ({ page }: { page: Page }) => {
  const journey = mentionJourneys.get(page)
  if (journey === undefined) throw new Error('No thread mention journey was recorded for this browser page.')
  await threadTab(page, journey.threadId).dragTo(mentionComposer(page))
})

Then('a third mention chip joins the draft', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-dragging-a-thread-tab-mentions-into-the-composer', async () => {
    await expect(mentionChips(page)).toHaveCount(3, { timeout: 15_000 })
  })
})
