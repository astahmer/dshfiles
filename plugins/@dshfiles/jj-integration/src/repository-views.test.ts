import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Layer, References, Ref } from 'effect'
import { SessionReads, WorkspaceRegistry } from './host-edges-promise.js'
import { IntegrationRequests, IsolatedSessions } from './integration-requests.js'
import { ProjectBookmarks } from './project-bookmarks.js'
import { RepositoryViews } from './repository-views.js'
import { SessionActivity } from './session-activity.js'
import { ThreadWorkspaces } from './thread-workspaces.js'

const fixture = Effect.gen(function* () {
  const scans = yield* Ref.make(0)
  const release = yield* Deferred.make<void>()
  const registry = Layer.mock(WorkspaceRegistry, {
    list: Effect.succeed([]),
    archivedSessionIds: Effect.succeed(new Set<string>()),
  })
  const layer = RepositoryViews.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        registry,
        Layer.mock(ThreadWorkspaces, {}),
        Layer.mock(ProjectBookmarks, {}),
        Layer.mock(SessionReads, {}),
        Layer.mock(SessionActivity, { display: Ref.update(scans, count => count + 1).pipe(Effect.andThen(Deferred.await(release)), Effect.as(undefined)) }),
        Layer.mock(IntegrationRequests, {}),
        Layer.mock(IsolatedSessions, {}),
        NodeServices.layer,
      ),
    ),
  )
  return { scans, release, layer }
})

describe('RepositoryViews scan start', () => {
  it.live('starts one scan when two callers ask at once, even when the scheduler yields between them', () =>
    Effect.gen(function* () {
      const { scans, release, layer } = yield* fixture
      yield* Effect.gen(function* () {
        const views = yield* RepositoryViews
        const started = yield* Effect.all([views.startRefresh, views.startRefresh, views.startRefresh], { concurrency: 'unbounded' }).pipe(
          Effect.provideService(References.MaxOpsBeforeYield, 4),
        )
        yield* Effect.yieldNow
        yield* Deferred.succeed(release, undefined)
        expect(started.filter(Boolean)).toHaveLength(1)
        expect(yield* Ref.get(scans)).toBe(1)
        expect(yield* views.list).toEqual([])
      }).pipe(Effect.provide(layer), Effect.timeout('5 seconds'))
    }),
  )
})
