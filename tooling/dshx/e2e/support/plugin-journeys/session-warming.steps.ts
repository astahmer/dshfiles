import { expect, test, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, openSettingsDialog, recordAssertion } from '../steps.js'

const FIRST_MESSAGE = 'First message of the journey'

const requestsEndingWith = (page: Page, text: string): number =>
  fakeCommandCodeFor(page).requests.filter(
    request => request.kind === 'turn' && request.messages.some(message => message.role === 'user' && message.text === text),
  ).length

When('session warming is switched on in Settings with a one-minute interval', async ({ page }: { page: Page }) => {
  await openSettingsDialog(page)
  await page.getByRole('group', { name: 'Plugins' }).getByRole('button', { name: 'Session warming', exact: true }).click()
  const enabled = page.locator('[data-setting-path="enabled"]').getByRole('switch')
  await enabled.click()
  await expect(enabled).toBeChecked()
  const interval = page.locator('[data-setting-path="intervalMinutes"]').getByRole('spinbutton')
  await interval.fill('1')
  await interval.press('Enter')
  await expect(interval).toHaveValue('1')
  await page.keyboard.press('Escape')
})

Then('the fake provider receives the same request again within ninety seconds', async ({ page }: { page: Page }) => {
  test.setTimeout(300_000)
  await recordAssertion(page, 'session-warming-resends-last-request', async () => {
    expect(requestsEndingWith(page, FIRST_MESSAGE)).toBe(1)
    await expect.poll(() => requestsEndingWith(page, FIRST_MESSAGE), { timeout: 90_000, intervals: [2_000] }).toBe(2)
  })
})

Then('the thread still shows a single turn', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'session-warming-adds-no-turn', () => expect(page.getByRole('status').filter({ hasText: /^Completed$/ })).toHaveCount(1))
  await finishJourneyAssertions(page)
})
