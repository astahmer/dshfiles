import { expect, test, type ElementHandle, type Locator, type Page } from '@playwright/test'
import type { WorkbenchPanelDrop } from '../../../../../plugins/@dshfiles/workbench/src/workbench-view.js'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'
import { When, Then } from '../bdd.js'
import { recordAssertion, finishJourneyAssertions } from '../steps.js'

const SCRATCH = 'Workbench: Scratchpad'
const THREADS = 'Thread Sidebar: Threads'
const PREVIEW = 'AI Accounts: Preview'
const STATUS_ID = 'dshfiles-thread-sidebar.workbench-status'
const regions = (page: Page, name: string): Locator => page.locator(`[data-workbench-region=${JSON.stringify(name)}]`).first()
const tab = (page: Page, name: string): Locator => page.getByRole('tab', { name, exact: true, includeHidden: true })
const group = (page: Page, name: string): Locator =>
  tab(page, name).locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," dv-groupview ")][1]')
const row = (page: Page, name: string): Locator => group(page, name).locator('.dv-tabs-and-actions-container')
const own = (page: Page, id: string): Locator => page.locator(`[data-workbench-panel-id=${JSON.stringify(id)}]`)
interface Draft {
  readonly id: string
  readonly original: ElementHandle<SVGElement | HTMLElement>
  readonly value: string
}
const drafts = new WeakMap<Page, Draft>()
const draft = (page: Page): Draft => {
  const value = drafts.get(page)
  if (value === undefined) throw new Error('Single-tab draft fixture is missing')
  return value
}
const hide = async (page: Page, name: string, blank = false): Promise<void> => {
  if (blank) {
    const space = group(page, name).locator('.dv-void-container')
    await expect(space).toBeVisible()
    await space.click({ button: 'right', position: { x: 20, y: 12 } })
  } else await tab(page, name).click({ button: 'right' })
  const action = page.getByRole('menuitem', { name: 'Hide tab row', exact: true })
  await expect(action).toBeEnabled()
  await action.click()
  await expect(row(page, name)).toBeHidden()
}
const show = async (page: Page, id: string): Promise<void> => {
  const body = own(page, id)
  await body.hover()
  await body.getByRole('button', { name: 'Show tab row', exact: true }).click()
}
const drag = async (page: Page, source: Locator, destination: Locator): Promise<void> => {
  const start = await source.boundingBox()
  const end = await destination.boundingBox()
  if (start === null || end === null) throw new Error('A real tab drop endpoint is not visible')
  const x = start.x + Math.min(90, start.width / 2)
  const y = start.y + start.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 14, y + 1, { steps: 3 })
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 28 })
  await page.mouse.up()
}
const draftUnchanged = async (page: Page): Promise<void> => {
  const state = draft(page)
  const body = own(page, state.id)
  const editor = body.getByRole('textbox', { name: 'Scratchpad', exact: true })
  await expect(editor).toHaveValue(state.value)
  expect(await editor.evaluate((element, previous) => element === previous, state.original)).toBe(true)
  await expect(body.getByTestId('mounts')).toHaveText('1')
}

When('its single tab row is hidden from the tab context menu', async ({ page }: { page: Page }) => {
  const id = await tab(page, SCRATCH).locator('[data-workbench-tab-id]').getAttribute('data-workbench-tab-id')
  if (id === null) throw new Error('Scratchpad has no original occurrence id')
  const editor = own(page, id).getByRole('textbox', { name: 'Scratchpad', exact: true })
  const original = await editor.elementHandle()
  if (original === null) throw new Error('Scratchpad draft has not mounted')
  drafts.set(page, { id, original, value: await editor.inputValue() })
  await hide(page, SCRATCH)
})
Then('the tab row is hidden but its original draft stays mounted', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-single-tab-hide-preserves-native-draft', async () => {
    await expect(row(page, SCRATCH)).toBeHidden()
    await draftUnchanged(page)
    await page.screenshot({ path: test.info().outputPath('single-tab-content-only.png'), animations: 'disabled' })
  })
})
When('its tab row is shown from the content recovery control', async ({ page }: { page: Page }) => {
  await show(page, draft(page).id)
  await expect(row(page, SCRATCH)).toBeVisible()
  await draftUnchanged(page)
})
When('its single tab row is hidden from the blank row context menu', async ({ page }: { page: Page }) => {
  await hide(page, SCRATCH, true)
  await draftUnchanged(page)
})
When('a real Threads tab is dropped onto its content-only group', async ({ page }: { page: Page }) => {
  await drag(page, regions(page, 'left').getByRole('tab', { name: THREADS, exact: true }), own(page, draft(page).id))
})
Then('both tabs are shown and hiding a multiple-tab row is disabled', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-second-tab-drop-reveals-row-and-clears-hide', async () => {
    await expect(row(page, SCRATCH)).toBeVisible()
    await expect(group(page, SCRATCH).getByRole('tab')).toHaveCount(2)
    await expect(group(page, SCRATCH).getByRole('tab', { name: THREADS, exact: true })).toBeVisible()
    await expect(tab(page, THREADS)).toHaveCount(1)
    await tab(page, SCRATCH).click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Hide tab row', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await tab(page, SCRATCH).click()
    await draftUnchanged(page)
    await page.screenshot({ path: test.info().outputPath('dropped-tab-reveals-row.png'), animations: 'disabled' })
  })
})
When('the extra Threads tab is closed', async ({ page }: { page: Page }) => {
  await group(page, SCRATCH)
    .getByRole('tab', { name: THREADS, exact: true })
    .getByRole('button', { name: `Close ${THREADS}`, exact: true })
    .click()
})
Then('the remaining tab row stays shown with its original draft', async ({ page }: { page: Page }) => {
  await expect(group(page, SCRATCH).getByRole('tab')).toHaveCount(1)
  await expect(row(page, SCRATCH)).toBeVisible()
  await draftUnchanged(page)
})
Then('the global tab-row recovery command and a new tab arriving on reload reveal the row', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-hidden-row-palette-and-reload-recovery', async () => {
    await hide(page, SCRATCH)
    await page.getByRole('button', { name: 'Open command palette', exact: true }).click()
    const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
    await expect(palette).toBeVisible()
    await palette.getByRole('tab', { name: 'Everything', exact: true }).click()
    await palette.getByRole('combobox').fill('Show tab rows')
    await palette.getByRole('option', { name: /Workbench: Show tab rows/ }).click()
    await expect(row(page, SCRATCH)).toBeVisible()
    await draftUnchanged(page)
    await hide(page, SCRATCH)
    await StartupDialogs.reloadPastProviderSetup(page)
    // The native draft provider opens a fresh New thread on this fixture's
    // reload. That genuinely adds a second tab, so the row MUST reveal. The
    // Preview case separately proves hidden-row reload with a stable singleton.
    await expect(group(page, SCRATCH).getByRole('tab')).toHaveCount(2)
    await expect(group(page, SCRATCH).getByRole('tab', { name: 'New thread', exact: true })).toBeVisible()
    await expect(row(page, SCRATCH)).toBeVisible()
    await tab(page, SCRATCH).click()
    await expect(own(page, draft(page).id).getByRole('textbox', { name: 'Scratchpad', exact: true })).toBeVisible()
  })
  await draft(page).original.dispose()
  await finishJourneyAssertions(page)
})

const previewSeat = (page: Page): Locator => own(page, STATUS_ID).locator(`[data-sidebar-workbench-source="${STATUS_ID}"]`)

/** Resize the live Dockview group, never the preview DOM or a cloned strip. */
const resizePreviewContent = async (page: Page, height: number): Promise<void> => {
  // Workbench retains the live content in a portal seat, outside the native
  // group's DOM subtree. Measure both actual boxes rather than assuming nesting.
  const groupBox = await group(page, PREVIEW).boundingBox()
  const seatBox = await previewSeat(page).boundingBox()
  if (groupBox === null || seatBox === null) throw new Error('The real Preview group and seat are not visible')
  const inset = groupBox.height - seatBox.height
  await page.evaluate(
    ({ sourceId, groupHeight }) => {
      // SAFETY: WorkbenchView registers its real DockviewApi after readiness;
      // the visible left Preview above proves this registered surface is mounted.
      // The shared registry intentionally exposes only getPanel to other plugins.
      const api = globalThis.dshfilesWorkbenchRegionsV1?.get('left') as WorkbenchPanelDrop['api'] | undefined
      const panel = api?.getPanel(sourceId)
      if (panel === undefined) throw new Error('The live left Dockview Preview is missing')
      panel.api.setSize({ height: groupHeight })
    },
    { sourceId: STATUS_ID, groupHeight: height + inset },
  )
  await expect.poll(() => previewSeat(page).evaluate(element => element.getBoundingClientRect().height)).toBe(height)
}

const measurePreview = (page: Page) =>
  previewSeat(page).evaluate(element => {
    const strip = element.querySelector('[role="group"][aria-label^="AI accounts usage"]')
    const card = strip?.querySelector('button')
    if (!(element instanceof HTMLElement) || !(strip instanceof HTMLElement) || !(card instanceof HTMLElement)) {
      throw new Error('The real AI Accounts strip and its Usage card are missing')
    }
    const box = (node: HTMLElement) => {
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        paddingTop: Number.parseFloat(style.paddingTop),
        paddingBottom: Number.parseFloat(style.paddingBottom),
        overflowY: style.overflowY,
      }
    }
    return {
      outer: box(element),
      strip: box(strip),
      card: box(card),
      buttons: [...strip.querySelectorAll('button')].map(button => ({
        label: button.getAttribute('aria-label'),
        height: button.getBoundingClientRect().height,
      })),
      outerTopGap: strip.getBoundingClientRect().top - element.getBoundingClientRect().top,
      outerBottomGap: element.getBoundingClientRect().bottom - strip.getBoundingClientRect().bottom,
      innerTopGap: card.getBoundingClientRect().top - strip.getBoundingClientRect().top,
      innerBottomGap: strip.getBoundingClientRect().bottom - card.getBoundingClientRect().bottom,
      contentExtent:
        strip.getBoundingClientRect().height +
        Number.parseFloat(getComputedStyle(element).paddingTop) +
        Number.parseFloat(getComputedStyle(element).paddingBottom),
    }
  })

const assertCompactPreview = async (page: Page): Promise<void> => {
  await recordAssertion(page, 'workbench-preview-44px-real-content-no-scroll', async () => {
    const originalHeight = await previewSeat(page).evaluate(element => element.getBoundingClientRect().height)
    const measurements = []
    try {
      for (const height of [56, 48, 44, 40]) {
        await resizePreviewContent(page, height)
        measurements.push({ requestedHeight: height, ...(await measurePreview(page)) })
        if (height === 44 || height === 40) {
          await page.screenshot({ path: test.info().outputPath(`regular-preview-${String(height)}px.png`), animations: 'disabled', fullPage: true })
        }
      }
      await test.info().attach('regular-preview-real-layout', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
      console.info('Preview real Dockview measurements:', JSON.stringify(measurements))
      for (const measurement of measurements) {
        expect(measurement.outer.paddingTop).toBe(4)
        expect(measurement.outer.paddingBottom).toBe(4)
        expect(measurement.strip.paddingTop).toBe(2)
        expect(measurement.strip.paddingBottom).toBe(2)
        expect(measurement.innerTopGap).toBe(2)
        expect(measurement.innerBottomGap).toBe(2)
        expect(measurement.outerTopGap).toBe(4)
        expect(measurement.contentExtent).toBe(44)
        expect(measurement.card.height).toBe(32)
        expect(measurement.buttons.every(button => button.height === 32)).toBe(true)
        expect(measurement.outer.overflowY).toBe('auto')
        if (measurement.requestedHeight === 44) expect(measurement.outerBottomGap).toBe(4)
        if (measurement.requestedHeight >= 44) {
          expect(measurement.outer.scrollHeight).toBe(measurement.outer.clientHeight)
        } else {
          // A genuinely undersized pane still scrolls; no clipping/hidden overflow workaround.
          expect(measurement.outer.scrollHeight).toBeGreaterThan(measurement.outer.clientHeight)
        }
      }
    } finally {
      await resizePreviewContent(page, originalHeight)
    }
  })
}

Then('the account preview is one ordinary left tab rather than a fixed footer', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-sidebar-preview-is-one-regular-view', async () => {
    await expect(regions(page, 'left').getByRole('tab', { name: PREVIEW, exact: true })).toBeVisible()
    await expect(own(page, STATUS_ID)).toHaveCount(1)
    await expect(own(page, STATUS_ID).getByRole('button', { name: 'Add AI account', exact: true })).toBeVisible()
    const previews = page.locator('[data-slot="sidebar.footer.above"]').filter({ has: page.getByRole('button', { name: 'Add AI account', exact: true }) })
    await expect(previews).toHaveCount(1)
    expect(await previews.evaluate(element => element.closest('[data-workbench-panel-id]')?.getAttribute('data-workbench-panel-id'))).toBe(STATUS_ID)
  })
  await assertCompactPreview(page)
})
When('the account preview tab row is hidden and shown again', async ({ page }: { page: Page }) => {
  await hide(page, PREVIEW)
  await expect(own(page, STATUS_ID).getByRole('button', { name: 'Add AI account', exact: true })).toBeVisible()
  await own(page, STATUS_ID).hover()
  await page.screenshot({ path: test.info().outputPath('sidebar-preview-content-only.png'), animations: 'disabled' })
  await StartupDialogs.reloadPastProviderSetup(page)
  await expect(row(page, PREVIEW)).toBeHidden()
  await expect(tab(page, PREVIEW)).toHaveCount(1)
  await expect(own(page, STATUS_ID).getByRole('button', { name: 'Add AI account', exact: true })).toBeVisible()
  await show(page, STATUS_ID)
  await expect(row(page, PREVIEW)).toBeVisible()
})
When('the account preview is moved into the right pane', async ({ page }: { page: Page }) => {
  await regions(page, 'main').getByRole('button', { name: 'Pane options', exact: true }).first().click()
  await page.getByRole('menuitem', { name: 'Open right pane', exact: true }).click()
  await drag(page, tab(page, PREVIEW), regions(page, 'right').locator('[data-workbench-surface]').first())
  await expect(regions(page, 'right').getByRole('tab', { name: PREVIEW, exact: true })).toBeVisible()
})
Then('the account preview placement survives reload without a fixed or left duplicate', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-sidebar-preview-move-reload-stays-single', async () => {
    // Simulate an existing user who had already moved this reusable view before
    // the fixed-footer conversion shipped: saved foreign placement must win.
    await page.evaluate(() => localStorage.removeItem('dshfiles.workbench.sidebar-preview-docked.v1'))
    await StartupDialogs.reloadPastProviderSetup(page)
    await expect(regions(page, 'right').getByRole('tab', { name: PREVIEW, exact: true })).toBeVisible()
    await expect(regions(page, 'left').getByRole('tab', { name: PREVIEW, exact: true })).toHaveCount(0)
    await expect(tab(page, PREVIEW)).toHaveCount(1)
    await expect(own(page, STATUS_ID)).toHaveCount(1)
  })
})
When('the ordinary account preview tab is closed and the page is reloaded', async ({ page }: { page: Page }) => {
  await tab(page, PREVIEW)
    .getByRole('button', { name: `Close ${PREVIEW}`, exact: true })
    .click()
  await expect(tab(page, PREVIEW)).toHaveCount(0)
  await StartupDialogs.reloadPastProviderSetup(page)
})
Then('the closed account preview stays closed and can reopen from the chooser', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-sidebar-preview-close-and-explicit-reopen', async () => {
    await expect(tab(page, PREVIEW)).toHaveCount(0)
    await expect(own(page, STATUS_ID)).toHaveCount(0)
    await regions(page, 'main').getByRole('button', { name: 'New tab', exact: true }).first().click()
    const chooser = regions(page, 'main').getByRole('region', { name: 'Choose a view', exact: true }).filter({ visible: true })
    await chooser.getByRole('textbox', { name: 'Search views', exact: true }).fill(PREVIEW)
    await chooser.getByRole('button', { name: PREVIEW, exact: true }).click()
    await expect(regions(page, 'main').getByRole('tab', { name: PREVIEW, exact: true })).toBeVisible()
    await expect(own(page, STATUS_ID).getByRole('button', { name: 'Add AI account', exact: true })).toBeVisible()
    await expect(tab(page, PREVIEW)).toHaveCount(1)
  })
  await finishJourneyAssertions(page)
})

const legacyPanels = new WeakMap<Page, readonly string[]>()
When('an old saved sidebar without a docked Preview is restored', async ({ page }: { page: Page }) => {
  const ids = await regions(page, 'left')
    .locator('[data-workbench-tab-id]')
    .evaluateAll(
      (elements, statusId) =>
        elements.map(element => element.getAttribute('data-workbench-tab-id')).filter((id): id is string => id !== null && id !== statusId),
      STATUS_ID,
    )
  legacyPanels.set(page, ids)
  await hide(page, 'Thread Sidebar: Navigation')
  await tab(page, PREVIEW)
    .getByRole('button', { name: `Close ${PREVIEW}`, exact: true })
    .click()
  // This is the product's own versioned once-marker; the retained native layout
  // now represents the old two-group sidebar, including an intentional header.
  await page.evaluate(() => localStorage.removeItem('dshfiles.workbench.sidebar-preview-docked.v1'))
  await StartupDialogs.reloadPastProviderSetup(page)
})
Then('its existing views and hidden row survive the once-only Preview conversion', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-preview-legacy-layout-no-reset', async () => {
    const ids = legacyPanels.get(page)
    if (ids === undefined) throw new Error('Old sidebar occurrence snapshot is missing')
    for (const id of ids) await expect(own(page, id)).toHaveCount(1)
    await expect(row(page, 'Thread Sidebar: Navigation')).toBeHidden()
    await expect(regions(page, 'left').getByRole('tab', { name: PREVIEW, exact: true })).toBeVisible()
    await expect(tab(page, PREVIEW)).toHaveCount(1)
    await expect(own(page, STATUS_ID)).toHaveCount(1)
    const previewBox = await group(page, PREVIEW).boundingBox()
    const threadsBox = await group(page, THREADS).boundingBox()
    if (previewBox === null || threadsBox === null) throw new Error('Restored sidebar groups are not visible')
    expect(previewBox.y).toBeGreaterThanOrEqual(threadsBox.y + threadsBox.height - 1)
    await StartupDialogs.reloadPastProviderSetup(page)
    await expect(tab(page, PREVIEW)).toHaveCount(1)
    await expect(row(page, 'Thread Sidebar: Navigation')).toBeHidden()
  })
})
Then('resetting the layout restores the default visible rows and regular Preview', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-preview-explicit-reset-defaults', async () => {
    await page.getByRole('button', { name: 'Open command palette', exact: true }).click()
    const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
    await palette.getByRole('tab', { name: 'Everything', exact: true }).click()
    await palette.getByRole('combobox').fill('Reset layout')
    await palette.getByRole('option', { name: /Workbench: Reset layout/ }).click()
    await expect(row(page, 'Thread Sidebar: Navigation')).toBeVisible()
    await expect(row(page, THREADS)).toBeVisible()
    await expect(row(page, PREVIEW)).toBeVisible()
    await expect(own(page, STATUS_ID)).toHaveCount(1)
    await page.screenshot({ path: test.info().outputPath('regular-sidebar-preview.png'), animations: 'disabled' })
  })
  await finishJourneyAssertions(page)
})
