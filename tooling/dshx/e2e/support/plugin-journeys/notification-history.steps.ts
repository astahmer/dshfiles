import { expect, type Page, type TestInfo } from '@playwright/test'
import * as Schema from 'effect/Schema'
import {
  notificationHistorySnapshotSchema,
  type NotificationHistoryEntry,
} from '../../../../../plugins/@dshfiles/thread-sidebar/src/notification-history-api.js'
import { connectDshxApi, type DshxApiCall } from '../../../packages/dshx/src/platform/dshx-api.js'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, profileFor, recordAssertion, reloadPastProviderSetup } from '../steps.js'
import { materializeNonblankThread } from '../thread-composer.js'

interface NotificationHistoryJourney {
  readonly call: DshxApiCall
  readonly entry: NotificationHistoryEntry
  readonly prompt: string
}

const journeys = new WeakMap<Page, NotificationHistoryJourney>()
const decodeSnapshot = Schema.decodeUnknownSync(notificationHistorySnapshotSchema)
const historyPage = (page: Page) =>
  page
    .locator('[data-slot="page"]')
    .filter({ has: page.getByRole('heading', { name: 'Notifications', exact: true }) })
    .filter({ visible: true })
    .last()
const notificationRow = (page: Page, id: string) =>
  historyPage(page)
    .getByRole('listitem')
    .and(page.locator(`[data-notification-id="${id}"]`))
const historyTab = (page: Page, name: string) => historyPage(page).getByRole('tab', { name: new RegExp(`^${name}(?:\\s|$)`, 'u') })
const clearDialog = (page: Page) => page.getByRole('alertdialog', { name: 'Clear notification history?', exact: true })
const readEntries = async (call: DshxApiCall) => decodeSnapshot(await call('list', {})).entries
const journeyFor = (page: Page): NotificationHistoryJourney => {
  const journey = journeys.get(page)
  if (journey === undefined) throw new Error('Submit a real turn before checking notification history.')
  return journey
}

const openNotificationHistory = async (page: Page): Promise<void> => {
  await page.getByRole('tablist', { name: 'Destinations', exact: true }).getByRole('tab', { name: 'Observe', exact: true }).click()
  await page.getByRole('navigation', { name: 'Observe pages', exact: true }).getByRole('button', { name: 'Notifications', exact: true }).click()
  await expect(historyPage(page).getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible()
}

const chooseHistoryAction = async (page: Page, name: string): Promise<void> => {
  const button = historyPage(page).getByRole('button', { name, exact: true })
  if (await button.isVisible()) {
    await button.click()
    return
  }
  await historyPage(page).getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}

const submitFailingTurn = async (page: Page, prompt: string, testInfo: TestInfo): Promise<string> => {
  const sessionId = await materializeNonblankThread(page, prompt, testInfo)
  await expect(page.getByText(/This turn failed/u).first()).toBeVisible({ timeout: 30_000 })
  return sessionId
}

When('a real submitted turn produces a notification history entry', async ({ page, $testInfo }: { page: Page; $testInfo: TestInfo }) => {
  $testInfo.setTimeout(240_000)
  const call = await connectDshxApi({ url: profileFor(page).url, packageId: '@dshfiles/thread-sidebar', apiId: 'thread-notification-history', version: 1 })
  expect(await readEntries(call)).toEqual([])
  const prompt = 'Notification history synthetic browser journey'
  const sessionId = await submitFailingTurn(page, prompt, $testInfo)
  await expect.poll(async () => (await readEntries(call)).filter(entry => entry.sessionId === sessionId), { timeout: 30_000 }).toHaveLength(1)
  const entry = (await readEntries(call)).find(candidate => candidate.sessionId === sessionId)
  if (entry === undefined) throw new Error('The native failed turn did not reach retained notification history.')
  expect(entry).toMatchObject({ category: 'failed', read: false, dismissed: false })
  journeys.set(page, { call, entry, prompt })
  await openNotificationHistory(page)
})

Then('notification history shows the source event at desktop and phone widths', async ({ page, $testInfo }: { page: Page; $testInfo: TestInfo }) => {
  const { entry } = journeyFor(page)
  await recordAssertion(page, 'notification-history-native-source-visible', async () => {
    await expect(notificationRow(page, entry.id)).toContainText('Turn failed')
    await expect(notificationRow(page, entry.id).getByRole('button', { name: 'Mark read', exact: true })).toBeVisible()
    await historyTab(page, 'Unread').click()
    await expect(notificationRow(page, entry.id)).toBeVisible()
    await historyTab(page, 'History').click()
  })
  const originalViewport = page.viewportSize()
  try {
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 360, height: 800 },
    ]) {
      await page.setViewportSize(viewport)
      await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-shell-phone-nav'))).toBe(viewport.width < 640)
      await recordAssertion(page, `notification-history-layout-${String(viewport.width)}`, async () => {
        await expect(notificationRow(page, entry.id)).toBeVisible()
        await expect(notificationRow(page, entry.id).getByRole('button', { name: 'Open thread', exact: true })).toBeVisible()
        const layout = await historyPage(page).evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }))
        expect(layout.scrollWidth, `viewport ${String(viewport.width)}: page width ${String(layout.width)}`).toBeLessThanOrEqual(layout.width + 1)
      })
      if (viewport.width === 360) {
        await recordAssertion(page, 'notification-history-phone-controls-reachable', async () => {
          await chooseHistoryAction(page, 'Clear history')
          await expect(clearDialog(page)).toBeVisible()
          await clearDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
          await expect(clearDialog(page)).toBeHidden()
        })
      }
      const path = $testInfo.outputPath(`notification-history-${String(viewport.width)}.png`)
      await page.screenshot({ path, animations: 'disabled' })
      await $testInfo.attach(`notification-history-${String(viewport.width)}`, { path, contentType: 'image/png' })
    }
  } finally {
    if (originalViewport !== null) await page.setViewportSize(originalViewport)
  }
})

Then('notification read and dismiss actions are reversible and shared across tabs', async ({ page }: { page: Page }) => {
  const { call, entry } = journeyFor(page)
  await recordAssertion(page, 'notification-history-read-reversible', async () => {
    await notificationRow(page, entry.id).getByRole('button', { name: 'Mark read', exact: true }).click()
    await expect.poll(async () => (await readEntries(call)).find(candidate => candidate.id === entry.id)?.read).toBe(true)
    await historyTab(page, 'Unread').click()
    await expect(notificationRow(page, entry.id)).toHaveCount(0)
    await historyTab(page, 'History').click()
    await notificationRow(page, entry.id).getByRole('button', { name: 'Mark unread', exact: true }).click()
    await expect.poll(async () => (await readEntries(call)).find(candidate => candidate.id === entry.id)?.read).toBe(false)
    await historyTab(page, 'Unread').click()
    await expect(notificationRow(page, entry.id)).toBeVisible()
  })
  await recordAssertion(page, 'notification-history-dismiss-reversible', async () => {
    await notificationRow(page, entry.id).getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(notificationRow(page, entry.id)).toHaveCount(0)
    await expect.poll(async () => (await readEntries(call)).find(candidate => candidate.id === entry.id)?.dismissed).toBe(true)
    await historyTab(page, 'Dismissed').click()
    await expect(notificationRow(page, entry.id)).toContainText('Turn failed')
  })
  const otherTab = await page.context().newPage()
  try {
    await otherTab.goto(page.url())
    await openNotificationHistory(otherTab)
    await recordAssertion(page, 'notification-history-cross-tab-restore', async () => {
      await historyTab(otherTab, 'Dismissed').click()
      await notificationRow(otherTab, entry.id).getByRole('button', { name: 'Restore', exact: true }).click()
      await expect(notificationRow(otherTab, entry.id)).toHaveCount(0)
      await page.bringToFront()
      await expect(notificationRow(page, entry.id)).toHaveCount(0, { timeout: 20_000 })
      await historyTab(page, 'History').click()
      await expect(notificationRow(page, entry.id)).toBeVisible()
    })
  } finally {
    await otherTab.close()
  }
  await recordAssertion(page, 'notification-history-api-parity-and-reload', async () => {
    expect(decodeSnapshot(await call('setRead', { ids: [entry.id], read: true })).entries.find(candidate => candidate.id === entry.id)?.read).toBe(true)
    expect(decodeSnapshot(await call('setDismissed', { id: entry.id, dismissed: true })).entries.find(candidate => candidate.id === entry.id)?.dismissed).toBe(
      true,
    )
    await reloadPastProviderSetup(page)
    await openNotificationHistory(page)
    await historyTab(page, 'Dismissed').click()
    await expect(notificationRow(page, entry.id).getByRole('button', { name: 'Mark unread', exact: true })).toBeVisible()
    await notificationRow(page, entry.id).getByRole('button', { name: 'Restore', exact: true }).click()
    await historyTab(page, 'History').click()
    await notificationRow(page, entry.id).getByRole('button', { name: 'Mark unread', exact: true }).click()
    await chooseHistoryAction(page, 'Mark all read')
    await expect(notificationRow(page, entry.id).getByRole('button', { name: 'Mark unread', exact: true })).toBeVisible()
    expect((await readEntries(call)).find(candidate => candidate.id === entry.id)).toMatchObject({ read: true, dismissed: false })
  })
})

Then('opening a history entry returns to its existing thread', async ({ page }: { page: Page }) => {
  const { entry, prompt } = journeyFor(page)
  await recordAssertion(page, 'notification-history-existing-thread-navigation', async () => {
    await notificationRow(page, entry.id).getByRole('button', { name: 'Open thread', exact: true }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(entry.sessionId)
    await expect(page.locator('[data-slot="conversation.session"]').filter({ visible: true }).getByText(prompt, { exact: true })).toBeVisible()
  })
  await openNotificationHistory(page)
})

Then('cancelling clear keeps history and confirming clear preserves newer arrivals', async ({ page, $testInfo }: { page: Page; $testInfo: TestInfo }) => {
  const { call, entry } = journeyFor(page)
  await recordAssertion(page, 'notification-history-clear-cancel', async () => {
    await chooseHistoryAction(page, 'Clear history')
    await expect(clearDialog(page)).toBeVisible()
    await clearDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(clearDialog(page)).toBeHidden()
    await expect(notificationRow(page, entry.id)).toBeVisible()
    expect((await readEntries(call)).map(candidate => candidate.id)).toContain(entry.id)
  })
  await notificationRow(page, entry.id).getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(notificationRow(page, entry.id)).toHaveCount(0)
  await chooseHistoryAction(page, 'Clear history')
  await expect(clearDialog(page)).toBeVisible()
  const otherTab = await page.context().newPage()
  try {
    await otherTab.goto(profileFor(page).url)
    await reloadPastProviderSetup(otherTab)
    const newSessionId = await submitFailingTurn(otherTab, 'Notification history synthetic arrival during clear confirmation', $testInfo)
    await expect.poll(async () => (await readEntries(call)).some(candidate => candidate.sessionId === newSessionId), { timeout: 30_000 }).toBe(true)
    await page.bringToFront()
    await recordAssertion(page, 'notification-history-clear-captured-ids-preserve-arrivals', async () => {
      await clearDialog(page).getByRole('button', { name: 'Clear history', exact: true }).click()
      await expect(clearDialog(page)).toBeHidden()
      await expect(notificationRow(page, entry.id)).toHaveCount(0)
      await expect.poll(async () => (await readEntries(call)).map(candidate => candidate.sessionId)).toEqual([newSessionId])
      await expect(historyPage(page).getByRole('listitem')).toHaveCount(1)
      await expect(historyPage(page).getByRole('listitem')).toContainText('Turn failed')
    })
  } finally {
    await otherTab.close()
  }
  await recordAssertion(page, 'notification-history-clear-confirm-empty', async () => {
    await chooseHistoryAction(page, 'Clear history')
    await clearDialog(page).getByRole('button', { name: 'Clear history', exact: true }).click()
    await expect(clearDialog(page)).toBeHidden()
    await expect(historyPage(page).getByRole('listitem')).toHaveCount(0)
    expect(await readEntries(call)).toEqual([])
    await chooseHistoryAction(page, 'Refresh')
    await expect(historyPage(page)).toContainText('No notifications here. New thread events appear automatically.')
    await reloadPastProviderSetup(page)
    await openNotificationHistory(page)
    await expect(historyPage(page).getByRole('listitem')).toHaveCount(0)
    expect(await readEntries(call)).toEqual([])
  })
  await finishJourneyAssertions(page)
})
