import { describe, expect, test } from 'vitest'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { threadQueueApi } from './queue-api.js'

describe('thread queue tool exposure', () => {
  test('removing, steering and editing a queued message are named, gated tools', () => {
    const tools = Object.values(threadQueueApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual(['thread_queue_edit', 'thread_queue_remove', 'thread_queue_steer'])
    for (const name of ['remove', 'steer', 'edit'] as const) {
      expect(threadQueueApi.methods[name].description ?? '').toMatch(/Call only when the user asked/u)
      expect(threadQueueApi.methods[name].tool?.readOnly).toBeUndefined()
      expect(threadQueueApi.methods[name].tool?.render).toBeDefined()
    }
  })

  test('an edit carries the replacement text and refuses an empty one', () => {
    const accepts = (value: unknown): boolean => {
      const schema = threadQueueApi.methods.edit.input
      return schema !== undefined && Result.isSuccess(Schema.decodeUnknownResult(schema)(value))
    }
    expect(accepts({ itemId: 'message-1', text: 'Use the staging bucket instead' })).toBe(true)
    expect(accepts({ sessionId: 'session-1', itemId: 'message-1', text: 'x' })).toBe(true)
    expect(accepts({ itemId: 'message-1', text: '   ' })).toBe(false)
    expect(accepts({ itemId: 'message-1' })).toBe(false)
    expect(accepts({ itemId: '', text: 'x' })).toBe(false)
  })
})
