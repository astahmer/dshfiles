import { expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const attachmentFixtures = fileURLToPath(new URL('../../fixtures/attachments/', import.meta.url))
const newThreadComposer = (page: Page) => page.getByRole('textbox', {
  name: 'Describe what you want to build, / commands, @ files or sessions',
  exact: true,
})
const lightbox = (page: Page) => page.getByRole('dialog', { name: 'Image preview', exact: true })

When('a new thread is opened with two image attachments', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await expect(newThreadComposer(page)).toBeVisible()
  await page.locator('[data-composer-card] input[type="file"]').setInputFiles([
    join(attachmentFixtures, 'red.png'),
    join(attachmentFixtures, 'blue.png'),
  ])
  await expect(page.getByRole('button', { name: 'Remove image red.png', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove image blue.png', exact: true })).toBeVisible()
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
