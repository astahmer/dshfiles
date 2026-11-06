import { expect, type Page } from '@playwright/test'
import { PassThrough } from 'node:stream'
import * as Schema from 'effect/Schema'
import { ApiChannelModel } from '../../../packages/dshx/src/api/channel.js'
import { ApiProtocolModel } from '../../../packages/dshx/src/api/common.js'
import { runCli } from '../../../packages/dshx/src/cli/run.js'
import { decodeJson } from '../../../packages/dshx/src/json.js'
import { connectDshxApi } from '../../../packages/dshx/src/platform/dshx-api.js'
import { Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'
import { createScratchDirectory } from '../threads.js'

const TITLE = 'Driven by a plugin'
const FIRST_ANSWER = 'Started through the sessions API'
const WOKEN_ANSWER = 'Woken by a plugin message'
const INSTRUCTION = 'SESSIONS-API-E2E-INSTRUCTION: keep answers short.'
/** A fallback Command Code model the fake provider serves, distinct from the thread's `gpt-6-luna`. */
const PICKED_MODEL = { provider: 'commandcode_work', model: 'deepseek/deepseek-v4-flash' }

const threads = new WeakMap<Page, string>()

const modelSelectionSchema = Schema.Struct({ provider: Schema.String, model: Schema.String, reasoningEffort: Schema.optional(Schema.String) })
const defaultsBeforeSelect = new WeakMap<Page, typeof modelSelectionSchema.Type>()
const cliEnvelope = <Data extends Schema.Top>(data: Data) => Schema.Struct({ ok: Schema.Literal(true), data })
const modelsListOutput = cliEnvelope(Schema.Struct({ default: modelSelectionSchema }))
const modelsSelectOutput = cliEnvelope(Schema.Struct({ sessionId: Schema.String, selected: modelSelectionSchema }))
const threadModelSnapshot = Schema.Struct({ selection: modelSelectionSchema })

/** Runs the real dshx CLI against this scenario's DSH and returns its JSON output; a failing command fails the step. */
const dshx = async (page: Page, args: readonly string[]): Promise<string> => {
  let stdout = ''
  let stderr = ''
  const out = new PassThrough().on('data', chunk => (stdout += String(chunk)))
  const err = new PassThrough().on('data', chunk => (stderr += String(chunk)))
  const exitCode = await runCli([...args, '--url', profileFor(page).url, '--json'], {
    io: { stdin: new PassThrough(), stdout: out, stderr: err },
    version: 'e2e',
  })
  expect(exitCode, `dshx ${args.join(' ')} failed: ${stdout}${stderr}`).toBe(0)
  return stdout
}

const defaultModel = async (page: Page) => decodeJson(modelsListOutput, await dshx(page, ['models', 'list'])).data.default

const rpcResultSchema = Schema.Struct({
  result: Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ output: Schema.Unknown }) }),
    Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ code: Schema.String, message: Schema.String }) }),
  ]),
})

/** One sessions API call exactly as another plugin's browser half makes it: a Connection RPC from the signed-in page. */
const callSessions = async (page: Page, method: string, input: unknown): Promise<unknown> => {
  const endpoint = `${ApiChannelModel.apiChannel('@dshfiles/session-controller', 'sessions').slice(1)}/${method}`
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
  const parsed = Schema.decodeUnknownSync(rpcResultSchema)(body).result
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
  const created = Schema.decodeUnknownSync(Schema.Struct({ sessionId: Schema.String }))(
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

When('dshx models select picks another Command Code model for that thread', async ({ page }: { page: Page }) => {
  const before = await defaultModel(page)
  expect(before).not.toMatchObject(PICKED_MODEL)
  defaultsBeforeSelect.set(page, before)
  const sessionId = sessionOf(page)
  const output = decodeJson(modelsSelectOutput, await dshx(page, ['models', 'select', '--session', sessionId, PICKED_MODEL.provider, PICKED_MODEL.model]))
  expect(output.data).toMatchObject({ sessionId, selected: PICKED_MODEL })
})

Then('that thread uses the picked model and the default model is unchanged', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'session-controller-cli-selects-thread-model', async () => {
    const call = await connectDshxApi({ url: profileFor(page).url, packageId: '@dshfiles/session-controller', apiId: 'thread-model', version: 1 })
    const snapshot = Schema.decodeUnknownSync(threadModelSnapshot)(await call('snapshot', { sessionId: sessionOf(page) }))
    expect(snapshot.selection).toMatchObject(PICKED_MODEL)
  })
  await recordAssertion(page, 'session-controller-cli-keeps-default-model', async () => {
    expect(await defaultModel(page)).toEqual(defaultsBeforeSelect.get(page))
  })
  await finishJourneyAssertions(page)
})
