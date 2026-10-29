import { createAdaptorServer } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import { Hono } from 'hono'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import { z } from 'zod'
import { decodeJson } from '../json.js'

/**
 * A loopback stand-in for Command Code, the one provider whose account base URL accepts a loopback address, so a
 * journey can drive real turns without a network or a subscription.
 *
 * The key decides the account: `-LIMITED` keys are rate limited on chat, `-BROKEN` keys fail the billing read,
 * `-EXHAUSTED` keys exercise quota recovery, and `-RESETTING` keys are exhausted until 5 seconds after their first turn,
 * then answer. Every other key reports a 75%-left session window and a
 * 10%-left weekly window. A turn answers `Answered by <key suffix>` unless its latest message carries a directive:
 * `[[call TOOL {json}]]` calls any tool; `[[once call TOOL {json}]]` calls it only on its first match; `[[read PATH]]`
 * and `[[memory_search QUERY]]` call tools; `[[empty]]` settles with reasoning but no answer; `[[hold]]` keeps the
 * turn running until `releaseHeldTurns`; `[[title NAME]]` sets the thread name; `[[answer TEXT]]` returns markdown;
 * the turn after a tool result answers `Tool finished.`.
 *
 * E2E journeys start it per page; `dshx dev`'s `tool-call-thread` seed runs it as its own process.
 */

/** The fake provider's model id; journeys and scratch use separate account route slugs. */
export const FAKE_COMMAND_CODE_MODEL_ID = 'gpt-6-luna'
export const FAKE_COMMAND_CODE_MODEL = `commandcode_work/${FAKE_COMMAND_CODE_MODEL_ID}`

const HOUR_MS = 3_600_000
const RESETTING_QUOTA_MS = 5_000
const TITLE_INSTRUCTION = 'Create a concise title for an AI coding-assistant session'
const RUNTIME_CONTEXT_PREFIXES = ['Current runtime context.', 'Time sampled while preparing turn ']

const isRuntimeContextMessage = (text: string): boolean => RUNTIME_CONTEXT_PREFIXES.some(prefix => text.startsWith(prefix))

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

export interface FakeCommandCodeState {
  readonly requests: FakeChatRequest[]
  readonly held: Set<() => void>
  readonly oneShotCalls: Set<string>
  readonly quotaResetsAt: Map<string, number>
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

type ChatCompletionResult =
  | { readonly kind: 'response'; readonly response: Response }
  | { readonly kind: 'stream'; readonly delta: ChatDelta; readonly delayBetweenWordsMs: number }
  | { readonly kind: 'held' }

let completionSequence = 0

const writeStreamAnswer = async (stream: SSEStreamingApi, delta: ChatDelta, delayBetweenWordsMs = 0): Promise<void> => {
  const id = `fake-${String(++completionSequence).padStart(6, '0')}`
  const created = Math.floor(Date.now() / 1000)
  const chunk = (body: ChatDelta, finishReason: string | null): string =>
    JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model: 'fake',
      choices: [{ index: 0, delta: body, finish_reason: finishReason }],
    })
  const contentChunks = delayBetweenWordsMs > 0 && typeof delta.content === 'string' ? (delta.content.match(/\S+\s*/gu) ?? [delta.content]) : undefined
  if (contentChunks === undefined) {
    await stream.writeSSE({ data: chunk({ role: 'assistant', ...delta }, null) })
  } else {
    for (const [index, content] of contentChunks.entries()) {
      await stream.writeSSE({ data: chunk(index === 0 ? { role: 'assistant', content } : { content }, null) })
      if (index < contentChunks.length - 1) await new Promise<void>(resolveDelay => setTimeout(resolveDelay, delayBetweenWordsMs))
    }
  }
  await stream.writeSSE({ data: chunk({}, delta.tool_calls === undefined ? 'stop' : 'tool_calls') })
  await stream.writeSSE({ data: '[DONE]' })
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

const streamAnswer = (delta: ChatDelta, delayBetweenWordsMs = 0): ChatCompletionResult => ({ kind: 'stream', delta, delayBetweenWordsMs })
const responseAnswer = <Payload>(payload: Payload, status: number): ChatCompletionResult => ({ kind: 'response', response: Response.json(payload, { status }) })

const chatCompletionResponse = (input: { readonly state: FakeCommandCodeState; readonly key: string; readonly body: unknown }): ChatCompletionResult => {
  const parsed = chatRequestSchema.safeParse(input.body)
  if (!parsed.success) return responseAnswer({ error: 'unexpected chat request' }, 400)

  const messages = parsed.data.messages.map(message => ({ role: message.role, text: message.content }))
  const kind = messages.some(message => message.text.startsWith(TITLE_INSTRUCTION)) ? 'title' : 'turn'
  input.state.requests.push({ key: input.key, kind, messages })

  if (kind === 'title') {
    const named = /\[\[title ([^\]]+)\]\]/.exec(messages.map(message => message.text).join('\n'))
    return streamAnswer({ content: named?.[1] ?? 'Fake thread title' })
  }
  if (input.key.endsWith('-MISSING'))
    return responseAnswer({ error: { code: 'MISSING_CREDENTIAL', message: 'The fake account has no usable credential.', type: 'authentication_error' } }, 401)
  if (input.key.endsWith('-LIMITED')) return responseAnswer({ error: { message: 'Rate limit reached', type: 'rate_limit_error' } }, 429)
  if (input.key.endsWith('-RESETTING') && kind === 'turn') {
    const resetsAt = input.state.quotaResetsAt.get(input.key) ?? Date.now() + RESETTING_QUOTA_MS
    input.state.quotaResetsAt.set(input.key, resetsAt)
    if (Date.now() < resetsAt)
      return responseAnswer({ error: { message: 'Usage limit reached for this account.', type: 'insufficient_quota', code: 'USAGE_LIMIT_REACHED' } }, 400)
  }
  if (input.key.endsWith('-EXHAUSTED'))
    return responseAnswer({ error: { message: 'Usage limit reached for this account.', type: 'insufficient_quota', code: 'USAGE_LIMIT_REACHED' } }, 400)

  // DSH can append project and runtime context after the user's tool directive.
  const last = messages.filter(message => !isRuntimeContextMessage(message.text)).at(-1)
  const lastAssistantIndex = messages.findLastIndex(message => message.role === 'assistant' || message.role === 'tool')
  const hasDirective = /\[\[(?:stream|empty|hold|answer|(?:once )?call|read|memory_search)\b/
  const directiveMessage = messages
    .slice(lastAssistantIndex + 1)
    .findLast(message => message.role === 'user' && !isRuntimeContextMessage(message.text) && hasDirective.test(message.text))
  const lastUser = messages.filter(message => message.role === 'user' && !isRuntimeContextMessage(message.text)).at(-1)
  const directiveText = directiveMessage?.text ?? lastUser?.text ?? last?.text ?? ''
  const streamDirective = /\[\[stream (\d+)\]\]/.exec(directiveText)
  const parsedDelay = streamDirective === null ? null : z.number().int().min(1).max(250).safeParse(Number(streamDirective[1]))
  if (parsedDelay !== null && !parsedDelay.success) return responseAnswer({ error: { message: 'Stream delay must be between 1 and 250 ms.' } }, 400)
  const streamDelayMs = parsedDelay?.success === true ? parsedDelay.data : 0
  if (last?.role === 'tool') return streamAnswer({ content: 'Tool finished.' })
  if (directiveText.includes('[[empty]]')) return streamAnswer({ reasoning_content: 'Thinking without an answer.' })
  if (directiveText.includes('[[hold]]')) return { kind: 'held' }

  const answer = /\[\[answer ([\s\S]+?)\]\]/.exec(directiveText)
  if (answer?.[1] !== undefined) return streamAnswer({ content: answer[1] }, streamDelayMs)

  const calls = [...directiveText.matchAll(/\[\[(once )?call (\w+) (\{.*?\})\]\]/g)].flatMap(match => {
    const directive = match[0] ?? ''
    if (match[1] !== undefined) {
      if (input.state.oneShotCalls.has(directive)) return []
      input.state.oneShotCalls.add(directive)
    }
    const rawArguments = match[3] ?? '{}'
    const argumentsJson = rawArguments.startsWith(String.raw`{\"`) ? decodeJson(z.string(), `"${rawArguments}"`) : rawArguments
    return [{ name: match[2] ?? '', argumentsJson }]
  })
  if (calls.length > 0) return streamAnswer(toolCalls(calls))

  const read = /\[\[read ([^\]]+)\]\]/.exec(directiveText)
  if (read?.[1] !== undefined) return streamAnswer(toolCall('read', JSON.stringify({ file_path: read[1] })))

  const search = /\[\[memory_search ([^\]]+?)(?: in ([a-z-]+))?\]\]/.exec(directiveText)
  if (search?.[1] !== undefined)
    return streamAnswer(toolCall('memory_search', JSON.stringify(search[2] === undefined ? { query: search[1] } : { query: search[1], scope: search[2] })))

  return streamAnswer({ content: `Answered by ${input.key.slice(-6)}` }, streamDelayMs)
}

export const createFakeCommandCodeApp = (state: FakeCommandCodeState): Hono => {
  const app = new Hono()

  app.get('/alpha/billing/credits', context => {
    const key = (context.req.header('authorization') ?? '').replace(/^Bearer /, '')
    if (key.endsWith('-BROKEN')) return context.json({ error: 'billing unavailable' }, 503)
    const quotaResetsAt = state.quotaResetsAt.get(key)
    const resetting = quotaResetsAt !== undefined && Date.now() < quotaResetsAt
    const weeklyUsed = key.endsWith('-EXHAUSTED') || resetting ? 100 : 90
    return context.json({
      windowLimits: {
        fiveHour: { used: 25, cap: 100, resetAt: Date.now() + HOUR_MS },
        weekly: { used: weeklyUsed, cap: 100, resetAt: resetting ? quotaResetsAt : Date.now() + 72 * HOUR_MS },
      },
      credits: { planId: 'individual-pro' },
    })
  })

  app.get('/alpha/whoami', context => {
    const key = (context.req.header('authorization') ?? '').replace(/^Bearer /, '')
    return context.json({ user: { userName: `fake-${key.slice(-6)}` } })
  })
  app.get('/alpha/billing/subscriptions', context => context.json({ data: { planId: 'individual-pro', status: 'active' } }))
  app.get('/provider/v1/models', context => context.json({ data: [] }))
  app.post('/provider/v1/chat/completions', async context => {
    const key = (context.req.header('authorization') ?? '').replace(/^Bearer /, '')
    const body = await context.req.json().catch(() => undefined)
    const result = chatCompletionResponse({ state, key, body })
    if (result.kind === 'response') return result.response

    return streamSSE(context, async stream => {
      if (result.kind === 'held') {
        if (stream.aborted) return
        await new Promise<void>(resolve => {
          const release = (): void => {
            state.held.delete(release)
            resolve()
          }
          state.held.add(release)
          stream.onAbort(() => {
            state.held.delete(release)
            resolve()
          })
        })
        if (stream.aborted) return
        await writeStreamAnswer(stream, { content: 'Held turn released.' })
        return
      }

      await writeStreamAnswer(stream, result.delta, result.delayBetweenWordsMs)
    })
  })
  app.notFound(context => context.json({ error: 'not found' }, 404))

  return app
}

interface ListenableServer {
  once(event: 'error', listener: (error: Error) => void): ListenableServer
  off(event: 'error', listener: (error: Error) => void): ListenableServer
  listen(port: number, host: string, listener: () => void): ListenableServer
  address(): AddressInfo | string | null
  close(listener: () => void): ListenableServer
  closeAllConnections?(): void
}

const listen = (server: ListenableServer): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

/** Listens on a free loopback port until `close`. */
export const startFakeCommandCode = async (): Promise<FakeCommandCode> => {
  const state: FakeCommandCodeState = { requests: [], held: new Set(), oneShotCalls: new Set(), quotaResetsAt: new Map() }
  const server: ListenableServer = createAdaptorServer({ fetch: createFakeCommandCodeApp(state).fetch })
  await listen(server)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('The fake Command Code server has no port.')

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    requests: state.requests,
    releaseHeldTurns: () => {
      for (const release of [...state.held]) release()
    },
    close: async () => {
      if (server.closeAllConnections !== undefined) server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      state.held.clear()
    },
  }
}
