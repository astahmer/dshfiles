import type {} from '@deepseek-ai/dsh-subprocess'
import { Git } from '@dshfiles/git-cli'
import { Jj, JjViewReads } from '@dshfiles/jj-cli'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { VcsProviders } from '@dshfiles/vcs-provider-port'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Duration, Effect, Layer, Option } from 'effect'
import { jjIntegrationApi } from './api.js'
import { LandAttention } from './attention-provider.js'
import { AutoIntegration } from './auto-integration.js'
import { Cleanup } from './cleanup.js'
import { Executables } from './executables-promise.js'
import { HostEdgesLive } from './host-edges-promise.js'
import { HostHooksLive, rebaseCommand } from './host-hooks-promise.js'
import { IntegrationQueue } from './integration-queue.js'
import { IntegrationRequests, IsolatedSessions } from './integration-requests.js'
import { JjSettingsLive } from './jj-settings.js'
import { Landing } from './landing.js'
import { MaintenanceLive } from './maintenance.js'
import { RepoLocks } from './repo-locks.js'
import { RepositoryViews } from './repository-views.js'
import { SessionActivity } from './session-activity.js'
import { jjIntegrationSettings } from './settings.js'
import { ThreadLifecycle } from './thread-lifecycle.js'
import { ThreadWorkspaces } from './thread-workspaces.js'
import { WorkspaceSync } from './workspace-sync.js'

const JJ_TIMEOUT = Duration.minutes(2)
const JJ_PROVIDER_PRIORITY = 100
const GIT_PROVIDER_PRIORITY = 50
const MAX_JJ_STDOUT_BYTES = 512 * 1024
const MAX_JJ_STDERR_BYTES = 64 * 1024

const PlatformLive = Layer.mergeAll(DshChildProcessSpawner.layer, NodeFileSystem.layer, NodePath.layer)

const BaseLive = Layer.mergeAll(
  RepoLocks.layer,
  Executables.layer,
  JjSettingsLive,
  HostEdgesLive,
  IntegrationRequests.layer,
  IsolatedSessions.layer,
  HostApis.layer,
)

const JjIntegrationLive = Layer.mergeAll(MaintenanceLive, HostHooksLive, IntegrationQueue.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(AutoIntegration.layer, Cleanup.layer, ThreadLifecycle.layer, LandAttention.layer)),
  Layer.provideMerge(Landing.layer),
  Layer.provideMerge(Layer.mergeAll(RepositoryViews.layer, WorkspaceSync.layer)),
  Layer.provideMerge(SessionActivity.layer),
  Layer.provideMerge(ThreadWorkspaces.layer),
  Layer.provideMerge(JjViewReads.layer),
  Layer.provideMerge(Jj.layerWith({ timeout: JJ_TIMEOUT, maxStdoutBytes: MAX_JJ_STDOUT_BYTES, maxStderrBytes: MAX_JJ_STDERR_BYTES })),
  // Automatic fetch runs git in a git-only repository; thread workspaces get their own Git through ThreadWorkspaces.layer.
  Layer.provideMerge(Git.layer),
  Layer.provideMerge(BaseLive),
  Layer.provideMerge(PlatformLive),
)

const handlers = Api.handlers(jjIntegrationApi, {
  ownWorkspaceFor: input => ThreadLifecycle.use(lifecycle => lifecycle.ownWorkspaceFor(input)),
  provision: input => ThreadLifecycle.use(lifecycle => lifecycle.provision(input)),
  isolate: (_input, call) => ThreadLifecycle.use(lifecycle => lifecycle.isolate(call.caller)),
  destination: input => ThreadLifecycle.use(lifecycle => lifecycle.destination(input)),
  classifyWorkspaces: input => ThreadLifecycle.use(lifecycle => lifecycle.classifyWorkspaces(input)),
  projects: () => ThreadLifecycle.use(lifecycle => lifecycle.projects),
  noFolder: () => ThreadLifecycle.use(lifecycle => lifecycle.noFolder),
  repositories: () => RepositoryViews.use(views => views.snapshot),
  refreshRepositories: () => RepositoryViews.use(views => Effect.map(views.startRefresh, started => ({ started }))),
  threadAt: input => ThreadLifecycle.use(lifecycle => lifecycle.threadAt(input)),
  revisionGraph: input => ThreadWorkspaces.use(threads => Effect.map(threads.revisionGraph(input.path), graph => ({ graph }))),
  // A land from a client view resolves its ready-to-land inbox item at once instead of on the provider's safety tick.
  land: input =>
    Landing.use(landing => landing.land({ path: input.path, sessionId: input.sessionId, fromAgent: false, bookmark: input.bookmark })).pipe(
      Effect.ensuring(LandAttention.use(attention => attention.refresh)),
    ),
  queueLand: input => Landing.use(landing => landing.queue({ path: input.path, sessionId: input.sessionId })),
  cancelQueuedLand: input => Landing.use(landing => landing.cancel(input.path)),
  integrationProgress: input => IntegrationRequests.use(requests => Effect.map(requests.progress(input.path), progress => ({ progress }))),
  reviewHistory: input => ThreadLifecycle.use(lifecycle => lifecycle.reviewHistory(input)),
  threadStatus: (input, call) => ThreadLifecycle.use(lifecycle => lifecycle.threadStatus(input, call.caller)),
  landThread: (input, call) => ThreadLifecycle.use(lifecycle => lifecycle.landThread(input, call.caller)),
  workspaceSync: () => WorkspaceSync.use(sync => Effect.map(sync.current, current => ({ sync: current }))),
  discard: input => ThreadLifecycle.use(lifecycle => lifecycle.discard(input)),
  discardMany: input => ThreadLifecycle.use(lifecycle => lifecycle.discardMany(input)),
  cleanupWorkspaces: input =>
    Cleanup.use(cleanup => (input.apply ? Effect.flatMap(cleanup.startManual(input), started => started.done) : cleanup.preview(input))),
  // The job owns the removal once queued; its failure is reported on the trail, not to a request that already returned.
  startCleanup: input => Cleanup.use(cleanup => Effect.map(cleanup.startManual(input), started => ({ job: started.job }))),
  cleanupJobs: input => Cleanup.use(cleanup => Effect.map(cleanup.jobs(input.path), scoped => ({ repoRoot: scoped.repoRoot, jobs: [...scoped.jobs] }))),
})

/** jj-integration as a `@dshfiles/vcs-provider-port` provider: the port's callers isolate and snapshot without naming jj. */
const vcsProviderHandlers = Api.handlers(VcsProviders.contract('@dshfiles/jj-integration'), {
  detect: input =>
    RepositoryViews.use(views =>
      Effect.map(views.bestEffortLocation(input.path), location =>
        Option.match(location, {
          onNone: () => ({ match: null }),
          onSome: found => ({
            // jj keeps its priority; a git-only repository still beats @dshfiles/git-worktrees (10) because these threads can land.
            match: {
              vcs: found.vcs ?? 'jj',
              priority: found.vcs === 'git' ? GIT_PROVIDER_PRIORITY : JJ_PROVIDER_PRIORITY,
              repoRoot: found.repoRoot,
              workspaceRoot: found.workspaceRoot,
              isolated: found.threadName !== undefined,
            },
          }),
        }),
      ),
    ),
  provision: input =>
    ThreadLifecycle.use(lifecycle =>
      Effect.map(lifecycle.provision(input), provisioned => ({ workspaceId: provisioned.workspaceId, isolated: provisioned.isolated })),
    ),
  snapshot: input => ThreadWorkspaces.use(threads => Effect.map(threads.snapshotFiles(input.path), snapshot => ({ snapshot }))),
  restore: input => ThreadWorkspaces.use(threads => Effect.map(threads.restoreFiles(input.path, input.snapshot), previous => ({ previous }))),
})

export default {
  ...DshxPlugin.make({
    name: 'jj-integration',
    inject: ['subprocess', 'sessionController'],
    settings: [jjIntegrationSettings],
    layer: JjIntegrationLive,
    apis: [Api.bind(jjIntegrationApi, handlers), Api.bind(VcsProviders.contract('@dshfiles/jj-integration'), vcsProviderHandlers)],
  }),
  commands: [rebaseCommand],
}
