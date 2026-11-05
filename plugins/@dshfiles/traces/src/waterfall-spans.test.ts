import { describe, expect, test } from 'vitest'
import type { SpanRow } from './types.js'
import { WaterfallSpans } from './waterfall-spans.js'

const row = (input: Partial<SpanRow> & Pick<SpanRow, 'spanId' | 'depth'>): SpanRow => ({
  parentSpanId: null,
  childCount: 0,
  name: input.spanId,
  service: 'checkout',
  scope: null,
  kind: 'internal',
  offsetMs: 0,
  durationMs: 10,
  status: 'unset',
  statusMessage: null,
  sessionId: null,
  attributes: {},
  resource: {},
  events: [],
  linkCount: 0,
  ...input,
})

describe('WaterfallSpans.fromRows', () => {
  test('nests by the Host depth order and converts milliseconds to seconds', () => {
    const spans = WaterfallSpans.fromRows([
      row({ spanId: 'root', depth: 0, durationMs: 240 }),
      row({ spanId: 'a', depth: 1, parentSpanId: 'root', offsetMs: 8, durationMs: 38 }),
      row({ spanId: 'a1', depth: 2, parentSpanId: 'a', offsetMs: 10, durationMs: 5 }),
      row({ spanId: 'b', depth: 1, parentSpanId: 'root', offsetMs: 52, durationMs: 158 }),
    ])
    expect(spans.map(span => [span.id, span.parentId])).toEqual([
      ['root', undefined],
      ['a', 'root'],
      ['a1', 'a'],
      ['b', 'root'],
    ])
    expect(spans[3]).toMatchObject({ start: 0.052, end: 0.21, detail: 'checkout' })
  })

  test('keeps a parent cycle the Host listed flat as roots', () => {
    const spans = WaterfallSpans.fromRows([row({ spanId: 'a', depth: 0, parentSpanId: 'b' }), row({ spanId: 'b', depth: 0, parentSpanId: 'a' })])
    expect(spans.map(span => span.parentId)).toEqual([undefined, undefined])
  })

  test('marks failed spans with their status message and reads GenAI kind, tokens and cost', () => {
    const [failed, model, tool, plain] = WaterfallSpans.fromRows([
      row({ spanId: 'f', depth: 0, status: 'error', statusMessage: 'card declined' }),
      row({
        spanId: 'm',
        depth: 0,
        status: 'ok',
        attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.usage.input_tokens': 1_000, 'gen_ai.usage.output_tokens': 80, 'dshx.cost.usd': 0.02 },
      }),
      row({ spanId: 't', depth: 0, attributes: { 'gen_ai.operation.name': 'execute_tool' } }),
      row({ spanId: 'p', depth: 0 }),
    ])
    expect(failed?.error).toBe('card declined')
    expect(model).toMatchObject({ kind: 'model', tokens: 1_080, cost: 0.02, error: undefined })
    expect(tool?.kind).toBe('tool')
    expect(plain).toMatchObject({ kind: 'span', tokens: undefined, cost: undefined })
  })

  test('gives one service the same tone every time', () => {
    expect(WaterfallSpans.serviceTone('checkout')).toBe(WaterfallSpans.serviceTone('checkout'))
  })
})
