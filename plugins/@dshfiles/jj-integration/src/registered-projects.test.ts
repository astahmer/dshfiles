import { describe, expect, it } from 'vitest'
import { registeredProjects } from './registered-projects.js'

const workspaces = [
  { workspaceId: 'recent', title: 'Recent', path: '/work/recent' },
  { workspaceId: 'thread', title: 'Thread', path: '/work/thread' },
  { workspaceId: 'older', title: 'Older', path: '/work/older' },
]

describe('registeredProjects', () => {
  it('checks workspace types concurrently and keeps registry order', async () => {
    let activeChecks = 0
    let maximumConcurrentChecks = 0
    const projectsPromise = registeredProjects({
      workspaces,
      isSecondaryWorkspace: async path => {
        activeChecks += 1
        maximumConcurrentChecks = Math.max(maximumConcurrentChecks, activeChecks)
        await Promise.resolve()
        activeChecks -= 1
        return path === '/work/thread'
      },
    })

    await expect(projectsPromise).resolves.toEqual([workspaces[0], workspaces[2]])
    expect(maximumConcurrentChecks).toBe(workspaces.length)
  })
})
