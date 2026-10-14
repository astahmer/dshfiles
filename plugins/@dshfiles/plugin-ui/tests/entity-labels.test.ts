import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EntityLabels } from '../src/hooks/entity-labels.js'

const store = <Snapshot>(snapshot: Snapshot) => ({ list: { subscribe: () => () => undefined, getSnapshot: () => snapshot } })

const workspaces = store({
  items: [
    { workspaceId: 'w-repo', title: 'dshfiles', path: '/dev/dshfiles' },
    { workspaceId: 'w-thread', title: 'dshfiles · thread-4c91b5', path: '/dev/dshfiles-threads/thread-4c91b5' },
    { workspaceId: 'w-other', title: 'nixfiles', path: '/dev/nixfiles/' },
  ],
})

describe('EntityLabels', () => {
  it('folds jj thread workspaces under the repository they were cut from', () => {
    const groups = EntityLabels.groupByRepository([
      { path: '/dev/dshfiles-threads/thread-4c91b5', id: 'thread' },
      { path: '/dev/dshfiles', id: 'repo' },
      { path: '/elsewhere-threads/thread-aaaaaa', id: 'orphan' },
      { path: null, id: 'unregistered' },
    ])
    expect(groups.map(group => [group.repositoryPath, group.project?.id ?? null, group.threads.map(thread => thread.id)])).toEqual([
      ['/dev/dshfiles', 'repo', ['thread']],
      ['/elsewhere', null, ['orphan']],
    ])
  })

  it('names a thread workspace after its repository project and an unknown folder after its basename', () => {
    const { result } = renderHook(() => EntityLabels.useWorkspaceLabel(workspaces))
    expect(result.current({ workspaceId: 'w-thread' })).toBe('dshfiles')
    expect(result.current({ path: '/dev/nixfiles' })).toBe('nixfiles')
    expect(result.current({ path: '/tmp/scratch-project' })).toBe('scratch-project')
  })

  it('names a Session by its thread title and an unknown one by a short id', () => {
    const sessions = store({ byId: { 'session-1': { displayTitle: 'Fix the composer', cwd: '/dev/dshfiles' }, 'session-2': { displayTitle: ' ' } } })
    const { result } = renderHook(() => EntityLabels.useSessionLabel(sessions))
    expect(result.current('session-1')).toBe('Fix the composer')
    expect(result.current('session-2')).toBe('Thread 2')
    expect(result.current('session-0123456789')).toBe('Thread 01234567')
  })
})
