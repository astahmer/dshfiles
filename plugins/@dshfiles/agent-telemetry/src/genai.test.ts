import { describe, expect, it } from 'vitest'
import { CONTENT_MAX_CHARS, GenAi } from './genai.js'

describe('GenAI mapping (LoongSuite mapping.ts parity)', () => {
  it('spells DSH finish kinds the way GenAI spans expect', () => {
    expect(['tool-calls', 'max-tokens', 'aborted', 'stop', 'error', 'blocked', undefined].map(kind => GenAi.finishReason(kind))).toEqual([
      'tool_calls',
      'length',
      'cancelled',
      'stop',
      'error',
      'blocked',
      'unknown',
    ])
  })

  it('folds DSH disjoint cache buckets into cumulative input tokens', () => {
    expect(GenAi.usageAttributes({ inputTokens: 10, outputTokens: 4, cacheReadTokens: 6, cacheWriteTokens: 2, reasoningTokens: 1 })).toEqual({
      'gen_ai.usage.input_tokens': 18,
      'gen_ai.usage.output_tokens': 4,
      'gen_ai.usage.cache_read.input_tokens': 6,
      'gen_ai.usage.cache_creation.input_tokens': 2,
      'gen_ai.usage.total_tokens': 22,
      'gen_ai.usage.reasoning_tokens': 1,
    })
    const totals = GenAi.emptyTotals()
    GenAi.addUsage(totals, { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3 })
    GenAi.addUsage(totals, { inputTokens: 1, outputTokens: 2 })
    expect(GenAi.totalsAttributes(totals)).toMatchObject({ 'gen_ai.usage.input_tokens': 5, 'gen_ai.usage.total_tokens': 9 })
  })

  it('maps DSH content blocks and tool results to GenAI message parts', () => {
    expect(
      GenAi.inputMessage({
        role: 'user',
        source: { kind: 'tool', callId: 'c1' },
        content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }],
      }),
    ).toEqual({ role: 'tool', parts: [{ type: 'tool_call_response', id: 'c1', response: [{ type: 'text', content: 'ok' }] }] })
    expect(
      GenAi.mapContent([
        { type: 'tool-call', id: 'c2', name: 'bash', arguments: '{"command":"ls"}' },
        { type: 'reasoning', text: 'r' },
      ]),
    ).toEqual([
      { type: 'tool_call', id: 'c2', name: 'bash', arguments: { command: 'ls' } },
      { type: 'reasoning', content: 'r' },
    ])
    expect(GenAi.parseToolArguments('not json')).toBe('not json')
  })

  it('serializes captured content as JSON or a truncation marker, never cut JSON', () => {
    expect(GenAi.serializeCaptured({ a: 1 })).toBe('{"a":1}')
    const marker = JSON.parse(GenAi.serializeCaptured('x'.repeat(CONTENT_MAX_CHARS + 10)))
    expect(marker).toEqual({ truncated: true, original_characters: CONTENT_MAX_CHARS + 12, limit_characters: CONTENT_MAX_CHARS })
  })

  it('reads the GenAI content capture variable like LoongSuite: only span modes turn it on', () => {
    expect(GenAi.contentCaptureFromEnvironment({})).toBe(false)
    expect(GenAi.contentCaptureFromEnvironment({ OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'span_only' })).toBe(true)
    expect(GenAi.contentCaptureFromEnvironment({ OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'SPAN_AND_EVENT' })).toBe(true)
    expect(GenAi.contentCaptureFromEnvironment({ OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'EVENT_ONLY' })).toBe(false)
  })
})
