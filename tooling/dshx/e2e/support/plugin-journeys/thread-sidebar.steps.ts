import { expect, type Page, type TestInfo } from '@playwright/test'
import { z } from 'zod'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const createdSessionResponseSchema = z.object({
  result: z.object({
    ok: z.literal(true),
    value: z.object({ sessionId: z.string().min(1) }),
  }),
})

interface ThreadHistoryJourney {
  readonly firstThreadId: string
  readonly secondThreadId: string
}

const threadHistoryJourneys = new WeakMap<Page, ThreadHistoryJourney>()
const archivedOpenJourneys = new WeakMap<Page, string>()

interface FinishedTurnJourney {
  readonly targetThreadId: string
}

const finishedTurnJourneys = new WeakMap<Page, FinishedTurnJourney>()

/** The key the plugin read before attention became Host-owned. */
const LEGACY_NOTIFICATION_STORAGE_KEY = 'dshfiles.thread-sidebar.notifications.v1'

const threadSidebar = (page: Page) => page.getByRole('region', { name: 'Threads' })
const sidebarNavigation = (page: Page) => page.getByRole('navigation', { name: 'Sidebar navigation' })
const customizeSidebar = (page: Page) => page.getByRole('region', { name: 'Customize sidebar' })
const sidebarSettings = (page: Page) => page.getByRole('region', { name: 'Sidebar settings' })
const paletteDialog = (page: Page) => page.getByRole('dialog', { name: 'Command palette' })
const paletteInput = (page: Page) => paletteDialog(page).getByRole('combobox')
const currentThreadId = (page: Page): string | null => new URL(page.url()).searchParams.get('thread')
// The Host shortens display titles to their first words, so rows are found by thread id, not by the prompt.
const threadRow = (page: Page, threadId: string) => threadSidebar(page).locator(`article[data-thread-id="${threadId}"]`)

const startBlankThread = async (page: Page): Promise<string> => {
  const createResponsePromise = page.waitForResponse(
    response => {
      const request = response.request()
      return request.method() === 'POST' && request.postData()?.includes('session/create') === true
    },
    { timeout: 15_000 },
  )
  await sidebarNavigation(page).getByRole('button', { name: 'New thread', exact: true }).click()
  const createResponse = await createResponsePromise
  const parsedResponse = createdSessionResponseSchema.safeParse(await createResponse.json())
  if (!parsedResponse.success) throw new Error('The Host returned an invalid session ID after New thread was clicked.')
  const createdThreadId = parsedResponse.data.result.value.sessionId
  await expect.poll(() => currentThreadId(page)).toBe(createdThreadId)
  await expect(page.getByRole('textbox').first()).toBeVisible()
  return createdThreadId
}

const openSidebarSettings = async (page: Page): Promise<void> => {
  await threadSidebar(page).getByRole('button', { name: 'Sidebar settings', exact: true }).click()
  await expect(sidebarSettings(page)).toBeVisible()
}

const statusFilterLabels: readonly string[] = ['All threads', 'Working', 'Not working', 'Needs attention', 'Muted', 'Archived']

const setThreadStatusFilters = async (page: Page, triggerName: string, selectedLabels: readonly string[]): Promise<void> => {
  await threadSidebar(page).getByRole('button', { name: triggerName, exact: true }).click()
  for (const label of statusFilterLabels) {
    const item = page.getByRole('menuitemcheckbox', { name: label, exact: true })
    const shouldBeChecked = label === 'All threads' ? selectedLabels.length === 0 : selectedLabels.includes(label)
    if ((await item.getAttribute('aria-checked')) === String(shouldBeChecked)) continue
    await item.click()
  }
  await page.keyboard.press('Escape')
}

const selectThreadViewValue = async (page: Page, triggerName: string, value: string): Promise<void> => {
  if (statusFilterLabels.includes(value)) {
    await setThreadStatusFilters(page, triggerName, value === 'All threads' ? [] : [value])
    return
  }
  await threadSidebar(page).getByRole('button', { name: triggerName, exact: true }).click()
  await page.getByRole('menuitemradio', { name: value, exact: true }).click()
}

When('a blank Host thread is started', async ({ page }: { page: Page }) => {
  await startBlankThread(page)
})

When('a nonblank Host thread is archived and immediately undone', async ({ page, $testInfo }: { page: Page; $testInfo: TestInfo }) => {
  const prompt = 'thread sidebar archive undo e2e'
  if (currentThreadId(page) === null) await startBlankThread(page)
  await page.getByRole('textbox').first().fill(prompt)
  await page.getByRole('textbox').first().press('Enter')
  const archivedThreadId = currentThreadId(page)
  if (archivedThreadId === null) throw new Error('The Host did not keep the selected thread after its first message.')
  const targetRow = threadSidebar(page).locator('article').filter({ hasText: prompt })
  await expect(targetRow).toHaveCount(1)
  await expect(targetRow.getByRole('button', { name: 'Archive', exact: true })).toBeEnabled()
  const scrollPane = threadSidebar(page).getByTestId('thread-sidebar-scroll')
  const scrollPaneTopBeforeArchive = await scrollPane.evaluate(element => element.getBoundingClientRect().top)
  await targetRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
  const transientNotice = threadSidebar(page).getByTestId('thread-sidebar-transient-notice')
  let screenshotClip: { x: number; y: number; width: number; height: number } | undefined
  let layoutEvidence: string | undefined
  await recordAssertion(page, 'thread-sidebar-archive-notice-overlays-thread-list', async () => {
    const archivedMessage = transientNotice.getByText('Thread archived.', { exact: true })
    const noticeAlert = transientNotice.getByRole('alert')
    await expect(archivedMessage).toBeVisible()
    await expect(noticeAlert).toBeVisible()
    const undoButton = noticeAlert.getByRole('button', { name: 'Undo', exact: true })
    await expect(undoButton).toBeVisible()
    const transientNoticeLayout = await transientNotice.evaluate(element => {
      const style = getComputedStyle(element)
      return { position: style.position, bottom: Number.parseFloat(style.bottom) }
    })
    const noticeStyle = await noticeAlert.evaluate(element => {
      const style = getComputedStyle(element)
      return { display: style.display, backgroundColor: style.backgroundColor }
    })
    const sidebarPosition = await threadSidebar(page).evaluate(element => getComputedStyle(element).position)
    const sidebarBounds = await threadSidebar(page).boundingBox()
    const noticeBounds = await transientNotice.boundingBox()
    const alertBounds = await noticeAlert.boundingBox()
    const archivedMessageBounds = await archivedMessage.boundingBox()
    const undoButtonBounds = await undoButton.boundingBox()
    if (sidebarBounds === null || noticeBounds === null || alertBounds === null || archivedMessageBounds === null || undoButtonBounds === null) {
      throw new Error('The archive notice or sidebar has no layout box.')
    }
    const scrollPaneTopAfterArchive = await scrollPane.evaluate(element => element.getBoundingClientRect().top)
    expect(transientNoticeLayout.position).toBe('absolute')
    expect(transientNoticeLayout.bottom).toBeGreaterThan(0)
    expect(noticeStyle.display).toBe('flex')
    expect(noticeStyle.backgroundColor).toMatch(/^rgb\(/)
    expect(undoButtonBounds.x).toBeGreaterThan(archivedMessageBounds.x + archivedMessageBounds.width)
    expect(sidebarPosition).toBe('relative')
    expect(noticeBounds.x).toBeGreaterThanOrEqual(sidebarBounds.x)
    expect(noticeBounds.x + noticeBounds.width).toBeLessThanOrEqual(sidebarBounds.x + sidebarBounds.width)
    expect(noticeBounds.y + noticeBounds.height).toBeLessThanOrEqual(sidebarBounds.y + sidebarBounds.height)
    expect(alertBounds.width).toBeLessThan(sidebarBounds.width)
    expect(alertBounds.x).toBeGreaterThanOrEqual(sidebarBounds.x)
    expect(alertBounds.x + alertBounds.width).toBeLessThanOrEqual(sidebarBounds.x + sidebarBounds.width)
    expect(archivedMessageBounds.x).toBeGreaterThanOrEqual(alertBounds.x)
    expect(archivedMessageBounds.x + archivedMessageBounds.width).toBeLessThanOrEqual(alertBounds.x + alertBounds.width)
    expect(undoButtonBounds.x).toBeGreaterThanOrEqual(alertBounds.x)
    expect(undoButtonBounds.x + undoButtonBounds.width).toBeLessThanOrEqual(alertBounds.x + alertBounds.width)
    expect(undoButtonBounds.y + undoButtonBounds.height).toBeLessThanOrEqual(sidebarBounds.y + sidebarBounds.height)
    expect(scrollPaneTopAfterArchive).toBe(scrollPaneTopBeforeArchive)
    layoutEvidence = JSON.stringify(
      {
        transientNoticeLayout,
        noticeStyle,
        sidebarPosition,
        sidebarBounds,
        noticeBounds,
        alertBounds,
        archivedMessageBounds,
        undoButtonBounds,
        scrollPaneTopBeforeArchive,
        scrollPaneTopAfterArchive,
      },
      null,
      2,
    )
    screenshotClip = { x: sidebarBounds.x, y: sidebarBounds.y, width: sidebarBounds.width, height: sidebarBounds.height }
  })
  if (layoutEvidence === undefined || screenshotClip === undefined) throw new Error('The archive notice evidence was not captured.')
  await $testInfo.attach('archive-undo-notice-layout.json', { body: layoutEvidence, contentType: 'application/json' })
  await $testInfo.attach('archive-undo-notice.png', {
    body: await page.screenshot({ type: 'png', animations: 'disabled', clip: screenshotClip }),
    contentType: 'image/png',
  })
  const archivedSection = threadSidebar(page).getByRole('button', { name: 'Archived (1)', exact: true })
  await expect(archivedSection).toBeVisible()
  const undoButton = transientNotice.getByRole('button', { name: 'Undo', exact: true })
  await expect(undoButton).toBeVisible()
  await undoButton.click()
  await expect.poll(() => currentThreadId(page)).toBe(archivedThreadId)
  await expect(threadSidebar(page).getByText('Thread restored.', { exact: true })).toBeVisible()
})

Then('the thread is restored from the archive notice', async ({ page }: { page: Page }) => {
  const targetRow = threadSidebar(page).locator('article').filter({ hasText: 'thread sidebar archive undo e2e' })
  await recordAssertion(page, 'thread-sidebar-archive-undo-restores-thread', async () => {
    await expect(threadSidebar(page).getByRole('button', { name: 'Archived (0)', exact: true })).toHaveCount(0)
    await expect(targetRow).toHaveCount(1)
    await expect(targetRow.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('archive undo settings are changed and threads are archived', async ({ page }: { page: Page }) => {
  await openSidebarSettings(page)
  const undoEnabled = sidebarSettings(page).getByRole('checkbox', { name: 'Show an undo notice after archiving' })
  const undoDuration = sidebarSettings(page).getByRole('spinbutton', { name: 'Undo notice duration (seconds)' })
  await expect(undoEnabled).toBeChecked()
  await undoDuration.fill('2')
  await expect(undoDuration).toHaveValue('2')
  await threadSidebar(page).getByRole('button', { name: 'Sidebar settings', exact: true }).click()

  await startBlankThread(page)
  const timedPrompt = 'thread sidebar archive duration e2e'
  const composer = page.getByRole('textbox').first()
  await composer.fill(timedPrompt)
  await composer.press('Enter')
  const timedRow = threadSidebar(page).locator('article').filter({ hasText: timedPrompt })
  await expect(timedRow.getByRole('button', { name: 'Archive', exact: true })).toBeEnabled()
  await timedRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
  const archivedNotice = threadSidebar(page).getByText('Thread archived.', { exact: true })
  await expect(archivedNotice).toBeVisible()
  await expect(archivedNotice).toBeHidden({ timeout: 4_000 })

  await openSidebarSettings(page)
  await undoEnabled.uncheck()
  await expect(undoEnabled).not.toBeChecked()
  await threadSidebar(page).getByRole('button', { name: 'Sidebar settings', exact: true }).click()

  await startBlankThread(page)
  const disabledPrompt = 'thread sidebar archive disabled e2e'
  await page.getByRole('textbox').first().fill(disabledPrompt)
  await page.getByRole('textbox').first().press('Enter')
  const disabledRow = threadSidebar(page).locator('article').filter({ hasText: disabledPrompt })
  await expect(disabledRow.getByRole('button', { name: 'Archive', exact: true })).toBeEnabled()
  await disabledRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
  await expect(threadSidebar(page).getByRole('button', { name: 'Archived (2)', exact: true })).toBeVisible()
  await expect(threadSidebar(page).getByText('Thread archived.', { exact: true })).toHaveCount(0)
})

Then('archive undo settings control the temporary notice', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-sidebar-archive-undo-preferences-respected', async () => {
    await expect(threadSidebar(page).getByRole('button', { name: 'Archived (2)', exact: true })).toBeVisible()
    await expect(threadSidebar(page).getByText('Thread archived.', { exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('an archived thread is opened from the Archived section', async ({ page }: { page: Page }) => {
  if (currentThreadId(page) === null) await startBlankThread(page)
  const prompt = 'thread sidebar archived open e2e'
  await page.getByRole('textbox').first().fill(prompt)
  await page.getByRole('textbox').first().press('Enter')
  const archivedThreadId = currentThreadId(page)
  if (archivedThreadId === null) throw new Error('The Host did not keep the selected thread after its first message.')
  const targetRow = threadRow(page, archivedThreadId)
  await expect(targetRow.getByRole('button', { name: 'Archive', exact: true })).toBeEnabled()
  await targetRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()

  await threadSidebar(page).getByRole('button', { name: 'Archived (1)', exact: true }).click()
  await targetRow.click()
  const restoreButton = threadSidebar(page)
    .getByTestId('thread-sidebar-transient-notice')
    .getByRole('button', { name: 'Restore and open', exact: true })
  await expect(restoreButton).toBeVisible({ timeout: 15_000 })
  archivedOpenJourneys.set(page, archivedThreadId)
})

Then('the archived-open notice dismisses and returns on the next attempt', async ({ page }: { page: Page }) => {
  const archivedThreadId = archivedOpenJourneys.get(page)
  if (archivedThreadId === undefined) throw new Error('No archived thread was opened in this journey.')
  const targetRow = threadRow(page, archivedThreadId)
  const transientNotice = threadSidebar(page).getByTestId('thread-sidebar-transient-notice')
  const restoreButton = transientNotice.getByRole('button', { name: 'Restore and open', exact: true })

  await recordAssertion(page, 'thread-sidebar-archived-open-notice-dismisses', async () => {
    await expect(restoreButton).toBeHidden({ timeout: 15_000 })
    await expect(transientNotice).toHaveCount(0)
  })
  await recordAssertion(page, 'thread-sidebar-archived-open-notice-returns', async () => {
    await targetRow.click()
    await expect(restoreButton).toBeVisible({ timeout: 15_000 })
  })
  await finishJourneyAssertions(page)
})

let parkedThreadId: string | null = null

When('a nonblank Host thread is parked from its context menu', async ({ page }: { page: Page }) => {
  if (currentThreadId(page) === null) await startBlankThread(page)
  const composer = page.getByRole('textbox').first()
  await composer.fill('thread sidebar park e2e target')
  await composer.press('Enter')
  const threadId = currentThreadId(page)
  if (threadId === null) throw new Error('The Host did not keep the selected thread after its first message.')
  parkedThreadId = threadId
  const targetRow = threadRow(page, threadId)
  await expect(targetRow).toHaveCount(1)
  await targetRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Park', exact: true }).click()
  await expect(threadSidebar(page).getByRole('button', { name: 'Active (0)', exact: true })).toBeVisible()
  await expect(threadSidebar(page).getByRole('button', { name: 'Parked (1)', exact: true })).toBeVisible()
  await expect(targetRow).toHaveCount(1)
})

Then('the Host thread stays parked after reload without an attention error', async ({ page }: { page: Page }) => {
  if (parkedThreadId === null) throw new Error('No thread was parked.')
  const targetRow = threadRow(page, parkedThreadId)
  await recordAssertion(page, 'thread-sidebar-context-menu-parking-succeeds', async () => {
    await expect(threadSidebar(page).getByText('The Host could not update this thread’s read or parked state.', { exact: true })).toHaveCount(0)
    await expect(threadSidebar(page).getByRole('button', { name: 'Active (0)', exact: true })).toBeVisible()
    await expect(threadSidebar(page).getByRole('button', { name: 'Parked (1)', exact: true })).toBeVisible()
    await expect(targetRow).toHaveCount(1)
  })
  await page.reload()
  await expect(threadSidebar(page)).toBeVisible()
  await recordAssertion(page, 'thread-sidebar-context-menu-parking-survives-reload', async () => {
    await expect(threadSidebar(page).getByRole('button', { name: 'Active (0)', exact: true })).toBeVisible()
    await expect(threadSidebar(page).getByRole('button', { name: 'Parked (1)', exact: true })).toBeVisible()
    await expect(targetRow).toHaveCount(1)
  })
  await finishJourneyAssertions(page)
})

let pinnedThreadId: string | null = null

When('a nonblank Host thread is pinned from its session header', async ({ page }: { page: Page }) => {
  const prompt = 'thread sidebar header pin e2e target'
  if (currentThreadId(page) === null) await startBlankThread(page)
  const composer = page.getByRole('textbox').first()
  await composer.fill(prompt)
  await composer.press('Enter')
  const threadId = currentThreadId(page)
  if (threadId === null) throw new Error('The Host did not keep the selected thread after its first message.')
  pinnedThreadId = threadId
  await expect(threadRow(page, threadId)).toHaveCount(1)
  const threadActions = page.getByRole('group', { name: 'Thread actions', exact: true })
  await expect(threadActions).toHaveCount(1)
  await threadActions.getByRole('button', { name: 'More thread actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Archive', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await threadActions.getByRole('button', { name: 'Pin', exact: true }).click()
  await expect(threadSidebar(page).getByRole('button', { name: 'Pinned (1)', exact: true })).toBeVisible()
  await expect(threadActions.getByRole('button', { name: 'Unpin', exact: true })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'could not update' })).toHaveCount(0)
})

When('a nonblank Host thread is pinned from its sidebar row', async ({ page }: { page: Page }) => {
  if (currentThreadId(page) === null) await startBlankThread(page)
  const composer = page.getByRole('textbox').first()
  await composer.fill('thread sidebar row pin e2e target')
  await composer.press('Enter')
  const threadId = currentThreadId(page)
  if (threadId === null) throw new Error('The Host did not keep the selected thread after its first message.')
  pinnedThreadId = threadId
  const targetRow = threadRow(page, threadId)
  await expect(targetRow).toHaveCount(1)
  const threadRowActions = targetRow.getByTestId('thread-row-actions')
  await expect.poll(() => threadRowActions.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none')
  const rowBounds = await targetRow.boundingBox()
  if (rowBounds === null) throw new Error('The target thread row has no layout box.')
  await page.mouse.move(rowBounds.x + 8, rowBounds.y + rowBounds.height / 2)
  await expect.poll(() => threadRowActions.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
  await expect.poll(() => threadRowActions.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('auto')
  const scrollPane = threadSidebar(page).getByTestId('thread-sidebar-scroll')
  await expect.poll(() => scrollPane.evaluate(element => getComputedStyle(element).overscrollBehaviorY)).toBe('contain')
  const pinButton = targetRow.getByRole('button', { name: 'Pin', exact: true })
  await pinButton.hover()
  await expect.poll(() => threadRowActions.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
  await pinButton.click()
  await expect(threadSidebar(page).getByRole('button', { name: 'Pinned (1)', exact: true })).toBeVisible()
  await expect(targetRow.getByRole('button', { name: 'Unpin', exact: true })).toHaveCount(1)
  await expect(threadSidebar(page).getByText('could not update', { exact: false })).toHaveCount(0)
})

Then('the thread stays pinned after reload', async ({ page }: { page: Page }) => {
  if (pinnedThreadId === null) throw new Error('No thread was pinned.')
  const targetRow = threadRow(page, pinnedThreadId)
  await recordAssertion(page, 'thread-sidebar-session-header-pin-succeeds', async () => {
    await expect(threadSidebar(page).getByRole('button', { name: 'Pinned (1)', exact: true })).toBeVisible()
    await expect(targetRow).toHaveCount(1)
  })
  await page.reload()
  await expect(threadSidebar(page)).toBeVisible()
  await recordAssertion(page, 'thread-sidebar-session-header-pin-survives-reload', async () => {
    await expect(threadSidebar(page).getByRole('button', { name: 'Pinned (1)', exact: true })).toBeVisible()
    await expect(targetRow).toHaveCount(1)
  })
  await finishJourneyAssertions(page)
})

let mutedThreadId: string | null = null

When('a thread is snoozed until tomorrow morning from its sidebar row', async ({ page }: { page: Page }) => {
  if (currentThreadId(page) === null) await startBlankThread(page)
  const composer = page.getByRole('textbox').first()
  await composer.fill('thread sidebar mute e2e target')
  await composer.press('Enter')
  mutedThreadId = currentThreadId(page)
  if (mutedThreadId === null) throw new Error('The Host did not keep the selected thread after its first message.')
  const targetRow = threadRow(page, mutedThreadId)
  await expect(targetRow).toHaveCount(1)
  await targetRow.hover()
  await targetRow.getByRole('button', { name: 'Mute thread', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Until tomorrow morning', exact: true }).click()
  const marker = targetRow.getByRole('img', { name: 'Muted', exact: true })
  await expect(marker).toBeVisible()
  await marker.hover()
  await expect(
    page
      .getByRole('tooltip')
      .filter({ hasText: /Muted · wakes in \d+ [hd] / })
      .first(),
  ).toBeVisible()
})

Then('it stays snoozed after reload and the Muted filter lists it', async ({ page }: { page: Page }) => {
  if (mutedThreadId === null) throw new Error('No thread was muted.')
  const targetRow = threadRow(page, mutedThreadId)
  await page.reload()
  await expect(threadSidebar(page)).toBeVisible()
  await recordAssertion(page, 'thread-sidebar-mute-survives-reload', async () => {
    await expect(targetRow.getByRole('img', { name: 'Muted', exact: true })).toBeVisible()
  })
  await selectThreadViewValue(page, 'Filter: None', 'Muted')
  await recordAssertion(page, 'thread-sidebar-muted-filter-lists-muted-thread', async () => {
    await expect(targetRow).toHaveCount(1)
  })
})

Then('unmuting it from the session header clears the marker', async ({ page }: { page: Page }) => {
  if (mutedThreadId === null) throw new Error('No thread was muted.')
  const threadActions = page.getByRole('group', { name: 'Thread actions', exact: true })
  await threadActions.getByRole('button', { name: 'More thread actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Muted', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Unmute', exact: true }).click()
  await recordAssertion(page, 'thread-sidebar-unmute-clears-marker', async () => {
    await expect(threadSidebar(page).getByTestId('thread-sidebar-muted-marker')).toHaveCount(0)
    await expect(threadRow(page, mutedThreadId ?? '')).toHaveCount(0)
  })
  await selectThreadViewValue(page, 'Filter: Muted', 'All threads')
  await expect(threadRow(page, mutedThreadId)).toHaveCount(1)
  await finishJourneyAssertions(page)
})

When('the Active section is folded and reopened', async ({ page }: { page: Page }) => {
  const activeSection = threadSidebar(page).getByRole('button', { name: 'Active (0)', exact: true })
  await expect(activeSection).toHaveAttribute('aria-expanded', 'true')
  await activeSection.click()
  await expect(activeSection).toHaveAttribute('aria-expanded', 'false')
  await activeSection.click()
  await expect(activeSection).toHaveAttribute('aria-expanded', 'true')
})

Then('the sidebar keeps the blank session out of classified thread rows', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-sidebar-classification-excludes-blank-host-session', async () => {
    await expect.poll(() => currentThreadId(page)).not.toBeNull()
    await expect(threadSidebar(page).getByRole('button', { name: 'Active (0)', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await expect(threadSidebar(page).locator('article')).toHaveCount(0)
    await expect(threadSidebar(page).getByText('No threads in this section.', { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('a Host thread is archived and the view is grouped and filtered', async ({ page }: { page: Page }) => {
  const prompt = 'thread sidebar view filter e2e target'
  const displayTitle = 'thread sidebar view filter e2e'
  if (currentThreadId(page) === null) await startBlankThread(page)
  const composer = page.getByRole('textbox').first()
  await expect(composer).toBeVisible()
  await composer.fill(prompt)
  await composer.press('Enter')
  const targetRow = threadSidebar(page).locator('article').filter({ hasText: 'thread sidebar view filter e2e' })
  await expect(targetRow).toHaveCount(1)
  await expect(page.getByText('This turn failed', { exact: false })).toBeVisible()
  await selectThreadViewValue(page, 'Filter: None', 'Not working')
  await expect(targetRow).toBeVisible()
  await selectThreadViewValue(page, 'Filter: Not working', 'Working')
  await expect(targetRow).toHaveCount(0)
  await expect(threadSidebar(page).getByText('No threads are working right now.', { exact: true })).toBeVisible()
  await selectThreadViewValue(page, 'Filter: Working', 'All threads')
  await expect(targetRow).toBeVisible()
  await targetRow.click({ button: 'right' })
  const archiveItem = page.getByRole('menuitem', { name: 'Archive', exact: true })
  await expect(archiveItem).toBeEnabled()
  await archiveItem.click()
  await expect(threadSidebar(page).getByRole('button', { name: 'Archived (1)', exact: true })).toBeVisible()

  await selectThreadViewValue(page, 'Group: Status', 'Date')
  await selectThreadViewValue(page, 'Filter: None', 'Archived')
  await selectThreadViewValue(page, 'Filter: Archived', 'Main threads')
  await expect(targetRow).toBeVisible()
  await expect(threadSidebar(page).getByRole('region', { name: 'Today', exact: true })).toContainText(displayTitle)
  await setThreadStatusFilters(page, 'Filter: Archived · Main threads', ['Working', 'Archived'])
  await expect(threadSidebar(page).getByRole('button', { name: 'Filter: Working · Archived · Main threads', exact: true })).toBeVisible()
  await expect(targetRow).toBeVisible()
  await setThreadStatusFilters(page, 'Filter: Working · Archived · Main threads', ['Archived'])

  await selectThreadViewValue(page, 'Filter: Archived · Main threads', 'Working')
  await expect(targetRow).toHaveCount(0)
  await expect(threadSidebar(page).getByText('No threads are working right now.', { exact: true })).toBeVisible()
  await selectThreadViewValue(page, 'Filter: Working · Main threads', 'Archived')
  await selectThreadViewValue(page, 'Filter: Archived · Main threads', 'Subagent threads')
  await expect(targetRow).toHaveCount(0)
  await selectThreadViewValue(page, 'Filter: Archived · Subagent threads', 'Main threads')
  await expect(targetRow).toBeVisible()

  await page.reload()
  await expect(threadSidebar(page)).toBeVisible()
})

Then('only matching rows remain visible after reload', async ({ page }: { page: Page }) => {
  const displayTitle = 'thread sidebar view filter e2e'
  const targetRow = threadSidebar(page).locator('article').filter({ hasText: displayTitle })
  await recordAssertion(page, 'thread-sidebar-grouping-and-filter-preferences-survive-reload', async () => {
    await expect(threadSidebar(page).getByRole('button', { name: 'Group: Date', exact: true })).toBeVisible()
    await expect(threadSidebar(page).getByRole('button', { name: 'Filter: Archived · Main threads', exact: true })).toBeVisible()
    await expect(targetRow).toBeVisible()
    await expect(threadSidebar(page).getByRole('region', { name: 'Today', exact: true })).toContainText(displayTitle)
    await threadSidebar(page).getByRole('button', { name: 'Filter: Archived · Main threads', exact: true }).click()
    await expect(page.getByRole('menuitemcheckbox', { name: 'Archived', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('menuitemradio', { name: 'Main threads', exact: true })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
  })
  await finishJourneyAssertions(page)
})

When('auto-archive is enabled with a new idle threshold and scan interval', async ({ page }: { page: Page }) => {
  await openSidebarSettings(page)
  const autoArchive = sidebarSettings(page).getByRole('checkbox', { name: 'Auto-archive inactive threads' })
  await expect(autoArchive).not.toBeChecked()
  await autoArchive.click()
  await page.getByLabel('Move to inactive after (minutes)').fill('45')
  await page.getByLabel('Check every (minutes)').fill('5')
  await page.reload()
  await expect(threadSidebar(page)).toBeVisible()
  await openSidebarSettings(page)
})

Then('the policy settings survive a browser reload', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-sidebar-idle-policy-settings-survive-reload', async () => {
    await expect(sidebarSettings(page).getByRole('checkbox', { name: 'Auto-archive inactive threads' })).toBeChecked()
    await expect(page.getByLabel('Move to inactive after (minutes)')).toHaveValue('45')
    await expect(page.getByLabel('Check every (minutes)')).toHaveValue('5')
  })
  await finishJourneyAssertions(page)
})

When('one thread is marked unread and another thread is opened', async ({ page }: { page: Page }) => {
  const targetThreadId = await startBlankThread(page)
  const targetPrompt = 'thread sidebar primary unread e2e target'
  const composer = page.getByRole('textbox').first()
  await composer.fill(targetPrompt)
  await composer.press('Enter')
  const targetRow = threadSidebar(page).locator('article').filter({ hasText: 'thread sidebar primary unread' })
  await expect(targetRow).toHaveCount(1)

  const otherThreadId = await startBlankThread(page)
  const otherPrompt = 'thread sidebar sibling unread e2e target'
  await composer.fill(otherPrompt)
  await composer.press('Enter')
  const otherRow = threadSidebar(page).locator('article').filter({ hasText: 'thread sidebar sibling unread' })
  await expect(otherRow).toHaveCount(1)

  await targetRow.getByRole('button').first().click()
  await expect.poll(() => currentThreadId(page)).toBe(targetThreadId)
  await targetRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Mark unread', exact: true }).click()
  await expect(targetRow.getByRole('img', { name: 'Unread', exact: true })).toBeVisible()

  await otherRow.getByRole('button').first().click()
  await expect.poll(() => currentThreadId(page)).toBe(otherThreadId)
  await expect(targetRow.getByRole('img', { name: 'Unread', exact: true })).toBeVisible()

  await targetRow.getByRole('button').first().click()
  await expect.poll(() => currentThreadId(page)).toBe(targetThreadId)
})

Then('its unread marker clears on open', async ({ page }: { page: Page }) => {
  const targetRow = threadSidebar(page).locator('article').filter({ hasText: 'thread sidebar primary unread' })
  await recordAssertion(page, 'thread-sidebar-manual-unread-clears-on-open', async () => {
    await expect(targetRow).toHaveCount(1)
    await expect(targetRow.getByRole('img', { name: 'Unread', exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('a thread finishes its turn and the browser hands its unfinished marker to the Host', async ({ page }: { page: Page }) => {
  const targetThreadId = await startBlankThread(page)
  const composer = page.getByRole('textbox').first()
  await composer.fill('thread sidebar finished turn e2e target')
  await composer.press('Enter')
  await expect(page.getByText(/This turn failed/).first()).toBeVisible({ timeout: 30_000 })

  // Watch another thread first, so the target stays out of this tab's main view while it is unacknowledged.
  await startBlankThread(page)
  // A browser that still holds the older browser-local markers hands them to the Host on its next load.
  await page.evaluate(
    ([key, sessionId]) =>
      localStorage.setItem(
        key ?? '',
        JSON.stringify({ enabled: false, needsYouAt: { [sessionId ?? '']: Date.now() }, mutedUntil: {}, manuallyUnreadSessionIds: [], seenCompletionSessionIds: [] }),
      ),
    [LEGACY_NOTIFICATION_STORAGE_KEY, targetThreadId],
  )
  finishedTurnJourneys.set(page, { targetThreadId })
})

Then('every open tab shows the finished turn until one tab opens it', async ({ page }: { page: Page }) => {
  const journey = finishedTurnJourneys.get(page)
  if (journey === undefined) throw new Error('No finished-turn journey was recorded for this browser page.')
  const finishedLabel = (target: Page) => threadRow(target, journey.targetThreadId).getByText('Turn finished', { exact: true })
  await recordAssertion(page, 'thread-sidebar-turn-finished-outlives-its-client', async () => {
    await page.reload()
    await expect(finishedLabel(page)).toBeVisible({ timeout: 60_000 })
  })
  const otherTab = await page.context().newPage()
  try {
    await otherTab.goto(page.url())
    await recordAssertion(page, 'thread-sidebar-turn-finished-is-shared-across-tabs', async () => {
      await expect(finishedLabel(otherTab)).toBeVisible({ timeout: 30_000 })
      await otherTab.reload()
      await expect(finishedLabel(otherTab)).toBeVisible({ timeout: 30_000 })
    })
    await recordAssertion(page, 'thread-sidebar-turn-finished-clears-in-every-tab', async () => {
      await threadRow(otherTab, journey.targetThreadId).getByRole('button').first().click()
      await expect(finishedLabel(otherTab)).toHaveCount(0, { timeout: 15_000 })
      await page.bringToFront()
      await page.reload()
      await expect(finishedLabel(page)).toHaveCount(0, { timeout: 30_000 })
    })
  } finally {
    await otherTab.close()
  }
  await finishJourneyAssertions(page)
})

When('auto-archive is enabled for one thread while global auto-archive stays off', async ({ page }: { page: Page }) => {
  const targetThreadId = await startBlankThread(page)
  const prompt = 'thread sidebar auto archive override'
  const composer = page.getByRole('textbox').first()
  await composer.fill(prompt)
  await composer.press('Enter')
  const targetRow = threadSidebar(page).locator('article').filter({ hasText: 'thread sidebar auto archive override' })
  await expect(targetRow).toHaveCount(1)
  await openSidebarSettings(page)
  await expect(sidebarSettings(page).getByRole('checkbox', { name: 'Auto-archive inactive threads' })).not.toBeChecked()
  await threadSidebar(page).getByRole('button', { name: 'Sidebar settings', exact: true }).click()
  await targetRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Auto-settle behavior', exact: true }).click()
  const enableForThread = page.getByRole('menuitemradio', { name: 'Auto-archive after idle threshold', exact: true })
  await enableForThread.click()
  await expect(enableForThread).toHaveAttribute('aria-checked', 'true')
  await page.reload()
  await expect(threadSidebar(page)).toBeVisible()
  await expect.poll(() => currentThreadId(page)).toBe(targetThreadId)
})

Then('the per-thread override survives reload without changing the global setting', async ({ page }: { page: Page }) => {
  const targetRow = threadSidebar(page).locator('article').filter({ hasText: 'thread sidebar auto archive override' })
  await openSidebarSettings(page)
  await recordAssertion(page, 'thread-sidebar-global-auto-archive-remains-off', async () => {
    await expect(sidebarSettings(page).getByRole('checkbox', { name: 'Auto-archive inactive threads' })).not.toBeChecked()
  })
  await threadSidebar(page).getByRole('button', { name: 'Sidebar settings', exact: true }).click()
  await targetRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Auto-settle behavior', exact: true }).click()
  await recordAssertion(page, 'thread-sidebar-per-thread-auto-archive-survives-reload', async () => {
    await expect(page.getByRole('menuitemradio', { name: 'Auto-archive after idle threshold', exact: true })).toHaveAttribute('aria-checked', 'true')
  })
  await finishJourneyAssertions(page)
})

When('an attention status color is changed in Sidebar settings', async ({ page }: { page: Page }) => {
  await openSidebarSettings(page)
  await sidebarSettings(page).getByRole('button', { name: 'Approval needed: Color Warning', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Danger', exact: true }).click()
  await page.reload()
  await expect(threadSidebar(page)).toBeVisible()
  await openSidebarSettings(page)
})

Then('the selected attention color survives a browser reload', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-sidebar-attention-color-survives-reload', async () => {
    await expect(sidebarSettings(page).getByRole('button', { name: 'Approval needed: Color Danger', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the header is expanded, reordered, and one destination is hidden', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Customize sidebar', exact: true }).first().click()
  const customize = customizeSidebar(page)
  await expect(customize).toBeVisible()
  await customize.getByRole('radio', { name: 'Expanded labels', exact: true }).click()
  await customize.getByRole('button', { name: 'Move down: New thread', exact: true }).click()
  const navigation = sidebarNavigation(page)
  await expect(navigation.getByRole('button').nth(0)).toHaveAccessibleName('Search threads')
  await expect(navigation.getByRole('button').nth(1)).toHaveAccessibleName('New thread')
  await customize.getByRole('checkbox', { name: 'Show item: Search threads', exact: true }).click()
  await expect(navigation.getByRole('button', { name: 'Search threads', exact: true })).toHaveCount(0)
  await customize.getByRole('button', { name: 'Done', exact: true }).click()
  await page.reload()
  await expect(threadSidebar(page)).toBeVisible()
  await page.getByRole('button', { name: 'Customize sidebar', exact: true }).first().click()
})

Then('the custom layout survives a browser reload', async ({ page }: { page: Page }) => {
  const customize = customizeSidebar(page)
  await recordAssertion(page, 'thread-sidebar-navigation-layout-survives-reload', async () => {
    await expect(customize.getByRole('radio', { name: 'Expanded labels', exact: true })).toBeChecked()
    await expect(customize.getByRole('checkbox', { name: 'Show item: Search threads', exact: true })).not.toBeChecked()
    await expect(customize.getByRole('button', { name: 'Move up: New thread', exact: true })).toBeEnabled()
    const navigation = sidebarNavigation(page)
    await expect(navigation.getByRole('button', { name: 'Search threads', exact: true })).toHaveCount(0)
    await expect(navigation.getByRole('button', { name: 'New thread', exact: true })).toHaveText('New thread')
  })
  await finishJourneyAssertions(page)
})

When('the sidebar thread-search destination is opened with a nonmatching query', async ({ page }: { page: Page }) => {
  await sidebarNavigation(page).getByRole('button', { name: 'Search threads', exact: true }).click()
  await expect(paletteDialog(page)).toBeVisible()
  await paletteInput(page).fill('e2e-no-thread-match-in-fresh-host')
})

Then('the thread-sidebar palette shows no matching sessions', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-sidebar-search-shows-empty-host-result', async () => {
    await expect(paletteInput(page)).toBeVisible()
    await expect(paletteDialog(page).getByText('No matches.', { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

// New thread on a still-blank thread reopens that same session, so the first thread gets a message first.
When('two Host threads are opened one after the other', async ({ page }: { page: Page }) => {
  const firstThreadId = await startBlankThread(page)
  await page.getByRole('textbox').first().fill('thread sidebar history e2e first')
  await page.getByRole('textbox').first().press('Enter')
  await expect(threadRow(page, firstThreadId)).toHaveCount(1)
  const secondThreadId = await startBlankThread(page)
  expect(secondThreadId).not.toBe(firstThreadId)
  threadHistoryJourneys.set(page, { firstThreadId, secondThreadId })
})

Then('Back and Forward return to the corresponding Host sessions', async ({ page }: { page: Page }) => {
  const journey = threadHistoryJourneys.get(page)
  if (journey === undefined) throw new Error('No Host-created thread history was recorded for this browser page.')
  const back = page.getByRole('button', { name: 'Back', exact: true })
  const forward = page.getByRole('button', { name: 'Forward', exact: true })
  await recordAssertion(page, 'thread-sidebar-history-back-restores-first-host-thread', async () => {
    await expect(back).toBeEnabled()
    await back.click()
    await expect.poll(() => currentThreadId(page)).toBe(journey.firstThreadId)
  })
  await recordAssertion(page, 'thread-sidebar-history-forward-restores-second-host-thread', async () => {
    await expect(forward).toBeEnabled()
    await forward.click()
    await expect.poll(() => currentThreadId(page)).toBe(journey.secondThreadId)
  })
  await finishJourneyAssertions(page)
})

Then('no child rows or thread-link actions are offered for the blank session', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-sidebar-blank-session-has-no-child-or-link-actions', async () => {
    await expect.poll(() => currentThreadId(page)).not.toBeNull()
    await expect(threadSidebar(page).locator('article')).toHaveCount(0)
    await expect(threadSidebar(page).getByRole('list', { name: 'Child threads', exact: true })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Copy thread link', exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

interface ThreadMentionJourney {
  readonly targetPrompt: string
  readonly diagnostics: string[]
}

const threadMentionJourneys = new WeakMap<Page, ThreadMentionJourney>()

When('a visible Host thread is mentioned from its context menu at the captured cursor', async ({ page }: { page: Page }) => {
  const targetThreadId = await startBlankThread(page)
  const targetPrompt = 'thread sidebar mention e2e target'
  const targetComposer = page.getByRole('textbox').first()
  await targetComposer.fill(targetPrompt)
  await targetComposer.press('Enter')
  const targetRow = threadRow(page, targetThreadId)
  await expect(targetRow).toHaveCount(1)
  const sourceThreadId = await startBlankThread(page)
  expect(sourceThreadId).not.toBe(targetThreadId)

  const composer = page.getByRole('textbox').first()
  await composer.fill('LEFTRIGHT')
  await composer.press('Home')
  for (let index = 0; index < 'LEFT'.length; index += 1) await composer.press('ArrowRight')

  const diagnostics: string[] = []
  page.on('console', message => {
    if (message.type() !== 'warning' || !message.text().includes('thread-sidebar: mention resolution failed')) return
    void Promise.all(message.args().map(argument => argument.jsonValue().catch(() => null))).then(values => {
      diagnostics.push(JSON.stringify(values))
    })
  })
  await targetRow.click({ button: 'right' })
  const mentionMenuItem = page.getByRole('menuitem', { name: '@Mention thread', exact: true })
  await expect(mentionMenuItem).toBeVisible()
  await mentionMenuItem.click()
  threadMentionJourneys.set(page, { targetPrompt, diagnostics })
})

Then('the composer contains the native mention chip at the captured cursor', async ({ page }: { page: Page }) => {
  const journey = threadMentionJourneys.get(page)
  if (journey === undefined) throw new Error('No thread mention journey was recorded for this browser page.')
  const composer = page.getByRole('textbox').first()
  const chip = composer.locator('[data-composer-chip="reference"]')
  const failureNotice = page.getByText('Could not resolve this thread mention.', { exact: true })
  const unavailableNotice = page.getByText('This thread cannot be mentioned from the current conversation.', { exact: true })

  await recordAssertion(page, 'thread-sidebar-mention-inserts-native-chip-at-captured-cursor', async () => {
    const outcome = await Promise.race([
      chip.waitFor({ state: 'attached', timeout: 15_000 }).then(() => 'inserted'),
      failureNotice.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'failed'),
      unavailableNotice.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'unavailable'),
    ])
    if (outcome === 'failed') {
      await expect.poll(() => journey.diagnostics.length).toBeGreaterThan(0)
      await expect(composer).toHaveText('LEFTRIGHT')
      throw new Error(`The Host could not resolve the thread mention: ${journey.diagnostics.join('; ')}`)
    }
    if (outcome === 'unavailable') {
      await expect(composer).toHaveText('LEFTRIGHT')
      throw new Error('The Host did not return the visible target thread as a mention candidate.')
    }

    await expect(chip).toHaveCount(1)
    await expect(chip).toHaveAttribute('data-composer-chip', 'reference')
    await expect(chip).toContainText(journey.targetPrompt)
    const draft = await composer.innerText()
    const label = await chip.innerText()
    const leftIndex = draft.indexOf('LEFT')
    const labelIndex = draft.indexOf(label)
    const rightIndex = draft.indexOf('RIGHT')
    expect(leftIndex).toBeGreaterThanOrEqual(0)
    expect(label.trim()).not.toBe('')
    expect(labelIndex).toBeGreaterThan(leftIndex)
    expect(rightIndex).toBeGreaterThan(labelIndex)
  })
  await finishJourneyAssertions(page)
})

When('the thread-sidebar command palette is searched for restart', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Open command palette', exact: true }).click()
  await expect(paletteDialog(page)).toBeVisible()
  await paletteInput(page).fill('Restart DSH')
})

Then('no restart action or confirmation appears without pending Host changes', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-sidebar-scratch-host-does-not-offer-restart-action', async () => {
    await expect(paletteDialog(page).getByRole('option', { name: /Restart DSH/ })).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Restart DSH?' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Restart DSH to apply updates/ })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('the composer searches @ autocomplete for skill {string}', async ({ page }: { page: Page }, skillName: string) => {
  await startBlankThread(page)
  await page.getByRole('textbox').first().fill(`@${skillName}`)
})

Then('the skill {string} appears as an @ suggestion', async ({ page }: { page: Page }, skillName: string) => {
  await recordAssertion(page, 'thread-sidebar-skill-mentions-offer', async () => {
    await expect(page.getByRole('option').filter({ hasText: skillName })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
