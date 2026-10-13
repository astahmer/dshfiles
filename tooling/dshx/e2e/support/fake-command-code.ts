import type { Page } from '@playwright/test'
import { createServer, type ServerResponse } from 'node:http'
import { z } from 'zod'

/**
 * A loopback stand-in for Command Code, the one provider whose account base URL accepts a loopback address, so a
 * journey can drive real turns without a network or a subscription.
 *
 * The key decides the account: `-LIMITED` keys are rate limited on chat, `-BROKEN` keys fail the billing read, and
 * every other key reports a 75%-left session window and a 10%-left weekly window. A turn answers `Answered by <key
 * suffix>` unless its latest message carries a directive: `[[read PATH]]` calls the read tool and
 * `[[memory_search QUERY]]` or `[[memory_search QUERY in SCOPE]]` calls the memory search tool; the turn after a tool
 * result answers `Tool finished.`. OptMem summary calls answer, fail or hang as `summaries` says.
 */

const HOUR_MS = 3_600_000
const SUMMARY_INSTRUCTION = 'You maintain the long-term memory of a software engineering assistant.'
const TITLE_INSTRUCTION = 'Create a concise title for an AI coding-assistant session'
const RUNTIME_CONTEXT = 'Current runtime context.'

const chatRequestSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown() }).passthrough()),
})

export interface FakeChatRequest {
  readonly key: string
  readonly kind: 'turn' | 'summary' | 'title'
  readonly messages: readonly { readonly role: string; readonly text: string }[]
}

export interface FakeCommandCode {
  readonly baseUrl: string
  readonly requests: FakeChatRequest[]
  summaries: 'answer' | 'fail' | 'hang'
  close(): Promise<void>
}

const fakes = new WeakMap<Page, FakeCommandCode>()

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => (typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string' ? part.text : '')).join('')
}

const streamAnswer = (response: ServerResponse, delta: object): void => {
  const chunk = (body: object, finishReason: string | null): string =>
    `data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', created: 1, model: 'fake', choices: [{ index: 0, delta: body, finish_reason: finishReason }] })}\n\n`
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.write(chunk({ role: 'assistant', ...delta }, null))
  response.write(chunk({}, 'tool_calls' in delta ? 'tool_calls' : 'stop'))
  response.end('data: [DONE]\n\n')
}

const toolCall = (name: string, args: object): object => ({
  content: null,
  tool_calls: [{ index: 0, id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
})

export const startFakeCommandCode = async (page: Page): Promise<FakeCommandCode> => {
  const requests: FakeChatRequest[] = []
  const hanging = new Set<ServerResponse>()
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => {
      const key = (request.headers.authorization ?? '').replace(/^Bearer /, '')
      const json = (status: number, value: unknown): void => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(value))
      }
      if (request.url === '/alpha/billing/credits') {
        if (key.endsWith('-BROKEN')) return json(503, { error: 'billing unavailable' })
        return json(200, {
          windowLimits: { fiveHour: { used: 25, cap: 100, resetAt: Date.now() + HOUR_MS }, weekly: { used: 90, cap: 100, resetAt: Date.now() + 72 * HOUR_MS } },
          credits: { planId: 'individual-pro' },
        })
      }
      if (request.url === '/alpha/whoami') return json(200, { user: { userName: `fake-${key.slice(-6)}` } })
      if (request.url === '/alpha/billing/subscriptions') return json(200, { data: { planId: 'individual-pro', status: 'active' } })
      if (request.url === '/provider/v1/models') return json(200, { data: [] })
      if (request.url !== '/provider/v1/chat/completions') return json(404, { error: 'not found' })
      const parsed = chatRequestSchema.safeParse(JSON.parse(body))
      if (!parsed.success) return json(400, { error: 'unexpected chat request' })
      const messages = parsed.data.messages.map(message => ({ role: message.role, text: textOf(message.content) }))
      const kind = messages.some(message => message.text.startsWith(SUMMARY_INSTRUCTION))
        ? 'summary'
        : messages.some(message => message.text.startsWith(TITLE_INSTRUCTION))
          ? 'title'
          : 'turn'
      requests.push({ key, kind, messages })
      if (kind === 'summary') {
        if (fake.summaries === 'fail') return json(500, { error: { message: 'summary model unavailable', type: 'server_error' } })
        if (fake.summaries === 'hang') {
          hanging.add(response)
          return
        }
        return streamAnswer(response, { content: 'Memory note written by the fake summarizer.' })
      }
      if (kind === 'title') return streamAnswer(response, { content: 'Fake thread title' })
      if (key.endsWith('-LIMITED')) return json(429, { error: { message: 'Rate limit reached', type: 'rate_limit_error' } })
      // DSH appends its runtime-context snapshot after the user's message.
      const last = messages.filter(message => !message.text.startsWith(RUNTIME_CONTEXT)).at(-1)
      if (last?.role === 'tool') return streamAnswer(response, { content: 'Tool finished.' })
      const read = /\[\[read ([^\]]+)\]\]/.exec(last?.text ?? '')
      if (read?.[1] !== undefined) return streamAnswer(response, toolCall('read', { file_path: read[1] }))
      const search = /\[\[memory_search ([^\]]+?)(?: in ([a-z-]+))?\]\]/.exec(last?.text ?? '')
      if (search?.[1] !== undefined) {
        return streamAnswer(response, toolCall('memory_search', search[2] === undefined ? { query: search[1] } : { query: search[1], scope: search[2] }))
      }
      return streamAnswer(response, { content: `Answered by ${key.slice(-6)}` })
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('The fake Command Code server has no port.')
  const fake: FakeCommandCode = {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    requests,
    summaries: 'answer',
    close: async () => {
      for (const response of hanging) response.destroy()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
  fakes.set(page, fake)
  return fake
}

export const fakeCommandCodeFor = (page: Page): FakeCommandCode => {
  const fake = fakes.get(page)
  if (fake === undefined) throw new Error('The fake Command Code server was not started for this scenario.')
  return fake
}

export const stopFakeCommandCode = async (page: Page): Promise<void> => {
  const fake = fakes.get(page)
  if (fake === undefined) return
  fakes.delete(page)
  await fake.close()
}
