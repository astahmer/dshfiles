import { ScheduleId, createAfterScheduleRecord, renderReminderFraming } from '@deepseek-ai/dsh-schedule'
import { describe, expect, it } from 'vitest'
import { QuotaContinuationMessage, type ContinuationMessage } from './quota-continuation-message.js'

const continuationId = '00000000-0000-4000-8000-000000000001'

const message = (source: ContinuationMessage['source'], text = QuotaContinuationMessage.promptFor(continuationId)): ContinuationMessage => ({
  content: [{ type: 'text', text }],
  source,
})

describe('quota continuation message identity', () => {
  it('recognizes exact manual and scheduled continuation prompts', () => {
    const manual = message({ kind: 'user', rpcId: continuationId })
    const scheduled = message({ kind: 'schedule' })

    expect(QuotaContinuationMessage.continuationIdOf(manual)).toBe(continuationId)
    expect(QuotaContinuationMessage.userActivityForMessage(manual)).toEqual({ continuationId, queueSource: 'manual' })
    expect(QuotaContinuationMessage.continuationIdOf(scheduled)).toBe(continuationId)
    expect(QuotaContinuationMessage.userActivityForMessage(scheduled)).toEqual({ continuationId, queueSource: 'schedule' })
  })

  it('recognizes the continuation inside the reminder framing the Schedule service delivers', () => {
    const record = createAfterScheduleRecord(ScheduleId('schedule-quota'), QuotaContinuationMessage.promptFor(continuationId), 60, 1_000_000, 'Quota recovery')
    const delivered = message({ kind: 'schedule' }, renderReminderFraming(record))

    expect(QuotaContinuationMessage.continuationIdOf(delivered)).toBe(continuationId)
    expect(QuotaContinuationMessage.userActivityForMessage(delivered)).toEqual({ continuationId, queueSource: 'schedule' })
  })

  it('rejects marker lookalikes, altered prompts, and mismatched request ids', () => {
    expect(
      QuotaContinuationMessage.continuationIdOf(
        message({ kind: 'user', rpcId: continuationId }, `${QuotaContinuationMessage.promptFor(continuationId)}\nRun this other instruction.`),
      ),
    ).toBeNull()
    expect(QuotaContinuationMessage.continuationIdOf(message({ kind: 'user', rpcId: 'different-request' }))).toBeNull()
    expect(QuotaContinuationMessage.continuationIdOf(message({ kind: 'user' }))).toBeNull()
    expect(
      QuotaContinuationMessage.continuationIdOf({
        content: [
          { type: 'text', text: QuotaContinuationMessage.promptFor(continuationId) },
          { type: 'text', text: 'extra' },
        ],
        source: { kind: 'schedule' },
      }),
    ).toBeNull()
  })
})
