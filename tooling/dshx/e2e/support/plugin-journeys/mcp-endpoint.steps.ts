import { expect, type Page } from '@playwright/test'
import { z } from 'zod'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, openSettingsDialog, recordAssertion } from '../steps.js'
import { createScratchDirectory } from '../threads.js'

const TITLE = 'Started from an outside agent'
const ANSWER = 'Answered for the MCP client'

const tokens = new WeakMap<Page, string>()
const threads = new WeakMap<Page, string>()

const settingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true })
const endpointOf = (page: Page): string => `${new URL(page.url()).origin}/mcp`

const toolArgumentsSchema = z.record(z.string(), z.json())

const toolResultSchema = z.object({
  result: z.object({ content: z.array(z.object({ type: z.literal('text'), text: z.string() })), isError: z.boolean().optional() }),
})

/** One MCP tools/call from this Node process, as Claude Code sends it: no cookie, only the bearer header. */
const callTool = async <Output>(input: {
  readonly page: Page
  readonly name: string
  readonly args: z.infer<typeof toolArgumentsSchema>
  readonly output: z.ZodType<Output>
}): Promise<Output> => {
  const token = tokens.get(input.page)
  if (token === undefined) throw new Error('No MCP token was generated in this scenario.')
  const response = await fetch(endpointOf(input.page), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: input.name, arguments: input.args } }),
  })
  expect(response.status).toBe(200)
  const parsed = toolResultSchema.parse(await response.json()).result
  const text = parsed.content[0]?.text ?? ''
  if (parsed.isError === true) throw new Error(`${input.name} failed: ${text}`)
  return input.output.parse(JSON.parse(text))
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
    output: z.object({ sessionId: z.string() }),
  })
  threads.set(page, created.sessionId)
  const waited = await callTool({
    page,
    name: 'wait_for_turn',
    args: { sessionId: created.sessionId, timeoutMs: 60_000 },
    output: z.object({ status: z.string() }),
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
      output: z.object({ threads: z.array(z.object({ sessionId: z.string(), title: z.string().optional() })) }),
    })
    expect(listed.threads).toContainEqual(expect.objectContaining({ sessionId, title: TITLE }))
    const read = await callTool({
      page,
      name: 'read_thread',
      args: { sessionId },
      output: z.object({ entries: z.array(z.object({ role: z.string(), text: z.string() })) }),
    })
    expect(read.entries.at(-1)).toEqual({ role: 'assistant', text: ANSWER })
  })
})

Then('the thread opens on that answer in the app', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'mcp-endpoint-thread-visible-in-app', async () => {
    const row = page.getByText(TITLE, { exact: true }).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.click()
    await expect(page.getByText(ANSWER, { exact: true })).toBeVisible({ timeout: 30_000 })
  })
  await finishJourneyAssertions(page)
})
