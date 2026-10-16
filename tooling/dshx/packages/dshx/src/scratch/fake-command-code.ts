import { createServer, type ServerResponse } from 'node:http'
import { json } from 'node:stream/consumers'
import { z } from 'zod'

/**
 * A loopback stand-in for Command Code, the one provider whose account base URL accepts a loopback address, so a
 * journey can drive real turns without a network or a subscription.
 *
 * The key decides the account: `-LIMITED` keys are rate limited on chat, `-BROKEN` keys fail the billing read,
 * and `-EXHAUSTED` keys exercise quota recovery. Every other key reports a 75%-left session window and a
 * 10%-left weekly window. A turn answers `Answered by <key suffix>` unless its latest message carries a directive:
 * `[[call TOOL {json}]]` calls any tool; `[[once call TOOL {json}]]` calls it only on its first match; `[[read PATH]]`
 * and `[[memory_search QUERY]]` call tools; `[[empty]]` settles with reasoning but no answer; `[[hold]]` keeps the
 * turn running until `releaseHeldTurns`; `[[title NAME]]` sets the thread name; `[[answer TEXT]]` returns markdown;
 * the turn after a tool result answers `Tool finished.`.
 *
 * E2E journeys start it per page; `dshx dev`'s `tool-call-thread` seed runs it as its own process.
 */

/** The only model the fake provider advertises, so journeys and the scratch seed pick the same route. */
export const FAKE_COMMAND_CODE_MODEL = 'commandcode_work/gpt-6-luna'

const HOUR_MS = 3_600_000
const TITLE_INSTRUCTION = 'Create a concise title for an AI coding-assistant session'
const RUNTIME_CONTEXT = 'Current runtime context.'

const messageTextSchema = z
  .union([z.string(), z.array(z.object({ text: z.string().optional() }).passthrough()).transform(parts => parts.map(part => part.text ?? '').join(''))])
  .nullish()
  .transform(text => text ?? '')

const chatRequestSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: messageTextSchema }).passthrough()),
})

export interface FakeChatRequest {
  readonly key: string
  readonly kind: 'turn' | 'title'
  readonly messages: readonly { readonly role: string; readonly text: string }[]
}

export interface FakeCommandCode {
  readonly baseUrl: string
  readonly requests: FakeChatRequest[]
  /** Answers every turn held by a `[[hold]]` directive. */
  releaseHeldTurns(): void
  close(): Promise<void>
}

interface ToolCallDelta {
  readonly index: number
  readonly id: string
  readonly type: 'function'
  readonly function: { readonly name: string; readonly arguments: string }
}

/** One streamed assistant delta: text, reasoning, or tool calls. */
interface ChatDelta {
  readonly role?: 'assistant'
  readonly content?: string | null
  readonly reasoning_content?: string
  readonly tool_calls?: readonly ToolCallDelta[]
}

const streamAnswer = (response: ServerResponse, delta: ChatDelta): void => {
  const chunk = (body: ChatDelta, finishReason: string | null): string =>
    `data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', created: 1, model: 'fake', choices: [{ index: 0, delta: body, finish_reason: finishReason }] })}\n\n`
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.write(chunk({ role: 'assistant', ...delta }, null))
  response.write(chunk({}, delta.tool_calls === undefined ? 'stop' : 'tool_calls'))
  response.end('data: [DONE]\n\n')
}

/** `argumentsJson` is the raw JSON the model would stream for the call. */
const toolCalls = (calls: readonly { readonly name: string; readonly argumentsJson: string }[]): ChatDelta => ({
  content: null,
  tool_calls: calls.map((call, index) => ({
    index,
    id: `call_${String(index)}_${call.name}`,
    type: 'function',
    function: { name: call.name, arguments: call.argumentsJson },
  })),
})
const toolCall = (name: string, argumentsJson: string): ChatDelta => toolCalls([{ name, argumentsJson }])

/** Listens on a free loopback port until `close`. */
export const startFakeCommandCode = async (): Promise<FakeCommandCode> => {
  const requests: FakeChatRequest[] = []
  const held = new Set<ServerResponse>()
  const oneShotCalls = new Set<string>()
  const server = createServer((request, response) => {
    // Billing and model reads have no body; only a chat completion is decoded below.
    void json(request)
      .catch(() => undefined)
      .then(body => {
        const key = (request.headers.authorization ?? '').replace(/^Bearer /, '')
        const reply = (status: number, payload: string): void => {
          response.writeHead(status, { 'content-type': 'application/json' })
          response.end(payload)
        }
        if (request.url === '/alpha/billing/credits') {
          if (key.endsWith('-BROKEN')) return reply(503, JSON.stringify({ error: 'billing unavailable' }))
          const weeklyUsed = key.endsWith('-EXHAUSTED') ? 100 : 90
          return reply(
            200,
            JSON.stringify({
              windowLimits: {
                fiveHour: { used: 25, cap: 100, resetAt: Date.now() + HOUR_MS },
                weekly: { used: weeklyUsed, cap: 100, resetAt: Date.now() + 72 * HOUR_MS },
              },
              credits: { planId: 'individual-pro' },
            }),
          )
        }
        if (request.url === '/alpha/whoami') return reply(200, JSON.stringify({ user: { userName: `fake-${key.slice(-6)}` } }))
        if (request.url === '/alpha/billing/subscriptions') return reply(200, JSON.stringify({ data: { planId: 'individual-pro', status: 'active' } }))
        if (request.url === '/provider/v1/models') return reply(200, JSON.stringify({ data: [] }))
        if (request.url !== '/provider/v1/chat/completions') return reply(404, JSON.stringify({ error: 'not found' }))
        const parsed = chatRequestSchema.safeParse(body)
        if (!parsed.success) return reply(400, JSON.stringify({ error: 'unexpected chat request' }))
        const messages = parsed.data.messages.map(message => ({ role: message.role, text: message.content }))
        const kind = messages.some(message => message.text.startsWith(TITLE_INSTRUCTION)) ? 'title' : 'turn'
        requests.push({ key, kind, messages })
        if (kind === 'title') {
          const named = /\[\[title ([^\]]+)\]\]/.exec(messages.map(message => message.text).join('\n'))
          return streamAnswer(response, { content: named?.[1] ?? 'Fake thread title' })
        }
        if (key.endsWith('-LIMITED')) return reply(429, JSON.stringify({ error: { message: 'Rate limit reached', type: 'rate_limit_error' } }))
        if (key.endsWith('-EXHAUSTED')) {
          return reply(
            400,
            JSON.stringify({ error: { message: 'Usage limit reached for this account.', type: 'insufficient_quota', code: 'USAGE_LIMIT_REACHED' } }),
          )
        }
        // DSH appends its runtime-context snapshot after the user's message.
        const last = messages.filter(message => !message.text.startsWith(RUNTIME_CONTEXT)).at(-1)
        if (last?.role === 'tool') return streamAnswer(response, { content: 'Tool finished.' })
        if (last?.text.includes('[[empty]]') === true) return streamAnswer(response, { reasoning_content: 'Thinking without an answer.' })
        if (last?.text.includes('[[hold]]') === true) {
          held.add(response)
          return
        }
        const answer = /\[\[answer ([^\]]+)\]\]/.exec(last?.text ?? '')
        if (answer?.[1] !== undefined) return streamAnswer(response, { content: answer[1] })
        const calls = [...(last?.text ?? '').matchAll(/\[\[(once )?call (\w+) (\{.*?\})\]\]/g)].flatMap(match => {
          const directive = match[0] ?? ''
          if (match[1] !== undefined) {
            if (oneShotCalls.has(directive)) return []
            oneShotCalls.add(directive)
          }
          const rawArguments = match[3] ?? '{}'
          const argumentsJson = rawArguments.startsWith(String.raw`{\"`) ? z.string().parse(JSON.parse(`"${rawArguments}"`)) : rawArguments
          return [{ name: match[2] ?? '', argumentsJson }]
        })
        if (calls.length > 0) return streamAnswer(response, toolCalls(calls))
        const read = /\[\[read ([^\]]+)\]\]/.exec(last?.text ?? '')
        if (read?.[1] !== undefined) return streamAnswer(response, toolCall('read', JSON.stringify({ file_path: read[1] })))
        const search = /\[\[memory_search ([^\]]+?)(?: in ([a-z-]+))?\]\]/.exec(last?.text ?? '')
        if (search?.[1] !== undefined) {
          return streamAnswer(
            response,
            toolCall('memory_search', JSON.stringify(search[2] === undefined ? { query: search[1] } : { query: search[1], scope: search[2] })),
          )
        }
        return streamAnswer(response, { content: `Answered by ${key.slice(-6)}` })
      })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = z.object({ port: z.number() }).safeParse(server.address())
  if (!address.success) throw new Error('The fake Command Code server has no port.')
  const fake: FakeCommandCode = {
    baseUrl: `http://127.0.0.1:${String(address.data.port)}`,
    requests,
    releaseHeldTurns: () => {
      for (const response of held) streamAnswer(response, { content: 'Held turn released.' })
      held.clear()
    },
    close: async () => {
      for (const response of held) response.destroy()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
  return fake
}
