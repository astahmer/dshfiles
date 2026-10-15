import { expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const attachmentFixtures = fileURLToPath(new URL('../../fixtures/attachments/', import.meta.url))
const newThreadComposer = (page: Page) =>
  page.getByRole('textbox', {
    name: 'Describe what you want to build, / commands, @ files or sessions',
    exact: true,
  })
const lightbox = (page: Page) => page.getByRole('dialog', { name: 'Image preview', exact: true })
const imageRemovalButtons = (page: Page) => page.getByRole('button', { name: /^Remove image / })

When('a new thread is opened with two image attachments', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await expect(newThreadComposer(page)).toBeVisible()
  await page.locator('[data-composer-card] input[type="file"]').setInputFiles([join(attachmentFixtures, 'red.png'), join(attachmentFixtures, 'blue.png')])
  await expect(page.getByRole('button', { name: 'Remove image red.png', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove image blue.png', exact: true })).toBeVisible()
})

When('an image is pasted into a new thread composer', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  const composer = newThreadComposer(page)
  await expect(composer).toBeVisible()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin })
  await composer.click()
  await page.evaluate(
    async (bytes: number[]) => {
      const image = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })])
    },
    [...(await readFile(join(attachmentFixtures, 'red.png')))],
  )
  await page.keyboard.press('Meta+V')
})

Then('the pasted image appears in the attachment rail', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'attachment-gallery-paste-adds-an-image', async () => {
    await expect(imageRemovalButtons(page)).toHaveCount(1)
    await expect(imageRemovalButtons(page).first()).toBeVisible()
  })
})

When('the pasted image is removed and another image is dropped', async ({ page }: { page: Page }) => {
  await imageRemovalButtons(page).click()
  await expect(imageRemovalButtons(page)).toHaveCount(0)
  const accepted = await page.evaluate(
    (bytes: number[]) => {
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' }))
      return ['dragenter', 'dragover', 'drop'].every(type => {
        const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer })
        document.dispatchEvent(event)
        return event.defaultPrevented
      })
    },
    [...(await readFile(join(attachmentFixtures, 'blue.png')))],
  )
  if (!accepted) throw new Error('The composer did not accept the image drop.')
})

Then('the dropped image appears in the attachment rail', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'attachment-gallery-drop-adds-an-image', async () => {
    await expect(page.getByRole('button', { name: 'Remove image dropped.png', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the first draft image is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'red.png, click to view original', exact: true }).click()
})

Then('the lightbox shows the first image and its thumbnail strip', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'attachment-gallery-opens-selected-draft-image', async () => {
    await expect(lightbox(page)).toBeVisible()
    await expect(lightbox(page).getByRole('img', { name: 'red.png', exact: true })).toBeVisible()
    await expect(lightbox(page).getByRole('button', { name: 'Image 1 of 2', exact: true })).toHaveAttribute('aria-current', 'true')
    await expect(lightbox(page).getByRole('button', { name: 'Image 2 of 2', exact: true })).toBeVisible()
  })
})

When('the right arrow key is pressed in the lightbox', async ({ page }: { page: Page }) => {
  await page.keyboard.press('ArrowRight')
})

Then('the second image is selected', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'attachment-gallery-keyboard-navigation-selects-next-image', async () => {
    await expect(lightbox(page).getByRole('img', { name: 'blue.png', exact: true })).toBeVisible()
    await expect(lightbox(page).getByRole('button', { name: 'Image 2 of 2', exact: true })).toHaveAttribute('aria-current', 'true')
  })
})

When('the first lightbox thumbnail is selected', async ({ page }: { page: Page }) => {
  await lightbox(page).getByRole('button', { name: 'Image 1 of 2', exact: true }).click()
})

Then('the first image is selected', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'attachment-gallery-thumbnail-selects-corresponding-image', async () => {
    await expect(lightbox(page).getByRole('img', { name: 'red.png', exact: true })).toBeVisible()
    await expect(lightbox(page).getByRole('button', { name: 'Image 1 of 2', exact: true })).toHaveAttribute('aria-current', 'true')
  })
  await page.keyboard.press('Escape')
  await expect(lightbox(page)).toBeHidden()
  await finishJourneyAssertions(page)
})
