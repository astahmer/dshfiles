import { describe, expect, it } from 'vitest'
import { UsageFoldModel, type ToolSourceMetadata } from './fold.js'
import type { LogRecord } from './session-log.js'

const fold = (records: readonly LogRecord[], toolSources: ReadonlyMap<string, ToolSourceMetadata> = new Map()) =>
  UsageFoldModel.foldRecords({ state: UsageFoldModel.initialFoldState(), records, sessionId: 'session-a', toolSources })

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

  it('folds privacy-reduced tool executions and marks missing results by turn outcome', () => {
    const first = fold([
      {
        type: 'tool/call',
        seq: 1,
        time: 100,
        data: { callId: 'private-call-id', name: 'shell.run', arguments: JSON.stringify({ command: 'pnpm test --token super-secret' }), turn: 1, step: 2 },
      },
    ])
    expect(first.tools).toMatchObject([{ startedAt: 100, endedAt: null, outcome: 'pending' }])
    const finished = UsageFoldModel.foldRecords({
      state: first.state,
      records: [
        {
          type: 'tool/result',
          seq: 2,
          time: 375,
          data: { message: { toolCallId: 'private-call-id', isError: true, content: [{ type: 'text', text: 'private output' }] } },
        },
      ],
      sessionId: 'session-a',
    })
    const pending = UsageFoldModel.foldRecords({
      state: UsageFoldModel.initialFoldState(),
      records: [
        { type: 'tool/call', seq: 3, time: 400, data: { callId: 'interrupted-call', name: 'ask_user_question', turn: 2, step: 1 } },
        { type: 'turn/end', seq: 4, time: 500, data: { turn: 2, reason: { kind: 'interrupted' } } },
      ],
      sessionId: 'session-a',
    })
    expect(finished.tools).toEqual([
      {
        id: 'session-a#1',
        sessionId: 'session-a',
        seq: 1,
        turn: 1,
        step: 2,
        name: 'shell.run',
        category: 'other',
        owner: null,
        normalizedCommand: 'pnpm test',
        testRunner: 'pnpm:test',
        startedAt: 100,
        endedAt: 375,
        outcome: 'error',
        resultChars: 14,
      },
    ])
    expect(JSON.stringify(finished.tools)).not.toContain('super-secret')
    expect(JSON.stringify(finished.tools)).not.toContain('private output')
    expect(pending.tools[0]?.outcome).toBe('interrupted')
    const ptc = fold([
      { type: 'step/start', seq: 5, time: 510, data: { turn: 3, step: 1 } },
      {
        type: 'tool/ptc-dispatch-start',
        seq: 6,
        time: 520,
        data: { parentCallId: 'parent', subCallId: 'nested-id', name: 'file.read', arguments: { path: '/private/path' } },
      },
      {
        type: 'tool/ptc-dispatch',
        seq: 7,
        time: 580,
        data: {
          parentCallId: 'parent',
          subCallId: 'nested-id',
          name: 'file.read',
          arguments: { path: '/private/path' },
          isError: false,
          content: [{ type: 'text', text: 'private result' }],
        },
      },
      {
        type: 'tool/ptc-dispatch-start',
        seq: 8,
        time: 590,
        data: {
          parentCallId: 'parent',
          subCallId: 'test-run-id',
          name: 'bash',
          arguments: { command: 'vitest run /private/test.spec.ts --secret hidden', token: 'hidden' },
        },
      },
      {
        type: 'tool/ptc-dispatch',
        seq: 9,
        time: 690,
        data: {
          parentCallId: 'parent',
          subCallId: 'test-run-id',
          name: 'bash',
          arguments: { command: 'vitest run /private/test.spec.ts --secret hidden', token: 'hidden' },
          isError: false,
        },
      },
    ])
    expect(ptc.tools[0]).toMatchObject({ turn: 3, name: 'file.read', category: 'other', owner: null, startedAt: 520, endedAt: 580, outcome: 'success' })
    expect(ptc.tools[1]).toMatchObject({ normalizedCommand: 'vitest run', testRunner: 'vitest', startedAt: 590, endedAt: 690 })
    expect(JSON.stringify(ptc.tools)).not.toContain('/private/path')
    expect(JSON.stringify(ptc.tools)).not.toContain('/private/test.spec.ts')
    expect(JSON.stringify(ptc.tools)).not.toContain('hidden')
    expect(JSON.stringify(ptc.tools)).not.toContain('private result')
  })

  it('counts skill, plugin API, plugin, MCP and DSH tool calls by registry source', () => {
    const toolSources = new Map<string, ToolSourceMetadata>([
      ['usage_report', { source: 'api', owner: '@dshfiles/usage' }],
      ['custom_review', { source: 'plugin', owner: '@dshfiles/review' }],
      ['mcp__docs__search', { source: 'mcp', owner: '@dshfiles/mcp-servers' }],
      ['bash', { source: 'tool', owner: null }],
    ])
    const names = ['usage_report', 'custom_review', 'mcp__docs__search', 'bash', 'skill']
    const records = names.flatMap((name, index) => {
      const callId = `call-${String(index)}`
      const seq = index * 2 + 1
      return [
        {
          type: 'tool/call',
          seq,
          time: seq * 100,
          data: {
            callId,
            name,
            arguments: name === 'skill' ? JSON.stringify({ name: 'verify-dsh' }) : undefined,
            turn: 1,
            step: index + 1,
          },
        },
        {
          type: 'tool/result',
          seq: seq + 1,
          time: seq * 100 + 25,
          data: { message: { toolCallId: callId, isError: false, content: [{ type: 'text', text: 'private output' }] } },
        },
      ] satisfies LogRecord[]
    })
    const result = fold(records, toolSources)
    expect(result.tools.map(({ name, category, owner }) => ({ name, category, owner }))).toEqual([
      { name: 'usage_report', category: 'api', owner: '@dshfiles/usage' },
      { name: 'custom_review', category: 'plugin', owner: '@dshfiles/review' },
      { name: 'mcp__docs__search', category: 'mcp', owner: '@dshfiles/mcp-servers' },
      { name: 'bash', category: 'tool', owner: null },
      { name: 'verify-dsh', category: 'skill', owner: null },
    ])
    expect(JSON.stringify(result.tools)).not.toContain('private output')
    expect(JSON.stringify(result.tools)).not.toContain('arguments')
    const malformed = fold([
      {
        type: 'tool/call',
        seq: 1,
        time: 100,
        data: { callId: 'bad-skill', name: 'skill', arguments: JSON.stringify({ name: 'private skill name', extra: 'private data' }), turn: 1, step: 1 },
      },
      { type: 'tool/result', seq: 2, time: 125, data: { message: { toolCallId: 'bad-skill', isError: false } } },
    ])
    expect(malformed.tools[0]).toMatchObject({ name: 'skill', category: 'skill' })
    expect(JSON.stringify(malformed.tools)).not.toContain('private skill name')
    expect(JSON.stringify(malformed.tools)).not.toContain('private data')
  })

  it('replaces duplicate open call IDs and keeps the newest invocation only', () => {
    const result = fold([
      { type: 'tool/call', seq: 1, time: 100, data: { callId: 'repeat', name: 'skill', arguments: JSON.stringify({ name: 'first-skill' }), turn: 1, step: 1 } },
      {
        type: 'tool/call',
        seq: 2,
        time: 200,
        data: { callId: 'repeat', name: 'skill', arguments: JSON.stringify({ name: 'second-skill' }), turn: 1, step: 2 },
      },
      { type: 'tool/result', seq: 3, time: 300, data: { message: { toolCallId: 'repeat', isError: false } } },
    ])
    expect(result.tools).toEqual([
      expect.objectContaining({ id: 'session-a#1', name: 'first-skill', startedAt: 100, endedAt: null, outcome: 'unknown' }),
      expect.objectContaining({ id: 'session-a#2', name: 'second-skill', startedAt: 200, endedAt: 300, outcome: 'success' }),
    ])
    expect(result.state.openTools).toHaveLength(0)
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
    const second = UsageFoldModel.foldRecords({ state: JSON.parse(JSON.stringify(first.state)), records: records.slice(1), sessionId: 'session-a' })
    expect(second.rows).toEqual(fold(records).rows)
    expect(second.rows[0]?.ttftMs).toBe(40)
  })
})
