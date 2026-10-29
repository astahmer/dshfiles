/**
 * The empty-response guard, and the failure that motivated it.
 *
 * `pi-ai-empty.test.ts` proves pi-ai's own transport settles a reasoning-only
 * response as `stopReason: 'stop'` with no answer. This proves our provider
 * boundary settles it with no content blocks at all, which DSH classifies as
 * `EMPTY_RESPONSE` (a code the profile's retry policy lists) instead of a
 * finished turn. Both transports are covered: the CLI endpoint and the
 * Provider API.
 *
 * No network: `fetch` is replaced with synthetic bodies, so every result comes
 * from the real transports plus our real wrapper.
 */
import { describe, expect, it } from 'vitest'
import { createCommandCodeProvider } from './commandcode-provider.js'
import { isEmptyCompletion, settlementAnswered } from './empty-response.js'

const frame = (delta: Record<string, unknown>, finish: string | null): string => {
  const chunk = {
    id: 'c1',
    object: 'chat.completion.chunk',
    model: 'stealth/space-bunny-alpha',
    choices: [{ index: 0, delta, ...(finish !== null && { finish_reason: finish }) }],
  }
  return `data: ${JSON.stringify(chunk)}\n\n`
}

/** Reasoning only, then a clean `stop`. */
const reasoningOnly = (): string =>
  [frame({ role: 'assistant' }, null), frame({ reasoning_content: 'thinking' }, null), frame({}, 'stop'), 'data: [DONE]\n\n'].join('')

/** Reasoning plus answer text. */
const answered = (): string =>
  [
    frame({ role: 'assistant' }, null),
    frame({ reasoning_content: 'thinking' }, null),
    frame({ content: 'the answer' }, null),
    frame({}, 'stop'),
    'data: [DONE]\n\n',
  ].join('')

/** Answer text only, no reasoning: the common case must not be disturbed. */
const textOnly = (): string => [frame({ role: 'assistant' }, null), frame({ content: 'the answer' }, null), frame({}, 'stop'), 'data: [DONE]\n\n'].join('')

/** Whitespace is not an answer. */
const whitespaceOnly = (): string =>
  [
    frame({ role: 'assistant' }, null),
    frame({ reasoning_content: 'thinking' }, null),
    frame({ content: '   \n  ' }, null),
    frame({}, 'stop'),
    'data: [DONE]\n\n',
  ].join('')

interface Outcome {
  readonly deltas: readonly string[]
  readonly settled: { readonly content: readonly { type?: string; text?: string }[]; readonly stopReason: string }
}

const MODEL = 'gpt-6-luna'

const ndjson = (...parts: readonly Record<string, unknown>[]): string => parts.map(part => JSON.stringify(part)).join('\n')

/** `planId` decides the transport: a Pro plan uses the Provider API (SSE), anything else the CLI endpoint (NDJSON). */
const run = async (body: string, planId: string): Promise<Outcome> => {
  const stubFetch = async (resource: string | URL | Request): Promise<Response> => {
    const url = new URL(resource instanceof Request ? resource.url : resource)
    if (url.pathname === '/alpha/billing/subscriptions') return Response.json({ data: { planId } })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  const provider = createCommandCodeProvider()
  const model = provider.describeModel(MODEL)
  const deltas: string[] = []
  const stream = provider.streamSimple(model, { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 }] } as never, {
    apiKey: `key-${planId}`,
    fetch: stubFetch as typeof fetch,
  })
  for await (const event of stream) {
    if (event.type === 'text_delta' || event.type === 'thinking_delta' || event.type === 'toolcall_delta') deltas.push(event.type)
  }
  return { deltas, settled: await stream.result() }
}

const PRO = 'individual-pro-v1'
const GO = 'individual-go-v1'

describe('settlement classification', () => {
  it('treats answer text as an answer', () => {
    expect(settlementAnswered({ content: [{ type: 'text', text: 'hello' }] })).toBe(true)
  })

  it('treats a tool call as an answer', () => {
    expect(settlementAnswered({ content: [{ type: 'toolCall' }] })).toBe(true)
  })

  it('does not treat reasoning as an answer', () => {
    expect(settlementAnswered({ content: [{ type: 'thinking', text: 'thought about it' }] })).toBe(false)
  })

  it('does not treat whitespace as an answer', () => {
    expect(settlementAnswered({ content: [{ type: 'text', text: '  \n ' }] })).toBe(false)
  })

  it('calls a reasoning-only stop an empty completion', () => {
    expect(isEmptyCompletion({ content: [{ type: 'thinking', text: 'x' }], stopReason: 'stop' })).toBe(true)
  })

  it('does not call an aborted turn empty', () => {
    expect(isEmptyCompletion({ content: [], stopReason: 'aborted' })).toBe(false)
  })

  it('does not call a tool-use turn empty', () => {
    expect(isEmptyCompletion({ content: [{ type: 'toolCall' }], stopReason: 'toolUse' })).toBe(false)
  })
})

describe('Command Code provider: empty response settles as a classified failure', () => {
  it('the control: a response with answer text still completes', async () => {
    const result = await run(answered(), PRO)
    expect(result.settled.stopReason).toBe('stop')
    expect(result.settled.content.map(block => block.type)).toEqual(['thinking', 'text'])
  })

  it('the control: a plain text response is undisturbed', async () => {
    const result = await run(textOnly(), PRO)
    expect(result.settled.content).toEqual([{ type: 'text', text: 'the answer' }])
  })

  it('settles a reasoning-only Provider API response with no content, which DSH files as EMPTY_RESPONSE', async () => {
    const result = await run(reasoningOnly(), PRO)
    expect(result.deltas).toContain('thinking_delta')
    expect(result.settled).toMatchObject({ stopReason: 'stop', content: [] })
  })

  it('a whitespace-only response settles the same way', async () => {
    const result = await run(whitespaceOnly(), PRO)
    expect(result.settled).toMatchObject({ stopReason: 'stop', content: [] })
  })

  it('settles a reasoning-only CLI response with no content', async () => {
    const result = await run(ndjson({ type: 'reasoning-delta', text: 'thinking' }, { type: 'finish', finishReason: 'stop' }), GO)
    expect(result.settled).toMatchObject({ stopReason: 'stop', content: [] })
  })

  it('also catches a CLI response cut off by the output limit before any answer', async () => {
    const result = await run(ndjson({ type: 'reasoning-delta', text: 'thinking' }, { type: 'finish', finishReason: 'length' }), GO)
    expect(result.settled).toMatchObject({ stopReason: 'stop', content: [] })
  })

  it('the control: a CLI answer keeps its content', async () => {
    const result = await run(
      ndjson({ type: 'reasoning-delta', text: 'thinking' }, { type: 'text-delta', text: 'done' }, { type: 'finish', finishReason: 'stop' }),
      GO,
    )
    expect(result.settled.content.map(block => block.type)).toEqual(['thinking', 'text'])
  })
})
