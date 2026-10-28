import { expect, test, type ElementHandle, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'
import { When, Then } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const names = { threads: 'Thread Sidebar: Threads', scratchpad: 'Workbench: Scratchpad' } as const
interface FloatJourney {
  readonly id: string
  readonly name: string
  readonly sourceRegion: string
  readonly original: ElementHandle<SVGElement | HTMLElement>
}
const journeys = new WeakMap<Page, FloatJourney>()
const state = (page: Page): FloatJourney => {
  const value = journeys.get(page)
  if (value === undefined) throw new Error('Left floating Threads fixture is missing')
  return value
}
const region = (page: Page, name: string): Locator => page.locator(`[data-workbench-region=${JSON.stringify(name)}]`).first()
const tab = (page: Page, name: string = state(page).name): Locator => page.getByRole('tab', { name, exact: true })
const chrome = (page: Page, name: string = state(page).name): Locator => page.locator('.dv-resize-container').filter({ has: tab(page, name) })
const body = (page: Page): Locator => page.locator(`[data-workbench-panel-id=${JSON.stringify(state(page).id)}]`)
const box = async (target: Locator) => {
  const rect = await target.boundingBox()
  if (rect === null) throw new Error('Native floating target has no visible box')
  return rect
}
const move = async (page: Page, floating: Locator, x: number, y: number): Promise<void> => {
  const handle = floating.locator('.dv-floating-titlebar')
  await expect(handle).toBeVisible()
  const rect = await box(handle)
  const start = { x: rect.x + Math.min(80, rect.width / 2), y: rect.y + rect.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 1, start.y + 1)
  await page.mouse.move(x, y, { steps: 24 })
  await page.mouse.up()
}
const bodyHit = async (target: Locator): Promise<boolean> =>
  target.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const hit = element.ownerDocument.elementFromPoint(rect.left + Math.min(40, rect.width / 2), rect.top + Math.min(40, rect.height / 2))
    return hit !== null && element.contains(hit)
  })

const floatSource = async (page: Page, sourceRegion: string, name: string): Promise<void> => {
  const threads = region(page, sourceRegion).getByRole('tab', { name, exact: true })
  await expect(threads).toBeVisible()
  const id = await threads.locator('[data-workbench-tab-id]').getAttribute('data-workbench-tab-id')
  if (id === null) throw new Error('Native Threads tab has no registered occurrence id')
  const original = await page.locator(`[data-workbench-panel-id=${JSON.stringify(id)}]`).elementHandle()
  if (original === null) throw new Error('Native Threads body has not mounted')
  journeys.set(page, { id, name, sourceRegion, original })
  await threads.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Float panel', exact: true }).click()
  await expect(chrome(page)).toBeVisible()
  await expect(chrome(page).locator('.dv-groupview-floating')).toHaveCount(1)
}

When('the real left Threads tab is floated from its context menu', async ({ page }: { page: Page }) => {
  await floatSource(page, 'left', names.threads)
})
When('the real right Scratchpad tab is floated from its context menu', async ({ page }: { page: Page }) => {
  await floatSource(page, 'right', names.scratchpad)
})

When('its floating titlebar is dragged over the centre of the window', async ({ page }: { page: Page }) => {
  const rect = await box(region(page, 'main'))
  await move(page, chrome(page), rect.x + rect.width * 0.55, rect.y + 140)
})

Then('the floating Threads body is visible and interactive outside the left pane without remounting', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-left-float-escapes-pane-with-native-content', async () => {
    const left = await box(region(page, 'left'))
    const floating = await box(chrome(page))
    const content = await box(body(page))
    const report = {
      left,
      floating,
      content,
      bodyHit: await bodyHit(body(page)),
      sameBody: await body(page).evaluate((element, original) => element === original, state(page).original),
    }
    const path = test.info().outputPath('left-floating-geometry.json')
    await writeFile(path, JSON.stringify(report, null, 2))
    await test.info().attach('left-floating-geometry', { path, contentType: 'application/json' })
    await page.screenshot({ path: test.info().outputPath('threads-floating-over-main.png'), animations: 'disabled' })
    expect(floating.x).toBeGreaterThan(left.x + left.width + 40)
    expect(content.x).toBeCloseTo(floating.x + 1, 0)
    expect(content.y).toBeGreaterThan(floating.y + 30)
    expect(content.x + content.width).toBeLessThanOrEqual(floating.x + floating.width + 1)
    expect(report.bodyHit).toBe(true)
    expect(report.sameBody).toBe(true)
    await expect(body(page).getByRole('button', { name: 'Search threads', exact: true })).toBeVisible()
  })
})

Then('the floating Threads placement survives reload and viewport resize', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-window-float-reloads-and-realigns', async () => {
    // Force a width-only re-clamp without crossing the responsive breakpoint
    // that intentionally hides the source sidebar and its native descendants.
    const initial = await box(chrome(page).locator('.dv-floating-titlebar'))
    await move(page, chrome(page), 1270, initial.y + initial.height / 2)
    const before = await box(chrome(page))
    await StartupDialogs.reloadPastProviderSetup(page)
    const after = await box(chrome(page))
    expect(after.x).toBeCloseTo(before.x, 0)
    expect(after.y).toBeCloseTo(before.y, 0)
    expect(await bodyHit(body(page))).toBe(true)
    // Width-only resize leaves the LEFT native grid's own dimensions unchanged.
    // The window floating integration, not its grid ResizeObserver, must reclamp.
    await page.setViewportSize({ width: 1100, height: 800 })
    await expect.poll(() => bodyHit(body(page))).toBe(true)
    await expect
      .poll(async () => {
        const bounds = await box(chrome(page))
        return bounds.x + bounds.width
      })
      .toBeLessThanOrEqual(1101)
    const resize = await box(chrome(page))
    expect(resize.x).toBeGreaterThan((await box(region(page, 'left'))).width)
    expect(resize.x + resize.width).toBeLessThanOrEqual(1101)
    expect(resize.y + resize.height).toBeLessThanOrEqual(801)
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect.poll(() => bodyHit(body(page))).toBe(true)
  })
})

When('the floating Threads tab is dragged into the main pane', async ({ page }: { page: Page }) => {
  const source = await box(tab(page))
  const destination = await box(region(page, 'main').locator('.dv-tabs-and-actions-container').first())
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2, { steps: 3 })
  await page.mouse.move(destination.x + Math.min(160, destination.width / 2), destination.y + destination.height / 2, { steps: 28 })
  await page.mouse.up()
})

Then('the same Threads occurrence is docked in main with no duplicate floating copy', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-floating-tab-docks-through-existing-region-owner', async () => {
    await expect(region(page, 'main').getByRole('tab', { name: names.threads, exact: true })).toBeVisible()
    await expect(tab(page)).toHaveCount(1)
    await expect(chrome(page)).toHaveCount(0)
    await expect(body(page)).toHaveCount(1)
    await expect(body(page)).toBeVisible()
    expect(await bodyHit(body(page))).toBe(true)
    await StartupDialogs.reloadPastProviderSetup(page)
    await expect(region(page, 'main').getByRole('tab', { name: names.threads, exact: true })).toBeVisible()
    await expect(tab(page)).toHaveCount(1)
    await expect(chrome(page)).toHaveCount(0)
  })
  await state(page).original.dispose()
  await finishJourneyAssertions(page)
})

Then('the floating draft remains aligned after its source origin moves', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-floating-body-follows-moving-source-origin', async () => {
    const editor = body(page).getByRole('textbox', { name: 'Scratchpad', exact: true })
    const draft = await editor.inputValue()
    expect(draft.length).toBeGreaterThan(0)
    const initialSource = await box(region(page, 'right'))
    const assertAligned = async (): Promise<void> => {
      const floating = await box(chrome(page))
      const content = await box(body(page))
      expect(content.x).toBeCloseTo(floating.x + 1, 0)
      expect(content.y).toBeGreaterThan(floating.y + 30)
      expect(content.x + content.width).toBeLessThanOrEqual(floating.x + floating.width + 1)
      expect(await bodyHit(body(page))).toBe(true)
      expect(await body(page).evaluate((element, previous) => element === previous, state(page).original)).toBe(true)
      await expect(editor).toHaveValue(draft)
      await expect(body(page).getByTestId('mounts')).toHaveText('1')
    }
    await assertAligned()
    await page.setViewportSize({ width: 1100, height: 800 })
    await expect.poll(async () => (await box(region(page, 'right'))).x).not.toBe(initialSource.x)
    await expect.poll(() => bodyHit(body(page))).toBe(true)
    await assertAligned()
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect.poll(() => bodyHit(body(page))).toBe(true)
    await assertAligned()
  })
  await state(page).original.dispose()
  await finishJourneyAssertions(page)
})

Then('the second floating window keeps its draft and wins overlap hit testing', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-overlapping-floats-keep-native-z-order-and-draft', async () => {
    // Place the older float where the next titlebar can overlap its BODY,
    // even when the second float is almost as wide as the whole window.
    await move(page, chrome(page), 330, 210)
    const first = await box(chrome(page))
    const olderBody = await box(body(page))
    const second = chrome(page, names.scratchpad)
    const scratchTab = tab(page, names.scratchpad)
    const scratchId = await scratchTab.locator('[data-workbench-tab-id]').getAttribute('data-workbench-tab-id')
    if (scratchId === null) throw new Error('Floating Scratchpad has no registered occurrence id')
    const scratchBody = page.locator(`[data-workbench-panel-id=${JSON.stringify(scratchId)}]`)
    const editor = scratchBody.getByRole('textbox', { name: 'Scratchpad', exact: true })
    const original = await editor.elementHandle()
    if (original === null) throw new Error('Floating Scratchpad editor has not mounted')
    const draft = await editor.inputValue()
    expect(draft).toContain('Keep this unsent Scratchpad draft')
    await move(page, second, first.x + 110, first.y + 100)
    const bounds = await box(second.locator('.dv-floating-titlebar'))
    const overlap = { x: Math.max(bounds.x + 20, olderBody.x + 20), y: bounds.y + bounds.height / 2 }
    expect(overlap.x).toBeLessThan(Math.min(bounds.x + bounds.width, olderBody.x + olderBody.width))
    expect(overlap.y).toBeGreaterThan(olderBody.y)
    expect(overlap.y).toBeLessThan(olderBody.y + olderBody.height)
    expect(
      await second.locator('.dv-floating-titlebar').evaluate((element, point) => {
        const hit = element.ownerDocument.elementFromPoint(point.x, point.y)
        return hit !== null && element.contains(hit)
      }, overlap),
    ).toBe(true)
    expect(await bodyHit(scratchBody)).toBe(true)
    // Both pane APIs can remain locally active. A real exposed older titlebar
    // click must still raise that WINDOW across APIs, not just select its tab.
    await chrome(page)
      .locator('.dv-floating-titlebar')
      .click({ position: { x: 20, y: 11 } })
    await expect
      .poll(() =>
        body(page).evaluate((element, point) => {
          const hit = element.ownerDocument.elementFromPoint(point.x, point.y)
          return hit !== null && element.contains(hit)
        }, overlap),
      )
      .toBe(true)
    await second.locator('.dv-floating-titlebar').click({ position: { x: bounds.width - 12, y: bounds.height / 2 } })
    await expect
      .poll(() =>
        second.locator('.dv-floating-titlebar').evaluate((element, point) => {
          const hit = element.ownerDocument.elementFromPoint(point.x, point.y)
          return hit !== null && element.contains(hit)
        }, overlap),
      )
      .toBe(true)
    expect(await editor.evaluate((element, previous) => element === previous, original)).toBe(true)
    await expect(editor).toHaveValue(draft)
    await expect(scratchBody.getByTestId('mounts')).toHaveText('1')
    await page.screenshot({ path: test.info().outputPath('window-floating-native-overlap.png'), animations: 'disabled' })
    await original.dispose()
  })
  await state(page).original.dispose()
  await finishJourneyAssertions(page)
})
