import type {} from '@deepseek-ai/dsh-tools'
import { Api, DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { Jj } from '@dshfiles/jj-cli'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Clock, Duration, Effect, Layer, PubSub, Stream } from 'effect'
import { MergedPullRequests } from '@dshfiles/jj-integration/merged-pull-requests'
import { pullRequestApi } from './api.js'
import { PullRequestCreator } from './create.js'
import { GitHubCli } from './github-cli.js'
import { GitLabCli } from './gitlab-cli.js'
import { ForgePullRequests } from './forge-port.js'
import { GitHubPointsFloor, PullRequestMonitor, PullRequestMonitorModel } from './monitor.js'
import { ProjectBase } from './project-base.js'
import { PullRequestSettings, pullRequestSettings } from './settings.js'
import { PullRequestRefreshTriggers, TRIGGER_EVENT_TYPES, type ThreadEvent } from './refresh-triggers.js'
import { PullRequestStore } from './store.js'
import { ThreadContext } from './thread-context.js'
import type { PullRequestLinkView, PullRequestRecord } from './pull-request-model.js'

const pullRequestLinkViewOf = (record: PullRequestRecord): PullRequestLinkView => ({
  sessionId: record.sessionId,
  repo: record.repo,
  number: record.number,
  url: record.url,
  watching: record.watching,
  lastKnownState: record.lastKnownState,
  lastCheckedAt: record.lastCheckedAt,
  lastError: record.lastError,
})

const hostServices = Layer.mergeAll(StorageDomain.layer, DshChildProcessSpawner.layer, HostApis.layer)
const storeAndGitHub = Layer.mergeAll(
  PullRequestStore.layer,
  ForgePullRequests.layer.pipe(Layer.provideMerge(Layer.mergeAll(GitHubCli.layer, GitLabCli.layer))),
).pipe(Layer.provideMerge(hostServices))
const monitor = PullRequestMonitor.layer.pipe(Layer.provideMerge(storeAndGitHub))
const jjAndThread = Layer.mergeAll(Jj.layer, ThreadContext.layer).pipe(
  Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, DshChildProcessSpawner.layer)),
)
const creator = PullRequestCreator.layer.pipe(Layer.provideMerge(Layer.mergeAll(monitor, jjAndThread, ProjectBase.layer.pipe(Layer.provide(HostApis.layer)))))

const pollWorker = Layer.effectDiscard(
  Effect.gen(function* () {
    const pullRequests = yield* PullRequestMonitor
    const settings = yield* PullRequestSettings
    const host = yield* HostContext
    const pubsub = yield* Effect.acquireRelease(PubSub.unbounded<ThreadEvent>(), PubSub.shutdown)
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        host.ctx.on('session/event', (session, event) => {
          if (TRIGGER_EVENT_TYPES.has(event.type)) PubSub.publishUnsafe(pubsub, { sessionId: String(session.id), event })
        }),
      ),
      dispose => Effect.sync(dispose),
    )
    const events = Stream.fromSubscription(yield* PubSub.subscribe(pubsub))
    const config = Effect.map(settings.get, value => ({
      enabled: value.refreshOnThreadEvents,
      debounce: Duration.seconds(value.eventDebounceSeconds),
    }))
    const withFloor = <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.flatMap(settings.get, value => effect.pipe(Effect.provideService(GitHubPointsFloor, value.githubPointsFloor)))
    const monitor = {
      refresh: (input: Parameters<typeof pullRequests.refresh>[0]) => withFloor(pullRequests.refresh(input)),
      pollAll: withFloor(pullRequests.pollAll),
    }
    yield* DshxPlugin.worker(PullRequestRefreshTriggers.refreshOnThreadEvents({ monitor, events, config }))
    yield* DshxPlugin.worker(
      PullRequestRefreshTriggers.sweepWatched({ monitor, every: Effect.map(settings.get, value => Duration.minutes(value.sweepMinutes)) }),
    )
  }),
).pipe(Layer.provideMerge(creator), Layer.provideMerge(Settings.layer(pullRequestSettings)))

export default DshxPlugin.make({
  name: '@dshfiles/pull-requests',
  settings: [pullRequestSettings],
  inject: ['storageDomain', 'subprocess'],
  layer: pollWorker,
  apis: [
    Api.bind(pullRequestApi, {
      search: input => GitHubCli.use(github => github.searchIssues(input).pipe(Effect.map(items => ({ items })))),
      link: (input, call) =>
        PullRequestMonitor.use(monitor => monitor.link(input, call.caller).pipe(Effect.map(link => ({ link: pullRequestLinkViewOf(link) })))),
      unlink: (input, call) => PullRequestMonitor.use(monitor => monitor.unlink(input, call.caller)),
      list: (input, call) =>
        PullRequestMonitor.use(monitor =>
          monitor
            .list(input, call.caller)
            .pipe(Effect.map(result => ({ links: result.links.map(pullRequestLinkViewOf), total: result.total, all: result.all }))),
        ),
      watch: (input, call) =>
        PullRequestMonitor.use(monitor => monitor.watch(input, call.caller).pipe(Effect.map(link => ({ link: pullRequestLinkViewOf(link) })))),
      createPreview: (input, call) => PullRequestCreator.use(creator => creator.preview(input, call.caller)),
      create: (input, call) => PullRequestCreator.use(creator => creator.create(input, call.caller)),
      watchFor: input =>
        PullRequestMonitor.use(monitor => monitor.watchFor(input).pipe(Effect.map(watch => ({ watch: PullRequestMonitorModel.ownedWatchViewOf(watch) })))),
      unwatchFor: input => PullRequestMonitor.use(monitor => monitor.unwatchFor(input).pipe(Effect.map(removed => ({ removed })))),
      ownedWatches: input =>
        PullRequestMonitor.use(monitor =>
          monitor.ownedWatches(input).pipe(Effect.map(watches => ({ watches: watches.map(PullRequestMonitorModel.ownedWatchViewOf) }))),
        ),
      issueStates: input =>
        GitHubCli.use(github =>
          Effect.gen(function* () {
            const read = yield* github.issueStates(input)
            const checkedAt = yield* Clock.currentTimeMillis
            return { issues: read.issues.map(issue => ({ ...issue, checkedAt })), failed: read.failed, rateLimited: read.rateLimited }
          }),
        ),
      unwatch: (input, call) =>
        PullRequestMonitor.use(monitor => monitor.unwatch(input, call.caller).pipe(Effect.map(link => ({ link: pullRequestLinkViewOf(link) })))),
    }),
    // Jujutsu integration owns the cleanup that wants this state and cannot import this API without closing a cycle,
    // so it declares the contract and this plugin provides it.
    Api.bind(MergedPullRequests.contract('@dshfiles/pull-requests'), {
      merged: (input, call) =>
        PullRequestMonitor.use(monitor =>
          monitor.list({ all: true }, call.caller).pipe(
            Effect.map(result => ({
              merged: result.links
                .filter(link => input.sessionIds.includes(link.sessionId) && link.lastKnownState?.state === 'MERGED')
                .map(link => ({ sessionId: link.sessionId, label: `${link.repo}#${String(link.number)}` })),
            })),
          ),
        ),
    }),
  ],
})
