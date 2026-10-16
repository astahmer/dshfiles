import { describe, expect, test } from 'vitest'
import { queueApi } from './api.js'

describe('queue-reorder tool exposure', () => {
  test('the queued rows are readable and the move tool keeps its own registration', () => {
    const tools = Object.values(queueApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name)).toEqual(['queue_describe'])
    expect(tools[0]?.readOnly).toBe(true)
    // `move` is registered by host.ts as queue_move; binding the API method too would duplicate the name.
    expect(queueApi.methods.move.tool).toBeUndefined()
  })
})
