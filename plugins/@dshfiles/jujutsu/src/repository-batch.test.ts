import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { JujutsuCommandFailed } from './errors.js'
import { registerRepositoryBatch } from './repository-batch.js'

describe('repository batch', () => {
  it.effect('reports one row per unique path and keeps failures local', () =>
    Effect.gen(function* () {
      const asked: string[] = []
      const results = yield* registerRepositoryBatch({
        paths: ['/repo-a', '/not-a-repo', '/repo-b', '/repo-a'],
        register: path =>
          Effect.suspend(() => {
            asked.push(path)
            if (path === '/not-a-repo') return Effect.fail(new JujutsuCommandFailed({ exitCode: 1 }))
            return Effect.succeed({ repoId: `id:${path}`, root: path })
          }),
      })
      expect(asked.sort()).toEqual(['/not-a-repo', '/repo-a', '/repo-b'])
      expect(results).toEqual([
        { path: '/repo-a', repoId: 'id:/repo-a', root: '/repo-a' },
        { path: '/not-a-repo', repoId: null, root: null },
        { path: '/repo-b', repoId: 'id:/repo-b', root: '/repo-b' },
      ])
    }),
  )

  it.effect('bounds how many repositories resolve at once', () =>
    Effect.gen(function* () {
      let running = 0
      let peak = 0
      const paths = Array.from({ length: 9 }, (_, index) => `/repo-${String(index)}`)
      const batch = yield* Effect.forkChild(
        registerRepositoryBatch({
          paths,
          concurrency: 3,
          register: path =>
            Effect.gen(function* () {
              running += 1
              peak = Math.max(peak, running)
              yield* Effect.sleep('1 second')
              running -= 1
              return { repoId: path, root: path }
            }),
        }),
      )
      for (let round = 0; round < 3; round += 1) yield* TestClock.adjust('1 second')
      expect(yield* Fiber.join(batch)).toHaveLength(9)
      expect(peak).toBe(3)
    }),
  )
})
