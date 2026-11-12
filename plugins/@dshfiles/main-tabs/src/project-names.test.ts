import { expect, test } from 'vitest'
import { ProjectNames } from './project-names.js'

test('names each project workspace after its folder', () => {
  const names = ProjectNames.byWorkspaceId([
    { workspaceId: 'a', path: '/Users/me/dev/dshfiles' },
    { workspaceId: 'b', path: 'C:\\code\\site\\' },
    { workspaceId: 'c', path: '/' },
  ])
  expect([...names]).toEqual([
    ['a', 'dshfiles'],
    ['b', 'site'],
  ])
})

test('names a thread workspace after the project it was cut from', () => {
  const names = ProjectNames.byWorkspaceId(
    [
      { workspaceId: 'thread', path: '/Users/me/dev/dshfiles-threads/thread-1ceffc' },
      { workspaceId: 'custom', path: '/Users/me/threads/site/thread-ab12' },
    ],
    new Map([['/Users/me/threads/site', '/Users/me/code/site']]),
  )
  expect([...names]).toEqual([
    ['thread', 'dshfiles'],
    ['custom', 'site'],
  ])
})
