import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, recordAssertion, settingsPage } from '../steps.js'
import { selectModelForNewThread, sendMessage } from '../threads.js'

const FAKE_MODEL = 'commandcode_work/gpt-6-luna'

const toolResults = (page: Page): string[] =>
  fakeCommandCodeFor(page).requests.flatMap(request => request.messages.filter(message => message.role === 'tool').map(message => message.text))

/** A tool's JSON input as the fake provider's `[[call …]]` directive carries it. */
type DirectiveInput = Readonly<Record<string, string | Readonly<Record<string, string>>>>

const directive = (tool: string, input: DirectiveInput): string => `[[call ${tool} ${JSON.stringify(input)}]]`

const newFakeThread = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await selectModelForNewThread(page, FAKE_MODEL)
}

When('a new thread on the fake model lists the client tools', async ({ page }: { page: Page }) => {
  await newFakeThread(page)
  await sendMessage(page, directive('client_tools_list', {}))
})

Then('the agent sees this window offer the client tool {string}', async ({ page }: { page: Page }, tool: string) => {
  await recordAssertion(page, 'client-bridge-window-listed', () =>
    expect.poll(() => toolResults(page).some(text => text.includes('"windows"') && text.includes(`"name":"${tool}"`))).toBe(true),
  )
})

When('the thread calls the client tool {string} for the Settings section {string}', async ({ page }: { page: Page }, tool: string, section: string) => {
  // Not sendMessage: Settings takes the main view, so the turn's settled status leaves the screen by design.
  const composer = page.getByRole('textbox', { name: /^Message or run a task, \/ commands, @ files or (?:threads|sessions)$/u })
  await composer.fill(directive('client_tool_call', { tool, input: { section } }))
  await composer.press('Enter')
})

Then('Settings is open in the window with a notice naming {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'client-bridge-settings-opened', async () => {
    await expect(settingsPage(page).first()).toBeVisible()
    await expect(page.getByText(`Agent: ${title}`).first()).toBeVisible()
  })
})

Then('the agent received the opened Settings section {string}', async ({ page }: { page: Page }, sectionId: string) => {
  await recordAssertion(page, 'client-bridge-result-returned', () =>
    expect.poll(() => toolResults(page).some(text => text.includes('"tool":"settings_open"') && text.includes(`"id":"${sectionId}"`))).toBe(true),
  )
  await finishJourneyAssertions(page)
})

When('a new thread on the fake model calls the client tool {string}', async ({ page }: { page: Page }, tool: string) => {
  await newFakeThread(page)
  // Let the window announce its tools first, as an Agent would after client_tools_list.
  await sendMessage(page, directive('client_tools_list', {}))
  await expect.poll(() => toolResults(page).some(text => text.includes('"name":"settings_open"'))).toBe(true)
  await sendMessage(page, directive('client_tool_call', { tool }))
})

Then('the agent is told no window offers {string} and that it offers {string}', async ({ page }: { page: Page }, missing: string, offered: string) => {
  await recordAssertion(page, 'client-bridge-unknown-tool-refused', () =>
    expect.poll(() => toolResults(page).some(text => text.includes(`No open window offers ${missing}`) && text.includes(offered))).toBe(true),
  )
  await finishJourneyAssertions(page)
})
