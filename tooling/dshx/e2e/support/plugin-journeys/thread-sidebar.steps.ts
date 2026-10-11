import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

interface ThreadHistoryJourney {
  readonly firstThreadId: string
  readonly secondThreadId: string
}

const threadHistoryJourneys = new WeakMap<Page, ThreadHistoryJourney>()

const threadSidebar = (page: Page) => page.getByRole('region', { name: 'Threads' })
const sidebarNavigation = (page: Page) => page.getByRole('navigation', { name: 'Sidebar navigation' })
const customizeSidebar = (page: Page) => page.getByRole('region', { name: 'Customize sidebar' })
const sidebarSettings = (page: Page) => page.getByRole('region', { name: 'Sidebar settings' })
const paletteDialog = (page: Page) => page.getByRole('dialog', { name: 'Command palette' })
const paletteInput = (page: Page) => paletteDialog(page).getByRole('combobox')
const currentThreadId = (page: Page): string | null => new URL(page.url()).searchParams.get('thread')

const startBlankThread = async (page: Page): Promise<string> => {
  const previousThreadId = currentThreadId(page)
  await sidebarNavigation(page).getByRole('button', { name: 'New thread', exact: true }).click()
  await expect.poll(() => currentThreadId(page)).not.toBe(previousThreadId)
  await expect(page.getByRole('textbox').first()).toBeVisible()
  const createdThreadId = currentThreadId(page)
  if (createdThreadId === null) throw new Error('The Host did not select a thread after New thread was clicked.')
  return createdThreadId
}

const openSidebarSettings = async (page: Page): Promise<void> => {
  await threadSidebar(page).getByRole('button', { name: 'Sidebar settings', exact: true }).click()
  await expect(sidebarSettings(page)).toBeVisible()
}

When('a blank Host thread is started', async ({ page }: { page: Page }) => {
  await startBlankThread(page)
})

When('a nonblank Host thread is archived and immediately undone', async ({ page }: { page: Page }) => {
  const prompt = 'thread sidebar archive undo e2e target'
  if (currentThreadId(page) === null) await startBlankThread(page)
  await page.getByRole('textbox').first().fill(prompt)
  await page.getByRole('textbox').first().press('Enter')
  const archivedThreadId = currentThreadId(page)
  if (archivedThreadId === null) throw new Error('The Host did not keep the selected thread after its first message.')
  const targetRow = threadSidebar(page).locator('article').filter({ hasText: prompt })
  await expect(targetRow).toHaveCount(1)
  await expect(targetRow.getByRole('button', { name: 'Archive', exact: true })).toBeEnabled()
  await targetRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
  await expect(threadSidebar(page).getByText('Thread archived.', { exact: true })).toBeVisible()
  const archivedSection = threadSidebar(page).getByRole('button', { name: 'Archived (1)', exact: true })
  await expect(archivedSection).toBeVisible()
  await archivedSection.click()
  const openArchivedThread = targetRow.locator('button').first()
  await expect(openArchivedThread).toBeEnabled()
  await openArchivedThread.click()
  await expect.poll(() => currentThreadId(page)).toBe(archivedThreadId)
  await expect(archivedSection).toBeVisible()
  await threadSidebar(page).getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(threadSidebar(page).getByText('Thread restored.', { exact: true })).toBeVisible()
})

Then('the thread is restored from the archive notice', async ({ page }: { page: Page }) => {
  const targetRow = threadSidebar(page).locator('article').filter({ hasText: 'thread sidebar archive undo e2e target' })
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
  const timedPrompt = 'thread sidebar archive duration e2e target'
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
  const disabledPrompt = 'thread sidebar archive disabled e2e target'
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

When('a nonblank Host thread is parked from its context menu', async ({ page }: { page: Page }) => {
  const prompt = 'thread sidebar park e2e target'
  if (currentThreadId(page) === null) await startBlankThread(page)
  const composer = page.getByRole('textbox').first()
  await composer.fill(prompt)
  await composer.press('Enter')
  const targetRow = threadSidebar(page).locator('article').filter({ hasText: prompt })
  await expect(targetRow).toHaveCount(1)
  await targetRow.hover()
  await targetRow.getByRole('button', { name: 'Thread notifications', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Snooze for 15 minutes', exact: true }).click()
  await expect(targetRow.getByRole('button', { name: 'Notifications muted', exact: true })).toBeVisible()
  await targetRow.getByRole('button', { name: 'Notifications muted', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Turn notifications back on', exact: true }).click()
  await expect(targetRow.getByRole('button', { name: 'Thread notifications', exact: true })).toBeVisible()
  await targetRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Park', exact: true }).click()
  await expect(threadSidebar(page).getByRole('button', { name: 'Active (0)', exact: true })).toBeVisible()
  await expect(threadSidebar(page).getByRole('button', { name: 'Parked (1)', exact: true })).toBeVisible()
  await expect(targetRow).toHaveCount(1)
})

Then('the Host thread stays parked after reload without an attention error', async ({ page }: { page: Page }) => {
  const targetRow = threadSidebar(page).locator('article').filter({ hasText: 'thread sidebar park e2e target' })
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
  await customize.getByRole('button', { name: 'Expanded labels', exact: true }).click()
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
    await expect(customize.getByRole('button', { name: 'Expanded labels', exact: true })).toHaveAttribute('aria-pressed', 'true')
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

When('two blank Host threads are opened', async ({ page }: { page: Page }) => {
  const firstThreadId = await startBlankThread(page)
  const secondThreadId = await startBlankThread(page)
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
