/**
 * The empty-response guard, and the failure that motivated it.
 *
 * `pi-ai-empty.test.ts` proves pi-ai's own transport settles a reasoning-only
 * response as `stopReason: 'stop'` with no content. This proves our provider
 * boundary converts that into a classified `LlmError` before it reaches DSH, so
 * the retry policy sees a failed attempt instead of a finished turn.
 *
 * No network: `fetch` is replaced with a synthetic SSE body, so every result
 * comes from the real transport plus our real wrapper.
 */
import { describe, expect, it } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { createCommandCodeProvider } from './commandcode-provider.js'
import { describeEmptyResponse, isEmptyCompletion, settlementAnswered } from './empty-response.js'

const frame = (delta: Record<string, unknown>, finish: string | null): string => {
  const chunk = {
    id: 'c1',
    object: 'chat.completion.chunk',
    model: 'stealth/space-bunny-alpha',
    choices: [{ index: 0, delta, ...(finish === null ? {} : { finish_reason: finish }) }],
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
  readonly threw: boolean
  readonly code?: string
  readonly message?: string
  readonly deltas: readonly string[]
  readonly settled?: readonly { type?: string; text?: string }[]
}

const MODEL = 'stealth/space-bunny-alpha'

const run = async (body: string): Promise<Outcome> => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch
  try {
    const provider = createCommandCodeProvider()
    // `getModels()` is the sync catalog; the fallback entry is the OpenAI shape,
    // which is the one this transport serves.
    const model = provider.getModels().find(candidate => candidate.id === MODEL) ?? provider.getModels()[0]
    if (model === undefined) throw new Error('Command Code provider advertised no models.')
    const deltas: string[] = []
    let settled: readonly { type?: string; text?: string }[] | undefined
    for await (const event of provider.stream(model, { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 0 }] } as never, {
      apiKey: 'test-key',
    })) {
      if (event.type === 'text_delta' || event.type === 'thinking_delta' || event.type === 'toolcall_delta') deltas.push(event.type)
      if (event.type === 'done') settled = (event.message as { content?: readonly { type?: string; text?: string }[] }).content
    }
    return { threw: false, deltas, settled }
  } catch (error) {
    return {
      threw: true,
      ...(error instanceof LlmError ? { code: error.code } : {}),
      message: error instanceof Error ? error.message : String(error),
      deltas: [],
    }
  } finally {
    globalThis.fetch = originalFetch
  }
}

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

  it('names the model and both stop reasons', () => {
    expect(describeEmptyResponse({ model: 'stealth/space-bunny-alpha', stopReason: 'stop', rawStopReason: 'stop' })).toContain('stealth/space-bunny-alpha')
  })
})

describe('Command Code provider: empty response becomes a classified failure', () => {
  it('the control: a response with answer text still completes', async () => {
    const result = await run(answered())
    expect({ threw: result.threw, code: result.code }).toMatchObject({ threw: false })
    expect(result.deltas).toContain('text_delta')
  })

  it('the control: a plain text response is undisturbed', async () => {
    const result = await run(textOnly())
    expect({ threw: result.threw, code: result.code }).toMatchObject({ threw: false })
    expect(result.deltas).toContain('text_delta')
  })

  it('raises EMPTY_RESPONSE instead of ending the turn silently', async () => {
    const result = await run(reasoningOnly())
    expect({ threw: result.threw, code: result.code }).toMatchObject({ threw: true, code: 'EMPTY_RESPONSE' })
  })

  it('a whitespace-only response still raises', async () => {
    // pi-ai drops whitespace-only blocks before settlement
    // (openai-completions.js:964 filters on `block.text.trim()`), so the
    // settlement carries no text block at all and the guard sees an empty
    // completion. The unit case above pins the classification independently of
    // that upstream filtering.
    const result = await run(whitespaceOnly())
    expect({ threw: result.threw, code: result.code }).toMatchObject({ threw: true, code: 'EMPTY_RESPONSE' })
  })
})
