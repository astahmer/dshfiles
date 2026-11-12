import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, openSettingsDialog, recordAssertion, settingsNavEntry } from '../steps.js'
import { selectModelForNewThread, sendMessage } from '../threads.js'

const call = (text: string): string => `[[call sample_echo ${JSON.stringify({ text })}]]`
const toolResults = (page: Page): string[] =>
  fakeCommandCodeFor(page).requests.flatMap(request => request.messages.filter(message => message.role === 'tool').map(message => message.text))

When('the OpenCode sample plugin is saved in Settings', async ({ page }: { page: Page }) => {
  await openSettingsDialog(page)
  await settingsNavEntry(page, 'Opencode compat').click()
  const plugins = page.locator('[data-setting-path="plugins"]').getByRole('textbox')
  await plugins.fill(
    JSON.stringify([
      {
        specifier: fileURLToPath(new URL('../../../../../plugins/@dshfiles/opencode-compat/tests/fixtures/opencode-sample/index.mjs', import.meta.url)),
        options: '{}',
        enabled: true,
      },
    ]),
  )
  await plugins.blur()
  await page.keyboard.press('Escape')
})

When('a new thread on the fake model calls the OpenCode sample tool with {string}', async ({ page }: { page: Page }, text: string) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await selectModelForNewThread(page, 'commandcode_work/gpt-6-luna')
  await sendMessage(page, call(text))
})

When('the thread calls the OpenCode sample tool with {string}', async ({ page }: { page: Page }, text: string) => {
  await sendMessage(page, call(text))
})

Then('the OpenCode sample tool returns {string}', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, text === 'Denied by opencode-sample' ? 'opencode-sample-denied' : 'opencode-sample-allowed', () =>
    expect.poll(() => toolResults(page).at(-1) ?? '').toContain(text),
  )
  if (text === 'Denied by opencode-sample') await finishJourneyAssertions(page)
})
