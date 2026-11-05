import { describe, expect, test } from 'vitest'
import { SessionTimelineModel } from './session-timeline.js'
import type { SpanRow, TraceDetail } from './types.js'

const span = (input: Partial<SpanRow> & Pick<SpanRow, 'spanId' | 'offsetMs' | 'durationMs'>): SpanRow => ({
  parentSpanId: null,
  depth: 0,
  childCount: 0,
  name: input.spanId,
  service: 'deepseek-harness',
  scope: null,
  kind: 'internal',
  status: 'unset',
  statusMessage: null,
  sessionId: 'session-1',
  attributes: {},
  resource: {},
  events: [],
  linkCount: 0,
  ...input,
})

const trace = (traceId: string, startMs: number, durationMs: number, spans: readonly SpanRow[]): TraceDetail => ({ traceId, startMs, durationMs, spans })
const laneNames = { turns: 'Turns', model: 'Model calls', tools: 'Tool calls' }

describe('SessionTimelineModel.build', () => {
  test('lays turns, model calls and tool calls on three lanes with idle time squeezed out', () => {
    const timeline = SessionTimelineModel.build({
      laneNames,
      traces: [
        trace('second', 100_000, 1_000, [span({ spanId: 'turn-2', offsetMs: 0, durationMs: 1_000 })]),
        trace('first', 0, 4_000, [
          span({ spanId: 'turn-1', offsetMs: 0, durationMs: 4_000, attributes: { 'gen_ai.operation.name': 'invoke_agent' } }),
          span({
            spanId: 'chat',
            offsetMs: 500,
            durationMs: 1_500,
            attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.usage.input_tokens': 900, 'gen_ai.usage.output_tokens': 100, 'dshx.cost.usd': 0.01 },
          }),
          span({ spanId: 'bash', offsetMs: 2_000, durationMs: 1_000, status: 'error', attributes: { 'gen_ai.operation.name': 'execute_tool' } }),
        ]),
      ],
    })
    expect(timeline.lanes.map(lane => [lane.id, lane.model])).toEqual([
      ['turns', '2'],
      ['model', '1'],
      ['tools', '1'],
    ])
    // 5 s of busy time and one 200 ms gap instead of 96 s idle.
    expect(timeline.duration).toBeCloseTo(5.2)
    const byId = new Map(timeline.segments.map(segment => [segment.id, segment]))
    expect(byId.get('first')).toMatchObject({ laneId: 'turns', kind: 'failed', start: 0, end: 4, label: 'turn-1' })
    expect(byId.get('second')).toMatchObject({ laneId: 'turns', kind: 'thinking', start: 4.2, end: 5.2 })
    expect(byId.get('first:chat')).toMatchObject({ laneId: 'model', kind: 'thinking', start: 0.5, end: 2, tokens: 1_000, cost: 0.01 })
    expect(byId.get('first:bash')).toMatchObject({ laneId: 'tools', kind: 'failed', start: 2, end: 3 })
  })

  test('keeps overlapping traces on their real offsets inside one busy block', () => {
    const timeline = SessionTimelineModel.build({
      laneNames,
      traces: [
        trace('a', 1_000, 2_000, [span({ spanId: 'a', offsetMs: 0, durationMs: 2_000 })]),
        trace('b', 2_000, 2_000, [span({ spanId: 'b', offsetMs: 0, durationMs: 2_000 })]),
      ],
    })
    expect(timeline.duration).toBeCloseTo(3)
    expect(timeline.segments.map(segment => [segment.id, segment.start, segment.end])).toEqual([
      ['a', 0, 2],
      ['b', 1, 3],
    ])
  })

  test('is empty without traces', () => {
    expect(SessionTimelineModel.build({ laneNames, traces: [] })).toMatchObject({ segments: [], duration: 0 })
  })
})
