import { describe, expect, it } from 'vitest'
import { bulkStoppable } from './stop-scope.js'
import type { ProcessTree } from './types.js'

const tree = (overrides: Partial<ProcessTree>): ProcessTree => ({
  pid: 1,
  startedAt: 1,
  name: 'node',
  command: 'node',
  cwd: '/dev/app',
  bytes: 1024,
  processCount: 1,
  origin: 'host',
  category: 'other',
  jobId: null,
  sessionId: null,
  ownerRunning: false,
  ...overrides,
})

describe('bulkStoppable', () => {
  it('leaves a job whose thread is mid-turn to that thread’s own Stop', () => {
    const runningJob = tree({ pid: 10, origin: 'job', jobId: 'bash-1', sessionId: 'session-a', ownerRunning: true })
    const idleJob = tree({ pid: 11, origin: 'job', jobId: 'bash-2', sessionId: 'session-b', ownerRunning: false })
    const detached = tree({ pid: 12, origin: 'detached', sessionId: 'session-c', ownerRunning: false })
    expect(bulkStoppable([runningJob, idleJob, detached]).map(candidate => candidate.pid)).toEqual([11, 12])
  })

  it('keeps a job whose thread finished its turn, so old leftovers still clear in bulk', () => {
    const finishedJob = tree({ pid: 20, origin: 'job', jobId: 'bash-3', sessionId: 'session-d', ownerRunning: false })
    expect(bulkStoppable([finishedJob]).map(candidate => candidate.pid)).toEqual([20])
  })
})
