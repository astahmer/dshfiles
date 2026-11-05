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
import { AgentConfirmation } from './agent-confirmation.js'
import { AiActivity } from './ai-activity.js'
import { BacklogAttention } from './attention-provider.js'
import { backlogApi } from './api.js'
import { AttachmentExport } from './attachment-file.js'
import { BacklogSettingsTag, backlogSettingsLayer, sharedJevSettingsLayer } from './backlog-settings.js'
import { BacklogItemNotFound, BacklogTemplateNotFound } from './errors.js'
import { BacklogTemplates } from './templates.js'
import { BacklogGates } from './gates.js'
import type { BacklogDetailView } from './api.js'
import { BacklogExport } from './backlog-export.js'
import { HostSpeech, hostEdgeLayer } from './host-edge-promise.js'
import { BacklogDb, BacklogStorePaths } from './backlog-db.js'
import { BacklogRepo } from './backlog-repo.js'
import { LegacyBacklogTables } from './legacy-tables.js'
import { LeaseSweep } from './lease-sweep.js'
import { LifecycleSignals } from './lifecycle-signals.js'
import { GateWatch } from './gate-watch.js'
import { PullRequestState } from './pull-request-state.js'
import { CaptureProjects } from './project-target.js'
import { ReplyGenerator } from './reply-generator.js'
import { backlogSettings } from './settings.js'
import { ProviderCredentials } from './provider-credentials.js'
import { builtInProviderRegistry } from './provider-builtins.js'
import { ExternalProviderEndpoints } from './provider-registry.js'
import { BacklogSyncEngine } from './sync-engine.js'
import { BacklogSync, RemoteSyncLoop } from './sync-service.js'
import { SyncSources } from './sync-sources.js'
import type { ExternalRef } from './sync-model.js'
import { ShippedSummaries } from './shipped-summaries.js'
import { SyncLocalProbes } from './sync-local-probes.js'
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

const backlogServices = Layer.mergeAll(
  ThreadStart.layer,
  TriageBackfill.layer,
  TweetImport.layer,
  ReplyGenerator.layer,
  BacklogSync.layer,
  ShippedSummaries.layer,
).pipe(
  Layer.provideMerge(Triage.layer),
  Layer.provideMerge(BacklogSyncEngine.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      BacklogStore.layer,
      BacklogExport.layer,
      AiActivity.layer,
      CaptureProjects.layer,
      AttachmentExport.layer,
      SyncSources.layer,
      PullRequestState.layer,
    ),
  ),
  Layer.provideMerge(builtInProviderRegistry),
  Layer.provideMerge(Layer.mergeAll(ProviderCredentials.layer, ExternalProviderEndpoints.layer)),
  Layer.provideMerge(BacklogRepo.layer),
  Layer.provideMerge(Layer.mergeAll(BacklogDb.layer, LegacyBacklogTables.layer)),
  Layer.provideMerge(BacklogStorePaths.fromDshHome),
  Layer.provideMerge(SyncLocalProbes.layer),
  Layer.provideMerge(Layer.mergeAll(Jev.layer, Jj.layer, VcsProviderService.layer)),
)

/** Every backlog service and background loop of one activation. */
const BacklogLive = Layer.mergeAll(ActivityPublisher, LifecycleSignals, GateWatch, LeaseSweep, BacklogAttention.layer, RemoteSyncLoop).pipe(
  Layer.provideMerge(backlogServices),
  Layer.provideMerge(hostEdges),
)

/** No item has id 0, so a reference that names nothing reaches each verb as an id it answers `not-found` for. */
const NO_ITEM = 0
const itemIdOf = (key: number | string) => BacklogStore.use(store => Effect.map(store.resolve(key), id => id ?? NO_ITEM))
const withItemId = <Input extends { readonly id: number | string }>(input: Input) => Effect.map(itemIdOf(input.id), id => ({ ...input, id }))
/** Every key resolved, with the keys that name no item kept as the caller wrote them. */
const itemIdsOf = (keys: readonly (number | string)[]) =>
  BacklogStore.use(store =>
    Effect.map(
      Effect.forEach(keys, key => Effect.map(store.resolve(key), id => ({ key, id }))),
      entries => ({
        ids: entries.flatMap(entry => (entry.id === undefined ? [] : [entry.id])),
        unknown: entries.flatMap(entry => (entry.id === undefined ? [entry.key] : [])),
      }),
    ),
  )

/** Asks the pull-requests plugin to watch a PR through the newest thread linked to the item, so its state stays live. */
const withWatch = <Result extends { readonly ok: boolean }>(result: Result & ({ readonly ok: false } | { readonly ok: true; readonly value: BacklogDetailView }), url: string) =>
  Effect.gen(function* () {
    if (!result.ok) return result
    const thread = [...result.value.item.links].reverse().find(link => link.type === 'thread')
    if (thread !== undefined) yield* PullRequestState.use(pulls => pulls.watch({ url, sessionId: thread.target }))
    return result
  })

/**
 * A merged duplicate's remote links move to the survivor when it has none on that binding, so the remote item keeps
 * syncing; one the survivor already covers stays on the dropped duplicate, whose remote then closes with it.
 */
const moveExternalRefs = (input: { readonly survivorId: number; readonly refs: readonly ExternalRef[] }) =>
  SyncSources.use(sources =>
    Effect.gen(function* () {
      const taken = new Set((yield* sources.refsOf(input.survivorId)).map(ref => ref.bindingId))
      for (const ref of input.refs) {
        if (taken.has(ref.bindingId)) continue
        taken.add(ref.bindingId)
        yield* sources.putRef({ itemId: input.survivorId, ref })
      }
    }),
  ).pipe(Effect.catch(error => Effect.logWarning('backlog: a merged duplicate kept its remote links', error)))

const backlogHandlers = Api.handlers(backlogApi, {
  list: input => BacklogStore.use(store => store.list(input)),
  get: input => Effect.flatMap(itemIdOf(input.id), id => BacklogStore.use(store => store.get(id))),
  getMany: input =>
    Effect.gen(function* () {
      const keys = yield* itemIdsOf(input.ids)
      const result = yield* BacklogStore.use(store => store.getMany(keys.ids))
      return { items: result.items, missing: [...keys.unknown, ...result.missing] }
    }),
  revision: () => BacklogStore.use(store => store.revision),
  aiActivity: () => AiActivity.use(activity => Effect.map(activity.isActive, active => ({ active }))),
  projects: input => BacklogStore.use(store => store.projects({ hideAgentItems: input?.hideAgentItems === true })),
  referencing: input => BacklogStore.use(store => store.referencing(input)),
  ready: input =>
    BacklogStore.use(store =>
      store.list({ ready: true, freshness: 'all', limit: input.limit ?? 20, ...(input.project !== undefined && { project: input.project }) }),
    ),
  claim: (input, call) => Effect.flatMap(itemIdOf(input.id), id => BacklogStore.use(store => store.claim({ id, actor: actorOf(call.caller) }))),
  release: (input, call) => Effect.flatMap(itemIdOf(input.id), id => BacklogStore.use(store => store.release({ id, actor: actorOf(call.caller) }))),
  capture: (input, call) =>
    Effect.gen(function* () {
      const store = yield* BacklogStore
      const actor = actorOf(call.caller)
      const project =
        input.project === undefined && actor.kind === 'agent' && actor.cwd !== undefined
          ? yield* CaptureProjects.use(projects => projects.of(actor.cwd ?? ''))
          : input.project
      const { template: templateName, ...fields } = input
      const templates = (yield* BacklogSettingsTag.use(settings => settings.get)).templates
      const command = templateName === undefined ? BacklogTemplates.extract(fields.text, templates) : null
      const template = templateName === undefined ? command?.template : BacklogTemplates.find(templates, templateName)
      if (templateName !== undefined && template === undefined)
        return yield* new BacklogTemplateNotFound({ name: templateName, available: templates.map(candidate => candidate.name) })
      const text = command === null || command.text === '' ? fields.text : command.text
      const detail = yield* store.capture({ ...fields, text, actor, ...(project !== undefined && { project }), ...(template !== undefined && { template }) })
      yield* Triage.use(triage => triage.schedule(detail.item.id))
      yield* TweetImport.use(tweets => tweets.schedule(detail.item.id))
      return detail
    }),
  triage: input => Effect.flatMap(itemIdOf(input.id), id => Triage.use(triage => AiActivity.use(activity => activity.track(triage.item(id))))),
  backfillTriage: ({ confirm, ...input }, call) =>
    AgentConfirmation.check({ callerKind: call.caller.kind, confirm, call: { tool: 'backlog_triage_backfill', limit: input.limit } }).pipe(
      Effect.andThen(TriageBackfill.use(backfill => backfill.start(input))),
    ),
  backfillTriageStatus: input => TriageBackfill.use(backfill => backfill.status(input.jobId)),
  acknowledge: input => Effect.flatMap(itemIdsOf(input.ids), keys => BacklogStore.use(store => store.acknowledge({ ids: keys.ids }))),
  applyProposal: (input, call) => Effect.flatMap(itemIdOf(input.id), id => BacklogStore.use(store => store.applyProposal({ id, actor: actorOf(call.caller) }))),
  dismissProposal: (input, call) =>
    Effect.flatMap(itemIdOf(input.id), id => BacklogStore.use(store => store.dismissProposal({ id, actor: actorOf(call.caller) }))),
  attachFile: (input, call) =>
    Effect.flatMap(itemIdOf(input.id), id => BacklogStore.use(store => store.attachFile({ id, file: input.file, actor: actorOf(call.caller) }))),
  enrichTweet: (input, call) =>
    Effect.flatMap(itemIdOf(input.id), id => TweetImport.use(tweets => tweets.import({ id, url: input.url, actor: actorOf(call.caller) }))),
  readFile: keyed =>
    Effect.gen(function* () {
      const input = yield* withItemId(keyed)
      const result = yield* BacklogStore.use(store => store.readFile(input))
      if (!result.ok || input.save !== true) return result
      const path = yield* AttachmentExport.use(files => files.write({ id: input.id, attachmentId: input.attachmentId, dataUrl: result.value.dataUrl }))
      return { ok: true as const, value: { dataUrl: result.value.dataUrl, path } }
    }),
  removeFile: (input, call) =>
    Effect.flatMap(withItemId(input), resolved => BacklogStore.use(store => store.removeFile({ ...resolved, actor: actorOf(call.caller) }))),
  delete: input =>
    Effect.flatMap(itemIdOf(input.id), id =>
      BacklogSync.use(sync => Effect.map(sync.deleteItem({ id }), result => (result.ok ? { ok: true as const } : result))),
    ),
  speechStatus: () => HostSpeech.use(speech => speech.status),
  jevSetupStatus: () => Triage.use(triage => Effect.map(triage.jevNeedsSetup, needsSetup => ({ needsSetup }))),
  classifyReply: input => Triage.use(triage => triage.classifyReply(input.text)),
  generateReply: input => Effect.flatMap(withItemId(input), resolved => ReplyGenerator.use(replies => replies.generate(resolved))),
  transcribeSpeech: input => HostSpeech.use(speech => AiActivity.use(activity => activity.track(speech.transcribe(input.audioBase64)))),
  update: (keyed, call) =>
    Effect.gen(function* () {
      const input = yield* withItemId(keyed)
      const updated = yield* BacklogStore.use(store => store.update({ ...input, actor: actorOf(call.caller) }))
      if (updated.ok && (input.title !== undefined || input.body !== undefined)) yield* TweetImport.use(tweets => tweets.schedule(input.id))
      return updated
    }),
  link: (keyed, call) =>
    Effect.gen(function* () {
      const input = yield* withItemId(keyed)
      const result = yield* BacklogStore.use(store => store.link({ ...input, actor: actorOf(call.caller) }))
      if (result.ok && input.link.type === 'url') yield* TweetImport.use(tweets => tweets.schedule(input.id))
      return result
    }),
  agentContinuationCandidates: input => Effect.flatMap(withItemId(input), resolved => ThreadStart.use(threads => threads.continuationCandidates(resolved))),
  continueAgentThread: input => Effect.flatMap(withItemId(input), resolved => ThreadStart.use(threads => threads.continueThread(resolved))),
  startThread: (input, call) =>
    Effect.gen(function* () {
      const keys = yield* itemIdsOf(input.ids)
      if (keys.unknown.length > 0) return yield* new BacklogItemNotFound({ ids: keys.unknown })
      return yield* ThreadStart.use(threads => threads.start({ ...input, ids: keys.ids }, call.caller))
    }),
  comment: (input, call) =>
    Effect.flatMap(withItemId(input), resolved => BacklogStore.use(store => store.comment({ ...resolved, actor: actorOf(call.caller) }))),
  syncStatus: input =>
    input.ids === undefined
      ? BacklogSync.use(sync => sync.status({}))
      : Effect.flatMap(itemIdsOf(input.ids), keys => BacklogSync.use(sync => sync.status({ ids: keys.ids }))),
  syncNow: ({ confirm, ...input }, call) =>
    AgentConfirmation.check({ callerKind: call.caller.kind, confirm, call: { tool: 'backlog_sync_now', id: input.id } }).pipe(
      Effect.andThen(
        input.id === undefined
          ? BacklogSync.use(sync => sync.syncNow({ project: input.project, binding: input.binding }))
          : Effect.flatMap(itemIdOf(input.id), id => BacklogSync.use(sync => sync.syncNow({ id, binding: input.binding }))),
      ),
    ),
  linkRemote: (input, call) =>
    Effect.flatMap(withItemId(input), resolved =>
      BacklogSync.use(sync =>
        sync.link({
          id: resolved.id,
          binding: resolved.binding,
          provider: resolved.backend,
          reference: resolved.reference,
          create: resolved.create,
          remove: resolved.remove,
          actor: actorOf(call.caller),
        }),
      ),
    ),
  syncSources: () =>
    BacklogSync.use(sync =>
      Effect.map(sync.status({ ids: [] }), status => ({ providers: status.providers, connections: status.connections, bindings: status.bindings })),
    ),
  saveSyncConnection: input =>
    BacklogSync.use(sync =>
      sync.saveConnection({
        connection: { ...input.connection, credential: input.connection.credential ?? '', baseUrl: input.connection.baseUrl ?? '' },
        previousInstanceId: input.previousInstanceId,
      }),
    ),
  removeSyncConnection: ({ confirm, instanceId }, call) =>
    AgentConfirmation.check({ callerKind: call.caller.kind, confirm, call: { tool: 'backlog_sync_connection_remove' } }).pipe(
      Effect.andThen(BacklogSync.use(sync => sync.removeConnection({ instanceId }))),
    ),
  moveSyncConnection: input => BacklogSync.use(sync => sync.moveConnection(input)),
  saveSyncBinding: input => BacklogSync.use(sync => sync.saveBinding({ binding: input.binding })),
  removeSyncBinding: ({ confirm, binding }, call) =>
    AgentConfirmation.check({ callerKind: call.caller.kind, confirm, call: { tool: 'backlog_sync_binding_remove' } }).pipe(
      Effect.andThen(BacklogSync.use(sync => sync.removeBinding({ binding }))),
    ),
  discoverSync: input => BacklogSync.use(sync => sync.discover(input)),
  testSyncConnection: input => BacklogSync.use(sync => sync.testConnection(input)),
  testSyncConnections: () => BacklogSync.use(sync => sync.testSaved),
  importRemote: (input, call) =>
    BacklogSync.use(sync =>
      sync.importRemote({ provider: input.backend, binding: input.binding, reference: input.reference, project: input.project, actor: actorOf(call.caller) }),
    ),
  importAllRemote: ({ confirm, binding }, call) =>
    AgentConfirmation.check({ callerKind: call.caller.kind, confirm, call: { tool: 'backlog_sync_import_all' } }).pipe(
      Effect.andThen(BacklogSync.use(sync => sync.importAll({ binding, actor: actorOf(call.caller) }))),
    ),
  editComment: (input, call) =>
    Effect.flatMap(withItemId(input), resolved => BacklogStore.use(store => store.editComment({ ...resolved, actor: actorOf(call.caller) }))),
  export: input => BacklogExport.use(exporter => exporter.run(input)),
  revert: ({ confirm, ...input }, call) =>
    AgentConfirmation.check({ callerKind: call.caller.kind, confirm, call: { tool: 'backlog_revert' } }).pipe(
      Effect.andThen(Effect.flatMap(withItemId(input), resolved => BacklogStore.use(store => store.revert({ ...resolved, actor: actorOf(call.caller) })))),
    ),
  pullRequests: input =>
    Effect.gen(function* () {
      const found = yield* Effect.flatMap(itemIdOf(input.id), id => BacklogStore.use(store => store.get(id)))
      if (!found.ok) return { available: yield* PullRequestState.use(pulls => pulls.available), pullRequests: [] }
      const item = found.value.item
      const urls = [...item.links.filter(link => link.type === 'url').map(link => link.target), ...(item.gates ?? []).filter(gate => gate.kind === 'pr').map(gate => gate.target)]
      return yield* PullRequestState.use(pulls => pulls.of([...new Set(urls)]))
    }),
  linkPullRequest: (keyed, call) =>
    Effect.gen(function* () {
      const input = yield* withItemId(keyed)
      const store = yield* BacklogStore
      const pull = BacklogGates.pullRequestOf(input.url)
      const url = pull?.url ?? input.url
      const actor = actorOf(call.caller)
      const linked = yield* store.link({ id: input.id, link: { type: 'url', target: url, relation: input.closes === false ? 'implements' : 'fixes' }, actor })
      if (!linked.ok || input.gate !== true) return yield* withWatch(linked, url)
      const gates = [...(linked.value.item.gates ?? []).map(gate => ({ kind: gate.kind, target: gate.target })), { kind: 'pr' as const, target: url }]
      return yield* withWatch(yield* store.update({ id: input.id, gates, actor }), url)
    }),
  merge: ({ confirm, ...input }, call) =>
    AgentConfirmation.check({ callerKind: call.caller.kind, confirm, call: { tool: 'backlog_merge' } }).pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const survivorId = yield* itemIdOf(input.survivor)
          const keys = yield* itemIdsOf(input.duplicates)
          if (keys.unknown.length > 0) return yield* new BacklogItemNotFound({ ids: keys.unknown })
          const refsBefore = yield* SyncSources.use(sources => Effect.forEach(keys.ids, id => sources.refsOf(id))).pipe(Effect.orDie)
          const result = yield* BacklogStore.use(store => store.merge({ survivorId, duplicateIds: keys.ids, actor: actorOf(call.caller) }))
          if (!result.ok) return result
          yield* moveExternalRefs({ survivorId, refs: refsBefore.flat() })
          const { merged, ...detail } = result.value
          return { ok: true as const, value: detail, merged }
        }),
      ),
    ),
  shipped: input => ShippedSummaries.use(summaries => summaries.digest(input)),
  summarizeShipped: input => ShippedSummaries.use(summaries => AiActivity.use(activity => activity.track(summaries.summarize(input)))),
  deleteComment: (input, call) =>
    Effect.flatMap(withItemId(input), resolved => BacklogStore.use(store => store.deleteComment({ ...resolved, actor: actorOf(call.caller) }))),
})

/**
 * What every Agent needs to know about the items it is working on, whichever thread it was started in: the panel only
 * links and starts an item, so finishing it is the Agent's call, and so is saying what is left.
 */
const itemLifecycleSection = definePromptSection({
  name: 'dshfiles-backlog:item-lifecycle',
  order: 910,
  text: [
    'Backlog: a thread naming an item (`b:k3f9`, or a legacy `b:12`) links it and moves it to `doing`. Keep it current while you work: move it to',
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
