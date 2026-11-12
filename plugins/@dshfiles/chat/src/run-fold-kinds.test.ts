import { afterEach, describe, expect, it } from 'vitest'
import type { StartedToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { RunFoldKinds } from './run-fold-kinds.ts'
import type { RunFoldKind } from './run-folds.ts'

const kind = (id: string, claims: RunFoldKind['claims'], order: number): RunFoldKind => ({
  id,
  order,
  Icon: () => null,
  claims,
  useStates: () => [],
  useText: () => ({ count: count => String(count), active: 'running', done: 'done' }),
})

const result = (name: string, text: string, isError = false): ToolResultNode => ({
  kind: 'tool-result',
  seq: 1,
  time: 0,
  callId: `call-${name}`,
  name,
  args: PartialArguments.EMPTY,
  call: { name, argsRaw: '{}' },
  callTime: null,
  content: [{ type: 'text', text }],
  isError,
  meta: undefined,
  subCalls: [],
})
const started = (name: string): StartedToolCall => ({
  phase: 'start',
  callId: `call-${name}`,
  name,
  argsRaw: '{"prompt":"x"}',
  args: PartialArguments.fromText('{"prompt":"x"}'),
  turn: 1,
  step: 1,
  time: 0,
  subCalls: [],
})

afterEach(() => RunFoldKinds.set([]))

describe('RunFoldKinds', () => {
  it('reads a result call with its text, and an error result without it', () => {
    expect(RunFoldKinds.callOf(result('bash', 'started background job bash-1'))).toMatchObject({
      toolName: 'bash',
      phase: 'result',
      resultText: 'started background job bash-1',
      isError: false,
    })
    expect(RunFoldKinds.callOf(result('bash', 'boom', true))).toMatchObject({ resultText: undefined, isError: true })
    expect(RunFoldKinds.callOf(started('subagent'))).toMatchObject({ toolName: 'subagent', phase: 'start', argsRaw: '{"prompt":"x"}' })
  })

  it('returns one object per block, so equal blocks compare by identity', () => {
    const block = result('bash', 'x')
    expect(RunFoldKinds.callOf(block)).toBe(RunFoldKinds.callOf(block))
  })

  it('picks the first claiming kind by order, and ignores a throwing provider', () => {
    const late = kind('late', () => true, 5)
    const early = kind('early', call => call.toolName === 'bash', 1)
    const broken = kind(
      'broken',
      () => {
        throw new Error('bad provider')
      },
      0,
    )
    RunFoldKinds.set([late, early, broken])
    expect(RunFoldKinds.get().map(entry => entry.id)).toEqual(['broken', 'early', 'late'])
    expect(RunFoldKinds.kindOf(RunFoldKinds.callOf(result('bash', 'x')))?.id).toBe('early')
    expect(RunFoldKinds.kindOf(RunFoldKinds.callOf(result('read', 'x')))?.id).toBe('late')
  })

  it('folds nothing without providers', () => {
    expect(RunFoldKinds.kindOf(RunFoldKinds.callOf(result('bash', 'started background job bash-1')))).toBeUndefined()
  })
})
