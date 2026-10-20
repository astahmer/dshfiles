import { describe, expect, it } from 'vitest'
import { registeredProjects, type RegisteredWorkspaceKind } from './registered-projects.js'

const workspaces = [
  { workspaceId: 'recent', title: 'Recent', path: '/work/recent' },
  { workspaceId: 'thread', title: 'Thread', path: '/work/thread' },
  { workspaceId: 'removed', title: 'Removed thread', path: '/work/removed' },
  { workspaceId: 'older', title: 'Older', path: '/work/older' },
]

const kindByPath = new Map<string, RegisteredWorkspaceKind>([
  ['/work/thread', 'workspace'],
  ['/work/removed', 'missing'],
])

describe('registeredProjects', () => {
  it('splits projects from thread workspaces concurrently, drops missing folders and keeps registry order', async () => {
    let activeChecks = 0
    let maximumConcurrentChecks = 0
    const result = await registeredProjects({
      workspaces,
      classify: async path => {
        activeChecks += 1
        maximumConcurrentChecks = Math.max(maximumConcurrentChecks, activeChecks)
        await Promise.resolve()
        activeChecks -= 1
        return kindByPath.get(path) ?? 'project'
      },
    })

    expect(result.projects).toEqual([workspaces[0], workspaces[3]])
    expect(result.workspaces).toEqual([workspaces[1]])
    expect(maximumConcurrentChecks).toBe(workspaces.length)
  })
})
