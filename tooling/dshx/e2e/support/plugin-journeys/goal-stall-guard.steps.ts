import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const failedTurns = (page: Page) => page.getByText('This turn failed', { exact: true })
const roundRequests = (page: Page): number => fakeCommandCodeFor(page).requests.filter(request => request.kind === 'turn').length

When('a goal whose rounds come back empty is set in a new thread', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Escape')
  await page.getByRole('treeitem', { name: 'New Session', exact: true }).click()
  await page.getByRole('button', { name: /^Select model/ }).click()
  await page.getByRole('menuitem', { name: /^Model / }).click()
  await page.getByRole('menuitemradio', { name: 'commandcode_work/gpt-6-luna', exact: true }).click()
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await composer.fill('/goal [[empty]] Write the release notes')
  await composer.press('Enter')
})

When('three messages that come back empty are sent in a new thread without a goal', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Escape')
  await page.getByRole('treeitem', { name: 'New Session', exact: true }).click()
  await page.getByRole('button', { name: /^Select model/ }).click()
  await page.getByRole('menuitem', { name: /^Model / }).click()
  await page.getByRole('menuitemradio', { name: 'commandcode_work/gpt-6-luna', exact: true }).click()
  for (let message = 1; message <= 3; message += 1) {
    const composer = page.getByRole('textbox', { name: /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/ })
    await composer.fill(`[[empty]] Message ${String(message)}`)
    await composer.press('Enter')
    await expect(failedTurns(page)).toHaveCount(message, { timeout: 60_000 })
  }
})

When('the goal is resumed and its round comes back empty again', async ({ page }: { page: Page }) => {
  const failuresBefore = await failedTurns(page).count()
  await page.getByRole('button', { name: 'Resume goal', exact: true }).click()
  await expect(failedTurns(page)).toHaveCount(failuresBefore + 1, { timeout: 60_000 })
})

Then('the empty round fails and leaves the goal inactive', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'goal-stall-guard-empty-round-fails-the-turn', async () => {
    await expect(failedTurns(page)).toHaveCount(1, { timeout: 60_000 })
    await expect(page.getByText('EMPTY_RESPONSE', { exact: true })).toHaveCount(1)
    await expect(page.getByText('Inactive Goal', { exact: true })).toBeVisible()
  })
})

Then('the goal is still only inactive', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'goal-stall-guard-two-empty-rounds-do-not-pause', async () => {
    await expect(page.getByText('Inactive Goal', { exact: true })).toBeVisible()
    await expect(page.getByText('Paused Goal', { exact: true })).toHaveCount(0)
  })
})

Then('each turn fails on its own and no goal appears', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'goal-stall-guard-ignores-turns-without-a-goal', async () => {
    await expect(failedTurns(page)).toHaveCount(3)
    await expect(page.getByText(/^(Paused|Inactive|Active) Goal$/)).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

Then('the guard pauses the goal after its third empty round', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'goal-stall-guard-third-empty-round-pauses-the-goal', async () => {
    await expect(page.getByText('Paused Goal', { exact: true })).toBeVisible()
    // Three rounds, each the first attempt plus AI Accounts' two retries; the paused goal starts no fourth.
    expect(roundRequests(page)).toBe(9)
  })
  await finishJourneyAssertions(page)
})
