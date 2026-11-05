import { afterEach, describe, expect, it, vi } from 'vitest'
import { RestartBridge } from './restart-bridge.js'

describe('RestartBridge', () => {
  afterEach(() => RestartBridge.publish(RestartBridge.empty))

  it('lists every pending package once, sorted, whichever source named it', () => {
    expect(RestartBridge.combine([['@dshfiles/b', '@dshfiles/a'], ['@dshfiles/a', '@dshfiles/c'], []])).toEqual(['@dshfiles/a', '@dshfiles/b', '@dshfiles/c'])
  })

  it('notifies the item only when what it shows changes', () => {
    const listener = vi.fn()
    const stop = RestartBridge.subscribe(listener)
    RestartBridge.publish({ hostPlugins: ['@dshfiles/a'], available: true, waitingLabel: null })
    RestartBridge.publish({ hostPlugins: ['@dshfiles/a'], available: true, waitingLabel: null })
    expect(listener).toHaveBeenCalledTimes(1)
    RestartBridge.publish({ hostPlugins: ['@dshfiles/a'], available: true, waitingLabel: 'Restart pending: waiting for running turns to finish' })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(RestartBridge.read().waitingLabel).toBe('Restart pending: waiting for running turns to finish')
    stop()
  })

  it('hands a verb to the shell that owns the dialog', () => {
    const handler = vi.fn()
    const stop = RestartBridge.onRequest(handler)
    RestartBridge.request('restart-when-idle')
    stop()
    RestartBridge.request('restart')
    expect(handler.mock.calls).toEqual([['restart-when-idle']])
  })
})
