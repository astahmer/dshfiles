import type {} from '@deepseek-ai/dsh-tools'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { Duration, Effect, Layer, Schedule } from 'effect'
import { pullRequestApi } from './api.js'
import { GitHubCli } from './github-cli.js'
import { PullRequestMonitor } from './monitor.js'
import { PullRequestStore } from './store.js'
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
).pipe(Layer.provideMerge(monitor))

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
      unwatch: (input, call) =>
        PullRequestMonitor.use(monitor => monitor.unwatch(input, call.caller).pipe(Effect.map(link => ({ link: pullRequestLinkViewOf(link) })))),
    }),
  ],
})
