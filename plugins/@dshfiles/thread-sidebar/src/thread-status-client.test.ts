import { describe, expect, it, vi } from 'vitest'
import { ThreadWorkStatusModel } from './thread-status-client.js'

describe('thread work status store', () => {
  it('notifies readers only when a status or its detail changes', () => {
    const store = ThreadWorkStatusModel.createStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.publish(new Map([['parent', { status: 'working', detail: 'Waiting on 1 subagent' }]]))
    store.publish(new Map([['parent', { status: 'working', detail: 'Waiting on 1 subagent' }]]))
    expect(listener).toHaveBeenCalledOnce()
    expect(store.getSnapshot()?.get('parent')?.status).toBe('working')
    store.publish(new Map([['parent', { status: 'ready', detail: undefined }]]))
    store.publish(null)
    expect(listener).toHaveBeenCalledTimes(3)
    expect(store.getSnapshot()).toBeNull()
  })
})
