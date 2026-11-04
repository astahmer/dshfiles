import { describe, expect, it } from 'vitest'
import { Effect, Schema } from 'effect'
import { ProjectChecksActivityModel, projectChecksActivityEventSchema } from './receipt-activity.js'
import type { StoredReceipt } from './store.js'

const revision = 'a'.repeat(40)
const receipt: StoredReceipt = {
  id: '00000000-0000-4000-8000-000000000001',
  sessionId: 'session-a',
  actionId: 'unit-check',
  label: 'Unit\n\u0085check',
  status: 'passed',
  failure: null,
  startedAt: 10,
  finishedAt: 15,
  durationMs: 5,
  exitCode: 0,
  sourceRevision: revision,
  sourceRevisionBefore: revision,
  sourceRevisionAfter: revision,
  verificationTurn: null,
  automatic: false,
  attempt: 0,
}

describe('Project Checks activity summary', () => {
  it('publishes only the bounded, versioned receipt facts', () => {
    const event = ProjectChecksActivityModel.event(receipt)
    expect(event).toEqual({
      kind: 'verification-receipt',
      version: 1,
      value: {
        receiptId: receipt.id,
        sessionId: receipt.sessionId,
        actionId: receipt.actionId,
        label: 'Unit check',
        status: 'passed',
        failure: null,
        startedAt: 10,
        finishedAt: 15,
        durationMs: 5,
        exitCode: 0,
        automatic: false,
        verificationTurn: null,
        attempt: 0,
        sourceRevisionBefore: revision,
        sourceRevisionAfter: revision,
      },
    })
    expect(JSON.stringify(event)).not.toMatch(/command|args|stdout|stderr|environment|prompt/i)
    expect(Schema.decodeUnknownResult(projectChecksActivityEventSchema, { onExcessProperty: 'error' })({ ...event, version: 2 })._tag === 'Success').toBe(false)
    expect(
      Schema.decodeUnknownResult(projectChecksActivityEventSchema, { onExcessProperty: 'error' })({
        ...event,
        value: { ...event.value, stdout: 'private output' },
      })._tag === 'Success',
    ).toBe(false)
  })

  it('keeps peer targets, workspace paths and peer stderr out of the Activity payload', () => {
    const sentinels = ['SENTINEL-SSH-TARGET-7f3a', '/SENTINEL/peer/workspace-7f3a', 'SENTINEL-STDERR-7f3a']
    const remote: StoredReceipt = {
      ...receipt,
      status: 'failed',
      failure: 'remote-failed',
      verificationStage: 'rebase',
      executor: { kind: 'remote', remoteId: 'm1', sshTarget: sentinels[0] ?? '', workspace: sentinels[1] ?? '' },
      remoteFailure: { remoteId: 'm1', code: 'peer-unreachable', message: `ssh: ${sentinels[2]} ${sentinels[0]}:${sentinels[1]}` },
    }
    const event = ProjectChecksActivityModel.event(remote)
    const serialized = JSON.stringify(event)
    for (const sentinel of sentinels) expect(serialized).not.toContain(sentinel)
    expect(event.value.executor).toEqual({ kind: 'remote', remoteId: 'm1', sshTarget: '', workspace: '' })
    expect(event.value.remoteFailure).toEqual({ remoteId: 'm1', code: 'peer-unreachable', message: 'the remote was unreachable' })

    const unknownCode = ProjectChecksActivityModel.event({ ...remote, remoteFailure: { remoteId: 'm1', code: 'peer-novel', message: sentinels[2] ?? '' } })
    expect(unknownCode.value.remoteFailure?.message).toBe('remote execution failed')
    expect(ProjectChecksActivityModel.event({ ...remote, remoteFailure: null }).value.remoteFailure).toBe(null)
    expect(ProjectChecksActivityModel.event({ ...remote, executor: { kind: 'local' } }).value.executor).toEqual({ kind: 'local' })

    const decode = Schema.decodeUnknownResult(projectChecksActivityEventSchema, { onExcessProperty: 'error' })
    expect(decode({ ...event, value: { ...event.value, executor: { kind: 'remote', remoteId: 'm1', sshTarget: sentinels[0], workspace: '' } } })._tag).toBe(
      'Failure',
    )
    expect(decode({ ...event, value: { ...event.value, executor: { kind: 'remote', remoteId: 'm1', sshTarget: '', workspace: sentinels[1] } } })._tag).toBe(
      'Failure',
    )
    expect(decode({ ...event, value: { ...event.value, remoteFailure: { remoteId: 'm1', code: 'peer-unreachable', message: sentinels[2] } } })._tag).toBe(
      'Failure',
    )
  })

  it('does not add the stage to the v1 Activity payload for any stage or for legacy receipts', () => {
    for (const stage of ['manual', 'completion', 'rebase', undefined] as const) {
      const stored: StoredReceipt = stage === undefined ? receipt : { ...receipt, verificationStage: stage }
      const event = ProjectChecksActivityModel.event(stored)
      expect(event.version).toBe(1)
      expect(Object.keys(event.value)).not.toContain('verificationStage')
    }
  })

  it('waits for durable receipt persistence before publishing and keeps projection failures optional', async () => {
    const order: string[] = []
    const publish = () => Effect.sync(() => order.push('activity'))
    await Effect.runPromise(ProjectChecksActivityModel.persistAndEmit({ receipt, persist: Effect.sync(() => order.push('receipt')), emit: publish }))
    expect(order).toEqual(['receipt', 'activity'])

    const failed = await Effect.runPromise(
      Effect.flip(ProjectChecksActivityModel.persistAndEmit({ receipt, persist: Effect.fail('storage unavailable'), emit: publish })),
    )
    expect(failed).toBe('storage unavailable')
    expect(order).toEqual(['receipt', 'activity'])

    await Effect.runPromise(ProjectChecksActivityModel.publish({ receipt: { ...receipt, startedAt: -1 }, emit: publish }))
    expect(order).toEqual(['receipt', 'activity'])
  })
})
