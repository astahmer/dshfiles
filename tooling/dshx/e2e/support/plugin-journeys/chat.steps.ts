import { expect, type Page } from '@playwright/test'
import { When, Then } from '../bdd.js'
import { profileFor, recordAssertion, finishJourneyAssertions } from '../steps.js'
import { seedInterruptedSession } from '../seed-interrupted-session.mjs'

When('a thread with two interrupted tasks is opened', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  await seedInterruptedSession({ homeRoot: profile.homeRoot, profileRoot: `${profile.homeRoot}/profiles/${profile.profile}` })
  await page.reload()
  await page.getByText('Interrupted resume fixture', { exact: true }).first().click()
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
