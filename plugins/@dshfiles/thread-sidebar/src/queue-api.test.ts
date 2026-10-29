import { describe, expect, test } from 'vitest'
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

  test('an edit carries the replacement text and refuses an empty one', async () => {
    const accepts = async (value: unknown): Promise<boolean> => {
      const result = await threadQueueApi.methods.edit.input?.['~standard'].validate(value)
      return result !== undefined && result.issues === undefined
    }
    expect(await accepts({ itemId: 'message-1', text: 'Use the staging bucket instead' })).toBe(true)
    expect(await accepts({ sessionId: 'session-1', itemId: 'message-1', text: 'x' })).toBe(true)
    expect(await accepts({ itemId: 'message-1', text: '   ' })).toBe(false)
    expect(await accepts({ itemId: 'message-1' })).toBe(false)
    expect(await accepts({ itemId: '', text: 'x' })).toBe(false)
  })
})
