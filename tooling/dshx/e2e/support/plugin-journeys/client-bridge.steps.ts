import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, openSettingsDialog, recordAssertion, reloadPastProviderSetup, settingsNavEntry, settingsPage } from '../steps.js'
import { selectModelForNewThread, sendMessage } from '../threads.js'

const FAKE_MODEL = 'commandcode_work/gpt-6-luna'

const toolResults = (page: Page): string[] =>
  fakeCommandCodeFor(page).requests.flatMap(request => request.messages.filter(message => message.role === 'tool').map(message => message.text))

/** A tool's JSON input as the fake provider's `[[call …]]` directive carries it. */
type DirectiveInput = Readonly<Record<string, string | Readonly<Record<string, string>>>>

const THREAD_COMPOSER = /^Message or run a task, \/ commands, @ files or (?:threads|sessions)$/u

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
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
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

When('PTC mode is the new task default', async ({ page }: { page: Page }) => {
  await openSettingsDialog(page)
  // PTC is a coding preset: with the coding view off, a PTC default falls back to Standard.
  await settingsNavEntry(page, 'General').click()
  const codingView = settingsPage(page).getByRole('switch', { name: 'Show coding view' })
  if ((await codingView.getAttribute('aria-checked')) !== 'true') await codingView.click()
  await expect(codingView).toHaveAttribute('aria-checked', 'true')
  // The registry's selectedDefault is the preset new threads start with; the Agent presets cards write the same field.
  await settingsNavEntry(page, 'Preset registry').click()
  const field = settingsPage(page)
    .getByRole('textbox', { name: /selected ?default/iu })
    .first()
  await field.fill('ptc')
  await field.blur()
  await expect(field).toHaveValue('ptc')
  await page.keyboard.press('Escape')
  // The new-thread composer reads the roster once; a reload makes it start from the new default.
  await reloadPastProviderSetup(page)
})

/** A run_code program: list the windows, then one client_tool_call chain; it returns what the agent needs. */
const chainProgram = (first: string, second: string, section: string): string =>
  [
    'const listed = await tools.client_tools_list({})',
    `const chain = await tools.client_tool_call({ steps: [{ tool: ${JSON.stringify(first)}, input: {} }, { tool: ${JSON.stringify(second)}, input: { section: ${JSON.stringify(section)} } }] })`,
    'return { windows: listed.windows.length, chained: chain.steps.map(step => step.tool), opened: chain.steps[1].result }',
  ].join('\n')

When(
  'a new thread on the fake model runs a program that lists the client tools and chains {string} then {string} for {string}',
  async ({ page }: { page: Page }, first: string, second: string, section: string) => {
    await newFakeThread(page)
    const composer = page.getByRole('textbox', {
      name: /^(?:Describe what you want to build|Message or run a task), \/ commands, @ files or (?:threads|sessions)$/u,
    })
    await composer.fill(directive('run_code', { code: chainProgram(first, second, section), description: 'Open Settings through the client bridge' }))
    await composer.press('Enter')
  },
)

Then('the program returned both step results from one window', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'client-bridge-code-mode-chain', () =>
    // The last tool result is the run_code output: its JSON, or the raw text when it is not JSON, so a mismatch shows it.
    expect
      .poll(
        () => {
          const text = toolResults(page).at(-1) ?? ''
          try {
            const parsed: { readonly windows?: number; readonly chained?: readonly string[] } = JSON.parse(text)
            return { windows: parsed.windows, chained: parsed.chained }
          } catch {
            return text
          }
        },
        { timeout: 20_000 },
      )
      .toEqual({ windows: 1, chained: ['settings_sections', 'settings_open'] }),
  )
  // Code Mode kept the preset's executor: no tool_search proxy ran.
  expect(fakeCommandCodeFor(page).requests.some(request => request.messages.some(message => message.text.includes('tool_search')))).toBe(false)
})

Then('the client bridge journey is recorded', async ({ page }: { page: Page }) => {
  await finishJourneyAssertions(page)
})

When('a new thread on the fake model finds the palette command {string} and runs it', async ({ page }: { page: Page }, label: string) => {
  await newFakeThread(page)
  await sendMessage(page, directive('client_tool_call', { tool: 'palette_commands', input: { query: label } }))
  // The settings-shell row's id, as palette_commands listed it.
  await expect.poll(() => toolResults(page).some(text => text.includes('"id":"@dshfiles/settings-shell/open"'))).toBe(true)
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(`[[call client_tool_call ${JSON.stringify({ tool: 'palette_run', input: { id: '@dshfiles/settings-shell/open', confirm: true } })}]]`)
  await composer.press('Enter')
})

Then('the agent received the palette command it ran', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'command-palette-agent-ran-command', () =>
    expect.poll(() => toolResults(page).some(text => text.includes('"ran":"@dshfiles/settings-shell/open"'))).toBe(true),
  )
  await finishJourneyAssertions(page)
})
