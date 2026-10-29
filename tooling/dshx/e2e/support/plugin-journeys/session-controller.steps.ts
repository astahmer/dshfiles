import { expect, type Page } from '@playwright/test'
import { z } from 'zod'
import { ApiProtocolModel } from '../../../packages/dshx/src/api/common.js'
import { Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory } from '../threads.js'

const TITLE = 'Driven by a plugin'
const FIRST_ANSWER = 'Started through the sessions API'
const WOKEN_ANSWER = 'Woken by a plugin message'
const INSTRUCTION = 'SESSIONS-API-E2E-INSTRUCTION: keep answers short.'

const threads = new WeakMap<Page, string>()

const rpcResultSchema = z.object({
  result: z.union([
    z.object({ ok: z.literal(true), value: z.object({ output: z.unknown() }) }),
    z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
  ]),
})

/** One sessions API call exactly as another plugin's browser half makes it: a Connection RPC from the signed-in page. */
const callSessions = async (page: Page, method: string, input: unknown): Promise<unknown> => {
  const endpoint = `${ApiProtocolModel.apiChannel('@dshfiles/session-controller', 'sessions').slice(1)}/${method}`
  const body = await page.evaluate(
    async request => {
      const response = await fetch(`/api/${request.endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: request.endpoint, payload: { version: 1, input: request.input } }),
      })
      return response.json()
    },
    { endpoint, input },
  )
  const parsed = rpcResultSchema.parse(body).result
  if (!parsed.ok) throw new Error(`sessions.${method} failed (${parsed.error.code}): ${parsed.error.message}`)
  return parsed.value.output
}

const sessionOf = (page: Page): string => {
  const sessionId = threads.get(page)
  if (sessionId === undefined) throw new Error('No thread was started through the sessions API in this scenario.')
  return sessionId
}

const waitIdle = async (page: Page): Promise<void> => {
  expect(await callSessions(page, 'wait', { sessionId: sessionOf(page), timeoutMs: 60_000 })).toEqual({ status: 'idle' })
}

When('a plugin starts a titled thread with a first prompt through the sessions API', async ({ page }: { page: Page }) => {
  const cwd = await createScratchDirectory('dshx-sessions-api-e2e-')
  const created = z.object({ sessionId: z.string() }).parse(
    await callSessions(page, 'create', {
      cwd,
      title: TITLE,
      model: { provider: 'commandcode_work', model: 'gpt-6-luna' },
      prompt: `[[answer ${FIRST_ANSWER}]]`,
    }),
  )
  threads.set(page, created.sessionId)
  await waitIdle(page)
})

Then('the thread is listed and opens on the answer to that prompt', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'session-controller-api-thread-listed-with-answer', async () => {
    const row = page.getByText(TITLE, { exact: true }).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.click()
    await expect(page.getByText(FIRST_ANSWER, { exact: true })).toBeVisible({ timeout: 30_000 })
  })
})

When('the plugin adds an instruction and a message that wakes the thread', async ({ page }: { page: Page }) => {
  const sessionId = sessionOf(page)
  expect(await callSessions(page, 'setInstruction', { sessionId, key: 'e2e:tone', text: INSTRUCTION })).toEqual({
    entries: [{ key: 'e2e:tone', text: INSTRUCTION }],
  })
  await callSessions(page, 'message', { sessionId, text: `[[answer ${WOKEN_ANSWER}]]`, wake: true })
  await waitIdle(page)
})

Then('the woken turn answers in the open thread and its request carried the instruction', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'session-controller-api-message-wakes-thread', async () => {
    await expect(page.getByText(WOKEN_ANSWER, { exact: true })).toBeVisible({ timeout: 30_000 })
  })
  await recordAssertion(page, 'session-controller-api-instruction-reaches-model', async () => {
    const turns = fakeCommandCodeFor(page).requests.filter(request => request.kind === 'turn')
    const woken = turns.find(request => request.messages.some(message => message.text.includes(WOKEN_ANSWER)))
    const first = turns.find(request => request.messages.some(message => message.text.includes(FIRST_ANSWER)))
    expect(woken?.messages.some(message => message.text.includes(INSTRUCTION))).toBe(true)
    expect(first?.messages.some(message => message.text.includes(INSTRUCTION))).toBe(false)
  })
  await finishJourneyAssertions(page)
})
