import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Llm } from '@dshfiles/dshx/effect/llm'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { definePromptSection } from '@dshfiles/dshx/host'
import { Jev } from '@dshfiles/jev'
import { Jj } from '@dshfiles/jj-cli'
import { VcsProviderService } from '@dshfiles/vcs-provider-port/effect'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { ActivityPublisher } from './activity-publisher.js'
import { AiActivity } from './ai-activity.js'
import { BacklogAttention } from './attention-provider.js'
import { backlogApi } from './api.js'
import { AttachmentExport } from './attachment-file.js'
import { backlogSettingsLayer, sharedJevSettingsLayer } from './backlog-settings.js'
import { HostSpeech, hostEdgeLayer } from './host-edge-promise.js'
import { BacklogTables } from './backlog-tables.js'
import { LifecycleSignals } from './lifecycle-signals.js'
import { CaptureProjects } from './project-target.js'
import { ReplyGenerator } from './reply-generator.js'
import { backlogSettings } from './settings.js'
import { BacklogSync, RemoteBackends, RemoteSyncLoop } from './sync-service.js'
import { SyncLocalProbes } from './sync-local-probes.js'
import { BacklogSyncTables } from './sync-tables.js'
import { BacklogStore } from './store.js'
import { actorOf, ThreadStart } from './thread-start.js'
import { TriageBackfill } from './triage-backfill.js'
import { Triage } from './triage-service.js'
import { TweetImport } from './tweet-import.js'

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

/** DSH services the backlog reads through dshx, and the platform and network clients its services run on. */
const hostEdges = Layer.mergeAll(
  backlogSettingsLayer,
  sharedJevSettingsLayer,
  StorageDomain.layer,
  HostApis.layer,
  SecretReferenceResolver.layer,
  Llm.layer,
  hostEdgeLayer,
  FetchHttpClient.layer,
  DshChildProcessSpawner.layer,
  platform,
)

const backlogServices = Layer.mergeAll(ThreadStart.layer, TriageBackfill.layer, TweetImport.layer, ReplyGenerator.layer, BacklogSync.layer).pipe(
  Layer.provideMerge(Triage.layer),
  Layer.provideMerge(Layer.mergeAll(BacklogStore.layer, AiActivity.layer, CaptureProjects.layer, AttachmentExport.layer)),
  Layer.provideMerge(Layer.mergeAll(BacklogTables.layer, BacklogSyncTables.layer, RemoteBackends.layer)),
  Layer.provideMerge(SyncLocalProbes.layer),
  Layer.provideMerge(Layer.mergeAll(Jev.layer, Jj.layer, VcsProviderService.layer)),
)

/** Every backlog service and background loop of one activation. */
const BacklogLive = Layer.mergeAll(ActivityPublisher, LifecycleSignals, BacklogAttention.layer, RemoteSyncLoop).pipe(
  Layer.provideMerge(backlogServices),
  Layer.provideMerge(hostEdges),
)

const backlogHandlers = Api.handlers(backlogApi, {
  list: input => BacklogStore.use(store => store.list(input)),
  get: input => BacklogStore.use(store => store.get(input.id)),
  getMany: input => BacklogStore.use(store => store.getMany(input.ids)),
  revision: () => BacklogStore.use(store => store.revision),
  aiActivity: () => AiActivity.use(activity => Effect.map(activity.isActive, active => ({ active }))),
  projects: () => BacklogStore.use(store => store.projects),
  referencing: input => BacklogStore.use(store => store.referencing(input)),
  capture: (input, call) =>
    Effect.gen(function* () {
      const store = yield* BacklogStore
      const actor = actorOf(call.caller)
      const project =
        input.project === undefined && actor.kind === 'agent' && actor.cwd !== undefined
          ? yield* CaptureProjects.use(projects => projects.of(actor.cwd ?? ''))
          : input.project
      const detail = yield* store.capture({ ...input, actor, ...(project !== undefined && { project }) })
      yield* Triage.use(triage => triage.schedule(detail.item.id))
      yield* TweetImport.use(tweets => tweets.schedule(detail.item.id))
      return detail
    }),
  triage: input => Triage.use(triage => AiActivity.use(activity => activity.track(triage.item(input.id)))),
  backfillTriage: input => TriageBackfill.use(backfill => backfill.start(input)),
  backfillTriageStatus: input => TriageBackfill.use(backfill => backfill.status(input.jobId)),
  acknowledge: input => BacklogStore.use(store => store.acknowledge(input)),
  applyProposal: (input, call) => BacklogStore.use(store => store.applyProposal({ id: input.id, actor: actorOf(call.caller) })),
  dismissProposal: (input, call) => BacklogStore.use(store => store.dismissProposal({ id: input.id, actor: actorOf(call.caller) })),
  attachFile: (input, call) => BacklogStore.use(store => store.attachFile({ id: input.id, file: input.file, actor: actorOf(call.caller) })),
  enrichTweet: (input, call) => TweetImport.use(tweets => tweets.import({ id: input.id, url: input.url, actor: actorOf(call.caller) })),
  readFile: input =>
    Effect.gen(function* () {
      const result = yield* BacklogStore.use(store => store.readFile(input))
      if (!result.ok || input.save !== true) return result
      const path = yield* AttachmentExport.use(files => files.write({ id: input.id, attachmentId: input.attachmentId, dataUrl: result.value.dataUrl }))
      return { ok: true as const, value: { dataUrl: result.value.dataUrl, path } }
    }),
  removeFile: (input, call) => BacklogStore.use(store => store.removeFile({ ...input, actor: actorOf(call.caller) })),
  delete: input => BacklogSync.use(sync => Effect.map(sync.deleteItem({ id: input.id }), result => (result.ok ? { ok: true as const } : result))),
  speechStatus: () => HostSpeech.use(speech => speech.status),
  jevSetupStatus: () => Triage.use(triage => Effect.map(triage.jevNeedsSetup, needsSetup => ({ needsSetup }))),
  classifyReply: input => Triage.use(triage => triage.classifyReply(input.text)),
  generateReply: input => ReplyGenerator.use(replies => replies.generate(input)),
  transcribeSpeech: input => HostSpeech.use(speech => AiActivity.use(activity => activity.track(speech.transcribe(input.audioBase64)))),
  update: (input, call) =>
    Effect.gen(function* () {
      const updated = yield* BacklogStore.use(store => store.update({ ...input, actor: actorOf(call.caller) }))
      if (updated.ok && (input.title !== undefined || input.body !== undefined)) yield* TweetImport.use(tweets => tweets.schedule(input.id))
      return updated
    }),
  link: (input, call) =>
    Effect.gen(function* () {
      const result = yield* BacklogStore.use(store => store.link({ ...input, actor: actorOf(call.caller) }))
      if (result.ok && input.link.type === 'url') yield* TweetImport.use(tweets => tweets.schedule(input.id))
      return result
    }),
  agentContinuationCandidates: input => ThreadStart.use(threads => threads.continuationCandidates(input)),
  continueAgentThread: input => ThreadStart.use(threads => threads.continueThread(input)),
  startThread: (input, call) => ThreadStart.use(threads => threads.start(input, call.caller)),
  comment: (input, call) => BacklogStore.use(store => store.comment({ ...input, actor: actorOf(call.caller) })),
  syncStatus: input => BacklogSync.use(sync => sync.status(input)),
  syncNow: input => BacklogSync.use(sync => sync.syncNow(input)),
  linkRemote: (input, call) => BacklogSync.use(sync => sync.link({ ...input, actor: actorOf(call.caller) })),
  importRemote: (input, call) => BacklogSync.use(sync => sync.importRemote({ ...input, actor: actorOf(call.caller) })),
  testSyncBackend: input =>
    BacklogSync.use(sync => sync.testConnection({ ...input, project: input.project ?? '', target: input.target ?? '', secret: input.secret ?? '' })),
  testSyncBackends: () => BacklogSync.use(sync => sync.testSaved),
  editComment: (input, call) => BacklogStore.use(store => store.editComment({ ...input, actor: actorOf(call.caller) })),
  deleteComment: (input, call) => BacklogStore.use(store => store.deleteComment({ ...input, actor: actorOf(call.caller) })),
})

/**
 * What every Agent needs to know about the items it is working on, whichever thread it was started in: the panel only
 * links and starts an item, so finishing it is the Agent's call, and so is saying what is left.
 */
const itemLifecycleSection = definePromptSection({
  name: 'dshfiles-backlog:item-lifecycle',
  order: 910,
  text: [
    'Backlog: a thread naming `b:12` links that item and moves it to `doing`. Keep it current while you work: move it to',
    '`done` with `backlog_update` once the thread has resolved it. When only part of it is done, or the work is stuck,',
    'leave it `doing`, add a `partial` or `blocked` tag, set `attention` when the user must decide something,',
    '`backlog_comment` what is done and what is missing, and say the same in your final reply.',
  ].join(' '),
})

export default {
  ...DshxPlugin.make({
    name: '@dshfiles/backlog',
    inject: ['storageDomain', 'sessionController', 'attachments', 'subprocess'],
    settings: [backlogSettings],
    layer: BacklogLive,
    apis: [Api.bind(backlogApi, backlogHandlers)],
  }),
  prompts: [itemLifecycleSection],
}
