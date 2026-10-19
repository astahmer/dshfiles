import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const failedTurns = (page: Page) => page.getByText('This turn failed', { exact: true })
const roundRequests = (page: Page): number => fakeCommandCodeFor(page).requests.filter(request => request.kind === 'turn').length

When('a goal whose rounds come back empty is set in a new thread', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await page.getByRole('button', { name: /^Select model/ }).click()
  await page.getByRole('menuitemradio', { name: 'commandcode_work/gpt-6-luna', exact: true }).click()
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await composer.fill('/goal [[empty]] Write the release notes')
  await composer.press('Enter')
})

When('three messages that come back empty are sent in a new thread without a goal', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await page.getByRole('button', { name: /^Select model/ }).click()
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

When('a one-round goal is started with a one-shot extension request', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await page.getByRole('button', { name: /^Select model/ }).click()
  await page.getByRole('menuitemradio', { name: 'commandcode_work/gpt-6-luna', exact: true }).click()
  const encodedObjective = String.raw`Finish handoff [[once call extend_goal_budget \u007b\u0022additional_rounds\u0022:1,\u0022progress\u0022:\u0022Primary handoff completed and verified.\u0022,\u0022remaining_work\u0022:\u0022One final result check remains.\u0022,\u0022justification\u0022:\u0022The original request authorizes this monitoring window.\u0022\u007d]]`
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await composer.fill(`[[call create_goal {"objective":"${encodedObjective}","max_goal_rounds":1}]]`)
  await composer.press('Enter')
})

Then('the extension is applied and the goal blocks at its new limit', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'goal-stall-guard-final-round-extension', async () => {
    await expect(page.getByText('Blocked Goal', { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTitle('Goal reached its configured limit of 2 rounds.', { exact: true })).toBeVisible()
  })
})

When('completion evidence is delivered to the round-limited goal', async ({ page }: { page: Page }) => {
  const composer = page.getByRole('textbox', { name: /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/ })
  await composer.fill('[[call complete_blocked_goal {"evidence":"All requirements passed review; final output was produced and verified."}]]')
  await composer.press('Enter')
})

Then('the round-limited goal is marked complete', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'goal-stall-guard-round-limit-completion', async () => {
    await expect(page.getByText('Blocked Goal', { exact: true })).toHaveCount(0, { timeout: 60_000 })
  })
  await finishJourneyAssertions(page)
})
