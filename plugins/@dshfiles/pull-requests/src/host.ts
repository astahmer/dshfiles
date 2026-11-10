import type {} from '@deepseek-ai/dsh-tools'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { Jj } from '@dshfiles/jj-cli'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Duration, Effect, Layer, Schedule } from 'effect'
import { MergedPullRequests } from '@dshfiles/jj-integration/merged-pull-requests'
import { pullRequestApi } from './api.js'
import { PullRequestCreator } from './create.js'
import { GitHubCli } from './github-cli.js'
import { PullRequestMonitor } from './monitor.js'
import { ProjectBase } from './project-base.js'
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
const storeAndGitHub = Layer.mergeAll(PullRequestStore.layer, GitHubCli.layer).pipe(Layer.provideMerge(hostServices))
const monitor = PullRequestMonitor.layer.pipe(Layer.provideMerge(storeAndGitHub))
const jjAndThread = Layer.mergeAll(Jj.layer, ThreadContext.layer).pipe(
  Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, DshChildProcessSpawner.layer)),
)
const creator = PullRequestCreator.layer.pipe(Layer.provideMerge(Layer.mergeAll(monitor, jjAndThread, ProjectBase.layer.pipe(Layer.provide(HostApis.layer)))))

const pollWorker = Layer.effectDiscard(
  Effect.gen(function* () {
    const pullRequests = yield* PullRequestMonitor
    yield* DshxPlugin.worker(
      pullRequests.pollAll.pipe(
        Effect.catchCause(() => Effect.logWarning('pull-requests: scheduled poll failed; polling will continue')),
        Effect.repeat(Schedule.spaced(Duration.minutes(2))),
      ),
    )
  }),
).pipe(Layer.provideMerge(creator))

export default DshxPlugin.make({
  name: '@dshfiles/pull-requests',
  inject: ['storageDomain', 'subprocess'],
  layer: pollWorker,
  apis: [
    Api.bind(pullRequestApi, {
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
