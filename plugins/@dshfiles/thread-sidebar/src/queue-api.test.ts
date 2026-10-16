import { describe, expect, test } from 'vitest'
import { threadQueueApi } from './queue-api.js'

describe('thread queue tool exposure', () => {
  test('removing and steering a queued message are named, gated tools', () => {
    const tools = Object.values(threadQueueApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual(['thread_queue_remove', 'thread_queue_steer'])
    for (const name of ['remove', 'steer'] as const) {
      expect(threadQueueApi.methods[name].description ?? '').toMatch(/Call only when the user asked/u)
      expect(threadQueueApi.methods[name].tool?.readOnly).toBeUndefined()
      expect(threadQueueApi.methods[name].tool?.render).toBeDefined()
    }
  })
})
