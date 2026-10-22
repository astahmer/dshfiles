import { expect, type Locator, type Page } from '@playwright/test'
import { When, Then } from '../bdd.js'
import { profileFor, recordAssertion, finishJourneyAssertions } from '../steps.js'
import { seedInterruptedSession } from '../seed-interrupted-session.mjs'
import { seedChatImageLinkSession } from '../seed-chat-image-link-session.mjs'

When('a thread with two interrupted tasks is opened', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  await seedInterruptedSession({ homeRoot: profile.homeRoot, profileRoot: `${profile.homeRoot}/profiles/${profile.profile}` })
  const fixture = page.getByRole('treeitem', { name: /Untitled|Interrupted resume fixture/ })
  await expect
    .poll(
      async () => {
        await page.reload()
        if ((await fixture.count()) === 0) await page.getByText('Ungrouped', { exact: true }).first().click()
        await fixture
          .first()
          .waitFor({ state: 'attached', timeout: 3_000 })
          .catch(() => undefined)
        return fixture.count()
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
  await fixture.first().click()
  await page.getByText('Task stopped', { exact: true }).first().waitFor()
})

Then('only the latest stopped notice offers Resume', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'chat-latest-interrupted-only', async () => {
    await expect(page.getByText('Task stopped', { exact: true })).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(1)
  })
})

When('the latest stopped task is resumed inline', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
})

Then('the stopped notices remain but Resume disappears', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'chat-resumed-task-hides-action', async () => {
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0)
    await expect(page.getByText('Task stopped', { exact: true })).toHaveCount(2)
    await expect(page.getByText('Continue the interrupted task', { exact: false }).first()).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('a chat thread with a local image link is opened', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  await seedChatImageLinkSession({ homeRoot: profile.homeRoot })
  const fixture = page.getByRole('treeitem', { name: /Untitled|Chat image link fixture/ })
  await expect
    .poll(
      async () => {
        await page.reload()
        if ((await fixture.count()) === 0) await page.getByText('Ungrouped', { exact: true }).first().click()
        await fixture
          .first()
          .waitFor({ state: 'attached', timeout: 3_000 })
          .catch(() => undefined)
        return fixture.count()
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
  await fixture.first().click()
  const imageLink = page.getByRole('button', { name: 'red.png', exact: true })
  await imageLink.scrollIntoViewIfNeeded()
  const backToBottom = page.getByRole('button', { name: 'Back to bottom', exact: true })
  await expect(backToBottom).toBeVisible()
  await imageLink.click()
})

Then('the image link opens in the gallery rather than a side panel', async ({ page }: { page: Page }) => {
  const lightbox = page.getByRole('dialog', { name: 'Image preview', exact: true })
  const backToBottom = page.getByRole('button', { name: 'Back to bottom', exact: true })
  const rightSidebar = page.getByRole('button', { name: 'Open right sidebar', exact: true })
  const leftSidebarGroup = page.getByRole('treeitem', { name: 'Ungrouped', exact: true })
  const composer = page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })
  const pointIsInsideLightbox = async (element: Locator): Promise<boolean> =>
    element.evaluate(target => {
      const bounds = target.getBoundingClientRect()
      const topElement = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
      return topElement?.closest('[role="dialog"][aria-label="Image preview"]') !== null
    })
  await recordAssertion(page, 'chat-image-link-opens-gallery', async () => {
    await expect(lightbox).toBeVisible()
    await expect(lightbox.getByRole('img', { name: 'red.png', exact: true })).toBeVisible()
    await expect(backToBottom).toBeVisible()
    await expect(rightSidebar).toBeVisible()
    await expect(leftSidebarGroup).toBeVisible()
    await expect(composer).toBeVisible()
    const backdropStyle = await lightbox.locator('div[aria-hidden="true"]').evaluate(element => {
      const computed = getComputedStyle(element)
      const alpha = computed.backgroundColor.match(/,\s*([\d.]+)\)$/)?.[1]
      return {
        alpha: alpha === undefined ? 1 : Number(alpha),
        backdropFilter: computed.backdropFilter,
      }
    })
    expect(backdropStyle.alpha).toBeGreaterThan(0.4)
    expect(backdropStyle.backdropFilter).toContain('blur(')
    const lightboxZIndex = await lightbox.evaluate(element => Number(getComputedStyle(element).zIndex))
    expect(lightboxZIndex).toBeGreaterThan(1100)
    expect(await pointIsInsideLightbox(backToBottom)).toBe(true)
    expect(await pointIsInsideLightbox(rightSidebar)).toBe(true)
    expect(await pointIsInsideLightbox(leftSidebarGroup)).toBe(true)
    expect(await pointIsInsideLightbox(composer)).toBe(true)
  })
  await page.keyboard.press('Escape')
  await expect(lightbox).toBeHidden()
  await finishJourneyAssertions(page)
})
