import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { z } from 'zod'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, openSettingsDialog, recordAssertion } from '../steps.js'

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
// A row seats a hover-only action strip over its right half, so a click at the row's centre lands on an action
// button once the pointer reveals the strip: open the thread from the left half of its trigger instead.
const openThreadRow = async (row: Locator): Promise<void> => {
  await row
    .locator(':scope > div > button')
    .first()
    .click({ position: { x: 24, y: 16 } })
}
// The same strip covers the row's centre for a context-menu click, which targets the row itself rather than its
// trigger, so the menu is opened from the left half a reader would use too.
const openThreadRowMenu = async (row: Locator): Promise<void> => {
  await row.click({ button: 'right', position: { x: 24, y: 16 } })
}

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

const statusFilterLabels: readonly string[] = ['All threads', 'Working', 'Not working', 'Needs attention', 'Muted', 'Settled', 'Archived']

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
  await openThreadRowMenu(targetRow)
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
  await openThreadRowMenu(timedRow)
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
  await openThreadRowMenu(disabledRow)
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
  await openThreadRowMenu(targetRow)
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()

  await threadSidebar(page).getByRole('button', { name: 'Archived (1)', exact: true }).click()
  await openThreadRow(targetRow)
  archivedOpenJourneys.set(page, archivedThreadId)
})

Then('the thread is restored and open with no archived banner', async ({ page }: { page: Page }) => {
  const archivedThreadId = archivedOpenJourneys.get(page)
  if (archivedThreadId === undefined) throw new Error('No archived thread was opened in this journey.')
  const targetRow = threadRow(page, archivedThreadId)
  const transientNotice = threadSidebar(page).getByTestId('thread-sidebar-transient-notice')

  await recordAssertion(page, 'thread-sidebar-archived-open-restores-and-opens', async () => {
    // One click restores and opens: no recovery notice, no repeated "keeps closing" failure.
    await expect(transientNotice).toHaveCount(0)
    await expect(threadSidebar(page).getByRole('button', { name: 'Archived (0)', exact: true })).toHaveCount(0)
    await expect(page.getByRole('status', { name: 'This thread is archived.' })).toHaveCount(0, { timeout: 15_000 })
    await expect(targetRow).toHaveCount(1)
    await expect.poll(() => currentThreadId(page)).toBe(archivedThreadId)
  })
  await finishJourneyAssertions(page)
})

let settledThreadId: string | null = null

When('a nonblank Host thread is settled from its context menu', async ({ page }: { page: Page }) => {
  if (currentThreadId(page) === null) await startBlankThread(page)
  const composer = page.getByRole('textbox').first()
  await composer.fill('thread sidebar settle e2e target')
  await composer.press('Enter')
  // The profile has no provider credentials, so the turn fails: only an idle thread can be settled.
  await expect(page.getByText('This turn failed', { exact: false })).toBeVisible({ timeout: 30_000 })
  const threadId = currentThreadId(page)
  if (threadId === null) throw new Error('The Host did not keep the selected thread after its first message.')
  settledThreadId = threadId
  const targetRow = threadRow(page, threadId)
  await expect(targetRow).toHaveCount(1)
  await openThreadRowMenu(targetRow)
  await page.getByRole('menuitem', { name: 'Settle', exact: true }).click()
  await expect(threadSidebar(page).getByRole('button', { name: 'Settled (1)', exact: true })).toBeVisible()
})

Then('the thread is settled, opens read-only and unsettles to reply', async ({ page }: { page: Page }) => {
  if (settledThreadId === null) throw new Error('No thread was settled.')
  const targetRow = threadRow(page, settledThreadId)
  await recordAssertion(page, 'thread-sidebar-settle-blocks-the-composer', async () => {
    // Settled opens folded, so its rows appear after the section is expanded.
    await threadSidebar(page).getByRole('button', { name: 'Settled (1)', exact: true }).click()
    await expect(targetRow).toHaveCount(1)
    const banner = page.getByRole('status', { name: 'This thread is settled.' })
    await expect(banner).toBeVisible()
    await expect(page.getByRole('button', { name: 'Unsettle to reply', exact: true })).toBeVisible()
  })
  await recordAssertion(page, 'thread-sidebar-settled-stays-out-of-not-working', async () => {
    // A settled thread is storage, like an archived one: a working view never lists it.
    await setThreadStatusFilters(page, 'Filter: None', ['Not working'])
    await expect(targetRow).toHaveCount(0)
    await expect(threadSidebar(page).getByText('No stopped or waiting threads right now.', { exact: true })).toBeVisible()
    await setThreadStatusFilters(page, 'Filter: Not working', [])
    await expect(targetRow).toHaveCount(1)
  })
  await recordAssertion(page, 'thread-sidebar-settled-banner-carries-time-and-archive', async () => {
    const banner = page.getByRole('status', { name: 'This thread is settled.' })
    // The settle instant is recorded, so the banner dates it; no archive delay is set here, so it shows no archive time.
    await expect(banner.locator('time')).toHaveCount(1)
    await expect(banner.getByRole('button', { name: 'Archive', exact: true })).toBeVisible()
    // The banner reads like the jj rebase notice: capped and centred, never the dock's full width.
    const maxWidth = await banner.evaluate(element => Number.parseFloat(getComputedStyle(element).maxWidth))
    const bounds = await banner.boundingBox()
    if (bounds === null) throw new Error('The settled banner has no layout box.')
    expect(Number.isFinite(maxWidth)).toBe(true)
    expect(bounds.width).toBeLessThanOrEqual(maxWidth + 1)
  })
  await page.getByRole('button', { name: 'Unsettle to reply', exact: true }).click()
  await recordAssertion(page, 'thread-sidebar-unsettle-restores-the-composer', async () => {
    await expect(page.getByRole('status', { name: 'This thread is settled.' })).toHaveCount(0, { timeout: 15_000 })
    // A settled Composer refuses input; a fill that lands and an enabled Send button prove it is live.
    await page.getByRole('textbox').first().fill('thread sidebar unsettled reply e2e')
    await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled()
  })
  await page.reload()
  await expect(threadSidebar(page)).toBeVisible()
  await recordAssertion(page, 'thread-sidebar-unsettle-survives-reload', async () => {
    await expect(page.getByRole('status', { name: 'This thread is settled.' })).toHaveCount(0)
    await expect(threadSidebar(page).getByRole('button', { name: 'Settled (0)', exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('an archived thread and a settled thread fill the bottom sections', async ({ page }: { page: Page }) => {
  // Both threads are created while a workspace is still selected: the picker resets once the only
  // active thread is archived, so organizing happens after the second one exists.
  const sendPrompt = async (prompt: string): Promise<string> => {
    // startBlankThread waits for the new session's own composer: clicking New thread alone can leave the
    // previous thread's composer mounted, which queues the prompt into the wrong thread.
    const threadId = await startBlankThread(page)
    const composer = page.getByRole('textbox').first()
    await composer.fill(prompt)
    await composer.press('Enter')
    // No provider credentials in this profile, so the turn fails and the thread is idle enough to organize.
    await expect(page.getByText('This turn failed', { exact: false }).first()).toBeVisible({ timeout: 30_000 })
    return threadId
  }
  const archivedId = await sendPrompt('thread sidebar section order archived')
  const settledId = await sendPrompt('thread sidebar section order settled')

  const archivedRow = threadRow(page, archivedId)
  await expect(archivedRow).toHaveCount(1)
  await openThreadRowMenu(archivedRow)
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
  await expect(threadSidebar(page).getByRole('button', { name: 'Archived (1)', exact: true })).toBeVisible()

  const settledRow = threadRow(page, settledId)
  await expect(settledRow).toHaveCount(1)
  await openThreadRowMenu(settledRow)
  await page.getByRole('menuitem', { name: 'Settle', exact: true }).click()
  await expect(threadSidebar(page).getByRole('button', { name: 'Settled (1)', exact: true })).toBeVisible()
})

Then('dragging the Archived header above Active reorders the sections and survives a reload', async ({ page }: { page: Page }) => {
  const headers = threadSidebar(page).locator('section > button')
  const headerNames = (): Promise<string[]> => headers.evaluateAll(buttons => buttons.map(button => button.textContent.trim()))
  await recordAssertion(page, 'thread-sidebar-section-drag-reorders', async () => {
    expect(await headerNames()).toEqual(['Active(0)', 'Settled(1)', 'Archived(1)'])
    const dragged = await headers.last().boundingBox()
    const target = await headers.first().boundingBox()
    if (dragged === null || target === null) throw new Error('A section header has no layout box to drag.')
    await page.mouse.move(dragged.x + 60, dragged.y + dragged.height / 2)
    await page.mouse.down()
    for (const step of [0.25, 0.5, 0.75, 1]) {
      await page.mouse.move(dragged.x + 60, dragged.y + (target.y - dragged.y) * step, { steps: 4 })
    }
    await page.mouse.up()
    await expect.poll(headerNames).toEqual(['Archived(1)', 'Active(0)', 'Settled(1)'])
  })
  await page.reload()
  await recordAssertion(page, 'thread-sidebar-section-order-survives-reload', async () => {
    await expect(threadSidebar(page)).toBeVisible()
    await expect.poll(headerNames).toEqual(['Archived(1)', 'Active(0)', 'Settled(1)'])
  })
  await finishJourneyAssertions(page)
})

let settledArchiveThreadId: string | null = null

/** One dropdown per delay setting; the group's accessible name is the label above its trigger. */
const selectSettledArchiveDelay = async (page: Page, value: string): Promise<void> => {
  await openSidebarSettings(page)
  const delayGroup = sidebarSettings(page).getByRole('group', { name: 'Archive settled threads' })
  await delayGroup.getByRole('button').click()
  await page.getByRole('menuitemradio', { name: value, exact: true }).click()
  await expect(delayGroup.getByRole('button', { name: value, exact: true })).toBeVisible()
  await threadSidebar(page).getByRole('button', { name: 'Sidebar settings', exact: true }).click()
}

When('a thread is settled with a one-week settled-archive delay', async ({ page }: { page: Page }) => {
  if (currentThreadId(page) === null) await startBlankThread(page)
  const composer = page.getByRole('textbox').first()
  await composer.fill('thread sidebar settled archive e2e target')
  await composer.press('Enter')
  // The profile has no provider credentials, so the turn fails: only an idle thread can be settled.
  await expect(page.getByText('This turn failed', { exact: false })).toBeVisible({ timeout: 30_000 })
  const threadId = currentThreadId(page)
  if (threadId === null) throw new Error('The Host did not keep the selected thread after its first message.')
  settledArchiveThreadId = threadId
  await selectSettledArchiveDelay(page, 'After 1 week')
  const targetRow = threadRow(page, threadId)
  await expect(targetRow).toHaveCount(1)
  await openThreadRowMenu(targetRow)
  await page.getByRole('menuitem', { name: 'Settle', exact: true }).click()
  await expect(threadSidebar(page).getByRole('button', { name: 'Settled (1)', exact: true })).toBeVisible()
})

Then('the settled banner shows the archive time it is waiting for', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-sidebar-settled-banner-shows-archive-time', async () => {
    const banner = page.getByRole('status', { name: 'This thread is settled.' })
    // Two instants: when it was settled, and when the one-week delay will archive it.
    await expect(banner.locator('time')).toHaveCount(2)
    await expect(banner).toContainText('Settled')
    await expect(banner).toContainText('Archives')
  })
})

When('the settled-archive delay is shortened to immediately', async ({ page }: { page: Page }) => {
  await selectSettledArchiveDelay(page, 'Immediately')
})

Then('the settled thread archives itself without a click', async ({ page }: { page: Page }) => {
  if (settledArchiveThreadId === null) throw new Error('No thread was settled for auto-archive.')
  await recordAssertion(page, 'thread-sidebar-settled-auto-archive', async () => {
    await expect(threadSidebar(page).getByRole('button', { name: 'Archived (1)', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(threadSidebar(page).getByRole('button', { name: 'Settled (1)', exact: true })).toHaveCount(0)
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
  await openThreadRowMenu(targetRow)
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
  await openThreadRowMenu(targetRow)
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

  // Collapse the Today group so the reload below can prove the state is Host-synced.
  await threadSidebar(page)
    .getByRole('button', { name: /^Today/u })
    .click()
  await expect(targetRow).toHaveCount(0)

  await page.reload()
  await expect(threadSidebar(page)).toBeVisible()
})

Then('only matching rows remain visible after reload', async ({ page }: { page: Page }) => {
  const displayTitle = 'thread sidebar view filter e2e'
  const targetRow = threadSidebar(page).locator('article').filter({ hasText: displayTitle })
  await recordAssertion(page, 'thread-sidebar-grouping-and-filter-preferences-survive-reload', async () => {
    // The group was collapsed before the reload; a Host-synced preference is still collapsed, and expanding restores it.
    const todayHeader = threadSidebar(page).getByRole('button', { name: /^Today/u })
    await expect(todayHeader).toHaveAttribute('aria-expanded', 'false')
    await expect(targetRow).toHaveCount(0)
    await todayHeader.click()
    await expect(targetRow).toBeVisible()
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

When('auto-settle is enabled with a new idle threshold and scan interval', async ({ page }: { page: Page }) => {
  await openSidebarSettings(page)
  const autoSettle = sidebarSettings(page).getByRole('checkbox', { name: 'Settle inactive threads' })
  await expect(autoSettle).not.toBeChecked()
  await autoSettle.click()
  await page.getByLabel('Move to inactive after (minutes)').fill('45')
  await page.getByLabel('Check every (minutes)').fill('5')
  await page.reload()
  await expect(threadSidebar(page)).toBeVisible()
  await openSidebarSettings(page)
})

Then('the policy settings survive a browser reload', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-sidebar-idle-policy-settings-survive-reload', async () => {
    await expect(sidebarSettings(page).getByRole('checkbox', { name: 'Settle inactive threads' })).toBeChecked()
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

  await openThreadRow(targetRow)
  await expect.poll(() => currentThreadId(page)).toBe(targetThreadId)
  await openThreadRowMenu(targetRow)
  await page.getByRole('menuitem', { name: 'Mark unread', exact: true }).click()
  await expect(targetRow.getByRole('img', { name: 'Unread', exact: true })).toBeVisible()

  await openThreadRow(otherRow)
  await expect.poll(() => currentThreadId(page)).toBe(otherThreadId)
  await expect(targetRow.getByRole('img', { name: 'Unread', exact: true })).toBeVisible()

  await openThreadRow(targetRow)
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
        JSON.stringify({
          enabled: false,
          needsYouAt: { [sessionId ?? '']: Date.now() },
          mutedUntil: {},
          manuallyUnreadSessionIds: [],
          seenCompletionSessionIds: [],
        }),
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
      await openThreadRow(threadRow(otherTab, journey.targetThreadId))
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

When('auto-settle is enabled for one thread while global auto-settle stays off', async ({ page }: { page: Page }) => {
  const targetThreadId = await startBlankThread(page)
  const prompt = 'thread sidebar auto archive override'
  const composer = page.getByRole('textbox').first()
  await composer.fill(prompt)
  await composer.press('Enter')
  const targetRow = threadSidebar(page).locator('article').filter({ hasText: 'thread sidebar auto archive override' })
  await expect(targetRow).toHaveCount(1)
  await openSidebarSettings(page)
  await expect(sidebarSettings(page).getByRole('checkbox', { name: 'Settle inactive threads' })).not.toBeChecked()
  await threadSidebar(page).getByRole('button', { name: 'Sidebar settings', exact: true }).click()
  await openThreadRowMenu(targetRow)
  await page.getByRole('menuitem', { name: 'Auto-settle behavior', exact: true }).click()
  const enableForThread = page.getByRole('menuitemradio', { name: 'Settle after idle threshold', exact: true })
  await enableForThread.click()
  await expect(enableForThread).toHaveAttribute('aria-checked', 'true')
  await page.reload()
  await expect(threadSidebar(page)).toBeVisible()
  await expect.poll(() => currentThreadId(page)).toBe(targetThreadId)
})

Then('the per-thread override survives reload without changing the global setting', async ({ page }: { page: Page }) => {
  const targetRow = threadSidebar(page).locator('article').filter({ hasText: 'thread sidebar auto archive override' })
  await openSidebarSettings(page)
  await recordAssertion(page, 'thread-sidebar-global-auto-settle-remains-off', async () => {
    await expect(sidebarSettings(page).getByRole('checkbox', { name: 'Settle inactive threads' })).not.toBeChecked()
  })
  await threadSidebar(page).getByRole('button', { name: 'Sidebar settings', exact: true }).click()
  await openThreadRowMenu(targetRow)
  await page.getByRole('menuitem', { name: 'Auto-settle behavior', exact: true }).click()
  await recordAssertion(page, 'thread-sidebar-per-thread-auto-settle-survives-reload', async () => {
    await expect(page.getByRole('menuitemradio', { name: 'Settle after idle threshold', exact: true })).toHaveAttribute('aria-checked', 'true')
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
  await recordAssertion(page, 'thread-sidebar-settings-panel-scrolls', async () => {
    const region = sidebarSettings(page)
    await expect(region).toHaveCSS('overflow-y', 'auto')
    // The panel is taller than the sidebar it sits in, whose shell clips at `overflow: hidden`; only the
    // panel's own scroll box can bring its last group into view.
    const scrolled = await region.evaluate(element => {
      element.scrollTop = element.scrollHeight
      const lastGroup = [...element.querySelectorAll(':scope > fieldset')].at(-1)
      if (!(lastGroup instanceof HTMLElement)) return null
      const panel = element.getBoundingClientRect()
      const group = lastGroup.getBoundingClientRect()
      return { scrollTop: element.scrollTop, lastGroupInside: group.bottom <= panel.bottom + 1 && group.top >= panel.top - 1 }
    })
    expect(scrolled?.scrollTop ?? 0).toBeGreaterThan(0)
    expect(scrolled?.lastGroupInside).toBe(true)
  })
  await finishJourneyAssertions(page)
})

/**
 * Opens the plugin's own Settings section. It is found by its label, not by a nav id: a profile whose
 * composition uses the native settings shell renders this section without our `data-nav-id` attribute.
 *
 * Every action here is bounded: the app raises an unconfigured-Host provider prompt over the launcher and
 * rebuilds the settings navigation as the profile settles, and an unbounded click would otherwise wait
 * the whole test timeout instead of failing where the section never opened.
 */
const openThreadSidebarSettingsSection = async (page: Page): Promise<Locator> => {
  const settingsDialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  const notifications = settingsDialog.getByRole('group', { name: 'Thread notifications', exact: true })
  const section = settingsDialog.getByRole('button', { name: 'Thread sidebar', exact: true }).first()
  const providerPrompt = page.getByRole('dialog', { name: /^(Add an API key to get started|Get started)$/ })
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (await notifications.isVisible().catch(() => false)) return settingsDialog
    if (await providerPrompt.isVisible().catch(() => false)) {
      // The scratch Host raises this prompt over the app, and it can end up stacked under the Settings
      // modal, where each blocks the other's buttons. Close the top modal first, then the prompt itself.
      await page.keyboard.press('Escape')
      await providerPrompt
        .getByRole('button', { name: 'Close', exact: true })
        .click({ timeout: 4_000 })
        .catch(() => undefined)
      await providerPrompt.waitFor({ state: 'hidden', timeout: 4_000 }).catch(() => undefined)
      continue
    }
    await openSettingsDialog(page, { timeoutMs: 4_000 }).catch(() => undefined)
    await section.click({ timeout: 4_000 }).catch(() => undefined)
  }
  await expect(notifications).toBeVisible({ timeout: 10_000 })
  return settingsDialog
}

/**
 * Records every tone the client schedules, so a preview that produces nothing fails this journey
 * instead of passing quietly. Patches the prototype, so it also sees a context created earlier.
 */
const installNotificationAudioProbe = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    document.body.dataset.dshNotificationTones = '0'
    document.body.dataset.dshNotificationAudioState = ''
    const originalCreateOscillator = AudioContext.prototype.createOscillator
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      const oscillator = originalCreateOscillator.call(this)
      const originalStart = oscillator.start.bind(oscillator)
      oscillator.start = (when?: number) => {
        document.body.dataset.dshNotificationTones = String(Number(document.body.dataset.dshNotificationTones ?? '0') + 1)
        document.body.dataset.dshNotificationAudioState = this.state
        originalStart(when)
      }
      return oscillator
    }
  })
}

When('notification routes and sounds are configured in Settings', async ({ page }: { page: Page }) => {
  const settingsDialog = await openThreadSidebarSettingsSection(page)
  const notificationSettings = settingsDialog.getByRole('group', { name: 'Thread notifications', exact: true })
  await expect(notificationSettings).toBeVisible()
  await installNotificationAudioProbe(page)
  await notificationSettings.getByRole('button', { name: 'Approval needed: Off', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'In-app', exact: true }).click()
  await notificationSettings.getByRole('checkbox', { name: 'Approval needed: Play a sound', exact: true }).click()
  await notificationSettings.getByRole('button', { name: 'Approval needed Sound: Soft', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Chime', exact: true }).click()
  await notificationSettings.getByRole('button', { name: 'Turn stopped: Off', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'System notification', exact: true }).click()
  await notificationSettings.getByRole('button', { name: 'Preview sound', exact: true }).first().click()
})

Then('previewing a notification sound plays a tone through the browser audio context', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-sidebar-notification-preview-plays-a-tone', async () => {
    await expect.poll(() => page.evaluate(() => document.body.dataset.dshNotificationTones ?? '0')).not.toBe('0')
    expect(await page.evaluate(() => document.body.dataset.dshNotificationAudioState ?? '')).toBe('running')
  })
})

Then('the notification settings survive a browser reload', async ({ page }: { page: Page }) => {
  await page.reload()
  const settingsDialog = await openThreadSidebarSettingsSection(page)
  const notificationSettings = settingsDialog.getByRole('group', { name: 'Thread notifications', exact: true })
  await recordAssertion(page, 'thread-sidebar-notification-category-settings-survive-reload', async () => {
    await expect(notificationSettings.getByRole('button', { name: 'Approval needed: In-app', exact: true })).toBeVisible()
    await expect(notificationSettings.getByRole('checkbox', { name: 'Approval needed: Play a sound', exact: true })).toBeChecked()
    await expect(notificationSettings.getByRole('button', { name: 'Approval needed Sound: Chime', exact: true })).toBeVisible()
    await expect(notificationSettings.getByRole('button', { name: 'Turn stopped: System notification', exact: true })).toBeVisible()
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

When('the sidebar footer More menu is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'More', exact: true }).click()
})

Then('the footer menu lists Settings and the sidebar pages and opens the Plugins page', async ({ page }: { page: Page }) => {
  const menu = page.getByRole('dialog', { name: 'More', exact: true })
  const settings = menu.getByRole('button', { name: 'Settings', exact: true })
  const plugins = menu.getByRole('button', { name: 'Plugins', exact: true })
  await recordAssertion(page, 'thread-sidebar-footer-more-lists-settings-and-pages', async () => {
    await expect(settings).toBeVisible()
    await expect(menu.getByText('Pages', { exact: true })).toHaveCount(0)
    await expect(plugins).toBeVisible()
  })
  await plugins.click()
  await recordAssertion(page, 'thread-sidebar-footer-more-opens-the-plugins-page', async () => {
    await expect(sidebarNavigation(page).getByRole('button', { name: 'Plugins', exact: true })).toHaveAttribute('aria-current', 'page')
  })
})

When('the sidebar header More menu is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'More sidebar destinations', exact: true }).click()
})

Then('the header menu offers Settings and Customize sidebar', async ({ page }: { page: Page }) => {
  const menu = page.getByRole('dialog').filter({ has: page.getByPlaceholder('Filter destinations…') })
  const settings = menu.getByRole('option', { name: 'Settings', exact: true })
  await recordAssertion(page, 'thread-sidebar-header-more-offers-settings', async () => {
    await expect(settings).toBeVisible()
    await expect(menu.getByRole('option', { name: 'Customize sidebar', exact: true })).toBeVisible()
  })
  await settings.click()
  await recordAssertion(page, 'thread-sidebar-header-more-opens-settings', async () => {
    await expect(page.getByRole('dialog').filter({ hasText: 'Built-in plugins' })).toBeVisible()
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

When('two nonblank Host threads are listed in the sidebar', async ({ page }: { page: Page }) => {
  const firstThreadId = await startBlankThread(page)
  await page.getByRole('textbox').first().fill('thread sidebar keyboard first')
  await page.getByRole('textbox').first().press('Enter')
  await expect(threadRow(page, firstThreadId)).toHaveCount(1)
  const secondThreadId = await startBlankThread(page)
  expect(secondThreadId).not.toBe(firstThreadId)
  await page.getByRole('textbox').first().fill('thread sidebar keyboard second')
  await page.getByRole('textbox').first().press('Enter')
  await expect(threadRow(page, secondThreadId)).toHaveCount(1)
  threadHistoryJourneys.set(page, { firstThreadId, secondThreadId })
})

Then('arrow keys move focus and Shift+ArrowDown selects a range of threads', async ({ page }: { page: Page }) => {
  const journey = threadHistoryJourneys.get(page)
  if (journey === undefined) throw new Error('No Host-created thread history was recorded for this browser page.')
  const rowIds = await threadSidebar(page)
    .locator('article[data-thread-id]')
    .evaluateAll(rows => rows.map(row => row.getAttribute('data-thread-id')))
  const targetId = rowIds.find(id => id === journey.firstThreadId || id === journey.secondThreadId)
  if (targetId === undefined || targetId === null) throw new Error('Neither Host-created thread is listed in the sidebar.')
  const targetIndex = rowIds.indexOf(targetId)
  const nextId = rowIds[targetIndex + 1]
  if (nextId === undefined || nextId === null) throw new Error('The sidebar did not render a row below the target thread.')
  const targetTrigger = threadRow(page, targetId).locator(':scope > div > button').first()
  await targetTrigger.focus()
  await page.keyboard.press('ArrowDown')

  await recordAssertion(page, 'thread-sidebar-keyboard-arrow-switches-thread', async () => {
    await expect.poll(() => currentThreadId(page)).toBe(nextId)
  })
  await targetTrigger.focus()
  await page.keyboard.press('Shift+ArrowDown')

  await recordAssertion(page, 'thread-sidebar-keyboard-shift-range', async () => {
    const selectionBar = page.getByTestId('thread-selection-bar')
    await expect(selectionBar).toContainText('2 selected')
    await expect(threadSidebar(page).locator('button[data-thread-main-action][data-multi-selected="true"]')).toHaveCount(2)
  })
  await recordAssertion(page, 'thread-sidebar-keyboard-toggle-and-escape', async () => {
    const selectedRows = threadSidebar(page).locator('button[data-thread-main-action][data-multi-selected="true"]')
    await selectedRows.last().click({ modifiers: ['ControlOrMeta'], position: { x: 24, y: 16 } })
    await expect(page.getByTestId('thread-selection-bar')).toContainText('1 selected')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('thread-selection-bar')).toHaveCount(0)
  })
  await recordAssertion(page, 'thread-sidebar-keyboard-focus-only-setting', async () => {
    const settingsDialog = await openThreadSidebarSettingsSection(page)
    await settingsDialog.getByRole('button', { name: 'Move focus only', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(settingsDialog).toBeHidden()
    const beforeFocusOnly = currentThreadId(page)
    await targetTrigger.focus()
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => currentThreadId(page)).toBe(beforeFocusOnly)

    const reopenedSettings = await openThreadSidebarSettingsSection(page)
    await reopenedSettings.getByRole('button', { name: 'Switch immediately', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(reopenedSettings).toBeHidden()
  })
  await recordAssertion(page, 'thread-sidebar-keyboard-bulk-settle', async () => {
    await targetTrigger.focus()
    await page.keyboard.press('ControlOrMeta+A')
    const selectionBar = page.getByTestId('thread-selection-bar')
    await expect(selectionBar).toContainText('2 selected')
    await selectionBar.getByRole('button', { name: 'Settle', exact: true }).click()
    await expect(selectionBar).toHaveCount(0)
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
  await openThreadRowMenu(targetRow)
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

let asideThreadId: string | null = null

When('a nonblank Host thread is opened in the side panel from its context menu', async ({ page }: { page: Page }) => {
  if (currentThreadId(page) === null) await startBlankThread(page)
  const composer = page.getByRole('textbox').first()
  await composer.fill('aside e2e target')
  await composer.press('Enter')
  const threadId = currentThreadId(page)
  if (threadId === null) throw new Error('The Host did not keep the selected thread after its first message.')
  asideThreadId = threadId
  const targetRow = threadRow(page, threadId)
  await expect(targetRow).toHaveCount(1)
  await openThreadRowMenu(targetRow)
  await page.getByRole('menuitem', { name: 'Open in side panel', exact: true }).click()
})

Then("the side panel hosts that thread's scrollable conversation and composer", async ({ page }: { page: Page }) => {
  if (asideThreadId === null) throw new Error('No thread was opened aside.')
  const aside = page.locator('[data-dshfiles-thread-aside]')
  await recordAssertion(page, 'thread-sidebar-aside-opens-a-panel-tab', async () => {
    await expect(aside).toHaveCount(1)
    await expect(page.locator('[data-dockkit-tab]').filter({ hasText: 'aside e2e target' })).toHaveCount(1)
  })
  await recordAssertion(page, 'thread-sidebar-aside-pane-holds-the-conversation', async () => {
    // The embedded Conversation must be sized by the pane, not by its content: the body never grows past the pane, it
    // owns a real scroll container, and its composer stays inside both the pane and the viewport.
    const geometry = await aside.evaluate(element => {
      const body = element.querySelector('.wSkVaW_body')
      const scrollBody = element.querySelector('.wSkVaW_scrollBody')
      const composer = element.querySelector('.wSkVaW_composerSeat')
      if (body === null || scrollBody === null || composer === null) throw new Error('the aside holds no conversation body or composer')
      const pane = element.getBoundingClientRect()
      return {
        paneHeight: Math.round(pane.height),
        paneBottom: Math.round(pane.bottom),
        bodyHeight: Math.round(body.getBoundingClientRect().height),
        scrollHeight: scrollBody.scrollHeight,
        clientHeight: scrollBody.clientHeight,
        composerBottom: Math.round(composer.getBoundingClientRect().bottom),
        viewportHeight: window.innerHeight,
      }
    })
    expect(geometry.bodyHeight).toBeLessThanOrEqual(geometry.paneHeight)
    expect(geometry.scrollHeight).toBeGreaterThanOrEqual(geometry.clientHeight)
    expect(geometry.composerBottom).toBeLessThanOrEqual(Math.min(geometry.paneBottom, geometry.viewportHeight))
  })
  await recordAssertion(page, 'thread-sidebar-aside-keeps-the-thread-listed', async () => {
    await expect(threadRow(page, asideThreadId ?? '')).toHaveCount(1)
  })
  await finishJourneyAssertions(page)
})

const asideTab = (page: Page) => page.locator('[data-dockkit-tab]').filter({ hasText: 'aside e2e target' })
const rowActionContainer = (row: ReturnType<typeof threadRow>) => row.getByTestId('thread-row-actions')

Then('the thread row offers the side-panel hover action', async ({ page }: { page: Page }) => {
  if (asideThreadId === null) throw new Error('No thread was opened aside.')
  const row = threadRow(page, asideThreadId)
  await row.hover()
  const button = row.getByRole('button', { name: 'Open in side panel', exact: true })
  await recordAssertion(page, 'thread-sidebar-aside-hover-action-shows', async () => {
    await expect(rowActionContainer(row)).toHaveCount(1)
    await expect.poll(() => rowActionContainer(row).evaluate(element => getComputedStyle(element).pointerEvents)).toBe('auto')
    await expect(button).toBeVisible()
  })
  await recordAssertion(page, 'thread-sidebar-aside-hover-action-focuses-the-open-tab', async () => {
    await button.click()
    await expect(asideTab(page)).toHaveCount(1)
    await expect(page.locator('[data-dshfiles-thread-aside]')).toHaveCount(1)
  })
})

When('the side panel is closed and the same thread is opened from the command palette', async ({ page }: { page: Page }) => {
  await asideTab(page).hover()
  await asideTab(page).locator('button, [role=button]').last().click()
  await expect(asideTab(page)).toHaveCount(0)
  await page.keyboard.press('Meta+Shift+P')
  const palette = paletteDialog(page)
  await palette.getByRole('combobox').fill('side panel')
  await palette.getByRole('option', { name: /^Open in side panel/ }).click()
})

Then('the side panel hosts that thread again', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-sidebar-aside-palette-opens-the-panel', async () => {
    await expect(asideTab(page)).toHaveCount(1)
    await expect(page.locator('[data-dshfiles-thread-aside]')).toHaveCount(1)
  })
})

When('the side-panel hover action is switched off in Customize sidebar', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Customize sidebar', exact: true }).first().click()
  const customize = customizeSidebar(page)
  await expect(customize).toBeVisible()
  await customize.getByRole('checkbox', { name: 'Open in side panel', exact: true }).click()
  await customize.getByRole('button', { name: 'Done', exact: true }).click()
})

Then('the thread row keeps the context-menu action but drops the hover one', async ({ page }: { page: Page }) => {
  if (asideThreadId === null) throw new Error('No thread was opened aside.')
  const row = threadRow(page, asideThreadId)
  await recordAssertion(page, 'thread-sidebar-aside-hover-action-hidden-by-setting', async () => {
    await row.hover()
    await expect(row.getByRole('button', { name: 'Open in side panel', exact: true })).toHaveCount(0)
  })
  await recordAssertion(page, 'thread-sidebar-aside-context-menu-action-stays', async () => {
    await openThreadRowMenu(row)
    await expect(page.getByRole('menuitem', { name: 'Open in side panel', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
  })
})

When('the settle hover action is moved to the front in Customize sidebar', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Customize sidebar', exact: true }).first().click()
  const customize = customizeSidebar(page)
  await expect(customize).toBeVisible()
  const moveUp = customize.getByRole('button', { name: 'Move up: Settle', exact: true })
  await expect(moveUp).toBeVisible()
  for (let step = 0; step < 12; step += 1) {
    if (!(await moveUp.isEnabled())) break
    await moveUp.click()
  }
  await customize.getByRole('button', { name: 'Done', exact: true }).click()
})

Then('the thread row draws the settle hover action first', async ({ page }: { page: Page }) => {
  if (asideThreadId === null) throw new Error('No thread was opened aside.')
  const row = threadRow(page, asideThreadId)
  await row.hover()
  await recordAssertion(page, 'thread-sidebar-row-action-order-follows-the-setting', async () => {
    await expect(rowActionContainer(row).getByRole('button').first()).toHaveAttribute('aria-label', 'Settle')
  })
  await finishJourneyAssertions(page)
})

interface ThreadReferenceJourney {
  readonly targetThreadId: string
  readonly referencingThreadId: string
}

const threadReferenceJourneys = new WeakMap<Page, ThreadReferenceJourney>()

// A referencing thread's own title is folded asynchronously and can still be missing, so the row is found by the
// relation it names; the journey proves identity by clicking it and landing on the referencing thread.
const referencedByRows = (page: Page) =>
  page.getByRole('menu', { name: 'Referenced by', exact: true }).getByRole('menuitem').filter({ hasText: 'References this thread' })

When('another thread references a visible Host thread from its composer', async ({ page }: { page: Page }) => {
  const targetThreadId = await startBlankThread(page)
  const targetComposer = page.getByRole('textbox').first()
  await targetComposer.fill('thread sidebar referenced-by e2e target')
  await targetComposer.press('Enter')
  await expect(threadRow(page, targetThreadId)).toHaveCount(1)

  const referencingThreadId = await startBlankThread(page)
  expect(referencingThreadId).not.toBe(targetThreadId)

  await openThreadRowMenu(threadRow(page, targetThreadId))
  const mentionMenuItem = page.getByRole('menuitem', { name: '@Mention thread', exact: true })
  await expect(mentionMenuItem).toBeVisible()
  await mentionMenuItem.click()

  const composer = page.getByRole('textbox').first()
  await expect(composer.locator('[data-composer-chip="reference"]')).toHaveCount(1)
  await composer.click()
  await composer.press('Enter')
  threadReferenceJourneys.set(page, { targetThreadId, referencingThreadId })
})

Then('both menus list the referencing thread under Referenced by', async ({ page }: { page: Page }) => {
  const journey = threadReferenceJourneys.get(page)
  if (journey === undefined) throw new Error('No thread reference journey was recorded for this browser page.')

  await recordAssertion(page, 'thread-sidebar-row-menu-lists-the-referencing-thread', async () => {
    await openThreadRowMenu(threadRow(page, journey.targetThreadId))
    const trigger = page.getByRole('menuitem', { name: 'Referenced by', exact: true })
    await expect(trigger).toBeVisible()
    await trigger.hover()
    await expect(referencedByRows(page)).toHaveCount(1, { timeout: 15_000 })
    // One Escape closes the submenu and a second the row menu: a menu left open swallows the next row click.
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(trigger).toHaveCount(0)
  })
  await recordAssertion(page, 'thread-sidebar-header-menu-lists-the-referencing-thread', async () => {
    // The row's hover toolbar overlays its right half, so the title area is clicked by position, not by centre.
    await openThreadRow(threadRow(page, journey.targetThreadId))
    await expect.poll(() => currentThreadId(page)).toBe(journey.targetThreadId)
    const threadActions = page.getByRole('group', { name: 'Thread actions', exact: true })
    await threadActions.getByRole('button', { name: 'More thread actions', exact: true }).click()
    const trigger = page.getByRole('menuitem', { name: 'Referenced by', exact: true })
    await expect(trigger).toBeVisible()
    await trigger.hover()
    const row = referencedByRows(page)
    await expect(row).toHaveCount(1, { timeout: 15_000 })
    await row.click()
    await expect.poll(() => currentThreadId(page)).toBe(journey.referencingThreadId)
  })
  await finishJourneyAssertions(page)
})

/**
 * The collapsed sidebar labels its toggle "Expand sidebar" in this composition, and the frame-layout journeys own the
 * "Open/Collapse sidebar" wording; these read the state instead of assuming either label.
 */
const sidebarCollapseControl = (page: Page) => page.getByRole('button', { name: /^Collapse sidebar$/ }).first()
const sidebarExpandControl = (page: Page) => page.getByRole('button', { name: /^(?:Expand|Open) sidebar$/ }).first()

const jjInventoryRequests = new WeakMap<Page, { count: number }>()

/** Counts the JJ inventory reads the page makes, so a journey can prove a hidden surface bought none. */
const countJjInventoryRequests = (page: Page): { count: number } => {
  const existing = jjInventoryRequests.get(page)
  if (existing !== undefined) return existing
  const entry = { count: 0 }
  page.on('request', request => {
    if (/\/api\/dshx-[0-9a-f]+\/repositories$/.test(new URL(request.url()).pathname)) entry.count += 1
  })
  jjInventoryRequests.set(page, entry)
  return entry
}

/** The fresh profile raises this prompt over the app; a collapse click would wait on it forever. */
When('the provider onboarding prompt is dismissed', async ({ page }: { page: Page }) => {
  const prompt = page.getByRole('dialog', { name: /^(?:Add an API key to get started|Get started)$/ })
  if (!(await prompt.isVisible().catch(() => false))) return
  await page.keyboard.press('Escape')
  await prompt
    .getByRole('button', { name: 'Close', exact: true })
    .click({ timeout: 4_000 })
    .catch(() => undefined)
  await prompt.waitFor({ state: 'hidden', timeout: 4_000 }).catch(() => undefined)
})

When('the browser counts JJ inventory requests', async ({ page }: { page: Page }) => {
  countJjInventoryRequests(page)
})

When('the sidebar inventory pane is collapsed', async ({ page }: { page: Page }) => {
  await sidebarCollapseControl(page).click()
  await expect(sidebarExpandControl(page)).toBeVisible()
})

Then('no JJ inventory request is made while the sidebar is collapsed', async ({ page }: { page: Page }) => {
  const counted = countJjInventoryRequests(page)
  const reads = counted.count
  await page.waitForTimeout(2_000)
  await recordAssertion(page, 'thread-sidebar-collapsed-skips-jj-inventory', async () => {
    expect(counted.count).toBe(reads)
  })
  await finishJourneyAssertions(page)
})

Then('the JJ inventory is read again after the sidebar expands', async ({ page }: { page: Page }) => {
  const counted = countJjInventoryRequests(page)
  const reads = counted.count
  await sidebarExpandControl(page).click()
  await recordAssertion(page, 'thread-sidebar-expanded-reads-jj-inventory', async () => {
    // Expanding re-enables the query; the sample is taken before the click so the read it buys is what is counted.
    await expect.poll(() => counted.count, { timeout: 20_000 }).toBeGreaterThan(reads)
    await expect(sidebarCollapseControl(page)).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the blocked session appears in the Usage limit group', async ({ page }: { Page }) => {
  await recordAssertion(page, 'thread-sidebar-usage-limit-group', async () => {
    await expect.poll(() => currentThreadId(page), { timeout: 30_000 }).not.toBeNull()
    const sessionId = currentThreadId(page)
    if (sessionId === null) throw new Error('The blocked thread is not selected.')

    const group = page.getByRole('region', { name: 'Usage limit', exact: true })
    await expect(group).toBeVisible({ timeout: 30_000 })
    await expect(group.locator(`[data-thread-id="${sessionId}"]`)).toBeVisible({ timeout: 30_000 })
    await expect(group.getByRole('button', { name: 'Resume this thread', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the blocked session is listed only in the Usage limit group when grouped by date', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-sidebar-usage-limit-group-by-date', async () => {
    const sessionId = currentThreadId(page)
    if (sessionId === null) throw new Error('The blocked thread is not selected.')

    await selectThreadViewValue(page, 'Group: Status', 'Date')
    await expect(threadSidebar(page).getByRole('button', { name: 'Group: Date', exact: true })).toBeVisible()
    const group = page.getByRole('region', { name: 'Usage limit', exact: true })
    await expect(group.locator(`[data-thread-id="${sessionId}"]`)).toBeVisible()
    // A usage-limit row is a bare button, a list row an article: count the main action both carry.
    await expect(threadSidebar(page).locator(`[data-thread-main-action][data-thread-id="${sessionId}"]`)).toHaveCount(1)
  })
  await finishJourneyAssertions(page)
})
