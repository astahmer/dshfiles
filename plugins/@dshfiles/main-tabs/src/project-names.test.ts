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
