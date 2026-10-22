import { describe, expect, it } from 'vitest'
import type { ApiCaller } from '@dshfiles/dshx/api'
import type { JevUsageRecord } from './jev-usage.js'
import { createJevUsageRecorder, jevSourceOf } from './jev-usage-recorder.js'

const record: JevUsageRecord = {
  requestId: '00000000-0000-4000-8000-000000000001',
  source: 'backlog',
  credential: 'secret:JEV_KEY',
  startedAt: 100,
  durationMs: 50,
  outcome: 'success',
  inputTokens: 12,
  outputTokens: 4,
}

describe('Jev usage recorder authorization', () => {
  it('rejects clients and agent callers before persisting', () => {
    const persisted: JevUsageRecord[] = []
    const handler = createJevUsageRecorder({
      authorize: jevSourceOf,
      record: item => persisted.push(item),
    })

    for (const caller of [{ kind: 'client' }, { kind: 'agent', sessionId: 'session-safe' }] satisfies ApiCaller[]) {
      expect(() => handler({ input: record, caller })).toThrow(/Only the Jev source plugin/u)
    }
    expect(persisted).toEqual([])
  })

  it('rejects a Jev plugin claiming another source and accepts only its matching source', () => {
    const persisted: JevUsageRecord[] = []
    const handler = createJevUsageRecorder({
      authorize: jevSourceOf,
      record: item => persisted.push(item),
    })

    expect(() => handler({ input: record, caller: { kind: 'plugin', packageId: '@dshfiles/memory' } })).toThrow(/Only the Jev source plugin/u)
    expect(persisted).toEqual([])

    expect(handler({ input: record, caller: { kind: 'plugin', packageId: '@dshfiles/backlog' } })).toEqual({ accepted: true })
    expect(persisted).toEqual([record])
  })
})
