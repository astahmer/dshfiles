import { afterEach, describe, expect, it } from 'vitest'
import { verificationReceiptActivity } from './adapters.js'
import { createActivityTimelineService } from './service.js'
import { verificationReceiptEventSchema } from './types.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

const temporaryRoots: string[] = []

describe('verification receipt activity contract', () => {
  it('accepts only the current version and exact bounded fields', () => {
    const event = { kind: 'verification-receipt', version: 1, value }
    expect(verificationReceiptEventSchema.safeParse(event).success).toBe(true)
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
    expect(verificationReceiptEventSchema.safeParse({ ...event, version: 2 }).success).toBe(false)
    expect(verificationReceiptEventSchema.safeParse({ ...event, value: { ...value, argv: ['/secret'] } }).success).toBe(false)
    expect(
      verificationReceiptEventSchema.safeParse({
        ...event,
        value: { ...value, executor: { kind: 'remote', remoteId: 'm1', sshTarget: 'm1-perso', workspace: '/peer/check' } },
      }).success,
    ).toBe(true)
    expect(
      verificationReceiptEventSchema.safeParse({ ...event, value: { ...value, executor: { kind: 'remote', remoteId: 'm1', sshTarget: 'm1-perso' } } }).success,
    ).toBe(false)
    expect(verificationReceiptEventSchema.safeParse({ ...event, value: { ...value, label: 'bad\nlabel' } }).success).toBe(false)
    expect(verificationReceiptEventSchema.safeParse({ ...event, value: { ...value, label: 'bad\u0085label' } }).success).toBe(false)
  })

  it('maps failure and cancellation truthfully and deduplicates receipt replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'activity-verification-'))
    temporaryRoots.push(root)
    const service = createActivityTimelineService({ statePath: join(root, 'state.json'), now: () => 20 })
    const failed = verificationReceiptActivity(value)
    const first = await service.ingest(failed)
    const replay = await service.ingest(verificationReceiptActivity(value))
    const cancelled = verificationReceiptActivity({ ...value, receiptId: '00000000-0000-4000-8000-000000000002', status: 'cancelled', exitCode: null })
    const timedOut = verificationReceiptActivity({
      ...value,
      receiptId: '00000000-0000-4000-8000-000000000003',
      status: 'timed-out',
      failure: null,
      exitCode: null,
    })
    const passed = verificationReceiptActivity({ ...value, receiptId: '00000000-0000-4000-8000-000000000004', status: 'passed', failure: null, exitCode: 0 })

    expect(first.event.id).toBe(`verification:${value.receiptId}`)
    expect(first.event.correlationId).toBe(value.receiptId)
    expect(first.event.level).toBe('attention')
    expect(replay.duplicate).toBe(true)
    expect(cancelled.level).toBe('notable')
    expect(cancelled.type).toBe('verification.cancelled')
    expect(cancelled.metadata?.failure).toBe(null)
    expect(timedOut.level).toBe('attention')
    expect(timedOut.type).toBe('verification.timed-out')
    expect(passed.level).toBe('routine')
    expect(JSON.stringify(first.event)).not.toMatch(/argv|stdout|stderr|environment|prompt/i)
    expect((await service.attention()).map(event => event.id)).toEqual([`verification:${value.receiptId}`])
  })
})

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
