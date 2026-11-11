import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { HostContext } from '@dshfiles/dshx/effect/host-context'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { threadSidebarAutoSettleApi } from '@dshfiles/thread-sidebar/auto-settle-api'
import { Effect, Layer, Ref, Schema } from 'effect'
import { GhCommandFailed, type PullRequestRead } from '../src/github-cli.js'
import { ForgePullRequests, type ForgePullRequestTarget } from '../src/forge-port.js'
import { PullRequestMonitor } from '../src/monitor.js'
import type { GitHubPullRequestView, PullRequestRecord } from '../src/pull-request-model.js'
import { PullRequestStore } from '../src/store.js'

const PACKAGE_ID = '@dshfiles/pull-requests'

const view: GitHubPullRequestView = {
  state: 'OPEN',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  reviewDecision: 'APPROVED',
  statusCheckRollup: [{ __typename: 'CheckRun', name: 'unit', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  comments: [],
  reviews: [],
  body: '',
}

/** Every poll of this pull request fails, and it sorts before `acme/third#9` so a skipped tail would show. */
const failingPullRequest = 'acme/other#8'

const record = (input: { readonly repo: string; readonly number: number; readonly sessionId: string }): PullRequestRecord => ({
  id: `${encodeURIComponent(input.sessionId)}::${input.repo.toLowerCase()}#${String(input.number)}`,
  sessionId: input.sessionId,
  repo: input.repo,
  number: input.number,
  url: `https://github.com/${input.repo}/pull/${String(input.number)}`,
  cwd: '/work/widget',
  watching: true,
  lastKnownState: null,
  lastCheckedAt: null,
  retryAfterAt: null,
  consecutiveRateLimits: 0,
  lastError: null,
})

/** A batch read built from a per-pull-request answer, as the GitHub adapter reports each target's own outcome. */
const batchOf =
  (readOne: (target: ForgePullRequestTarget) => Effect.Effect<GitHubPullRequestView, GhCommandFailed>) =>
  (input: { readonly targets: readonly ForgePullRequestTarget[] }) =>
    Effect.map(
      Effect.forEach(input.targets, target =>
        readOne(target).pipe(
          Effect.map((value): PullRequestRead => ({ kind: 'read', view: value, fingerprint: null })),
          Effect.catch((): Effect.Effect<PullRequestRead> => Effect.succeed({ kind: 'failed', error: 'gh-command-failed' })),
        ),
      ),
      reads => ({ reads, rateLimit: null, rateLimited: false }),
    )

const fakeForge = (polls: string[]) =>
  Layer.succeed(
    ForgePullRequests,
    ForgePullRequests.of({
      repositoryInfo: () => Effect.die('repositoryInfo is not used here'),
      authStatus: () => Effect.die('authStatus is not used here'),
      pullRequests: batchOf(input =>
        Effect.suspend(() => {
          const key = `${input.repo}#${String(input.number)}`
          polls.push(key)
          return key === failingPullRequest
            ? Effect.fail(new GhCommandFailed({ operation: 'pr-view', rateLimited: false, exitCode: 1, detail: 'boom' }))
            : Effect.succeed(view)
        }),
      ),
      openPullRequestFor: () => Effect.die('openPullRequestFor is not used here'),
      createPullRequest: () => Effect.die('createPullRequest is not used here'),
    }),
  )

const withStorageHost = <A, E, R>(use: (host: Awaited<ReturnType<typeof createTestHost>>) => Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const storageRoot = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'pull-requests-poll-all-')))
      const mounted = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const host = await createTestHost()
          await host.ctx.plugin(Storage)
          await host.ctx.plugin(StorageJson, { root: storageRoot })
          await host.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
          return host
        }),
        host => Effect.promise(() => host.dispose()),
      )
      return yield* use(mounted).pipe(Effect.ensuring(Effect.promise(() => rm(storageRoot, { recursive: true, force: true }))))
    }),
  )

class SettleBusy extends Schema.TaggedError<SettleBusy>()('SettleBusy', {}) {}

describe('pull-requests pollAll', () => {
  it.effect('keeps polling a merged pull request only until its thread is settled', () =>
    withStorageHost(host => {
      const polls: string[] = []
      const hostContext = HostContext.of({ ctx: host.ctx, packageId: PACKAGE_ID })
      const merged = Layer.succeed(
        ForgePullRequests,
        ForgePullRequests.of({
          repositoryInfo: () => Effect.die('unused'),
          authStatus: () => Effect.die('unused'),
          pullRequests: batchOf(input => Effect.sync(() => (polls.push(`${input.repo}#${String(input.number)}`), { ...view, state: 'MERGED' as const }))),
          openPullRequestFor: () => Effect.die('unused'),
          createPullRequest: () => Effect.die('unused'),
        }),
      )
      const layer = PullRequestMonitor.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(PullRequestStore.layer, merged).pipe(
            Layer.provideMerge(Layer.mergeAll(StorageDomain.layer, HostApis.layer).pipe(Layer.provide(Layer.succeed(HostContext, hostContext)))),
          ),
        ),
      )
      return Effect.gen(function* () {
        const attempts = yield* Ref.make(0)
        const sidebar = DshxPlugin.make({
          name: '@dshfiles/thread-sidebar',
          layer: Layer.empty,
          apis: [
            Api.bind(threadSidebarAutoSettleApi, {
              status: () => Effect.die('unused'),
              requestSettle: input =>
                Effect.flatMap(
                  Ref.getAndUpdate(attempts, count => count + 1),
                  count =>
                    count === 0
                      ? Effect.fail(new SettleBusy())
                      : Effect.succeed({ results: input.sessionIds.map(sessionId => ({ sessionId, outcome: 'settled' as const })) }),
                ),
            }),
          ],
        })
        yield* Effect.promise(() => host.mount(sidebar, { packageId: '@dshfiles/thread-sidebar' }))
        const store = yield* PullRequestStore
        const monitor = yield* PullRequestMonitor
        yield* store.upsert(record({ repo: 'acme/widget', number: 7, sessionId: 'session-a' }))

        yield* monitor.pollAll
        expect((yield* store.list())[0]?.watching).toBe(true)
        yield* monitor.pollAll
        expect((yield* store.list())[0]?.watching).toBe(false)
        yield* monitor.pollAll
        expect(polls).toHaveLength(2)
        expect(yield* Ref.get(attempts)).toBe(2)
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect('polls each unique pull request once and keeps polling after a failing target', () =>
    withStorageHost(host => {
      const polls: string[] = []
      const hostContext = HostContext.of({ ctx: host.ctx, packageId: PACKAGE_ID })
      const layer = PullRequestMonitor.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(PullRequestStore.layer, fakeForge(polls)).pipe(
            Layer.provideMerge(Layer.mergeAll(StorageDomain.layer, HostApis.layer).pipe(Layer.provide(Layer.succeed(HostContext, hostContext)))),
          ),
        ),
      )

      return Effect.gen(function* () {
        const store = yield* PullRequestStore
        const monitor = yield* PullRequestMonitor
        const seeded = [
          record({ repo: 'acme/widget', number: 7, sessionId: 'session-a' }),
          record({ repo: 'acme/widget', number: 7, sessionId: 'session-b' }),
          record({ repo: 'acme/widget', number: 7, sessionId: 'session-c' }),
          record({ repo: 'acme/other', number: 8, sessionId: 'session-d' }),
          record({ repo: 'acme/third', number: 9, sessionId: 'session-e' }),
        ]
        for (const link of seeded) yield* store.upsert(link)

        yield* monitor.pollAll

        expect(polls.sort()).toEqual([failingPullRequest, 'acme/third#9', 'acme/widget#7'])

        const stored = yield* store.list()
        expect(stored).toHaveLength(seeded.length)

        const shared = stored.filter(link => link.repo === 'acme/widget')
        expect(shared).toHaveLength(3)
        for (const link of shared) {
          expect(link.lastKnownState?.state).toBe('OPEN')
          expect(link.lastKnownState?.checks).toHaveLength(1)
          expect(link.lastCheckedAt).not.toBeNull()
          expect(link.lastError).toBeNull()
        }

        const failed = stored.find(link => link.repo === 'acme/other')
        expect(failed?.lastKnownState).toBeNull()
        expect(failed?.lastError).toBe('gh-command-failed')
        expect(failed?.lastCheckedAt).not.toBeNull()
        expect(failed?.watching).toBe(true)

        const afterFailure = stored.find(link => link.repo === 'acme/third')
        expect(afterFailure?.lastKnownState?.state).toBe('OPEN')
        expect(afterFailure?.lastError).toBeNull()
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect('an event refresh polls only the pull requests its threads watch, once, and skips one checked moments ago', () =>
    withStorageHost(host => {
      const polls: string[] = []
      const hostContext = HostContext.of({ ctx: host.ctx, packageId: PACKAGE_ID })
      const layer = PullRequestMonitor.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(PullRequestStore.layer, fakeForge(polls)).pipe(
            Layer.provideMerge(Layer.mergeAll(StorageDomain.layer, HostApis.layer).pipe(Layer.provide(Layer.succeed(HostContext, hostContext)))),
          ),
        ),
      )
      return Effect.gen(function* () {
        const store = yield* PullRequestStore
        const monitor = yield* PullRequestMonitor
        for (const link of [
          record({ repo: 'acme/widget', number: 7, sessionId: 'session-a' }),
          record({ repo: 'acme/widget', number: 7, sessionId: 'session-b' }),
          record({ repo: 'acme/third', number: 9, sessionId: 'session-e' }),
        ])
          yield* store.upsert(link)

        expect(yield* monitor.refresh({ sessionIds: ['session-a', 'session-b', 'session-unknown'], minAgeMs: 20_000 })).toBe(1)
        expect(polls).toEqual(['acme/widget#7'])
        expect(yield* monitor.refresh({ sessionIds: ['session-a'], minAgeMs: 20_000 })).toBe(0)
        expect(polls).toEqual(['acme/widget#7'])
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect('a backlog item watches a pull request with no thread: polled at once and by the sweep, released on request', () =>
    withStorageHost(host => {
      const polls: string[] = []
      let state: GitHubPullRequestView['state'] = 'OPEN'
      const hostContext = HostContext.of({ ctx: host.ctx, packageId: PACKAGE_ID })
      const forge = Layer.succeed(
        ForgePullRequests,
        ForgePullRequests.of({
          repositoryInfo: () => Effect.die('unused'),
          authStatus: () => Effect.die('unused'),
          pullRequests: batchOf(input =>
            Effect.sync(() => {
              polls.push(`${input.repo}#${String(input.number)}`)
              return { ...view, state }
            }),
          ),
          openPullRequestFor: () => Effect.die('unused'),
          createPullRequest: () => Effect.die('unused'),
        }),
      )
      const layer = PullRequestMonitor.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(PullRequestStore.layer, forge).pipe(
            Layer.provideMerge(Layer.mergeAll(StorageDomain.layer, HostApis.layer).pipe(Layer.provide(Layer.succeed(HostContext, hostContext)))),
          ),
        ),
      )
      return Effect.gen(function* () {
        const store = yield* PullRequestStore
        const monitor = yield* PullRequestMonitor
        const owner = { kind: 'backlog-item', id: '42' } as const
        const url = 'https://github.com/acme/widget/pull/7'

        const watched = yield* monitor.watchFor({ owner, url })
        expect(polls).toEqual(['acme/widget#7'])
        expect(watched.lastKnownState?.state).toBe('OPEN')
        expect(watched.lastCheckedAt).not.toBeNull()
        expect(yield* store.list()).toEqual([])

        yield* monitor.watchFor({ owner, url })
        expect(polls).toHaveLength(1)

        state = 'MERGED'
        yield* monitor.pollAll
        const [merged] = yield* monitor.ownedWatches({ kind: 'backlog-item' })
        expect(merged?.lastKnownState?.state).toBe('MERGED')
        expect(merged?.watching).toBe(false)

        yield* monitor.pollAll
        expect(polls).toHaveLength(2)

        expect(yield* monitor.unwatchFor({ owner })).toBe(1)
        expect(yield* monitor.ownedWatches({ kind: 'backlog-item' })).toEqual([])
      }).pipe(Effect.provide(layer))
    }),
  )
})
