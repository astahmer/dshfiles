import { describe, expect, test } from 'vitest'
import { SessionReadingModel, TURN_TRACE_WAIT_MS, type SessionReading } from './session-reading.js'

const seek = (input: { readonly turn?: number; readonly now?: number } = {}): SessionReading =>
  SessionReadingModel.seek({ turn: input.turn ?? 3, now: input.now ?? 1_000 })

const settle = (input: { readonly reading: SessionReading; readonly foundTraceId?: string | null; readonly failed?: boolean; readonly now?: number }) =>
  SessionReadingModel.settle({ foundTraceId: null, failed: false, now: 2_000, ...input })

describe('SessionReadingModel', () => {
  test('a turn lookup opens the trace it found', () => {
    expect(settle({ reading: seek(), foundTraceId: 'trace-3' })).toEqual({ kind: 'trace', traceId: 'trace-3' })
  })

  test('a turn lookup keeps retrying until the wait runs out, then reports the turn as missing', () => {
    const seeking = seek({ now: 1_000 })
    expect(settle({ reading: seeking, now: 1_000 + TURN_TRACE_WAIT_MS - 1 })).toBe(seeking)
    expect(settle({ reading: seeking, now: 1_000 + TURN_TRACE_WAIT_MS })).toEqual({ kind: 'missing', turn: 3 })
  })

  test('a failed read reports the turn as missing without waiting', () => {
    expect(settle({ reading: seek(), failed: true, now: 1_001 })).toEqual({ kind: 'missing', turn: 3 })
  })

  test('only the seeking phase settles: a trace open, a missing turn and the list stay as they are', () => {
    const trace: SessionReading = { kind: 'trace', traceId: 'trace-1' }
    const missing: SessionReading = { kind: 'missing', turn: 1 }
    const idle = SessionReadingModel.idle()
    expect(settle({ reading: trace, foundTraceId: 'trace-2' })).toBe(trace)
    expect(settle({ reading: missing, now: 99_999 })).toBe(missing)
    expect(settle({ reading: idle, failed: true })).toBe(idle)
  })

  test('reading a phase never mixes the trace, the pending turn and the missing turn', () => {
    expect([
      SessionReadingModel.traceId({ kind: 'trace', traceId: 'trace-1' }),
      SessionReadingModel.seekingTurn({ kind: 'trace', traceId: 'trace-1' }),
      SessionReadingModel.missingTurn({ kind: 'trace', traceId: 'trace-1' }),
    ]).toEqual(['trace-1', null, null])
    expect([SessionReadingModel.traceId(seek()), SessionReadingModel.seekingTurn(seek()), SessionReadingModel.missingTurn(seek())]).toEqual([null, 3, null])
    expect([
      SessionReadingModel.traceId({ kind: 'missing', turn: 4 }),
      SessionReadingModel.seekingTurn({ kind: 'missing', turn: 4 }),
      SessionReadingModel.missingTurn({ kind: 'missing', turn: 4 }),
    ]).toEqual([null, null, 4])
  })
})
