import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import type {} from '../../../packages/dshx/src/client/broker.js'
import type { ComposerService } from '../../../packages/dshx/src/client/app-services.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const attachmentFixtures = fileURLToPath(new URL('../../fixtures/attachments/', import.meta.url))
const newThreadComposer = (page: Page) =>
  page.getByRole('textbox', {
    name: 'Describe what you want to build, / commands, @ files or sessions',
    exact: true,
  })

When('a canonical thread mention is pasted into a new thread composer', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  const composer = newThreadComposer(page)
  await expect(composer).toBeVisible()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin })
  const mention = `@[Pasted thread](dsh-session:${Buffer.from(JSON.stringify('session-e2e')).toString('base64url')})`
  await page.evaluate(async value => navigator.clipboard.writeText(value), mention)
  await composer.click()
  await page.keyboard.press('Meta+V')
})

Then('the pasted mention is displayed as a reference chip', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'rich-composer-paste-creates-session-reference-chip', async () => {
    const chip = page.locator('[data-composer-chip="reference"]')
    await expect(chip).toHaveCount(1)
    await expect(chip).toHaveText('Pasted thread')
  })
  await finishJourneyAssertions(page)
})

When('an image is attached to a new thread composer', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  const composer = newThreadComposer(page)
  await expect(composer).toBeVisible()
  await expect(composer).toHaveAttribute('contenteditable', 'true')
  await composer.click()
  await page.locator('[data-composer-card] input[type="file"]').setInputFiles(join(attachmentFixtures, 'red.png'))
  await expect(page.getByRole('button', { name: 'Remove image red.png', exact: true })).toBeVisible()
})

Then('the image is represented by an inline composer reference', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'rich-composer-image-attachment-creates-inline-reference', async () => {
    const imageReference = page.locator('[data-composer-chip="image-attachment"]')
    await expect(imageReference).toHaveCount(1)
    await expect(imageReference).toHaveText('@Image 1')
  })
  await finishJourneyAssertions(page)
})

Then('an image reference can be mentioned repeatedly and opens its selected image', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'rich-composer-image-reference-gallery-repeat', async () => {
    const imageReferences = page.locator('[data-composer-chip="image-attachment"]')
    await expect(imageReferences).toHaveCount(1)
    await expect(imageReferences.nth(0)).toHaveText('@Image 1')
    await page.getByText('Image 1', { exact: true }).click()

    const gallery = page.getByRole('dialog', { name: 'Image preview', exact: true })
    await expect(gallery).toBeVisible()
    await expect(gallery.locator('img').first()).toHaveAttribute('alt', 'red.png')
    await page.getByRole('button', { name: 'Close image preview', exact: true }).click()

    const composer = newThreadComposer(page)
    await composer.focus()
    await page.keyboard.press('End')
    for (let pick = 0; pick < 2; pick++) {
      await page.keyboard.type('@')
      const imageOption = page.getByRole('option', { name: 'Image 1', exact: true })
      await expect(imageOption).toBeVisible()
      await imageOption.click()
    }
    await expect(imageReferences).toHaveCount(3)
    await expect(imageReferences.nth(2)).toHaveText('Image 1')
  })
  await finishJourneyAssertions(page)
})

When('a plugin sets the draft and attaches a quote, a note and a file through the Composer contract', async ({ page }: { page: Page }) => {
  await page.waitForFunction(() => globalThis.__dshxBrokerV1?.contracts.get('dshx.composer')?.live.status === 'active')
  await newThreadComposer(page).click()
  const applied = await page.evaluate(() => {
    const live = globalThis.__dshxBrokerV1?.contracts.get('dshx.composer')?.live
    if (live?.status !== 'active') throw new Error('dshx.composer is not provided')
    // SAFETY: the broker stores contract values untyped; `dshx.composer` is only ever provided with a ComposerService.
    const composer = live.value as ComposerService
    return [
      composer.setText({ text: 'Please review ' }),
      composer.attach({ attachment: { kind: 'quote', text: 'const answer = 42' } }),
      composer.attach({ attachment: { kind: 'note', text: 'keep the API narrow', label: 'Reviewer note' } }),
      composer.attach({ attachment: { kind: 'file', path: 'README.md' } }),
    ]
  })
  expect(applied).toEqual([true, true, true, true])
})

Then('the composer shows the draft with the quote, note and file chips', async ({ page }: { page: Page }) => {
  const composer = newThreadComposer(page)
  await recordAssertion(page, 'composer-contract-chips-render', async () => {
    await expect(composer).toContainText('Please review')
    await expect(composer).toContainText('const answer = 42')
    await expect(composer).toContainText('Reviewer note')
    await expect(composer).toContainText('README.md')
  })
  await recordAssertion(page, 'composer-contract-reads-the-draft', async () => {
    const draft = await page.evaluate(() => {
      const live = globalThis.__dshxBrokerV1?.contracts.get('dshx.composer')?.live
      // SAFETY: as above, `dshx.composer` holds a ComposerService.
      return live?.status === 'active' ? (live.value as ComposerService).text() : undefined
    })
    expect(draft).toContain('> const answer = 42')
    expect(draft).toContain('keep the API narrow')
  })
  await finishJourneyAssertions(page)
})
