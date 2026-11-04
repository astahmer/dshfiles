import { describe, expect, it } from 'vitest'
import { forThread } from './panel.js'
import type { ProcessTree, WorkspaceGroup } from './types.js'

const tree = (patch: Partial<ProcessTree>): ProcessTree =>
  ({
    pid: 1,
    startedAt: 0,
    name: 'node',
    command: 'node',
    cwd: '/w',
    bytes: 100,
    processCount: 1,
    origin: 'job',
    category: 'other',
    jobId: null,
    sessionId: null,
    ownerRunning: false,
    ...patch,
  }) as ProcessTree

const group = (trees: readonly ProcessTree[]): WorkspaceGroup =>
  ({
    key: '/w',
    title: 'w',
    path: '/w',
    kind: 'workspace',
    project: null,
    bytes: 999,
    detachedBytes: 0,
    detachedCount: 0,
    threadCount: 1,
    threads: [],
    trees,
  }) as WorkspaceGroup

describe('forThread', () => {
  it('keeps only the trees one thread started and sums their bytes', () => {
    const groups = forThread(
      [
        group([
          tree({ pid: 1, sessionId: 's1', bytes: 100 }),
          tree({ pid: 2, sessionId: 's2', bytes: 50 }),
          tree({ pid: 3, sessionId: 's1', bytes: 25, origin: 'detached' }),
        ]),
        group([tree({ sessionId: 's2' })]),
      ],
      's1',
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]?.trees.map(entry => entry.pid)).toEqual([1, 3])
    expect(groups[0]).toMatchObject({ bytes: 125, detachedBytes: 25, detachedCount: 1 })
  })
})
