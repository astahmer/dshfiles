import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref } from 'effect'
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
  it.effect('splits projects from thread workspaces concurrently, drops missing folders and keeps registry order', () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0)
      const peak = yield* Ref.make(0)
      const result = yield* registeredProjects({
        workspaces,
        classify: path =>
          Effect.gen(function* () {
            const now = yield* Ref.updateAndGet(active, count => count + 1)
            yield* Ref.update(peak, current => Math.max(current, now))
            yield* Effect.yieldNow
            yield* Ref.update(active, count => count - 1)
            return kindByPath.get(path) ?? 'project'
          }),
      })
      expect(result.projects).toEqual([workspaces[0], workspaces[3]])
      expect(result.workspaces).toEqual([workspaces[1]])
      expect(yield* Ref.get(peak)).toBe(workspaces.length)
    }),
  )
})
