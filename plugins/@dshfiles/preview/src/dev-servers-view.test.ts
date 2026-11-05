import { describe, expect, it } from 'vitest'
import type { DevServerView } from './api.js'
import { DevServerViews } from './dev-servers-view.js'

const server: DevServerView = {
  pid: 1,
  startedAt: 0,
  name: 'vite',
  command: 'vite',
  cwd: '/repo',
  ports: [{ address: '127.0.0.1', port: 5173, url: 'http://127.0.0.1:5173' }],
  sessionIds: ['b'],
  attribution: 'workspace',
  jobId: null,
}

describe('DevServerViews', () => {
  it('lists only threads that serve a port, in the order asked', () => {
    const threads = DevServerViews.threadsWithServers(['a', 'b', 'c'], [[], [server], undefined])
    expect(threads.map(thread => thread.sessionId)).toEqual(['b'])
  })
})
