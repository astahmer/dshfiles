import { describe, expect, it } from 'vitest'
import type { DevServerView } from './api.js'
import { DevServerViews } from './dev-servers-view.js'

const server = { pid: 1 } as unknown as DevServerView

describe('DevServerViews', () => {
  it('lists only threads that serve a port, in the order asked', () => {
    const threads = DevServerViews.threadsWithServers(['a', 'b', 'c'], [[], [server], undefined])
    expect(threads.map(thread => thread.sessionId)).toEqual(['b'])
  })
})
