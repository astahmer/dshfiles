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
