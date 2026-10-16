import { expect, type Page } from '@playwright/test'
import { z } from 'zod'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const FRAME_WIDTHS_KEY = 'dshfiles.frame-layout.v1'

const storedFrameWidthsSchema = z.object({
  sidebar: z.number(),
  rightbar: z.number().nullable(),
  collapsed: z.boolean(),
})

const sidebarHandle = (page: Page) => page.locator('[data-side="sidebar"]')

/** The sidebar occupant's own toggle: "Collapse sidebar" while open, "Open sidebar" while collapsed. */
const sidebarToggle = (page: Page) => page.getByRole('button', { name: /^(?:Collapse|Open) sidebar$/ }).first()

/** The frame publishes `data-sidebar-collapsed` on its root whenever the column is closed. */
const frameCollapsed = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.querySelector('[data-sidebar-collapsed]') !== null)

/**
 * The frame's first grid track, read from the inline style: the computed value
 * can sit mid-transition, while the inline track is already the settled width.
 */
const sidebarTrack = (page: Page): Promise<number> =>
  sidebarHandle(page).evaluate(element => {
    const track = element.parentElement?.style.gridTemplateColumns.split(' ')[0] ?? ''
    return Number.parseFloat(track)
  })

const storedFrameWidths = async (page: Page): Promise<z.infer<typeof storedFrameWidthsSchema> | null> => {
  const raw = await page.evaluate(key => localStorage.getItem(key), FRAME_WIDTHS_KEY)
  if (raw === null) return null
  const parsed = storedFrameWidthsSchema.safeParse(JSON.parse(raw))
  return parsed.success ? parsed.data : null
}

When('the left sidebar handle is dragged {int}px wider', async ({ page }: { page: Page }, delta: number) => {
  const handle = sidebarHandle(page)
  await expect(handle).toBeVisible()
  const box = await handle.boundingBox()
  if (box === null) throw new Error('The left sidebar handle has no box to drag.')
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + delta, startY, { steps: 8 })
  await page.mouse.up()
})

Then('the left sidebar column is {int}px wide', async ({ page }: { page: Page }, width: number) => {
  await recordAssertion(page, 'frame-layout-drag-widens-the-sidebar-column', async () => {
    await expect.poll(() => sidebarTrack(page)).toBe(width)
  })
})

Then('the browser stores a {int}px sidebar width', async ({ page }: { page: Page }, width: number) => {
  await recordAssertion(page, 'frame-layout-persists-the-dragged-width', async () => {
    await expect.poll(async () => (await storedFrameWidths(page))?.sidebar ?? 0).toBe(width)
  })
})

When('the DSH page is reloaded', async ({ page }: { page: Page }) => {
  await page.reload()
})

Then('the left sidebar column keeps the {int}px width', async ({ page }: { page: Page }, width: number) => {
  await recordAssertion(page, 'frame-layout-reload-keeps-the-dragged-width', async () => {
    await expect(sidebarHandle(page)).toBeVisible()
    await expect.poll(() => sidebarTrack(page)).toBe(width)
  })
  await finishJourneyAssertions(page)
})

When('the sidebar collapse control is used', async ({ page }: { page: Page }) => {
  await sidebarToggle(page).click()
})

Then('the sidebar is collapsed', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'frame-layout-collapse-closes-the-column', async () => {
    await expect.poll(() => frameCollapsed(page)).toBe(true)
    await expect(page.getByRole('button', { name: 'Open sidebar', exact: true })).toBeVisible()
  })
})

Then('the browser stores a collapsed sidebar with a {int}px width', async ({ page }: { page: Page }, width: number) => {
  await recordAssertion(page, 'frame-layout-persists-the-collapsed-state', async () => {
    await expect.poll(async () => await storedFrameWidths(page)).toEqual({ sidebar: width, rightbar: null, collapsed: true })
  })
})

Then('the sidebar is still collapsed', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'frame-layout-reload-keeps-the-collapsed-sidebar', async () => {
    await expect(sidebarToggle(page)).toBeVisible()
    await expect.poll(() => frameCollapsed(page)).toBe(true)
  })
})

When('the sidebar expand control is used', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
})

Then('the left sidebar column is {int}px wide again', async ({ page }: { page: Page }, width: number) => {
  await recordAssertion(page, 'frame-layout-expand-restores-the-remembered-width', async () => {
    await expect(sidebarHandle(page)).toBeVisible()
    await expect.poll(() => sidebarTrack(page)).toBe(width)
  })
  await finishJourneyAssertions(page)
})
