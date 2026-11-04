import { Effect, Option, Schema } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { verificationReceiptActivity } from './adapters.js'
import { ActivityTimeline } from './activity-timeline.js'
import { temporaryStatePath, timelineLayer } from './test-support.js'
import { verificationReceiptEventSchema } from './types.js'

const revision = 'b'.repeat(40)
const value = {
  receiptId: '00000000-0000-4000-8000-000000000001',
  sessionId: 'session-a',
  actionId: 'unit-check',
  label: 'Unit check',
  status: 'failed' as const,
  failure: null,
  startedAt: 10,
  finishedAt: 15,
  durationMs: 5,
  exitCode: 1,
  automatic: true,
  verificationTurn: 3,
  attempt: 2,
  sourceRevisionBefore: revision,
  sourceRevisionAfter: revision,
}

const accepts = (candidate: unknown): boolean =>
  Option.isSome(Schema.decodeUnknownOption(verificationReceiptEventSchema, { onExcessProperty: 'error' })(candidate))

describe('verification receipt activity contract', () => {
  it('accepts only the current version and exact bounded fields', () => {
    const event = { kind: 'verification-receipt', version: 1, value }
    expect(accepts(event)).toBe(true)
    const projected = verificationReceiptActivity(value)
    if (projected.metadata === undefined) throw new Error('verification projection must include bounded metadata')
    expect(Object.keys(projected.metadata).sort()).toEqual([
      'actionId',
      'attempt',
      'automatic',
      'configurationFreshness',
      'durationMs',
      'executor',
      'exitCode',
      'failure',
      'finishedAt',
      'receiptId',
      'remoteFallback',
      'sourceRevisionAfter',
      'sourceRevisionBefore',
      'startedAt',
      'status',
      'verificationTurn',
    ])
    expect(accepts({ ...event, version: 2 })).toBe(false)
    expect(accepts({ ...event, value: { ...value, argv: ['/secret'] } })).toBe(false)
    expect(
      accepts({
        ...event,
        value: { ...value, executor: { kind: 'remote', remoteId: 'm1', sshTarget: 'm1-perso', workspace: '/peer/check' } },
      }),
    ).toBe(true)
    expect(accepts({ ...event, value: { ...value, executor: { kind: 'remote', remoteId: 'm1', sshTarget: 'm1-perso' } } })).toBe(false)
    expect(accepts({ ...event, value: { ...value, label: 'bad\nlabel' } })).toBe(false)
    expect(accepts({ ...event, value: { ...value, label: 'bad\u0085label' } })).toBe(false)
  })

  it.effect('maps failure and cancellation truthfully and deduplicates receipt replay', () =>
    Effect.gen(function* () {
      const statePath = yield* temporaryStatePath
      yield* Effect.gen(function* () {
        const service = yield* ActivityTimeline
        const failed = verificationReceiptActivity(value)
        const [first] = yield* service.ingest([failed])
        const [replay] = yield* service.ingest([verificationReceiptActivity(value)])
        const cancelled = verificationReceiptActivity({ ...value, receiptId: '00000000-0000-4000-8000-000000000002', status: 'cancelled', exitCode: null })
        const timedOut = verificationReceiptActivity({
          ...value,
          receiptId: '00000000-0000-4000-8000-000000000003',
          status: 'timed-out',
          failure: null,
          exitCode: null,
        })
        const passed = verificationReceiptActivity({
          ...value,
          receiptId: '00000000-0000-4000-8000-000000000004',
          status: 'passed',
          failure: null,
          exitCode: 0,
        })

        expect(first?.event.id).toBe(`verification:${value.receiptId}`)
        expect(first?.event.correlationId).toBe(value.receiptId)
        expect(first?.event.level).toBe('attention')
        expect(replay?.duplicate).toBe(true)
        expect(cancelled.level).toBe('notable')
        expect(cancelled.type).toBe('verification.cancelled')
        expect(cancelled.metadata?.failure).toBe(null)
        expect(timedOut.level).toBe('attention')
        expect(timedOut.type).toBe('verification.timed-out')
        expect(passed.level).toBe('routine')
        expect(JSON.stringify(first?.event)).not.toMatch(/argv|stdout|stderr|environment|prompt/i)
        expect((yield* service.attention(20)).map(event => event.id)).toEqual([`verification:${value.receiptId}`])
      }).pipe(Effect.provide(timelineLayer({ statePath })))
    }),
  )
})
