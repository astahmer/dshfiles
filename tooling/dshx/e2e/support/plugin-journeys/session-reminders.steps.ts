import { expect, type Page } from '@playwright/test'
import * as Schema from 'effect/Schema'
import { ApiChannelModel } from '../../../packages/dshx/src/api/channel.js'
import { Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory } from '../threads.js'

/** No fake-provider directive in it, so the delivered turn gets the fake's default answer. */
const REMINDER_PROMPT = 'REMINDER-PING-E2E'

const threads = new WeakMap<Page, string>()

const rpcResultSchema = Schema.Struct({
  result: Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ output: Schema.Unknown }) }),
    Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ code: Schema.String, message: Schema.String }) }),
  ]),
})

/** A sessions API call from the signed-in page, as session-controller.steps.ts makes it. */
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

When('a thread asks the model to create a reminder due in 5 seconds', async ({ page }: { page: Page }) => {
  const cwd = await createScratchDirectory('dshx-session-reminders-e2e-')
  const args = JSON.stringify({ title: 'E2E reminder', prompt: REMINDER_PROMPT, after_seconds: 5 })
  const created = Schema.decodeUnknownSync(Schema.Struct({ sessionId: Schema.String }))(
    await callSessions(page, 'create', {
      cwd,
      title: 'Reminder thread',
      model: { provider: 'commandcode_work', model: 'gpt-6-luna' },
      prompt: `[[once call schedule_create ${args}]]`,
    }),
  )
  threads.set(page, created.sessionId)
  expect(await callSessions(page, 'wait', { sessionId: created.sessionId, timeoutMs: 60_000 })).toEqual({ status: 'idle' })
})

Then('the reminder prompt reaches the model as a new turn of that thread', async ({ page }: { page: Page }) => {
  const sessionId = threads.get(page)
  if (sessionId === undefined) throw new Error('No reminder thread was started in this scenario.')
  await recordAssertion(page, 'session-reminder-delivered-to-its-thread', async () => {
    const turns = () => fakeCommandCodeFor(page).requests.filter(request => request.kind === 'turn')
    // The tool call answered first, so the schedule existed; the reminder turn's last user message is its prompt.
    expect(turns().some(request => request.messages.some(message => message.role === 'tool'))).toBe(true)
    await expect
      .poll(
        () =>
          turns().some(
            request =>
              request.messages
                .filter(message => message.role === 'user')
                .at(-1)
                ?.text.includes(REMINDER_PROMPT) === true,
          ),
        {
          timeout: 60_000,
        },
      )
      .toBe(true)
    // The same thread: the delivered turn still carries the original tool directive in its history.
    const delivered = turns().find(
      request =>
        request.messages
          .filter(message => message.role === 'user')
          .at(-1)
          ?.text.includes(REMINDER_PROMPT) === true,
    )
    expect(delivered?.messages.some(message => message.text.includes('schedule_create'))).toBe(true)
    expect(await callSessions(page, 'wait', { sessionId, timeoutMs: 60_000 })).toEqual({ status: 'idle' })
  })
  await finishJourneyAssertions(page)
})
