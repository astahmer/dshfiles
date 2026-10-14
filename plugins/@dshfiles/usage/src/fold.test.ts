import { describe, expect, it } from 'vitest'
import { foldRecords, initialFoldState } from './fold.js'
import type { LogRecord } from './session-log.js'

const fold = (records: readonly LogRecord[]) => foldRecords({ state: initialFoldState(), records, sessionId: 'session-a' })

describe('foldRecords', () => {
  it('fails an attempt the loop retried with the retry failure code, then records the settled retry', () => {
    const { rows } = fold([
      { type: 'request/header', seq: 1, time: 0, data: { header: { config: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } } } },
      { type: 'step/start', seq: 2, time: 1_000, data: { turn: 1, step: 1 } },
      { type: 'assistant/attempt', seq: 3, time: 1_400, data: { turn: 1, step: 1, stream: [] } },
      { type: 'llm/retry', seq: 4, time: 1_450, data: { turn: 1, step: 1, failure: { message: 'x', code: 'TRANSPORT' } } },
      {
        type: 'assistant/message',
        seq: 5,
        time: 3_000,
        data: {
          turn: 1,
          step: 1,
          usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 900 },
          stream: [
            { type: 'chunk', time: 2_200, chunk: { type: 'block-start' } },
            { type: 'chunk', time: 2_900, chunk: { type: 'finish', reason: { kind: 'stop' } } },
          ],
        },
      },
    ])
    expect(rows.map(row => [row.seq, row.status, row.errorCode, row.provider, row.ttftMs, row.endedAt, row.stopReason])).toEqual([
      [3, 'failed', 'TRANSPORT', 'opencode-go', null, 1_400, null],
      [5, 'ok', null, 'opencode-go', 1_200, 2_900, 'stop'],
    ])
    expect(rows[1]?.usage).toEqual({ input: 100, cacheRead: 900, cacheWrite: 0, output: 20, reasoning: 0 })
  })

  it('reports no TTFT for a request whose stream only carried its error', () => {
    const { rows } = fold([
      { type: 'step/start', seq: 1, time: 0, data: { turn: 1, step: 1 } },
      {
        type: 'assistant/attempt',
        seq: 2,
        time: 210,
        data: {
          turn: 1,
          step: 1,
          stream: [{ type: 'chunk', time: 205, chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } } } }],
        },
      },
    ])
    expect(rows.map(row => [row.status, row.errorCode, row.ttftMs, row.endedAt])).toEqual([['failed', 'MISSING_CREDENTIAL', null, 205]])
  })

  it('records a step the user interrupted before any answer as an aborted request', () => {
    const { rows, state } = fold([
      { type: 'model/selection', seq: 1, time: 0, data: { provider: 'claude', model: 'claude-opus-5-5' } },
      { type: 'step/start', seq: 2, time: 10, data: { turn: 3, step: 2 } },
      { type: 'step/end', seq: 3, time: 510, data: { turn: 3, step: 2 } },
      { type: 'turn/end', seq: 4, time: 520, data: { turn: 3, reason: { kind: 'interrupted' } } },
    ])
    expect(rows).toEqual([
      expect.objectContaining({ id: 'session-a#3', status: 'aborted', stopReason: 'interrupted', startedAt: 10, endedAt: 510, model: 'claude-opus-5-5' }),
    ])
    expect(state.stepStarts).toEqual({})
  })

  it('resumes a fold from its stored state as if the log had been read in one go', () => {
    const records: LogRecord[] = [
      { type: 'step/start', seq: 1, time: 0, data: { turn: 1, step: 1 } },
      {
        type: 'assistant/message',
        seq: 2,
        time: 50,
        data: { turn: 1, step: 1, usage: { inputTokens: 1, outputTokens: 1 }, stream: [{ type: 'chunk', time: 40 }] },
      },
    ]
    const first = fold(records.slice(0, 1))
    const second = foldRecords({ state: JSON.parse(JSON.stringify(first.state)), records: records.slice(1), sessionId: 'session-a' })
    expect(second.rows).toEqual(fold(records).rows)
    expect(second.rows[0]?.ttftMs).toBe(40)
  })
})
