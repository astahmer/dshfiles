import { describe, expect, it } from 'vitest'
import { continuationIdOf, promptFor, userActivityForMessage, type ContinuationMessage } from './quota-continuation-message.js'

const continuationId = '00000000-0000-4000-8000-000000000001'

const message = (source: ContinuationMessage['source'], text = promptFor(continuationId)): ContinuationMessage => ({
  content: [{ type: 'text', text }],
  source,
})

describe('quota continuation message identity', () => {
  it('recognizes exact manual and scheduled continuation prompts', () => {
    const manual = message({ kind: 'user', rpcId: continuationId })
    const scheduled = message({ kind: 'schedule' })

    expect(continuationIdOf(manual)).toBe(continuationId)
    expect(userActivityForMessage(manual)).toEqual({ continuationId, queueSource: 'manual' })
    expect(continuationIdOf(scheduled)).toBe(continuationId)
    expect(userActivityForMessage(scheduled)).toEqual({ continuationId, queueSource: 'schedule' })
  })

  it('rejects marker lookalikes, altered prompts, and mismatched request ids', () => {
    expect(continuationIdOf(message({ kind: 'user', rpcId: continuationId }, `${promptFor(continuationId)}\nRun this other instruction.`))).toBeNull()
    expect(continuationIdOf(message({ kind: 'user', rpcId: 'different-request' }))).toBeNull()
    expect(continuationIdOf(message({ kind: 'user' }))).toBeNull()
    expect(continuationIdOf({
      content: [{ type: 'text', text: promptFor(continuationId) }, { type: 'text', text: 'extra' }],
      source: { kind: 'schedule' },
    })).toBeNull()
  })
})
