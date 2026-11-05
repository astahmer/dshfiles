import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Cause, Clock, Context, Effect, Layer, Option, Ref, Schedule, Schema } from 'effect'
import type { BacklogDetailView } from './api.js'
import { BacklogRepo } from './backlog-repo.js'
import { BacklogSettingsTag } from './backlog-settings.js'
import { BacklogReference } from './backlog-reference.js'
import { BacklogItemNotFound, type BacklogWriteFailed } from './errors.js'
import { BacklogItems, type BacklogItem } from './item.js'
import { BacklogProviderFailed, type BacklogProvider, type ProviderContainer, type ProviderDescriptor, type RemoteRecord } from './provider-port.js'
import { BacklogProviderRegistry } from './provider-registry.js'
import { BacklogStore, type BacklogActor, type BacklogResult } from './store.js'
import { BacklogSyncEngine, SyncEngineModel, type BindingContext, type BindingPassResult, type SyncItemResult } from './sync-engine.js'
import {
  SyncAlreadyLinked,
  SyncBindingMissing,
  SyncBindingUnknown,
  SyncConfigInvalid,
  SyncConfigWriteFailed,
  SyncConnectionMissing,
  SyncItemNotLinked,
  SyncNotOwner,
  SyncProviderUnknown,
  SyncReferenceUnrecognized,
  SyncWriteFailed,
} from './sync-errors.js'
import { SyncMigration } from './sync-migration.js'
import { BacklogSyncModel, type ExternalRef, type SyncBinding, type SyncConflict, type SyncConnection, type SyncState } from './sync-model.js'
import { SyncSources, type StoredRef } from './sync-sources.js'

/** Where a connection's key comes from, read without a network call. */
export type CredentialView = 'reference' | 'environment' | 'fallback' | 'none' | 'missing'

export interface ConnectionView {
  readonly connection: SyncConnection
  readonly providerLabel: string
  readonly available: boolean
  readonly credential: CredentialView
}

export interface BindingView {
  readonly binding: SyncBinding
  readonly providerKind: string
  readonly connectionLabel: string
  readonly owned: boolean
  readonly linked: number
  readonly lastPassAt: number | null
}

/** What the agent tools and the panel read about one item's tie to one remote item. */
export interface SyncItemView {
  readonly itemId: number
  readonly ref?: string
  readonly bindingId: string
  readonly backend: string
  readonly connectionLabel: string
  readonly remoteKey: string
  readonly url: string
  readonly state: SyncState
  readonly lastSyncedAt: number | null
  readonly lastError: ExternalRef['lastError']
  readonly conflicts: readonly SyncConflict[]
}

export interface SyncStatusView {
  readonly providers: readonly ProviderDescriptor[]
  readonly connections: readonly ConnectionView[]
  readonly bindings: readonly BindingView[]
  readonly items: readonly SyncItemView[]
}

/** What Test connection answers: never the key, only where it came from and what it reaches. */
export interface SyncConnectionTest {
  readonly ok: boolean
  readonly credential: 'reference' | 'environment' | 'cli' | 'none' | 'missing'
  readonly account: string | null
  readonly containers: readonly ProviderContainer[]
  readonly error: { readonly code: string; readonly message: string } | null
}

/** A binding as a form or an agent sends it: every field but the connection of a new binding may be left out. */
export type BindingDraft = { readonly [K in keyof Omit<SyncBinding, 'ownerHostId'>]?: SyncBinding[K] | undefined }

/** A new binding's defaults: two-way, every field, last writer wins, Sync now only. */
const bindingDefaults = {
  container: '',
  scope: null,
  direction: 'two-way',
  fieldMap: BacklogSyncModel.defaultFieldMap(),
  conflictPolicy: 'lww',
  pollEverySec: 0,
  pushAgentComments: false,
  importNew: false,
  enabled: true,
} as const satisfies Omit<SyncBinding, 'id' | 'connectionId' | 'ownerHostId'>

/** A connection as a form holds it before it is saved. */
export interface SyncConnectionDraft {
  readonly kind: string
  readonly credential: string
  readonly baseUrl: string
}

const errorView = (error: { readonly _tag: string; readonly message: string }) => ({ code: error._tag.slice(0, 64), message: error.message.slice(0, 1_000) })

type ConfigError = SyncConnectionMissing | SyncBindingUnknown | SyncBindingMissing | SyncProviderUnknown | SyncNotOwner
type LinkError =
  | ConfigError
  | BacklogProviderFailed
  | SyncAlreadyLinked
  | SyncWriteFailed
  | BacklogWriteFailed
  | BacklogItemNotFound
  | SyncReferenceUnrecognized

const MIGRATION_RECEIPT = Schema.fromJsonString(Schema.Struct({ at: Schema.Number, connections: Schema.Number, bindings: Schema.Number, refs: Schema.Number }))

/**
 * Remote sync: connections (accounts), bindings (sync flows) and external refs in the backlog's SQLite file, run by
 * the engine one binding at a time. Linking, creating and importing is always an explicit action; a binding's poll
 * interval only syncs what is already linked, plus new remote items when the binding imports them.
 */
export class BacklogSync extends Context.Service<
  BacklogSync,
  {
    readonly status: (input: { readonly ids?: readonly number[] | undefined }) => Effect.Effect<SyncStatusView>
    readonly syncNow: (input: {
      readonly id?: number | undefined
      readonly project?: string | null | undefined
      readonly binding?: string | undefined
    }) => Effect.Effect<
      { readonly results: readonly SyncItemResult[]; readonly passes: readonly BindingPassResult[] },
      SyncItemNotLinked | ConfigError | BacklogWriteFailed
    >
    readonly link: (input: {
      readonly id: number
      readonly binding?: string | undefined
      readonly provider?: string | undefined
      readonly reference?: string | undefined
      readonly create?: boolean | undefined
      readonly remove?: boolean | undefined
      readonly actor: BacklogActor
    }) => Effect.Effect<{ readonly item: SyncItemView | null; readonly result: SyncItemResult | null }, LinkError>
    readonly importRemote: (input: {
      readonly provider?: string | undefined
      readonly binding?: string | undefined
      readonly reference: string
      readonly project?: string | null | undefined
      readonly actor: BacklogActor
    }) => Effect.Effect<{ readonly detail: BacklogDetailView; readonly created: boolean }, LinkError>
    /** Imports every open remote item of a binding no backlog item mirrors yet; already linked ones are left as they are. */
    readonly importAll: (input: {
      readonly binding: string
      readonly actor: BacklogActor
    }) => Effect.Effect<BindingPassResult, ConfigError | BacklogWriteFailed>
    readonly discover: (input: {
      readonly connection?: string | undefined
      readonly draft?: SyncConnectionDraft | undefined
    }) => Effect.Effect<SyncConnectionTest, ConfigError>
    readonly testConnection: (input: {
      readonly connection?: string | undefined
      readonly draft?: SyncConnectionDraft | undefined
    }) => Effect.Effect<SyncConnectionTest, ConfigError>
    readonly testSaved: Effect.Effect<{ readonly results: readonly { readonly connection: SyncConnection; readonly report: SyncConnectionTest }[] }>
    readonly saveConnection: (input: {
      readonly connection: Omit<SyncConnection, 'identity'>
      readonly previousInstanceId?: string | undefined
    }) => Effect.Effect<ConnectionView, SyncConfigInvalid | SyncProviderUnknown | SyncConfigWriteFailed>
    readonly removeConnection: (input: { readonly instanceId: string }) => Effect.Effect<void, SyncConnectionMissing | SyncConfigWriteFailed>
    readonly moveConnection: (input: {
      readonly instanceId: string
      readonly direction: 'earlier' | 'later'
    }) => Effect.Effect<void, SyncConnectionMissing | SyncConfigWriteFailed>
    /** Adds a binding (`connectionId` required) or changes one by `id`; fields left out keep their saved value or take the default. */
    readonly saveBinding: (input: {
      readonly binding: BindingDraft
    }) => Effect.Effect<BindingView, SyncConfigInvalid | SyncConnectionMissing | SyncConfigWriteFailed>
    readonly removeBinding: (input: { readonly binding: string }) => Effect.Effect<void, SyncBindingUnknown | SyncConfigWriteFailed>
    /** One auto-sync round: every owned binding whose interval is due, each behind its own permit. */
    readonly autoSyncTick: Effect.Effect<void>
    /**
     * Deletes an item. Its refs stay as tombstones, so a pull never imports its remote items again; a binding whose
     * provider closes on delete (files) also writes the remote item as dropped. Other remote items are left alone.
     */
    readonly deleteItem: (input: { readonly id: number }) => Effect.Effect<BacklogResult<void>, BacklogWriteFailed | SyncWriteFailed>
  }
>()('@dshfiles/backlog/BacklogSync') {
  static readonly layer = Layer.effect(
    BacklogSync,
    Effect.gen(function* () {
      const store = yield* BacklogStore
      const settings = yield* BacklogSettingsTag
      const sources = yield* SyncSources
      const registry = yield* BacklogProviderRegistry
      const engine = yield* BacklogSyncEngine
      const repo = yield* BacklogRepo

      const itemOf = (id: number) => Effect.map(store.get(id), found => (found.ok ? found.value.item : undefined))
      const refFor = (id: number) => Effect.map(itemOf(id), item => (item === undefined ? undefined : BacklogReference.refOf(item)))
      const configWrite = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.mapError(cause => new SyncConfigWriteFailed({ cause })))
      const snapshot = sources.snapshot.pipe(Effect.orDie)

      /** Settings rows and per-item mappings become connections, bindings and refs, once. */
      const migrate = Effect.fn('backlog sync migrate')(function* () {
        if (Option.isSome(yield* sources.marker(SyncMigration.marker).pipe(Effect.orDie))) return
        const rows = (yield* settings.get).syncBackends
        const mappings = (yield* repo.mappings.entries.pipe(Effect.orDie)).map(([, mapping]) => mapping)
        const items = new Map((yield* repo.loadItems.pipe(Effect.orDie)).map(item => [item.id, item.project] as const))
        const plan = SyncMigration.plan({ rows, mappings, projectOf: id => items.get(id), hostId: sources.hostId })
        const current = yield* snapshot
        yield* sources
          .replace({ connections: [...current.connections, ...plan.connections], bindings: [...current.bindings, ...plan.bindings] })
          .pipe(Effect.orDie)
        yield* Effect.forEach(plan.refs, entry => sources.putRef(entry).pipe(Effect.orDie), { discard: true })
        const at = yield* Clock.currentTimeMillis
        const receipt = yield* Schema.encodeEffect(MIGRATION_RECEIPT)({
          at,
          connections: plan.connections.length,
          bindings: plan.bindings.length,
          refs: plan.refs.length,
        }).pipe(Effect.orDie)
        yield* sources.setMarker({ key: SyncMigration.marker, value: receipt }).pipe(Effect.orDie)
        yield* Effect.annotateCurrentSpan({
          'dshx.backlog.sync.migrated_connections': plan.connections.length,
          'dshx.backlog.sync.migrated_bindings': plan.bindings.length,
          'dshx.backlog.sync.migrated_refs': plan.refs.length,
        })
      })
      yield* migrate()

      const contextOf = Effect.fnUntraced(function* (binding: SyncBinding) {
        const current = yield* snapshot
        const connection = current.connections.find(candidate => candidate.instanceId === binding.connectionId)
        if (connection === undefined) return yield* new SyncConnectionMissing({ connection: binding.connectionId })
        const provider = yield* registry.get(connection.kind)
        return { binding, connection, provider } satisfies BindingContext
      })

      const bindingById = Effect.fnUntraced(function* (id: string) {
        const found = (yield* snapshot).bindings.find(binding => binding.id === id)
        if (found === undefined) return yield* new SyncBindingUnknown({ binding: id })
        return found
      })

      /** The enabled binding of a provider kind that serves a project: its own scope first, then a binding for every project. */
      const bindingFor = Effect.fnUntraced(function* (input: { readonly kind?: string | undefined; readonly project: string | null }) {
        const current = yield* snapshot
        const kindOf = (binding: SyncBinding) => current.connections.find(connection => connection.instanceId === binding.connectionId)?.kind
        const candidates = current.bindings.filter(binding => binding.enabled && (input.kind === undefined || kindOf(binding) === input.kind))
        const own =
          input.project === null ? undefined : candidates.find(binding => binding.scope !== null && BacklogItems.projectPath(binding.scope) === input.project)
        const found = own ?? candidates.find(binding => binding.scope === null)
        if (found === undefined) {
          const label =
            input.kind === undefined
              ? 'sync'
              : yield* Effect.map(Effect.result(registry.get(input.kind)), result =>
                  result._tag === 'Success' ? result.success.descriptor.label : (input.kind ?? 'sync'),
                )
          return yield* new SyncBindingMissing({ provider: label, project: input.project })
        }
        return found
      })

      const viewOf = Effect.fnUntraced(function* (
        entry: StoredRef,
        item: BacklogItem | undefined,
        current: { readonly connections: readonly SyncConnection[]; readonly bindings: readonly SyncBinding[] },
      ) {
        const binding = current.bindings.find(candidate => candidate.id === entry.ref.bindingId)
        const connection = current.connections.find(candidate => candidate.instanceId === binding?.connectionId)
        const context = binding === undefined || connection === undefined ? undefined : yield* Effect.option(contextOf(binding))
        const local =
          item === undefined || context === undefined || Option.isNone(context) ? undefined : yield* engine.localSnapshot({ context: context.value, item })
        return {
          itemId: entry.itemId,
          ...(item !== undefined && { ref: BacklogReference.refOf(item) }),
          bindingId: entry.ref.bindingId,
          backend: connection?.kind ?? 'unknown',
          connectionLabel: connection?.label ?? entry.ref.bindingId,
          remoteKey: entry.ref.displayKey,
          url: entry.ref.url,
          state: BacklogSyncModel.stateOf(entry.ref, local),
          lastSyncedAt: entry.ref.lastSyncedAt,
          lastError: entry.ref.lastError,
          conflicts: entry.ref.conflicts.slice(-5),
        } satisfies SyncItemView
      })

      const credentialView = (connection: SyncConnection, descriptor: ProviderDescriptor | undefined): CredentialView => {
        if (connection.credential.trim() !== '') return 'reference'
        if (descriptor?.credential === 'none') return 'none'
        if ((descriptor?.environmentVariables ?? []).some(name => (process.env[name] ?? '') !== '')) return 'environment'
        return descriptor?.credential === 'optional' ? 'fallback' : 'missing'
      }

      const connectionView = (connection: SyncConnection, providers: readonly BacklogProvider[]): ConnectionView => {
        const provider = providers.find(candidate => candidate.descriptor.kind === connection.kind)
        return {
          connection,
          providerLabel: provider?.descriptor.label ?? connection.kind,
          available: provider !== undefined,
          credential: credentialView(connection, provider?.descriptor),
        }
      }

      const bindingView = Effect.fnUntraced(function* (
        binding: SyncBinding,
        current: { readonly connections: readonly SyncConnection[] },
        refs: readonly StoredRef[],
      ) {
        const connection = current.connections.find(candidate => candidate.instanceId === binding.connectionId)
        const state = yield* sources.state(binding.id).pipe(Effect.orDie)
        return {
          binding,
          providerKind: connection?.kind ?? 'unknown',
          connectionLabel: connection?.label ?? binding.connectionId,
          owned: binding.ownerHostId === sources.hostId,
          linked: refs.filter(entry => entry.ref.bindingId === binding.id).length,
          lastPassAt: state.lastPassAt,
        } satisfies BindingView
      })

      const status = Effect.fn('backlog sync status')(function* (input: { readonly ids?: readonly number[] | undefined }) {
        const current = yield* snapshot
        const providers = yield* registry.all
        const wanted = input.ids === undefined ? undefined : new Set(input.ids)
        const refs = yield* sources.refs.pipe(Effect.orDie)
        const live = yield* Effect.filter(refs, entry => Effect.map(itemOf(entry.itemId), item => item !== undefined))
        const items = yield* Effect.forEach(
          live.filter(entry => wanted === undefined || wanted.has(entry.itemId)),
          entry => Effect.flatMap(itemOf(entry.itemId), item => viewOf(entry, item, current)),
        )
        return {
          providers: providers.map(provider => provider.descriptor),
          connections: current.connections.map(connection => connectionView(connection, providers)),
          bindings: yield* Effect.forEach(current.bindings, binding => bindingView(binding, current, live)),
          items,
        } satisfies SyncStatusView
      })

      const syncStored = (entry: StoredRef) =>
        Effect.gen(function* () {
          const binding = yield* bindingById(entry.ref.bindingId)
          if (binding.ownerHostId !== sources.hostId) return yield* new SyncNotOwner({ binding: binding.id, ownerHostId: binding.ownerHostId })
          const context = yield* contextOf(binding)
          return yield* engine.withBinding(
            binding.id,
            Effect.flatMap(sources.refByKey({ bindingId: binding.id, key: entry.ref.key }).pipe(Effect.orDie), stored =>
              engine.syncRef({
                context,
                itemId: entry.itemId,
                ref: Option.getOrElse(
                  Option.map(stored, value => value.ref),
                  () => entry.ref,
                ),
              }),
            ),
          )
        })

      const passOf = (binding: SyncBinding, options: { readonly importNew?: boolean; readonly openOnly?: boolean; readonly restart?: boolean } = {}) =>
        Effect.flatMap(contextOf(binding), context => engine.withBinding(binding.id, engine.pass({ context, ...options })))

      const syncNow = Effect.fn('backlog sync now')(function* (input: {
        readonly id?: number | undefined
        readonly project?: string | null | undefined
        readonly binding?: string | undefined
      }) {
        if (input.id !== undefined) {
          const refs = (yield* sources.refsOf(input.id).pipe(Effect.orDie)).filter(ref => input.binding === undefined || ref.bindingId === input.binding)
          if (refs.length === 0) return yield* new SyncItemNotLinked({ itemId: input.id, ref: yield* refFor(input.id) })
          const id = input.id
          return { results: yield* Effect.forEach(refs, ref => syncStored({ itemId: id, ref })), passes: [] }
        }
        if (input.binding !== undefined) {
          const pass = yield* passOf(yield* bindingById(input.binding))
          return { results: pass.results, passes: [pass] }
        }
        const project = input.project === undefined ? undefined : BacklogItems.projectOf(input.project)
        const refs = yield* sources.refs.pipe(Effect.orDie)
        const selected = yield* Effect.filter(refs, entry =>
          Effect.map(itemOf(entry.itemId), item => item !== undefined && (project === undefined || item.project === project)),
        )
        const current = yield* snapshot
        const owned = selected.filter(entry => current.bindings.some(binding => binding.id === entry.ref.bindingId && binding.ownerHostId === sources.hostId))
        const results = yield* Effect.forEach(owned, entry => Effect.catch(syncStored(entry), () => Effect.succeed(undefined)), { concurrency: 4 })
        return { results: results.filter(result => result !== undefined), passes: [] }
      })

      /** The binding a link or import goes through: the one named, else the one serving the project for the provider the reference names. */
      const bindingOfRequest = Effect.fnUntraced(function* (input: {
        readonly binding?: string | undefined
        readonly provider?: string | undefined
        readonly reference?: string | undefined
        readonly project: string | null
      }) {
        if (input.binding !== undefined) return yield* bindingById(input.binding)
        if (input.provider !== undefined) return yield* bindingFor({ kind: input.provider, project: input.project })
        const recognizing = input.reference === undefined ? [] : yield* registry.recognizing(input.reference)
        if (input.reference !== undefined && recognizing.length === 0) {
          const providers = yield* registry.all
          return yield* new SyncReferenceUnrecognized({ reference: input.reference, examples: providers.map(provider => provider.descriptor.referenceExample) })
        }
        const kinds = recognizing.map(provider => provider.descriptor.kind)
        const outcomes = yield* Effect.forEach(kinds.length === 0 ? [undefined] : kinds, kind => Effect.result(bindingFor({ kind, project: input.project })))
        const found = outcomes.find(outcome => outcome._tag === 'Success')
        if (found !== undefined && found._tag === 'Success') return found.success
        const first = outcomes[0]
        return yield* first !== undefined && first._tag === 'Failure'
          ? Effect.fail(first.failure)
          : Effect.fail(new SyncBindingMissing({ provider: 'sync', project: input.project }))
      })

      const unlink = Effect.fnUntraced(function* (input: {
        readonly id: number
        readonly binding?: string | undefined
        readonly provider?: string | undefined
        readonly actor: BacklogActor
      }) {
        const current = yield* snapshot
        const kindOf = (bindingId: string) =>
          current.connections.find(connection => connection.instanceId === current.bindings.find(binding => binding.id === bindingId)?.connectionId)?.kind
        const refs = (yield* sources.refsOf(input.id).pipe(Effect.orDie)).filter(
          ref => (input.binding === undefined || ref.bindingId === input.binding) && (input.provider === undefined || kindOf(ref.bindingId) === input.provider),
        )
        for (const ref of refs) {
          yield* engine.withBinding(
            ref.bindingId,
            sources
              .deleteRef({ bindingId: ref.bindingId, key: ref.key })
              .pipe(Effect.catch(cause => Effect.fail(new SyncWriteFailed({ itemId: input.id, cause })))),
          )
          if (ref.url !== '') yield* store.link({ id: input.id, link: { type: 'url', target: ref.url }, remove: true, actor: input.actor })
        }
        return { item: null, result: null }
      })

      const newRef = (input: {
        readonly binding: SyncBinding
        readonly record: RemoteRecord
        readonly at: number
        readonly base: ExternalRef['base']
        readonly pushCommentsSince: number
      }): ExternalRef => ({
        bindingId: input.binding.id,
        key: input.record.key,
        displayKey: input.record.displayKey.slice(0, 200),
        url: input.record.url.slice(0, BacklogItems.maxTargetChars),
        linkedAt: input.at,
        lastSyncedAt: null,
        remoteUpdatedAt: null,
        lastRemoteVersion: null,
        localSyncedAt: null,
        base: input.base,
        comments: [],
        pushCommentsSince: input.pushCommentsSince,
        state: 'synced',
        conflicts: [],
        lastError: null,
      })

      const link = Effect.fn('backlog sync link')(function* (input: {
        readonly id: number
        readonly binding?: string | undefined
        readonly provider?: string | undefined
        readonly reference?: string | undefined
        readonly create?: boolean | undefined
        readonly remove?: boolean | undefined
        readonly actor: BacklogActor
      }) {
        if (input.remove === true) return yield* unlink(input)
        const item = yield* itemOf(input.id)
        if (item === undefined) return yield* new BacklogItemNotFound({ ids: [input.id] })
        const binding = yield* bindingOfRequest({
          binding: input.binding,
          provider: input.provider,
          reference: input.create === true ? undefined : input.reference,
          project: item.project,
        })
        if (binding.ownerHostId !== sources.hostId) return yield* new SyncNotOwner({ binding: binding.id, ownerHostId: binding.ownerHostId })
        const context = yield* contextOf(binding)
        const scope = SyncEngineModel.scopeOf(context, item.project)
        const existing = (yield* sources.refsOf(item.id).pipe(Effect.orDie)).find(ref => ref.bindingId === binding.id)
        const at = yield* Clock.currentTimeMillis
        const remote = input.create === true ? undefined : yield* context.provider.resolve({ ...scope, reference: input.reference ?? '' })
        if (existing !== undefined && (remote === undefined || existing.key !== remote.key))
          return yield* new SyncAlreadyLinked({ itemId: item.id, ref: BacklogReference.refOf(item), remoteKey: existing.displayKey })
        if (remote !== undefined && existing === undefined) {
          const other = yield* sources.refByKey({ bindingId: binding.id, key: remote.key }).pipe(Effect.orDie)
          if (Option.isSome(other) && other.value.itemId !== item.id && (yield* itemOf(other.value.itemId)) !== undefined)
            return yield* new SyncAlreadyLinked({ itemId: other.value.itemId, ref: yield* refFor(other.value.itemId), remoteKey: other.value.ref.displayKey })
        }
        if (input.create === true && !context.provider.descriptor.capabilities.create)
          return yield* new BacklogProviderFailed({ provider: context.provider.descriptor.label, code: 'unsupported', detail: 'it cannot create items' })
        const issue =
          remote ??
          (yield* context.provider.create({
            ...scope,
            patch: {
              title: item.title,
              body: item.body,
              status: item.status,
              ...Option.match(Option.fromUndefinedOr(BacklogSyncModel.remoteLabelOf(binding.fieldMap, 'status', item.status)), {
                onNone: () => ({}),
                onSome: statusLabel => ({ statusLabel }),
              }),
              kind: item.kind,
              tags: item.tags,
              ...(item.priority !== undefined && item.priority !== 'none' && { priority: item.priority }),
              localRef: BacklogReference.refOf(item),
            },
          }))
        const created = remote === undefined
        const ref =
          existing ??
          newRef({
            binding,
            record: issue,
            at,
            // A created item starts equal to the remote item; a linked one is adopted on its first pass.
            base: created
              ? {
                  local: BacklogSyncModel.remoteSnapshot({ record: issue, rules: binding.fieldMap }),
                  remote: BacklogSyncModel.remoteSnapshot({ record: issue, rules: binding.fieldMap }),
                }
              : null,
            pushCommentsSince: created ? 0 : at,
          })
        const base = created && ref.base !== null ? { local: yield* engine.localSnapshot({ context, item }), remote: ref.base.remote } : ref.base
        yield* sources
          .putRef({ itemId: item.id, ref: { ...ref, base } })
          .pipe(Effect.catch(cause => Effect.fail(new SyncWriteFailed({ itemId: item.id, ref: BacklogReference.refOf(item), cause }))))
        if (/^https?:\/\//u.test(ref.url)) yield* store.link({ id: item.id, link: { type: 'url', target: ref.url, relation: 'related' }, actor: input.actor })
        const stored = Option.getOrElse(
          Option.map(yield* sources.refByKey({ bindingId: binding.id, key: ref.key }).pipe(Effect.orDie), value => value.ref),
          () => ref,
        )
        const result = yield* engine.withBinding(binding.id, engine.syncRef({ context, itemId: item.id, ref: stored }))
        const after = yield* sources.refByKey({ bindingId: binding.id, key: ref.key }).pipe(Effect.orDie)
        const view = Option.isNone(after) ? null : yield* viewOf(after.value, yield* itemOf(item.id), yield* snapshot)
        return { item: view, result }
      })

      const importRemote = Effect.fn('backlog sync import')(function* (input: {
        readonly provider?: string | undefined
        readonly binding?: string | undefined
        readonly reference: string
        readonly project?: string | null | undefined
        readonly actor: BacklogActor
      }) {
        const project = input.project === undefined ? undefined : BacklogItems.projectOf(input.project)
        const binding = yield* bindingOfRequest({ binding: input.binding, provider: input.provider, reference: input.reference, project: project ?? null })
        if (binding.ownerHostId !== sources.hostId) return yield* new SyncNotOwner({ binding: binding.id, ownerHostId: binding.ownerHostId })
        const context = yield* contextOf(binding)
        const itemProject = project === undefined ? (binding.scope === null ? null : BacklogItems.projectPath(binding.scope)) : project
        const remote = yield* context.provider.resolve({ ...SyncEngineModel.scopeOf(context, itemProject), reference: input.reference })
        const known = yield* sources.refByKey({ bindingId: binding.id, key: remote.key }).pipe(Effect.orDie)
        if (Option.isSome(known)) {
          const found = yield* store.get(known.value.itemId)
          if (found.ok) return { detail: found.value, created: false }
        }
        const id = yield* engine.withBinding(binding.id, engine.importRecord({ context, record: remote, project: itemProject, actor: input.actor }))
        const stored = yield* sources.refByKey({ bindingId: binding.id, key: remote.key }).pipe(Effect.orDie)
        if (Option.isSome(stored)) yield* engine.withBinding(binding.id, engine.syncRef({ context, itemId: id, ref: stored.value.ref, record: remote }))
        const found = yield* store.get(id)
        if (!found.ok) return yield* new BacklogItemNotFound({ ids: [id] })
        return { detail: found.value, created: true }
      })

      const importAll = Effect.fn('backlog sync import all')(function* (input: { readonly binding: string; readonly actor: BacklogActor }) {
        const binding = yield* bindingById(input.binding)
        return yield* passOf(binding, { importNew: true, openOnly: true, restart: true })
      })

      const connectionOf = Effect.fnUntraced(function* (input: { readonly connection?: string | undefined; readonly draft?: SyncConnectionDraft | undefined }) {
        if (input.draft !== undefined)
          return {
            instanceId: 'draft',
            kind: input.draft.kind,
            label: input.draft.kind,
            credential: input.draft.credential,
            baseUrl: input.draft.baseUrl,
            identity: null,
          } satisfies SyncConnection
        const found = (yield* snapshot).connections.find(connection => connection.instanceId === input.connection)
        if (found === undefined) return yield* new SyncConnectionMissing({ connection: input.connection ?? '' })
        return found
      })

      const failedTest = (error: { readonly _tag: string; readonly message: string; readonly code?: string }): SyncConnectionTest => ({
        ok: false,
        credential: 'code' in error && error.code === 'credential-missing' ? 'missing' : 'reference',
        account: null,
        containers: [],
        error: errorView(error),
      })

      const testConnection = Effect.fn('backlog sync test connection')(function* (input: {
        readonly connection?: string | undefined
        readonly draft?: SyncConnectionDraft | undefined
      }) {
        const connection = yield* connectionOf(input)
        yield* Effect.annotateCurrentSpan({ 'dshx.plugin.package': '@dshfiles/backlog', 'dshx.backlog.sync.provider': connection.kind })
        const provider = yield* registry.get(connection.kind)
        const identity = yield* Effect.result(provider.identity(SyncEngineModel.providerConnection(connection)))
        if (identity._tag === 'Failure') return failedTest(identity.failure)
        if (input.draft === undefined) {
          const at = yield* Clock.currentTimeMillis
          const current = yield* snapshot
          yield* sources
            .replace({
              ...current,
              connections: current.connections.map(candidate =>
                candidate.instanceId === connection.instanceId
                  ? {
                      ...candidate,
                      identity: { account: identity.success.account.slice(0, 200), checkedAt: at, containers: identity.success.containers.slice(0, 500) },
                    }
                  : candidate,
              ),
            })
            .pipe(Effect.catch(error => Effect.logWarning('backlog sync: the identity could not be cached', error)))
        }
        return {
          ok: true,
          credential: identity.success.credentialSource,
          account: identity.success.account,
          containers: identity.success.containers,
          error: null,
        } satisfies SyncConnectionTest
      })

      const testSaved = Effect.gen(function* () {
        const current = yield* snapshot
        const results = yield* Effect.forEach(
          current.connections,
          connection =>
            Effect.map(testConnection({ connection: connection.instanceId }).pipe(Effect.catch(error => Effect.succeed(failedTest(error)))), report => ({
              connection,
              report,
            })),
          { concurrency: 4 },
        )
        const saved = (yield* snapshot).connections
        return {
          results: results.map(result => ({
            ...result,
            connection: saved.find(connection => connection.instanceId === result.connection.instanceId) ?? result.connection,
          })),
        }
      })

      const saveConnection = Effect.fn('backlog sync save connection')(function* (input: {
        readonly connection: Omit<SyncConnection, 'identity'>
        readonly previousInstanceId?: string | undefined
      }) {
        yield* registry.get(input.connection.kind)
        const current = yield* snapshot
        const previousId = input.previousInstanceId ?? input.connection.instanceId
        const previous = current.connections.find(connection => connection.instanceId === previousId)
        if (input.connection.instanceId !== previousId && current.connections.some(connection => connection.instanceId === input.connection.instanceId))
          return yield* new SyncConfigInvalid({ detail: `A connection named “${input.connection.instanceId}” already exists.` })
        if (previous !== undefined && previous.kind !== input.connection.kind)
          return yield* new SyncConfigInvalid({ detail: 'A connection keeps its provider; add a new connection for another provider.' })
        const saved: SyncConnection = {
          ...input.connection,
          identity: previous?.credential === input.connection.credential ? (previous.identity ?? null) : null,
        }
        const connections =
          previous === undefined
            ? [...current.connections, saved]
            : current.connections.map(connection => (connection.instanceId === previousId ? saved : connection))
        const bindings = current.bindings.map(binding => (binding.connectionId === previousId ? { ...binding, connectionId: saved.instanceId } : binding))
        yield* configWrite(sources.replace({ connections, bindings }))
        return connectionView(saved, yield* registry.all)
      })

      const removeConnection = Effect.fn('backlog sync remove connection')(function* (input: { readonly instanceId: string }) {
        const current = yield* snapshot
        if (!current.connections.some(connection => connection.instanceId === input.instanceId))
          return yield* new SyncConnectionMissing({ connection: input.instanceId })
        yield* configWrite(
          sources.replace({
            connections: current.connections.filter(connection => connection.instanceId !== input.instanceId),
            bindings: current.bindings.filter(binding => binding.connectionId !== input.instanceId),
          }),
        )
      })

      const moveConnection = Effect.fn('backlog sync move connection')(function* (input: {
        readonly instanceId: string
        readonly direction: 'earlier' | 'later'
      }) {
        const current = yield* snapshot
        const index = current.connections.findIndex(connection => connection.instanceId === input.instanceId)
        if (index < 0) return yield* new SyncConnectionMissing({ connection: input.instanceId })
        const target = input.direction === 'earlier' ? index - 1 : index + 1
        if (target < 0 || target >= current.connections.length) return
        const connections = [...current.connections]
        const [moved] = connections.splice(index, 1)
        if (moved !== undefined) connections.splice(target, 0, moved)
        yield* configWrite(sources.replace({ connections, bindings: current.bindings }))
      })

      const saveBinding = Effect.fn('backlog sync save binding')(function* (input: { readonly binding: BindingDraft }) {
        const current = yield* snapshot
        const previous = input.binding.id === undefined ? undefined : current.bindings.find(binding => binding.id === input.binding.id)
        const defined = Object.fromEntries(Object.entries(input.binding).filter(([, value]) => value !== undefined))
        const merged = { ...bindingDefaults, ...previous, ...defined }
        const connectionId = merged.connectionId ?? ''
        const connection = current.connections.find(candidate => candidate.instanceId === connectionId)
        if (connection === undefined) return yield* new SyncConnectionMissing({ connection: connectionId })
        const scope = typeof merged.scope === 'string' && merged.scope.trim() !== '' ? BacklogItems.projectPath(merged.scope) : null
        const container = typeof merged.container === 'string' ? merged.container.trim() : ''
        const id =
          previous?.id ??
          input.binding.id ??
          BacklogSyncModel.uniqueSlug(
            BacklogSyncModel.slugOf(
              `${connection.instanceId}-${container || (scope === null ? 'all' : (scope.split('/').filter(Boolean).pop() ?? 'project'))}`,
            ),
            new Set(current.bindings.map(binding => binding.id)),
          )
        const decoded = Schema.decodeUnknownResult(BacklogSyncModel.bindingSchema)({
          ...merged,
          id,
          connectionId,
          container,
          scope,
          ownerHostId: previous?.ownerHostId ?? sources.hostId,
        })
        if (decoded._tag === 'Failure') return yield* new SyncConfigInvalid({ detail: `The binding is not valid: ${String(decoded.failure).slice(0, 300)}` })
        const saved = decoded.success
        const bindings = previous === undefined ? [...current.bindings, saved] : current.bindings.map(binding => (binding.id === saved.id ? saved : binding))
        yield* configWrite(sources.replace({ connections: current.connections, bindings }))
        return yield* bindingView(saved, current, yield* sources.refs.pipe(Effect.orDie))
      })

      const removeBinding = Effect.fn('backlog sync remove binding')(function* (input: { readonly binding: string }) {
        const current = yield* snapshot
        if (!current.bindings.some(binding => binding.id === input.binding)) return yield* new SyncBindingUnknown({ binding: input.binding })
        yield* configWrite(
          engine.withBinding(
            input.binding,
            sources.replace({ connections: current.connections, bindings: current.bindings.filter(binding => binding.id !== input.binding) }),
          ),
        )
      })

      const lastRun = yield* Ref.make<ReadonlyMap<string, number>>(new Map())
      const autoSyncTick = Effect.gen(function* () {
        const current = yield* snapshot
        const at = yield* Clock.currentTimeMillis
        const ran = yield* Ref.get(lastRun)
        const due = yield* Effect.filter(
          current.bindings.filter(binding => binding.enabled && binding.pollEverySec > 0 && binding.ownerHostId === sources.hostId),
          binding =>
            Effect.map(
              sources.state(binding.id).pipe(Effect.orDie),
              state => at - Math.max(ran.get(binding.id) ?? 0, state.lastPassAt ?? 0) >= binding.pollEverySec * 1_000,
            ),
        )
        if (due.length === 0) return
        yield* Ref.update(lastRun, previous => new Map([...previous, ...due.map(binding => [binding.id, at] as const)]))
        yield* Effect.forEach(
          due,
          binding =>
            passOf(binding).pipe(
              Effect.catch(error => Effect.logWarning('backlog sync: a binding pass failed', { binding: binding.id, error: error.message })),
            ),
          { concurrency: 4, discard: true },
        )
      })

      const deleteItem = Effect.fn('backlog sync delete item')(function* (input: { readonly id: number }) {
        const item = yield* itemOf(input.id)
        const refs = item === undefined ? [] : yield* sources.refsOf(input.id).pipe(Effect.orDie)
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- an item has a ref or two; each close is best-effort and logged.
        for (const ref of refs) {
          const binding = (yield* snapshot).bindings.find(candidate => candidate.id === ref.bindingId)
          if (binding === undefined || item === undefined || binding.ownerHostId !== sources.hostId) continue
          const context = yield* Effect.option(contextOf(binding))
          if (Option.isNone(context)) continue
          const flows = BacklogSyncModel.fieldFlows({ binding, capabilities: context.value.provider.descriptor.capabilities })
          if (context.value.provider.descriptor.capabilities.delete !== 'close' || flows.get('status')?.push !== true) continue
          yield* context.value.provider
            .push({ ...SyncEngineModel.scopeOf(context.value, item.project), key: ref.key, patch: { status: 'dropped' } })
            .pipe(Effect.catch(error => Effect.logWarning('backlog sync: the remote item could not be closed', { binding: binding.id, error: error.message })))
        }
        return yield* store.delete(input)
      })

      return BacklogSync.of({
        status,
        syncNow,
        link,
        importRemote,
        importAll,
        discover: testConnection,
        testConnection,
        testSaved,
        saveConnection,
        removeConnection,
        moveConnection,
        saveBinding,
        removeBinding,
        autoSyncTick,
        deleteItem,
      })
    }),
  )
}

/** Auto-sync: a minute tick runs every binding whose interval is due; a failing tick is logged and retried. */
export const RemoteSyncLoop = Layer.effectDiscard(
  Effect.gen(function* () {
    const sync = yield* BacklogSync
    const tick = sync.autoSyncTick.pipe(
      Effect.catchCause(cause => (Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.logWarning('backlog remote sync failed', cause))),
    )
    yield* DshxPlugin.worker(Effect.sleep('1 minute').pipe(Effect.andThen(Effect.repeat(tick, Schedule.spaced('1 minute')))))
  }),
)
