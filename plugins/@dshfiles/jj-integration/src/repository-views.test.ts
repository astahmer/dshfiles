import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceId, type Workspace } from '@deepseek-ai/dsh-workspace'
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

describe('RepositoryViews thread statuses', () => {
  it.live('lists a repository again when its operation head moves, and only then', () =>
    Effect.gen(function* () {
      const repoRoot = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'jj-views-op-heads-')))
      const heads = join(repoRoot, '.jj', 'repo', 'op_heads', 'heads')
      yield* Effect.promise(() => mkdir(join(heads, 'aaaa'), { recursive: true }))
      const lists = yield* Ref.make(0)
      const workspace: Workspace = {
        id: WorkspaceId('workspace-1'),
        path: repoRoot,
        title: 'repo',
        createdAt: '2026-11-09T00:00:00.000Z',
        updatedAt: '2026-11-09T00:00:00.000Z',
        sessionIds: [],
        setTitle: () => Promise.resolve(),
        attachSession: () => Promise.resolve(),
        insertSessionBefore: () => Promise.resolve(),
        detachSession: () => Promise.resolve(),
        status: () => Promise.resolve('ok'),
      }
      const layer = RepositoryViews.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(WorkspaceRegistry, { list: Effect.succeed([workspace]), archivedSessionIds: Effect.succeed(new Set<string>()) }),
            Layer.mock(ThreadWorkspaces, {
              locate: () => Effect.succeed({ repoRoot, workspaceRoot: repoRoot, threadName: undefined }),
              list: () =>
                Effect.as(
                  Ref.update(lists, count => count + 1),
                  [],
                ),
              bookmarks: () => Effect.succeed({ current: null, names: [] }),
            }),
            Layer.mock(ProjectBookmarks, { bookmarkFor: () => Effect.succeed('main') }),
            Layer.mock(SessionReads, {}),
            Layer.mock(SessionActivity, { display: Effect.succeed(undefined) }),
            Layer.mock(IntegrationRequests, {}),
            Layer.mock(IsolatedSessions, {}),
            NodeServices.layer,
          ),
        ),
      )
      yield* Effect.gen(function* () {
        const views = yield* RepositoryViews
        yield* views.list
        yield* views.list
        expect(yield* Ref.get(lists)).toBe(1)
        yield* Effect.promise(() => rename(join(heads, 'aaaa'), join(heads, 'bbbb')))
        yield* views.list
        expect(yield* Ref.get(lists)).toBe(2)
      }).pipe(Effect.provide(layer), Effect.ensuring(Effect.promise(() => rm(repoRoot, { recursive: true, force: true }))))
    }),
  )
})
