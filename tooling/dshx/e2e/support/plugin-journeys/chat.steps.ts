import { expect, type Page } from '@playwright/test'
import { When, Then } from '../bdd.js'
import { profileFor, recordAssertion, finishJourneyAssertions } from '../steps.js'
import { seedInterruptedSession } from '../seed-interrupted-session.mjs'

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
