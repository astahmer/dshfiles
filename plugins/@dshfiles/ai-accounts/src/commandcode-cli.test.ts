import type { AssistantMessageEvent, Message } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import { streamCommandCodeCli } from './commandcode-cli.js'
import { createCommandCodeProvider } from './commandcode-provider.js'

const ndjson = (...parts: readonly Record<string, unknown>[]): string => parts.map(part => JSON.stringify(part)).join('\n')

const run = async (input: {
  readonly modelId?: string
  readonly messages?: readonly Message[]
  readonly reasoning?: 'low' | 'high' | 'max'
  readonly sessionId?: string
  readonly respond: () => Response
}) => {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = []
  const stubFetch = async (resource: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(resource, init)
    requests.push({ url: request.url, headers: request.headers, body: JSON.parse(await request.text()) })
    return input.respond()
  }
  const model = createCommandCodeProvider().describeModel(input.modelId ?? 'gpt-6-luna')
  const stream = streamCommandCodeCli({
    root: 'https://api.commandcode.ai',
    model,
    context: { messages: input.messages ?? [{ role: 'user', content: 'hi', timestamp: 0 }] } as never,
    options: {
      apiKey: 'test-key',
      fetch: stubFetch as typeof fetch,
      headers: { 'user-agent': 'dsh-test', 'x-dropped': null },
      ...(input.reasoning === undefined ? {} : { reasoning: input.reasoning }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    },
  })
  const events: AssistantMessageEvent[] = []
  for await (const event of stream) events.push(event)
  return { requests, events, settled: await stream.result() }
}

const answer = () => new Response(ndjson({ type: 'text-delta', text: 'ok' }, { type: 'finish', finishReason: 'stop' }), { status: 200 })

describe('Command Code CLI request', () => {
  it('posts the CLI body with the bearer key and the version header', async () => {
    const { requests } = await run({ respond: answer, sessionId: 'session-abc' })
    const request = requests[0]
    expect(request?.url).toBe('https://api.commandcode.ai/alpha/generate')
    expect(request?.headers.get('authorization')).toBe('Bearer test-key')
    expect(request?.headers.get('x-command-code-version')).toBe('1.74.1')
    expect(request?.headers.get('user-agent')).toBe('dsh-test')
    expect(request?.headers.has('x-dropped')).toBe(false)
    expect(request?.body).toMatchObject({
      config: { workingDir: '.', structure: [], isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] },
      memory: null,
      params: { model: 'gpt-6-luna', stream: true, max_tokens: 131_072, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
    })
    expect(request?.body.threadId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('keeps one thread id per session', async () => {
    const first = await run({ respond: answer, sessionId: 'session-abc' })
    const second = await run({ respond: answer, sessionId: 'session-abc' })
    expect(first.requests[0]?.body.threadId).toBe(second.requests[0]?.body.threadId)
  })

  it('sends the chosen effort as the CLI wire value and none when no effort is chosen', async () => {
    const chosen = await run({ respond: answer, reasoning: 'max', modelId: 'deepseek/deepseek-v4-flash' })
    expect(chosen.requests[0]?.body.params).toMatchObject({ reasoning_effort: 'max' })
    const unchosen = await run({ respond: answer })
    expect(unchosen.requests[0]?.body.params).not.toHaveProperty('reasoning_effort')
  })

  it('sends only answered tool calls, aliases overlong ids, and carries tool images in a user message', async () => {
    const longId = `call_${'x'.repeat(80)}`
    const messages = [
      { role: 'system', content: 'be brief', timestamp: 0 },
      { role: 'user', content: 'look', timestamp: 0 },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'plan' },
          { type: 'toolCall', id: longId, name: 'read_image', arguments: { path: 'a.png' } },
          { type: 'toolCall', id: 'orphan', name: 'never_answered', arguments: {} },
        ],
        api: 'commandcode',
        provider: 'commandcode',
        model: 'gpt-6-luna',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'toolUse',
        timestamp: 0,
      },
      { role: 'toolResult', toolCallId: longId, toolName: 'read_image', content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }], isError: false, timestamp: 0 },
    ] as Message[]
    const { requests } = await run({ respond: answer, messages })
    const params = requests[0]?.body.params as { messages: unknown; system: unknown }
    expect(params.system).toEqual([{ type: 'text', text: 'be brief', cache_control: { type: 'ephemeral' } }])
    expect(params.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'look' }] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'plan' },
          { type: 'tool-call', toolCallId: 'cc-1', toolName: 'read_image', input: { path: 'a.png' } },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'cc-1', toolName: 'read_image', output: { type: 'text', value: '(image returned; see the attached image)' } }],
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Attached image(s) from tool result (cc-1):' },
          { type: 'image', image: 'data:image/png;base64,AAAA', mimeType: 'image/png' },
        ],
      },
    ])
  })
})

describe('Command Code CLI stream', () => {
  it('turns reasoning, text, a tool call and usage into pi-ai events', async () => {
    const body = ndjson(
      { type: 'start' },
      { type: 'reasoning-start' },
      { type: 'reasoning-delta', text: 'thin' },
      { type: 'reasoning-delta', text: 'king' },
      { type: 'reasoning-end' },
      { type: 'text-delta', text: 'calling' },
      { type: 'tool-input-start', id: 'call_1', toolName: 'get_time' },
      { type: 'tool-call', toolCallId: 'call_1', toolName: 'get_time', input: { city: 'Paris' } },
      { type: 'cache-write-tokens', cacheWriteTokens: 40 },
      {
        type: 'finish',
        finishReason: 'tool-calls',
        totalUsage: { inputTokens: 1000, outputTokens: 20, reasoningTokens: 5, inputTokenDetails: { noCacheTokens: 60, cacheReadTokens: 900 } },
      },
    )
    // Split mid-line to prove lines are reassembled across network chunks.
    const encoded = new TextEncoder().encode(body)
    const halves = [encoded.slice(0, 50), encoded.slice(50)]
    const { events, settled } = await run({
      respond: () =>
        new Response(
          new ReadableStream({
            start: controller => {
              for (const half of halves) controller.enqueue(half)
              controller.close()
            },
          }),
          { status: 200 },
        ),
    })
    expect(events.map(event => event.type)).toEqual([
      'start',
      'thinking_start',
      'thinking_delta',
      'thinking_delta',
      'thinking_end',
      'text_start',
      'text_delta',
      'text_end',
      'toolcall_start',
      'toolcall_delta',
      'toolcall_end',
      'done',
    ])
    expect(settled.content).toEqual([
      { type: 'thinking', thinking: 'thinking' },
      { type: 'text', text: 'calling' },
      { type: 'toolCall', id: 'call_1', name: 'get_time', arguments: { city: 'Paris' } },
    ])
    expect(settled.stopReason).toBe('toolUse')
    expect(settled.usage).toMatchObject({ input: 60, output: 20, cacheRead: 900, cacheWrite: 40, reasoning: 5 })
  })

  it('reports an HTTP refusal with its status first, so DSH can classify it', async () => {
    const { settled } = await run({ respond: () => Response.json({ success: false, error: { code: 'RATE_LIMITED', message: 'slow down' } }, { status: 429 }) })
    expect(settled.stopReason).toBe('error')
    expect(settled.errorMessage).toBe('429 Command Code /alpha/generate: RATE_LIMITED: slow down')
  })

  it('reports an in-stream error event', async () => {
    const { settled } = await run({ respond: () => new Response(ndjson({ type: 'text-delta', text: 'pa' }, { type: 'error', error: { message: 'upstream overloaded', statusCode: 503 } }), { status: 200 }) })
    expect(settled.errorMessage).toBe('503 upstream overloaded')
  })

  it('fails a stream that ends without a finish event', async () => {
    const { settled } = await run({ respond: () => new Response(ndjson({ type: 'text-delta', text: 'pa' }), { status: 200 }) })
    expect(settled.stopReason).toBe('error')
    expect(settled.errorMessage).toMatch(/stream ended without/)
  })
})
