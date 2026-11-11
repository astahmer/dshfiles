import { describe, expect, test } from 'vitest'
import { queueApi } from './api.js'
import { scheduledSendApi } from './scheduled-send-api.js'

describe('queue-reorder tool exposure', () => {
  test('the queued rows are readable and the move tool keeps its own registration', () => {
    const tools = Object.values(queueApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name)).toEqual(['queue_describe'])
    expect(tools[0]?.readOnly).toBe(true)
    // `move` is registered by host.ts as queue_move; binding the API method too would duplicate the name.
    expect(queueApi.methods.move.tool).toBeUndefined()
  })

  test('every scheduled-send verb has an agent tool; only the list is read-only and every write waits for the user', () => {
    const methods = Object.values(scheduledSendApi.methods)
    expect(methods.map(method => method.tool?.name)).toEqual([
      'scheduled_send_list',
      'scheduled_send_create',
      'scheduled_send_update',
      'scheduled_send_cancel',
      'scheduled_send_now',
    ])
    expect(methods.filter(method => method.tool?.readOnly === true).map(method => method.tool?.name)).toEqual(['scheduled_send_list'])
    for (const method of methods.filter(method => method.tool?.readOnly !== true)) expect(method.description).toMatch(/only when the user asked/u)
  })
})
