/**
 * Does pi-ai's own OpenAI transport classify a reasoning-only completion as a
 * failure, or does it end the stream as a successful empty turn?
 *
 * A reasoning-only response is what `@mars-sea/dsh-commandcode-provider` emits
 * when Space Bunny Alpha thinks and then produces no answer text and no tool
 * call. `@mars-sea` misreads it as empty; this asks whether the transport our
 * own Command Code provider wraps inherits the same defect.
 *
 * No network: `fetch` is replaced with a synthetic SSE body, so the answer comes
 * from the transport's own terminal logic rather than from a live provider.
 */
import { describe, expect, it } from 'vitest'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'

const frame = (delta: Record<string, unknown>, finish: string | null): string => {
  const chunk = {
    id: 'c1',
    object: 'chat.completion.chunk',
    model: 'test',
    choices: [{ index: 0, delta, ...(finish === null ? {} : { finish_reason: finish }) }],
  }
  return `data: ${JSON.stringify(chunk)}\n\n`
}

/** Reasoning only, then a clean `stop`: the shape that ended turns silently. */
const reasoningOnlyBody = (): string =>
  [
    frame({ role: 'assistant' }, null),
    frame({ reasoning_content: 'thinking about the answer' }, null),
    frame({}, 'stop'),
    'data: [DONE]\n\n',
  ].join('')

/** The same response, plus answer text. */
const answeredBody = (): string =>
  [
    frame({ role: 'assistant' }, null),
    frame({ reasoning_content: 'thinking about the answer' }, null),
    frame({ content: 'the answer' }, null),
    frame({}, 'stop'),
    'data: [DONE]\n\n',
  ].join('')

interface StreamOutcome {
  readonly threw: boolean
  readonly message?: string
  readonly blockTypes: readonly string[]
  readonly stopReason?: string
}

const MODEL = {
  id: 'test',
  api: 'openai-completions',
  provider: 'commandcode',
  baseUrl: 'https://api.commandcode.ai',
  reasoning: true,
  input: ['text'],
  contextWindow: 128_000,
  maxTokens: 8_192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as never

const CONTEXT = {
  systemPrompt: undefined,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
} as never

const complete = async (body: string): Promise<StreamOutcome> => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch
  try {
    const api = openAICompletionsApi()
    const stream = api.stream(MODEL, CONTEXT, { apiKey: 'test-key' } as never)
    const blockTypes: string[] = []
    let stopReason: string | undefined
    // The event union is text_delta / thinking_delta / toolcall_delta, not the
    // block names: matching on `text` reports an empty stream for every response,
    // which reads as "no content" when the transport produced plenty.
    for await (const event of stream as AsyncIterable<{ type: string; reason?: string }>) {
      if (event.type === 'text_delta' || event.type === 'thinking_delta' || event.type === 'toolcall_delta') blockTypes.push(event.type)
      if (event.type === 'done') stopReason = event.reason
    }
    return { threw: false, blockTypes, stopReason }
  } catch (error) {
    return { threw: true, message: error instanceof Error ? error.message : String(error), blockTypes: [] }
  } finally {
    globalThis.fetch = originalFetch
  }
}

describe('pi-ai openai-completions: a reasoning-only completion', () => {
  it('the control: a response carrying answer text completes normally', async () => {
    const result = await complete(answeredBody())
    expect(result.threw).toBe(false)
    expect(result.blockTypes).toContain('text_delta')
  })

  // This currently FAILS, and that is the finding. pi-ai ends a reasoning-only
  // response with `stopReason: 'stop'` and no content, exactly as
  // @mars-sea/dsh-commandcode-provider does, so our own provider inherits the
  // defect. Swap `createCommandCodeProvider` for pi-ai's transport with no other
  // change and the goal livelock survives the swap.
  //
  // The assertion states the contract we want: a response with reasoning and no
  // answer must fail so the retry policy can see it. When pi-ai fixes this, or
  // our provider stops using this transport, this test goes green.
  it('raises instead of reporting an empty successful turn', async () => {
    const result = await complete(reasoningOnlyBody())
    expect({
      threw: result.threw,
      message: result.message,
      blockTypes: result.blockTypes,
      stopReason: result.stopReason,
    }).toMatchObject({ threw: true })
  })
})
