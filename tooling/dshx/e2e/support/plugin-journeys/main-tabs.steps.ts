import { expect, type Page } from '@playwright/test'
import { z } from 'zod'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'
import { sendMessage } from '../threads.js'

const createdSessionResponseSchema = z.object({
  result: z.object({
    ok: z.literal(true),
    value: z.object({ sessionId: z.string().min(1) }),
  }),
})

const STORAGE_KEY = 'dshfiles.main-tabs.v1'

const strip = (page: Page) => page.getByRole('tablist', { name: 'Open views', exact: true })
const tab = (page: Page, name: string) => strip(page).getByRole('tab', { name, exact: true })
const globalPanel = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name, exact: true })

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

const primary = (): string => (process.platform === 'darwin' ? 'Meta' : 'Control')
const threadSidebar = (page: Page) => page.getByRole('region', { name: 'Threads', exact: true })
const sidebarThreadRow = (page: Page, sessionId: string) => threadSidebar(page).locator(`article[data-thread-id="${sessionId}"]`)
const threadTab = (page: Page, sessionId: string) => strip(page).locator(`[data-tab-id="thread:${sessionId}"]`)

const startSidebarThread = async (page: Page, prompt: string): Promise<string> => {
  const createResponsePromise = page.waitForResponse(
    response => {
      const request = response.request()
      return request.method() === 'POST' && request.postData()?.includes('session/create') === true
    },
    { timeout: 15_000 },
  )
  await page.getByRole('button', { name: 'New thread', exact: true }).click()
  const createResponse = await createResponsePromise
  const parsedResponse = createdSessionResponseSchema.safeParse(await createResponse.json())
  if (!parsedResponse.success) throw new Error('The Host returned an invalid session ID after New thread was clicked.')
  const sessionId = parsedResponse.data.result.value.sessionId
  await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(sessionId)
  await expect(page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })).toBeVisible()
  await StartupDialogs.dismissProviderSetupIfShown(page)
  await sendMessage(page, prompt)
  await expect(sidebarThreadRow(page, sessionId)).toBeVisible()
  return sessionId
}

When('the Workbench and then Jujutsu are opened from the sidebar', async ({ page }: { page: Page }) => {
  await globalPanel(page, 'Workbench').click()
  await expect(tab(page, 'Workbench')).toBeVisible()
  await globalPanel(page, 'Jujutsu').click()
})

Then('Jujutsu replaced the Workbench preview tab', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-preview-tab-is-replaced', () => expect.poll(() => tabSummary(page)).toEqual(['Jujutsu* (preview)']))
})

When('the Jujutsu tab is kept, the Workbench is opened again and a thread is started', async ({ page }: { page: Page }) => {
  await tab(page, 'Jujutsu').dblclick()
  await openKept(page, 'Workbench')
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await sendMessage(page, 'tabs thread')
})

Then('each of them has its own tab and the thread tab is active', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-panels-and-threads-get-tabs', () =>
    expect.poll(() => tabSummary(page)).toEqual(['Jujutsu', 'Workbench', 'tabs thread* (preview)']),
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
  await page.getByRole('menuitem', { name: 'Copy thread ID', exact: true }).click()
  await recordAssertion(page, 'main-tabs-context-menu-copies-thread-id', async () => {
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(sessionId)
    await expect(page.getByRole('status').filter({ hasText: /^Thread ID copied\.$/ })).toHaveText('Thread ID copied.')
  })

  await threadTab.click({ button: 'right' })
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

When('the Workbench tab is pinned and the thread tab is dragged before Jujutsu', async ({ page }: { page: Page }) => {
  await tab(page, 'Workbench').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pin tab', exact: true }).click()
  await tab(page, 'tabs thread').dragTo(tab(page, 'Jujutsu'), { targetPosition: { x: 4, y: 10 } })
})

Then('the pinned tab leads and the thread tab moved', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-pin-and-reorder', () => expect.poll(() => tabSummary(page)).toEqual(['Workbench (pinned)', 'tabs thread*', 'Jujutsu']))
})

When('the Jujutsu tab is closed with a middle click and other tabs are closed from the thread tab', async ({ page }: { page: Page }) => {
  await tab(page, 'Jujutsu').click({ button: 'middle' })
  await expect(tab(page, 'Jujutsu')).toHaveCount(0)
  await openKept(page, 'Jujutsu')
  await tab(page, 'tabs thread').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Close other tabs', exact: true }).click()
})

Then('only the pinned Workbench and the thread remain', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-close-others-keeps-pinned', async () => {
    await expect.poll(() => tabSummary(page)).toEqual(['Workbench (pinned)', 'tabs thread*'])
    await expect(page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the Workbench is opened as a tab', async ({ page }: { page: Page }) => {
  await globalPanel(page, 'Workbench').click()
  await expect(tab(page, 'Workbench')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Workbench', exact: true })).toBeVisible()
})

Then('the tab strip sits directly above the main panel, anchored before the main slot outlet', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-strip-mounts-above-main-panel', () => expect.poll(() => stripPlacement(page)).toEqual(expectedPlacement))
})

When('a thread is started beside the Workbench tab', async ({ page }: { page: Page }) => {
  await tab(page, 'Workbench').dblclick()
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await sendMessage(page, 'mount thread')
  await expect(tab(page, 'mount thread')).toHaveAttribute('aria-selected', 'true')
})

Then('the tab strip still sits directly above the main panel', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-strip-follows-panel-changes', async () => {
    await expect.poll(() => stripPlacement(page)).toEqual(expectedPlacement)
    await expect(page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the Workbench and Jujutsu are opened and kept as tabs', async ({ page }: { page: Page }) => {
  await openKept(page, 'Workbench')
  await openKept(page, 'Jujutsu')
})

Then('the tab shortcuts jump to the first and last tab and cycle between them', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-keyboard-jump-and-cycle', async () => {
    await page.keyboard.press(`${primary()}+Alt+Digit1`)
    await expect(tab(page, 'Workbench')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: 'Workbench', exact: true })).toBeVisible()
    await page.keyboard.press(`${primary()}+Alt+Digit9`)
    await expect(tab(page, 'Jujutsu')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press(`${primary()}+Alt+BracketRight`)
    await expect(tab(page, 'Workbench')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press(`${primary()}+Alt+BracketLeft`)
    await expect(tab(page, 'Jujutsu')).toHaveAttribute('aria-selected', 'true')
  })
  await finishJourneyAssertions(page)
})

When('the Workbench tab is pinned and the page is reloaded', async ({ page }: { page: Page }) => {
  await tab(page, 'Workbench').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Pin tab', exact: true }).click()
  await expect(tab(page, 'Workbench')).toHaveAttribute('data-pinned', 'true')
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
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  const threadTab = strip(page).locator('[data-tab-id^="thread:"]').first()
  await expect(threadTab).toBeVisible()
  await threadTab.dblclick()
  await expect(threadTab).not.toHaveAttribute('data-preview')
  await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click()
  await page.locator('[data-sidebar-right-guide-entry]').filter({ hasText: 'Workbench' }).click()
  await globalPanel(page, 'Jujutsu').click()
  await expect(tab(page, 'Jujutsu')).toHaveAttribute('aria-selected', 'true')
  await threadTab.click()
  await expect(page.locator('[data-slot="rightbar"]')).not.toHaveCount(0)
  await tab(page, 'Jujutsu').dragTo(page.locator('[data-slot="rightbar"] [data-dockkit-surface]').first())
})

Then('the side panel hosts Jujutsu and its main tab is gone', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-drag-panel-into-side-panel', async () => {
    await expect(page.locator('[data-dockkit-tab]').filter({ hasText: 'Jujutsu' })).toHaveCount(1)
    await expect(tab(page, 'Jujutsu')).toHaveCount(0)
  })
})

When("the moved aside Jujutsu tab's menu moves it to the main area", async ({ page }: { page: Page }) => {
  await page.locator('[data-dockkit-tab]').filter({ hasText: 'Jujutsu' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move to main area', exact: true }).click()
})

Then('Jujutsu is a main tab again and the side panel dropped its tab', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-move-panel-aside-back-to-main', async () => {
    await expect(tab(page, 'Jujutsu')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('[data-dockkit-tab]').filter({ hasText: 'Jujutsu' })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

Then('the tabs come back with the pin and the Jujutsu tab is active again', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-restore-after-reload', async () => {
    await expect.poll(() => tabSummary(page)).toEqual(['Workbench (pinned)', 'Jujutsu*'])
    await expect(page.getByRole('heading', { name: 'Jujutsu', exact: true })).toBeVisible()
  })
})

When('the saved tabs are corrupted and the page is reloaded', async ({ page }: { page: Page }) => {
  await page.evaluate(key => localStorage.setItem(key, '{"sets":"truncated'), STORAGE_KEY)
  await page.reload()
  await globalPanel(page, 'Workbench').click()
})

Then('the strip starts over from what the main view shows', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'main-tabs-malformed-storage-starts-over', () => expect.poll(() => tabSummary(page)).toEqual(['Workbench* (preview)']))
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
  await globalPanel(page, 'Workbench').click()
  await tab(page, 'Workbench').dblclick()
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await sendMessage(page, 'look thread')
  await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click()
  await page.locator('[data-sidebar-right-guide-entry]').filter({ hasText: 'Workbench' }).click()
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
const suggestion = (page: Page, name: string) => startPage(page).getByRole('option', { name, exact: true })
const suggestionNames = (page: Page): Promise<readonly string[]> =>
  startPage(page)
    .getByRole('option')
    .evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label') ?? ''))

When('the Workbench is kept as a tab and "+" is pressed', async ({ page }: { page: Page }) => {
  await openKept(page, 'Workbench')
  await newTabButton(page).click()
})

Then(
  'a Start tab follows the Workbench with its search input focused and suggestions for a new thread, panels and Settings',
  async ({ page }: { page: Page }) => {
    await recordAssertion(page, 'main-tabs-plus-opens-start-page', async () => {
      await expect.poll(() => tabSummary(page)).toEqual(['Workbench', 'Start*'])
      await expect(page.getByRole('heading', { name: 'Workbench', exact: true })).toBeHidden()
      const names = await suggestionNames(page)
      expect(names[0]).toBe('New thread')
      expect(names).toEqual(expect.arrayContaining(['Plugins', 'Jujutsu', 'Workbench']))
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
    await expect.poll(() => tabSummary(page)).toEqual(['Workbench', 'Jujutsu*'])
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
    await expect.poll(() => tabSummary(page)).toEqual(['Workbench', 'Jujutsu*'])
  })
  await finishJourneyAssertions(page)
})
