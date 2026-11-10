import { NodeServices } from '@effect/platform-node'
import { Effect, FileSystem, Option, Schema } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { verificationReceiptActivity } from './adapters.js'
import { activityEventPayloadSchema, ingestOfPayload } from './activity-event-payload.js'
import { ActivityTimeline } from './activity-timeline.js'
import { temporaryStatePath, timelineLayer } from './test-support.js'
import { activityStateSchema, verificationReceiptEventSchema, verificationReceiptSummaryOf } from './types.js'

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
const v1 = { kind: 'verification-receipt' as const, version: 1 as const, value }
const v2 = { kind: 'verification-receipt' as const, version: 2 as const, value }

const decodeReceipt = Schema.decodeUnknownOption(verificationReceiptEventSchema, { onExcessProperty: 'error' })
const accepts = (candidate: unknown): boolean => Option.isSome(decodeReceipt(candidate))
const summaryOf = (candidate: unknown) =>
  Option.match(decodeReceipt(candidate), {
    onNone: () => {
      throw new Error('receipt event must decode')
    },
    onSome: verificationReceiptSummaryOf,
  })
const decodePayload = Schema.decodeUnknownOption(activityEventPayloadSchema, { onExcessProperty: 'error' })

describe('verification receipt activity contract', () => {
  it('accepts v1 and v2 with exact bounded fields and projects bounded metadata', () => {
    expect(accepts(v1)).toBe(true)
    expect(accepts(v2)).toBe(true)
    const projected = verificationReceiptActivity(summaryOf(v2))
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
      'verificationStage',
      'verificationTurn',
    ])
    expect(accepts({ ...v1, version: 3 })).toBe(false)
    for (const event of [v1, v2]) {
      expect(accepts({ ...event, value: { ...value, argv: ['/secret'] } })).toBe(false)
      expect(accepts({ ...event, value: { ...value, label: 'bad\nlabel' } })).toBe(false)
      expect(accepts({ ...event, value: { ...value, label: 'bad\u0085label' } })).toBe(false)
    }
  })

  it('keeps decoding v1 events that carry peer keys, and drops them', () => {
    const peer = { kind: 'remote', remoteId: 'm1', sshTarget: 'm1-perso', workspace: '/peer/check' }
    expect(accepts({ ...v1, value: { ...value, executor: peer } })).toBe(true)
    expect(accepts({ ...v1, value: { ...value, executor: { kind: 'remote', remoteId: 'm1', sshTarget: 'm1-perso' } } })).toBe(false)
    expect(accepts({ ...v1, value: { ...value, verificationStage: 'rebase' } })).toBe(false)
    const summary = summaryOf({
      ...v1,
      value: { ...value, executor: peer, remoteFailure: { remoteId: 'm1', code: 'peer-unreachable', message: 'ssh: m1-perso: /peer/check' } },
    })
    expect(summary.executor).toEqual({ kind: 'remote', remoteId: 'm1' })
    expect(summary.remoteFailure).toEqual({ remoteId: 'm1', code: 'peer-unreachable' })
    expect(summary.verificationStage).toBe('not-recorded')
  })

  it('refuses peer keys and failure text in v2', () => {
    expect(accepts({ ...v2, value: { ...value, executor: { kind: 'remote', remoteId: 'm1' } } })).toBe(true)
    expect(accepts({ ...v2, value: { ...value, executor: { kind: 'remote', remoteId: 'm1', sshTarget: '', workspace: '' } } })).toBe(false)
    expect(accepts({ ...v2, value: { ...value, remoteFailure: { remoteId: 'm1', code: 'peer-unreachable' } } })).toBe(true)
    expect(accepts({ ...v2, value: { ...value, remoteFailure: { remoteId: 'm1', code: 'peer-unreachable', message: 'stderr' } } })).toBe(false)
    expect(accepts({ ...v2, value: { ...value, verificationStage: 'not-recorded' } })).toBe(false)
  })

  it('shows every recorded stage and “not recorded” without one', () => {
    const labels = { manual: 'stage manual run', completion: 'stage turn completion', rebase: 'stage rebase candidate' } as const
    for (const stage of ['manual', 'completion', 'rebase'] as const) {
      const projected = verificationReceiptActivity(summaryOf({ ...v2, value: { ...value, verificationStage: stage } }))
      expect(projected.metadata?.verificationStage).toBe(stage)
      expect(projected.summary).toContain(labels[stage])
    }
    for (const legacy of [v1, v2]) {
      const projected = verificationReceiptActivity(summaryOf(legacy))
      expect(projected.metadata?.verificationStage).toBe('not-recorded')
      expect(projected.summary).toContain('stage not recorded')
    }
  })

  it.effect('persists a peer receipt without its target, workspace or stderr, and the stored event round-trips', () =>
    Effect.gen(function* () {
      const sentinels = ['SENTINEL-SSH-TARGET-9c1d', '/SENTINEL/peer/workspace-9c1d', 'SENTINEL-STDERR-9c1d']
      const currentId = '00000000-0000-4000-8000-000000000005'
      const statePath = yield* temporaryStatePath
      const legacyPeer = {
        ...v1,
        value: {
          ...value,
          failure: 'remote-failed',
          executor: { kind: 'remote', remoteId: 'm1', sshTarget: sentinels[0], workspace: sentinels[1] },
          remoteFailure: { remoteId: 'm1', code: 'peer-unreachable', message: `ssh: ${sentinels[2]} ${sentinels[0]}:${sentinels[1]}` },
        },
      }
      const currentPeer = {
        ...v2,
        value: {
          ...value,
          receiptId: currentId,
          verificationStage: 'rebase',
          executor: { kind: 'remote', remoteId: 'm1' },
          remoteFailure: { remoteId: 'm1', code: 'peer-timeout' },
        },
      }
      const ingests = [legacyPeer, currentPeer].map(payload =>
        Option.match(decodePayload(payload), {
          onNone: () => {
            throw new Error('the Host must accept this payload')
          },
          onSome: ingestOfPayload,
        }),
      )
      yield* ActivityTimeline.use(timeline => timeline.ingest(ingests)).pipe(Effect.provide(timelineLayer({ statePath })))

      const fs = yield* Effect.provide(FileSystem.FileSystem, NodeServices.layer)
      const persisted = yield* fs.readFileString(statePath)
      for (const sentinel of sentinels) expect(persisted).not.toContain(sentinel)
      const state = Schema.decodeUnknownSync(Schema.fromJsonString(activityStateSchema))(persisted)
      expect(state.events.map(event => event.id).sort()).toEqual([`verification:${value.receiptId}`, `verification:${currentId}`])

      const [legacy, current] = yield* ActivityTimeline.use(timeline =>
        Effect.all([timeline.event(`verification:${value.receiptId}`), timeline.event(`verification:${currentId}`)]),
      ).pipe(Effect.provide(timelineLayer({ statePath })))
      expect(legacy.metadata).toMatchObject({ executor: 'remote:m1', remoteFallback: 'm1:peer-unreachable', verificationStage: 'not-recorded' })
      expect(legacy.detail).toContain('Remote m1 could not run this check (peer-unreachable).')
      expect(current.metadata).toMatchObject({ executor: 'remote:m1', remoteFallback: 'm1:peer-timeout', verificationStage: 'rebase' })
      expect(current.summary).toContain('stage rebase candidate')
      expect(state.events.find(event => event.id === legacy.id)).toEqual(legacy)
    }),
  )

  it.effect('maps failure and cancellation truthfully and deduplicates receipt replay', () =>
    Effect.gen(function* () {
      const statePath = yield* temporaryStatePath
      const base = summaryOf(v2)
      yield* Effect.gen(function* () {
        const service = yield* ActivityTimeline
        const failed = verificationReceiptActivity(base)
        const [first] = yield* service.ingest([failed])
        const [replay] = yield* service.ingest([verificationReceiptActivity(summaryOf(v1))])
        const cancelled = verificationReceiptActivity({ ...base, receiptId: '00000000-0000-4000-8000-000000000002', status: 'cancelled', exitCode: null })
        const timedOut = verificationReceiptActivity({
          ...base,
          receiptId: '00000000-0000-4000-8000-000000000003',
          status: 'timed-out',
          failure: null,
          exitCode: null,
        })
        const passed = verificationReceiptActivity({
          ...base,
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
