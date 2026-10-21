import { expect, type Page } from '@playwright/test'
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
        await fixture.first().waitFor({ state: 'attached', timeout: 3_000 }).catch(() => undefined)
        return fixture.count()
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
  await fixture.first().click()
  const imageLink = page.getByRole('button', { name: 'red.png', exact: true })
  await expect(imageLink).toBeVisible()
  await imageLink.click()
})

Then('the image link opens in the gallery rather than a side panel', async ({ page }: { page: Page }) => {
  const lightbox = page.getByRole('dialog', { name: 'Image preview', exact: true })
  await recordAssertion(page, 'chat-image-link-opens-gallery', async () => {
    await expect(lightbox).toBeVisible()
    await expect(lightbox.getByRole('img', { name: 'red.png', exact: true })).toBeVisible()
  })
  await page.keyboard.press('Escape')
  await expect(lightbox).toBeHidden()
  await finishJourneyAssertions(page)
})
