import { describe, expect, it, vi } from 'vitest'
import { emitProjectChecksActivity, persistReceiptAndEmitActivity, projectChecksActivityEvent, projectChecksActivityEventSchema } from './receipt-activity.js'
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
    const event = projectChecksActivityEvent(receipt)
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
    expect(projectChecksActivityEventSchema.safeParse({ ...event, version: 2 }).success).toBe(false)
    expect(projectChecksActivityEventSchema.safeParse({ ...event, value: { ...event.value, stdout: 'private output' } }).success).toBe(false)
  })

  it('waits for durable receipt persistence before publishing and keeps projection failures optional', async () => {
    const order: string[] = []
    const publish = vi.fn(() => {
      order.push('activity')
      expect(order).toEqual(['receipt'])
    })
    await persistReceiptAndEmitActivity({
      receipt,
      persist: async () => {
        order.push('receipt')
      },
      emit: publish,
    })
    expect(publish).toHaveBeenCalledTimes(1)

    await expect(
      persistReceiptAndEmitActivity({
        receipt,
        persist: async () => {
          throw new Error('storage unavailable')
        },
        emit: publish,
      }),
    ).rejects.toThrow('storage unavailable')
    expect(publish).toHaveBeenCalledTimes(1)

    expect(() =>
      emitProjectChecksActivity(receipt, () => {
        throw new Error('timeline unavailable')
      }),
    ).not.toThrow()
  })
})
