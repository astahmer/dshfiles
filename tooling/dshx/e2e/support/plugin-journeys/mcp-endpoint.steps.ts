import { expect, type Page } from '@playwright/test'
import * as Schema from 'effect/Schema'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, openSettingsDialog, recordAssertion, settingsPage } from '../steps.js'
import { createScratchDirectory } from '../threads.js'

const TITLE = 'Started from an outside agent'
const ANSWER = 'Answered for the MCP client'

const tokens = new WeakMap<Page, string>()
const threads = new WeakMap<Page, string>()

const settingsDialog = (page: Page) => settingsPage(page)
const endpointOf = (page: Page): string => `${new URL(page.url()).origin}/mcp`

const toolArgumentsSchema = Schema.Record(Schema.String, Schema.Json)

const toolResultSchema = Schema.Struct({
  result: Schema.Struct({
    content: Schema.Array(Schema.Struct({ type: Schema.Literal('text'), text: Schema.String })),
    isError: Schema.optional(Schema.Boolean),
  }),
})

/** One MCP tools/call from this Node process, as Claude Code sends it: no cookie, only the bearer header. */
const callTool = async <Output>(input: {
  readonly page: Page
  readonly name: string
  readonly args: Schema.Schema.Type<typeof toolArgumentsSchema>
  readonly output: Schema.ConstraintDecoder<Output>
}): Promise<Output> => {
  const token = tokens.get(input.page)
  if (token === undefined) throw new Error('No MCP token was generated in this scenario.')
  const response = await fetch(endpointOf(input.page), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: input.name, arguments: input.args } }),
  })
  expect(response.status).toBe(200)
  const parsed = Schema.decodeUnknownSync(toolResultSchema)(await response.json()).result
  const text = parsed.content[0]?.text ?? ''
  if (parsed.isError === true) throw new Error(`${input.name} failed: ${text}`)
  return Schema.decodeUnknownSync(input.output)(JSON.parse(text))
}

Then('the MCP endpoint refuses a client without a token', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'mcp-endpoint-refuses-without-token', async () => {
    const response = await fetch(endpointOf(page), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(response.status).toBe(401)
    expect(await response.text()).toContain('Settings › MCP endpoint')
  })
})

When('a token is generated in the MCP endpoint settings with a Claude Code command', async ({ page }: { page: Page }) => {
  await openSettingsDialog(page)
  const dialog = settingsDialog(page)
  await dialog.getByRole('button', { name: 'MCP endpoint', exact: true }).click()
  await dialog.getByRole('button', { name: 'Generate token', exact: true }).click()
  const token = await dialog
    .locator('code', { hasText: /^dshmcp_/ })
    .first()
    .textContent()
  if (token === null) throw new Error('The settings did not show the new token.')
  tokens.set(page, token)
  const command = `claude mcp add --transport http dsh ${endpointOf(page)} --header "Authorization: Bearer ${token}"`
  await recordAssertion(page, 'mcp-endpoint-token-shown-with-command', async () => {
    await expect(dialog.getByText(command, { exact: true })).toBeVisible()
  })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()
})

Then('reopened MCP endpoint settings no longer show the token', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'mcp-endpoint-token-not-shown-again', async () => {
    await openSettingsDialog(page)
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'MCP endpoint', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Rotate', exact: true })).toBeVisible()
    await expect(dialog.getByText(tokens.get(page) ?? 'dshmcp_', { exact: false })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('an MCP client with that token starts a thread with a first prompt', async ({ page }: { page: Page }) => {
  const cwd = await createScratchDirectory('dshx-mcp-endpoint-e2e-')
  const created = await callTool({
    page,
    name: 'create_thread',
    args: { cwd, title: TITLE, model: { provider: 'commandcode_work', model: 'gpt-6-luna' }, prompt: `[[answer ${ANSWER}]]` },
    output: Schema.Struct({ sessionId: Schema.String }),
  })
  threads.set(page, created.sessionId)
  const waited = await callTool({
    page,
    name: 'wait_for_turn',
    args: { sessionId: created.sessionId, timeoutMs: 60_000 },
    output: Schema.Struct({ status: Schema.String }),
  })
  expect(waited).toEqual({ status: 'idle' })
})

Then('the MCP client lists the thread and reads the answer to its prompt', async ({ page }: { page: Page }) => {
  const sessionId = threads.get(page)
  if (sessionId === undefined) throw new Error('No thread was started over MCP in this scenario.')
  await recordAssertion(page, 'mcp-endpoint-lists-and-reads-thread', async () => {
    const listed = await callTool({
      page,
      name: 'list_threads',
      args: {},
      output: Schema.Struct({ threads: Schema.Array(Schema.Struct({ sessionId: Schema.String, title: Schema.optional(Schema.String) })) }),
    })
    expect(listed.threads).toContainEqual(expect.objectContaining({ sessionId, title: TITLE }))
    const read = await callTool({
      page,
      name: 'read_thread',
      args: { sessionId },
      output: Schema.Struct({ entries: Schema.Array(Schema.Struct({ role: Schema.String, text: Schema.String })) }),
    })
    expect(read.entries.at(-1)).toEqual({ role: 'assistant', text: ANSWER })
  })
})

Then('the thread opens on that answer in the app', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'mcp-endpoint-thread-visible-in-app', async () => {
    const ungrouped = page.getByRole('treeitem', { name: 'Ungrouped', exact: true })
    if ((await ungrouped.isVisible().catch(() => false)) && (await ungrouped.getAttribute('aria-expanded')) !== 'true') await ungrouped.click()
    const row = page.getByRole('treeitem', { name: new RegExp(TITLE, 'u') }).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.click()
    await expect(page.getByText(ANSWER, { exact: true })).toBeVisible({ timeout: 30_000 })
  })
  await finishJourneyAssertions(page)
})

const paletteDialog = (page: Page) => page.getByRole('dialog', { name: 'Command palette' })

When('the MCP endpoint palette command is run from the keyboard', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Meta+Shift+P')
  await expect(paletteDialog(page)).toBeVisible()
  await paletteDialog(page).getByRole('combobox').fill('MCP endpoint: connect a client')
  await expect(
    paletteDialog(page)
      .getByRole('option', { name: /MCP endpoint: connect a client/u })
      .first(),
  ).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(paletteDialog(page)).toBeHidden()
})

Then('the MCP endpoint settings show client setup with no token and generate token is keyboard reachable', async ({ page }: { page: Page }) => {
  const settings = settingsPage(page)
  await recordAssertion(page, 'mcp-endpoint-palette-opens-client-setup', async () => {
    await expect(settings.getByRole('tab', { name: 'Claude Code' })).toBeVisible()
    await expect(settings.getByText('dshmcp_', { exact: false })).toHaveCount(0)
  })
  await recordAssertion(page, 'mcp-endpoint-settings-generate-token-keyboard-reachable', async () => {
    for (let press = 0; press < 80; press++) {
      await page.keyboard.press('Tab')
      const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
      if (focused === 'Generate token') return
    }
    throw new Error('Tab never reached the Generate token control inside Settings › MCP endpoint.')
  })
  await finishJourneyAssertions(page)
})
