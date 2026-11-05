import { Clock, Context, Effect, Layer, Ref, type Result, Semaphore } from 'effect'
import { BacklogItemNotFound, type BacklogWriteFailed } from './errors.js'
import { BacklogOrigins } from './event-origin.js'
import { BacklogReference } from './backlog-reference.js'
import { BacklogItems, type BacklogItem, type BacklogKind, type BacklogStatus } from './item.js'
import type {
  BacklogProvider,
  BacklogProviderFailed,
  ProviderConnection,
  ProviderField,
  ProviderScope,
  PullPage,
  RemotePatch,
  RemoteRecord,
  RemoteRelation,
} from './provider-port.js'
import { BacklogStore, type BacklogActor } from './store.js'
import { SyncNotOwner, SyncWriteFailed } from './sync-errors.js'
import {
  BacklogSyncModel,
  type ExternalRef,
  type SyncBinding,
  type SyncConflict,
  type SyncConnection,
  type SyncField,
  type SyncSnapshot,
  type SyncState,
} from './sync-model.js'
import { SyncSources, type StoredRef } from './sync-sources.js'

/** How many pages one pass reads before it stops and resumes from the same cursor next time. */
const MAX_PAGES_PER_PASS = 20

/** One binding with everything a pass needs: its connection, its provider and each field's flow. */
export interface BindingContext {
  readonly binding: SyncBinding
  readonly connection: SyncConnection
  readonly provider: BacklogProvider
}

/** What one sync did for one item. */
export interface SyncItemResult {
  readonly itemId: number
  readonly ref?: string
  readonly bindingId: string
  readonly remoteKey: string | null
  readonly state: SyncState
  readonly pulled: readonly SyncField[]
  readonly pushed: readonly SyncField[]
  readonly conflicts: readonly SyncConflict[]
  readonly commentsPulled: number
  readonly commentsPushed: number
  readonly error: { readonly code: string; readonly message: string } | null
}

/** What one binding pass did. */
export interface BindingPassResult {
  readonly bindingId: string
  readonly records: number
  readonly created: number
  readonly removed: number
  readonly complete: boolean
  readonly results: readonly SyncItemResult[]
}

const errorView = (error: { readonly _tag: string; readonly message: string }) => ({ code: error._tag.slice(0, 64), message: error.message.slice(0, 1_000) })

const providerConnection = (connection: SyncConnection): ProviderConnection => ({
  instanceId: connection.instanceId,
  kind: connection.kind,
  label: connection.label,
  credential: connection.credential,
  baseUrl: connection.baseUrl,
})

const scopeOf = (context: BindingContext, project: string | null): ProviderScope => ({
  connection: providerConnection(context.connection),
  container: context.binding.container,
  project: context.binding.scope ?? project,
  ...(context.binding.options !== undefined && { options: context.binding.options }),
})

const flowsOf = (context: BindingContext) => BacklogSyncModel.fieldFlows({ binding: context.binding, capabilities: context.provider.descriptor.capabilities })

/** The fields a pull or fetch should read: every field that flows either way. */
const readFields = (context: BindingContext): ProviderField[] => {
  const flows = flowsOf(context)
  return BacklogSyncModel.syncedFields.filter(field => {
    const flow = flows.get(field)
    return flow !== undefined && (flow.pull || flow.push)
  })
}

const isOpenRecord = (record: RemoteRecord): boolean => record.status === null || (record.status.category !== 'done' && record.status.category !== 'dropped')

/** The kind an imported item's labels name, first match wins. */
const kindLabels: readonly (readonly [string, BacklogKind])[] = [
  ['bug', 'bug'],
  ['idea', 'idea'],
  ['feature', 'idea'],
  ['question', 'question'],
]
const kindOfTags = (tags: readonly string[]): BacklogKind | undefined => kindLabels.find(([label]) => tags.includes(label))?.[1]

const supportedRelations = (context: BindingContext): ReadonlySet<string> => new Set(context.provider.descriptor.capabilities.relations)

/** The keys of one binding's refs, both ways: what parent and link translation reads. */
interface KeyMaps {
  readonly keyByItem: ReadonlyMap<number, string>
  readonly itemByKey: ReadonlyMap<string, number>
}

const keyMapsOf = (refs: readonly StoredRef[]): KeyMaps => ({
  keyByItem: new Map(refs.map(entry => [entry.itemId, entry.ref.key] as const)),
  itemByKey: new Map(refs.map(entry => [entry.ref.key, entry.itemId] as const)),
})

const withoutStructure = (snapshot: SyncSnapshot): SyncSnapshot => {
  const { parent: _parent, links: _links, ...rest } = snapshot
  return rest
}

/**
 * The sync engine: one binding at a time, each binding behind its own permit (two bindings sync side by side, one
 * binding never twice at once). Remote changes become ops with `origin: remote:<bindingId>`; a failing remote never
 * touches the item, the ref records the error and the next pass retries.
 */
export class BacklogSyncEngine extends Context.Service<
  BacklogSyncEngine,
  {
    readonly withBinding: <A, E, R>(bindingId: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
    readonly syncRef: (input: {
      readonly context: BindingContext
      readonly itemId: number
      readonly ref: ExternalRef
      readonly record?: RemoteRecord | undefined
      readonly comments?: boolean | undefined
    }) => Effect.Effect<SyncItemResult>
    readonly pass: (input: {
      readonly context: BindingContext
      readonly importNew?: boolean | undefined
      readonly openOnly?: boolean | undefined
      readonly restart?: boolean | undefined
    }) => Effect.Effect<BindingPassResult, SyncNotOwner | BacklogWriteFailed>
    readonly importRecord: (input: {
      readonly context: BindingContext
      readonly record: RemoteRecord
      readonly project: string | null
      readonly actor: BacklogActor
    }) => Effect.Effect<number, SyncWriteFailed | BacklogWriteFailed>
    readonly localSnapshot: (input: { readonly context: BindingContext; readonly item: BacklogItem }) => Effect.Effect<SyncSnapshot>
  }
>()('@dshfiles/backlog/BacklogSyncEngine') {
  static readonly layer = Layer.effect(
    BacklogSyncEngine,
    Effect.gen(function* () {
      const store = yield* BacklogStore
      const sources = yield* SyncSources
      const permits = yield* Ref.make(new Map<string, Semaphore.Semaphore>())

      const permitOf = (bindingId: string) =>
        Effect.gen(function* () {
          const existing = (yield* Ref.get(permits)).get(bindingId)
          if (existing !== undefined) return existing
          const made = yield* Semaphore.make(1)
          return yield* Ref.modify(permits, current => {
            const raced = current.get(bindingId)
            return raced === undefined ? [made, new Map(current).set(bindingId, made)] : [raced, current]
          })
        })

      const withBinding = <A, E, R>(bindingId: string, effect: Effect.Effect<A, E, R>) =>
        Effect.flatMap(permitOf(bindingId), permit => permit.withPermit(effect))

      const itemOf = (id: number) => Effect.map(store.get(id), found => (found.ok ? found.value.item : undefined))
      const refOfId = (id: number) => Effect.map(itemOf(id), item => (item === undefined ? undefined : BacklogReference.refOf(item)))
      const idOfRef = (ref: string) => store.resolve(ref)
      const keyMaps = (bindingId: string) => Effect.map(sources.refsOfBinding(bindingId).pipe(Effect.orDie), keyMapsOf)

      /** The item as the binding sees it: parent and item links as keys of the same binding, links it cannot map left out. */
      const snapshotOf = Effect.fnUntraced(function* (context: BindingContext, item: BacklogItem, maps: KeyMaps) {
        const relations = supportedRelations(context)
        const parentId = item.parent === undefined ? undefined : yield* idOfRef(item.parent)
        const parent = item.parent === undefined ? null : parentId === undefined ? undefined : maps.keyByItem.get(parentId)
        const links = yield* Effect.forEach(
          item.links.filter(link => link.type === 'item' && relations.has(link.relation ?? 'related')),
          link =>
            Effect.map(idOfRef(link.target), id => (id === undefined ? undefined : maps.keyByItem.get(id))).pipe(
              Effect.map(key => (key === undefined ? [] : [`${link.relation ?? 'related'}:${key}`])),
            ),
        )
        return {
          title: item.title,
          body: item.body,
          status: item.status,
          tags: [...item.tags],
          priority: item.priority ?? 'none',
          ...(parent !== undefined && { parent }),
          links: links.flat(),
        } satisfies SyncSnapshot
      })

      const recordError = (input: {
        readonly itemId: number
        readonly ref: ExternalRef
        readonly error: { readonly _tag: string; readonly message: string }
      }) =>
        Effect.gen(function* () {
          const at = yield* Clock.currentTimeMillis
          const view = errorView(input.error)
          yield* sources
            .putRef({ itemId: input.itemId, ref: { ...input.ref, state: 'error', lastError: { ...view, at } } })
            .pipe(Effect.catch(failure => Effect.logWarning('backlog sync: the error could not be recorded', failure)))
          return view
        })

      /** Carries remote comments over to the item and local replies over to the remote item, once each. */
      const syncComments = Effect.fnUntraced(function* (input: {
        readonly context: BindingContext
        readonly ref: ExternalRef
        readonly itemId: number
        readonly record: RemoteRecord
        readonly origin: string
        readonly scope: ProviderScope
      }) {
        const capability = input.context.provider.descriptor.capabilities.comments
        const knownRemote = new Set(input.ref.comments.map(pair => pair.remote))
        const incoming = (input.record.comments ?? []).filter(comment => !knownRemote.has(comment.id)).sort((left, right) => left.createdAt - right.createdAt)
        const pullAllowed = input.context.binding.direction !== 'push'
        // Sequential on purpose (forEach's default): comments land in the order they were written.
        const pulledPairs = pullAllowed
          ? yield* Effect.forEach(incoming, comment =>
              Effect.map(
                store.comment({
                  id: input.itemId,
                  text: BacklogSyncModel.importedCommentText({ source: input.context.connection.label, author: comment.author, body: comment.body }),
                  actor: { kind: 'system' },
                  origin: input.origin,
                }),
                result => ({
                  local: result.ok ? ([...result.value.item.events].reverse().find(event => event.kind === 'commented')?.commentId ?? '') : '',
                  remote: comment.id,
                }),
              ),
            )
          : []
        const knownLocal = new Set([...input.ref.comments, ...pulledPairs].map(pair => pair.local))
        const item = yield* itemOf(input.itemId)
        const pushAllowed = capability === 'read-write' && input.context.provider.descriptor.capabilities.write && input.context.binding.direction !== 'pull'
        const outgoing = pushAllowed
          ? (item?.events ?? []).flatMap(event =>
              event.kind === 'commented' &&
              event.commentId !== undefined &&
              event.actor !== 'system' &&
              !BacklogOrigins.isRemote(BacklogOrigins.of(event)) &&
              (input.context.binding.pushAgentComments || !BacklogOrigins.isAgent(BacklogOrigins.of(event))) &&
              !knownLocal.has(event.commentId) &&
              event.at >= input.ref.pushCommentsSince &&
              event.detail.trim() !== ''
                ? [{ commentId: event.commentId, actor: event.actor, detail: event.detail }]
                : [],
            )
          : []
        const label = item === undefined ? `b:${String(input.itemId)}` : BacklogReference.labelOf(item)
        const pushedPairs = yield* Effect.forEach(outgoing, event =>
          Effect.map(
            input.context.provider.comment({
              ...input.scope,
              key: input.ref.key,
              body: BacklogSyncModel.exportedCommentText(label, event.actor, event.detail),
            }),
            created => ({ local: event.commentId, remote: created.id }),
          ),
        )
        return {
          pairs: [...input.ref.comments, ...pulledPairs, ...pushedPairs].slice(-BacklogSyncModel.maxCommentPairs),
          pulled: pulledPairs.length,
          pushed: pushedPairs.length,
        }
      })

      /** Writes the pulled fields: scalars in one update, parent apart (a parent the store refuses is recorded, never fatal), links one by one. */
      const applyPull = Effect.fnUntraced(function* (input: {
        readonly item: BacklogItem
        readonly pull: ReturnType<typeof BacklogSyncModel.plan>['pull']
        readonly maps: KeyMaps
        readonly origin: string
        readonly context: BindingContext
      }) {
        const notes: string[] = []
        const parentRef =
          input.pull.parent === undefined
            ? undefined
            : input.pull.parent === null
              ? null
              : yield* Effect.flatMap(Effect.succeed(input.maps.itemByKey.get(input.pull.parent)), id =>
                  id === undefined ? Effect.succeed(undefined) : refOfId(id),
                )
        const scalars = {
          ...(input.pull.title !== undefined && { title: input.pull.title.slice(0, BacklogItems.maxTitleChars) }),
          ...(input.pull.body !== undefined && { body: input.pull.body.slice(0, BacklogItems.maxBodyChars) }),
          ...(input.pull.status !== undefined && { status: input.pull.status }),
          ...(input.pull.tags !== undefined && { tags: input.pull.tags.slice(0, 20) }),
          ...(input.pull.priority !== undefined && { priority: input.pull.priority }),
        }
        if (Object.keys(scalars).length > 0)
          yield* store.update({ id: input.item.id, ...scalars, actor: { kind: 'system' }, origin: input.origin }).pipe(Effect.orDie)
        if (parentRef !== undefined) {
          const parented = yield* Effect.result(store.update({ id: input.item.id, parent: parentRef, actor: { kind: 'system' }, origin: input.origin }))
          if (parented._tag === 'Failure') {
            if (parented.failure._tag !== 'BacklogParentInvalid') return yield* Effect.die(parented.failure)
            notes.push(parented.failure.message)
          }
        }
        if (input.pull.links !== undefined) {
          const relations = supportedRelations(input.context)
          const wanted = yield* Effect.forEach(input.pull.links, entry => {
            const separator = entry.indexOf(':')
            const relation = entry.slice(0, separator)
            const id = input.maps.itemByKey.get(entry.slice(separator + 1))
            return Effect.map(id === undefined ? Effect.succeed(undefined) : refOfId(id), ref => (ref === undefined ? [] : [{ relation, target: ref }]))
          })
          const wantedLinks = wanted.flat()
          const current = yield* itemOf(input.item.id)
          const mappable = yield* Effect.forEach(
            (current ?? input.item).links.filter(link => link.type === 'item' && relations.has(link.relation ?? 'related')),
            link => Effect.map(idOfRef(link.target), id => (id !== undefined && input.maps.keyByItem.has(id) ? [link] : [])),
          )
          const present = mappable.flat()
          const sameLink = (
            left: { readonly relation?: string | undefined; readonly target: string },
            right: { readonly relation?: string | undefined; readonly target: string },
          ) => (left.relation ?? 'related') === (right.relation ?? 'related') && left.target === right.target
          // Sequential on purpose: each link is its own op on the same item.
          yield* Effect.forEach(
            present.filter(link => !wantedLinks.some(entry => sameLink(entry, link))),
            link => store.link({ id: input.item.id, link, remove: true, actor: { kind: 'system' }, origin: input.origin }),
            { discard: true },
          )
          yield* Effect.forEach(
            wantedLinks.filter(entry => !present.some(link => sameLink(entry, link)) && BacklogItems.relations.some(known => known === entry.relation)),
            entry =>
              store.link({
                id: input.item.id,
                link: { type: 'item', target: entry.target, relation: BacklogItems.relations.find(known => known === entry.relation) ?? 'related' },
                actor: { kind: 'system' },
                origin: input.origin,
              }),
            { discard: true },
          )
        }
        return notes
      })

      /** A planned push as a provider patch: status and tags through the binding's value maps, links as relations. */
      const patchOf = (context: BindingContext, push: ReturnType<typeof BacklogSyncModel.plan>['push']): RemotePatch => {
        const rules = context.binding.fieldMap
        const statusLabel = push.status === undefined ? undefined : BacklogSyncModel.remoteLabelOf(rules, 'status', push.status)
        return {
          ...(push.title !== undefined && { title: push.title }),
          ...(push.body !== undefined && { body: push.body }),
          ...(push.status !== undefined && { status: push.status }),
          ...(statusLabel !== undefined && { statusLabel }),
          ...(push.tags !== undefined && { tags: push.tags.map(tag => BacklogSyncModel.remoteLabelOf(rules, 'tags', tag) ?? tag) }),
          ...(push.priority !== undefined && { priority: push.priority }),
          ...(push.parent !== undefined && { parentKey: push.parent }),
          ...(push.links !== undefined && {
            relations: push.links.flatMap((entry): RemoteRelation[] => {
              const separator = entry.indexOf(':')
              const relation = BacklogItems.relations.find(known => known === entry.slice(0, separator))
              return relation === 'related' || relation === 'depends-on' || relation === 'blocks' || relation === 'duplicates'
                ? [{ relation, key: entry.slice(separator + 1) }]
                : []
            }),
          }),
        }
      }

      /** The base after a pass: both sides as they now are, except flagged fields, whose base stays put. */
      const nextBase = (input: {
        readonly local: SyncSnapshot
        readonly remote: SyncSnapshot
        readonly previous: ExternalRef['base']
        readonly flagged: readonly SyncField[]
      }) => {
        if (input.previous === null || input.flagged.length === 0) return { local: input.local, remote: input.remote }
        const previous = input.previous
        const restore = (snapshot: SyncSnapshot, from: SyncSnapshot): SyncSnapshot =>
          input.flagged.reduce<SyncSnapshot>((current, field) => {
            const kept = from[field]
            if (kept === undefined) return current
            return { ...current, [field]: kept }
          }, snapshot)
        return { local: restore(input.local, previous.local), remote: restore(input.remote, previous.remote) }
      }

      const syncOnce = Effect.fnUntraced(function* (input: {
        readonly context: BindingContext
        readonly itemId: number
        readonly ref: ExternalRef
        readonly record?: RemoteRecord | undefined
        readonly comments: boolean
      }) {
        const context = input.context
        const item = yield* itemOf(input.itemId)
        if (item === undefined) return yield* new BacklogItemNotFound({ ids: [input.itemId] })
        const scope = scopeOf(context, item.project)
        const fields = readFields(context)
        const wantsComments = input.comments && context.provider.descriptor.capabilities.comments !== 'none'
        const record =
          input.record === undefined || (wantsComments && input.record.comments === undefined)
            ? yield* context.provider.fetch({ ...scope, key: input.ref.key, fields })
            : input.record
        const origin = `remote:${context.binding.id}`
        const maps = yield* keyMaps(context.binding.id)
        const at = yield* Clock.currentTimeMillis
        const flows = flowsOf(context)
        const local = yield* snapshotOf(context, item, maps)
        const remote = BacklogSyncModel.remoteSnapshot({ record, rules: context.binding.fieldMap })
        const plan = BacklogSyncModel.plan({
          item,
          local,
          remote,
          remoteStatusEquivalents: record.status?.equivalents ?? [],
          remoteUpdatedAt: record.updatedAt,
          base: input.ref.base,
          flows,
          policy: context.binding.conflictPolicy,
          at,
        })
        const pulled = BacklogSyncModel.syncedFields.filter(field => plan.pull[field] !== undefined)
        const pushed = BacklogSyncModel.syncedFields.filter(field => plan.push[field] !== undefined)
        const notes = pulled.length > 0 ? yield* applyPull({ item, pull: plan.pull, maps, origin, context }) : []
        const remoteAfter = pushed.length > 0 ? yield* context.provider.push({ ...scope, key: input.ref.key, patch: patchOf(context, plan.push) }) : record
        const comments = wantsComments
          ? yield* syncComments({ context, ref: input.ref, itemId: item.id, record, origin, scope })
          : { pairs: input.ref.comments, pulled: 0, pushed: 0 }
        if (plan.conflicts.length > 0) {
          yield* store.comment({
            id: item.id,
            text: BacklogSyncModel.conflictNote({ source: context.connection.label, key: remoteAfter.displayKey, conflicts: plan.conflicts }),
            actor: { kind: 'system' },
          })
        }
        const final = (yield* itemOf(item.id)) ?? item
        const finalLocal = yield* snapshotOf(context, final, maps)
        const finalRemote = BacklogSyncModel.remoteSnapshot({ record: remoteAfter, rules: context.binding.fieldMap })
        const next: ExternalRef = {
          ...input.ref,
          displayKey: remoteAfter.displayKey.slice(0, 200),
          url: remoteAfter.url.slice(0, BacklogItems.maxTargetChars),
          lastSyncedAt: at,
          remoteUpdatedAt: remoteAfter.updatedAt,
          lastRemoteVersion: remoteAfter.version.slice(0, 200),
          localSyncedAt: final.lastActivityAt,
          base: nextBase({ local: finalLocal, remote: finalRemote, previous: input.ref.base, flagged: plan.flagged }),
          comments: comments.pairs,
          state: plan.conflicts.length > 0 || plan.flagged.length > 0 ? 'conflict' : notes.length > 0 ? 'error' : 'synced',
          conflicts: [...input.ref.conflicts, ...plan.conflicts].slice(-BacklogSyncModel.maxConflicts),
          lastError: notes.length > 0 ? { code: 'BacklogParentInvalid', message: (notes[0] ?? '').slice(0, 1_000), at } : null,
        }
        yield* sources
          .putRef({ itemId: item.id, ref: next })
          .pipe(Effect.catch(cause => Effect.fail(new SyncWriteFailed({ itemId: item.id, ref: BacklogReference.refOf(item), cause }))))
        return {
          itemId: item.id,
          ref: BacklogReference.refOf(item),
          bindingId: context.binding.id,
          remoteKey: next.displayKey,
          state: next.state,
          pulled,
          pushed,
          conflicts: plan.conflicts,
          commentsPulled: comments.pulled,
          commentsPushed: comments.pushed,
          error: next.lastError === null ? null : { code: next.lastError.code, message: next.lastError.message },
        } satisfies SyncItemResult
      })

      /** One item's sync through one binding; a failure is recorded on the ref and answered, never thrown. */
      const syncRef = Effect.fn('backlog sync item')(function* (input: {
        readonly context: BindingContext
        readonly itemId: number
        readonly ref: ExternalRef
        readonly record?: RemoteRecord | undefined
        readonly comments?: boolean | undefined
      }) {
        yield* Effect.annotateCurrentSpan({
          'dshx.plugin.package': '@dshfiles/backlog',
          'dshx.backlog.item_id': input.itemId,
          'dshx.backlog.sync.binding': input.context.binding.id,
          'dshx.backlog.sync.provider': input.context.provider.descriptor.kind,
        })
        const outcome = yield* Effect.result(syncOnce({ ...input, comments: input.comments ?? true }))
        if (outcome._tag === 'Success') {
          yield* Effect.annotateCurrentSpan({
            'dshx.backlog.sync.outcome': outcome.success.state,
            'dshx.backlog.sync.pulled': outcome.success.pulled.length,
            'dshx.backlog.sync.pushed': outcome.success.pushed.length,
            'dshx.backlog.sync.conflicts': outcome.success.conflicts.length,
          })
          return outcome.success
        }
        const error = yield* recordError({ itemId: input.itemId, ref: input.ref, error: outcome.failure })
        yield* Effect.annotateCurrentSpan({ 'dshx.backlog.sync.outcome': 'error', 'error.type': error.code })
        const ref = yield* refOfId(input.itemId)
        return {
          itemId: input.itemId,
          ...(ref !== undefined && { ref }),
          bindingId: input.context.binding.id,
          remoteKey: input.ref.displayKey,
          state: 'error',
          pulled: [],
          pushed: [],
          conflicts: [],
          commentsPulled: 0,
          commentsPushed: 0,
          error,
        } satisfies SyncItemResult
      })

      /** A remote item that is gone: the item moves to dropped when status flows in, says why, and loses the ref. */
      const removed = Effect.fnUntraced(function* (input: { readonly context: BindingContext; readonly itemId: number; readonly ref: ExternalRef }) {
        const item = yield* itemOf(input.itemId)
        const origin = `remote:${input.context.binding.id}`
        if (item !== undefined) {
          const statusFlows = flowsOf(input.context).get('status')?.pull === true
          if (statusFlows && item.status !== 'done' && item.status !== 'dropped')
            yield* store.update({ id: item.id, status: 'dropped', actor: { kind: 'system' }, origin }).pipe(Effect.orDie)
          yield* store.comment({
            id: item.id,
            text: `${input.context.connection.label} no longer has ${input.ref.displayKey}; the link is removed${statusFlows ? ' and the item dropped' : ''}. Link it again from its menu to resume.`,
            actor: { kind: 'system' },
          })
        }
        yield* sources.deleteRef({ bindingId: input.ref.bindingId, key: input.ref.key }).pipe(Effect.orDie)
      })

      const importRecord = Effect.fn('backlog sync import item')(function* (input: {
        readonly context: BindingContext
        readonly record: RemoteRecord
        readonly project: string | null
        readonly actor: BacklogActor
      }) {
        const record = input.record
        const origin = `remote:${input.context.binding.id}`
        const remote = BacklogSyncModel.remoteSnapshot({ record, rules: input.context.binding.fieldMap })
        const captured = yield* store
          .capture({
            text: record.title.replace(/\s+/gu, ' ').trim() || record.displayKey,
            project: input.project,
            fields: { body: record.body, tags: remote.tags },
            actor: input.actor,
            origin,
          })
          .pipe(
            Effect.catchTag('BacklogParentInvalid', error => Effect.die(error)),
            Effect.orDie,
          )
        const id = captured.item.id
        const kind = record.kind ?? kindOfTags(remote.tags)
        const status: BacklogStatus | null = remote.status
        yield* store
          .update({
            id,
            ...(status !== null && { status }),
            ...(kind !== undefined && { kind }),
            ...(remote.priority !== undefined && remote.priority !== 'none' && { priority: remote.priority }),
            actor: { kind: 'system' },
            origin,
          })
          .pipe(Effect.orDie)
        const item = (yield* itemOf(id)) ?? captured.item
        const at = yield* Clock.currentTimeMillis
        const maps = yield* keyMaps(input.context.binding.id)
        const ref: ExternalRef = {
          bindingId: input.context.binding.id,
          key: record.key,
          displayKey: record.displayKey.slice(0, 200),
          url: record.url.slice(0, BacklogItems.maxTargetChars),
          linkedAt: at,
          lastSyncedAt: at,
          remoteUpdatedAt: record.updatedAt,
          lastRemoteVersion: record.version.slice(0, 200),
          localSyncedAt: item.lastActivityAt,
          // Parent and links stay out of the base: the next sync of this item adopts them once their targets are linked too.
          base: { local: withoutStructure(yield* snapshotOf(input.context, item, maps)), remote: withoutStructure(remote) },
          comments: [],
          pushCommentsSince: at,
          state: 'synced',
          conflicts: [],
          lastError: null,
        }
        yield* sources
          .putRef({ itemId: id, ref })
          .pipe(Effect.catch(cause => Effect.fail(new SyncWriteFailed({ itemId: id, ref: BacklogReference.refOf(item), cause }))))
        if (/^https?:\/\//u.test(ref.url)) yield* store.link({ id, link: { type: 'url', target: ref.url, relation: 'related' }, actor: input.actor, origin })
        return id
      })

      const pass = Effect.fn('backlog sync')(function* (input: {
        readonly context: BindingContext
        readonly importNew?: boolean | undefined
        readonly openOnly?: boolean | undefined
        readonly restart?: boolean | undefined
      }) {
        const context = input.context
        const binding = context.binding
        yield* Effect.annotateCurrentSpan({
          'dshx.plugin.package': '@dshfiles/backlog',
          'dshx.backlog.sync.binding': binding.id,
          'dshx.backlog.sync.provider': context.provider.descriptor.kind,
          'dshx.backlog.sync.direction': binding.direction,
        })
        if (binding.ownerHostId !== sources.hostId) return yield* new SyncNotOwner({ binding: binding.id, ownerHostId: binding.ownerHostId })
        const capabilities = context.provider.descriptor.capabilities
        const importNew = input.importNew ?? binding.importNew
        const state = yield* sources.state(binding.id).pipe(Effect.orDie)
        const results: SyncItemResult[] = []
        const handled = new Set<string>()
        const imported: { readonly itemId: number; readonly record: RemoteRecord }[] = []
        let records = 0
        let removedCount = 0
        let complete = false
        const canPull = binding.direction !== 'push' && capabilities.read
        if (canPull) {
          const fields = readFields(context)
          const cursor = input.restart === true ? null : state.cursor
          const seen = new Set<string>()
          let page: string | null = null
          let allPages = true
          let finished = false
          let checkpoint: string | null = cursor
          for (let pages = 0; pages < MAX_PAGES_PER_PASS; pages += 1) {
            const outcome: Result.Result<PullPage, BacklogProviderFailed> = yield* Effect.result(
              context.provider.pull({ ...scopeOf(context, null), cursor, page, fields, openOnly: input.openOnly === true }),
            )
            if (outcome._tag === 'Failure') {
              yield* Effect.annotateCurrentSpan({ 'error.type': outcome.failure.code })
              yield* Effect.logWarning('backlog sync: the pull failed', { binding: binding.id, error: outcome.failure.message })
              allPages = false
              break
            }
            const current: PullPage = outcome.success
            const maps = yield* keyMaps(binding.id)
            // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- records apply in remote order; each is a few ops the store serializes anyway.
            for (const record of current.records) {
              records += 1
              seen.add(record.key)
              const itemId = maps.itemByKey.get(record.key)
              if (itemId !== undefined) {
                const stored = yield* sources.refByKey({ bindingId: binding.id, key: record.key }).pipe(Effect.orDie)
                if (stored._tag === 'None') continue
                const item = yield* itemOf(itemId)
                if (item === undefined) continue
                const unchanged =
                  record.version === stored.value.ref.lastRemoteVersion &&
                  BacklogSyncModel.stateOf(stored.value.ref, yield* snapshotOf(context, item, maps)) === 'synced'
                handled.add(record.key)
                if (!unchanged) results.push(yield* syncRef({ context, itemId, ref: stored.value.ref, record }))
                continue
              }
              if (!importNew || record.deleted === true || !isOpenRecord(record)) continue
              const created = yield* Effect.result(importRecord({ context, record, project: binding.scope, actor: { kind: 'system' } }))
              if (created._tag === 'Success') {
                handled.add(record.key)
                imported.push({ itemId: created.success, record })
              }
            }
            allPages = allPages && current.complete
            if (current.nextPage === null) {
              finished = true
              checkpoint = current.checkpoint
              break
            }
            page = current.nextPage
          }
          complete = finished && allPages
          if (complete) {
            const stale = (yield* sources.refsOfBinding(binding.id).pipe(Effect.orDie)).filter(entry => !seen.has(entry.ref.key))
            // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- each removal writes the item and drops its ref; the store serializes them.
            for (const entry of stale) {
              if ((yield* itemOf(entry.itemId)) === undefined) continue
              yield* removed({ context, itemId: entry.itemId, ref: entry.ref })
              handled.add(entry.ref.key)
              removedCount += 1
            }
          }
          const at = yield* Clock.currentTimeMillis
          if (finished) yield* sources.setState({ bindingId: binding.id, cursor: checkpoint, lastPassAt: at }).pipe(Effect.orDie)
          // Parent and links of imported items resolve once every item of the pass is linked.
          for (const entry of imported) {
            if (entry.record.parentKey === undefined && entry.record.relations === undefined) continue
            const stored = yield* sources.refByKey({ bindingId: binding.id, key: entry.record.key }).pipe(Effect.orDie)
            if (stored._tag === 'Some') yield* syncRef({ context, itemId: entry.itemId, ref: stored.value.ref, record: entry.record, comments: false })
          }
        }
        const maps = yield* keyMaps(binding.id)
        const pending = (yield* sources.refsOfBinding(binding.id).pipe(Effect.orDie)).filter(entry => !handled.has(entry.ref.key))
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- one binding syncs one item at a time, so a provider's rate limit holds.
        for (const entry of pending) {
          const item = yield* itemOf(entry.itemId)
          if (item === undefined) continue
          const local = yield* snapshotOf(context, item, maps)
          if (entry.ref.state === 'error' || BacklogSyncModel.stateOf(entry.ref, local) === 'pending')
            results.push(yield* syncRef({ context, itemId: entry.itemId, ref: entry.ref }))
        }
        if (!canPull) yield* sources.setState({ bindingId: binding.id, cursor: state.cursor, lastPassAt: yield* Clock.currentTimeMillis }).pipe(Effect.orDie)
        yield* Effect.annotateCurrentSpan({
          'dshx.backlog.sync.records': records,
          'dshx.backlog.sync.created': imported.length,
          'dshx.backlog.sync.removed': removedCount,
          'dshx.backlog.sync.items': results.length,
          'dshx.backlog.sync.errors': results.filter(result => result.error !== null).length,
        })
        return { bindingId: binding.id, records, created: imported.length, removed: removedCount, complete, results } satisfies BindingPassResult
      })

      return BacklogSyncEngine.of({
        withBinding,
        syncRef,
        pass,
        importRecord,
        localSnapshot: input => Effect.flatMap(keyMaps(input.context.binding.id), maps => snapshotOf(input.context, input.item, maps)),
      })
    }),
  )
}

export class SyncEngineModel {
  static readonly providerConnection = providerConnection
  static readonly scopeOf = scopeOf
  static readonly readFields = readFields
  static readonly isOpenRecord = isOpenRecord
  static readonly kindOfTags = kindOfTags
}
