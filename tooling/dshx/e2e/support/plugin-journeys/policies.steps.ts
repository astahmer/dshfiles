import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, openSettingsDialog, recordAssertion } from '../steps.js'
import { selectModelForNewThread, sendMessage } from '../threads.js'

const FAKE_MODEL = 'commandcode_work/gpt-6-luna'

const toolResults = (page: Page): string[] =>
  fakeCommandCodeFor(page).requests.flatMap(request => request.messages.filter(message => message.role === 'tool').map(message => message.text))

const bashCall = (command: string): string => `[[call bash ${JSON.stringify({ command, description: 'Policy journey call' })}]]`

When('the deny rule {string} for bash calls matching {string} is saved in Settings', async ({ page }: { page: Page }, name: string, match: string) => {
  await openSettingsDialog(page)
  await page.getByRole('group', { name: 'Plugins' }).getByRole('button', { name: 'Policies', exact: true }).click()
  const rules = page.locator('[data-setting-path="rules"]').getByRole('textbox')
  await rules.fill(JSON.stringify([{ name, tool: 'bash', match, reason: 'policy journey', enabled: true }]))
  await rules.blur()
  await expect(rules).toHaveValue(new RegExp(`"name": "${name}"`))
  await page.keyboard.press('Escape')
})

When('a new thread on the fake model asks bash to write {string}', async ({ page }: { page: Page }, file: string) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await selectModelForNewThread(page, FAKE_MODEL)
  await sendMessage(page, bashCall(`echo blocked > ${file}`))
})

When('the thread asks bash to echo {string}', async ({ page }: { page: Page }, text: string) => {
  await sendMessage(page, bashCall(`echo ${text}`))
})

Then('the bash call is refused with the {string} policy', async ({ page }: { page: Page }, name: string) => {
  await recordAssertion(page, 'policies-deny-matching-call', () =>
    expect.poll(() => toolResults(page).some(text => text.includes(`Denied by policy “${name}”: policy journey`))).toBe(true),
  )
})

Then('the bash call ran and returned {string}', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'policies-allow-other-call', () => expect.poll(() => toolResults(page).at(-1) ?? '').toContain(text))
  await finishJourneyAssertions(page)
})
