import { SecretReferenceResolver, type SecretReferenceResolverError } from '@dshfiles/credential-port/effect'
import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Cause, Clock, Context, Effect, Layer, Option, Redacted, Ref, Schedule, Semaphore } from 'effect'
import { HttpClient } from 'effect/http'
import type { BacklogDetailView } from './api.js'
import { BacklogSettingsTag } from './backlog-settings.js'
import { BacklogItemNotFound, type BacklogWriteFailed } from './errors.js'
import { BacklogOrigins } from './event-origin.js'
import { BacklogReference } from './backlog-reference.js'
import { BacklogItems, type BacklogItem, type BacklogKind } from './item.js'
import type { BacklogSettings } from './settings.js'
import { BacklogStore, type BacklogActor, type BacklogResult } from './store.js'
import type { RemoteBackend, RemoteConnection } from './sync-backend.js'
import {
  SyncAlreadyLinked,
  SyncBackendUnconfigured,
  SyncCredentialMissing,
  SyncItemNotLinked,
  SyncReferenceUnrecognized,
  SyncRemoteRejected,
  SyncTargetMissing,
  SyncWriteFailed,
  type RemoteBackendError,
} from './sync-errors.js'
import { GithubMapping, makeGithubBackend } from './sync-github.js'
import { makeLinearBackend } from './sync-linear.js'
import { SyncLocalProbes } from './sync-local-probes.js'
import { BacklogSyncModel, type RemoteIssue, type SyncBackendKind, type SyncConflict, type SyncField, type SyncMapping, type SyncState } from './sync-model.js'
import { BacklogSyncTables } from './sync-tables.js'

type BackendRow = BacklogSettings['syncBackends'][number]

/** Host environment variables read when a row binds no key, first set wins. */
const environmentVariables = { linear: ['LINEAR_API_KEY'], github: ['GITHUB_TOKEN', 'GH_TOKEN'] } as const satisfies Record<SyncBackendKind, readonly string[]>

type CredentialSource = 'reference' | 'environment' | 'github-cli'

/** A row as the settings form holds it, before it is saved. */
export interface SyncBackendDraft {
  readonly backend: SyncBackendKind
  readonly project: string
  readonly target: string
  readonly secret: string
}

/** What Test connection answers: never the key, only where it came from and what it reaches. */
export interface SyncConnectionTest {
  readonly ok: boolean
  readonly credential: CredentialSource | 'missing'
  readonly account: string | null
  readonly target: { readonly key: string; readonly name: string } | null
  readonly targetSource: 'setting' | 'git-remote' | 'only-team' | 'per-project' | null
  readonly teams: readonly { readonly key: string; readonly name: string }[]
  readonly error: { readonly code: string; readonly message: string } | null
}

/** One row's identity for the auto-sync schedule. */
const rowKey = (row: BackendRow): string => `${row.backend}:${row.project}`

/** The enabled row that serves a project: its own row first, then a row with an empty project. */
const rowFor = (rows: readonly BackendRow[], backend: SyncBackendKind, project: string | null): BackendRow | undefined => {
  const candidates = rows.filter(row => row.enabled && row.backend === backend)
  const own = project === null ? undefined : candidates.find(row => row.project !== '' && BacklogItems.projectPath(row.project) === project)
  return own ?? candidates.find(row => row.project === '')
}

/** What the agent tools and the panel read about one linked item. */
export interface SyncItemView {
  readonly itemId: number
  readonly ref?: string
  readonly backend: SyncBackendKind
  readonly remoteKey: string
  readonly url: string
  readonly state: SyncState
  readonly lastSyncedAt: number | null
  readonly lastError: SyncMapping['lastError']
  readonly conflicts: readonly SyncConflict[]
}

/** What one sync pass did for one item. */
export interface SyncItemResult {
  readonly itemId: number
  readonly ref?: string
  readonly remoteKey: string | null
  readonly state: SyncState
  readonly pulled: readonly SyncField[]
  readonly pushed: readonly SyncField[]
  readonly conflicts: readonly SyncConflict[]
  readonly commentsPulled: number
  readonly commentsPushed: number
  readonly error: { readonly code: string; readonly message: string } | null
}

export interface SyncBackendView {
  readonly project: string | null
  readonly backend: SyncBackendKind
  readonly target: string
  readonly enabled: boolean
  readonly autoSyncMinutes: number
  readonly credential: CredentialSource | 'missing'
}

export interface SyncStatusView {
  readonly backends: readonly SyncBackendView[]
  readonly items: readonly SyncItemView[]
}

type ConfigError = SyncBackendUnconfigured | SyncCredentialMissing | SyncTargetMissing
type LinkError = ConfigError | RemoteBackendError | SyncAlreadyLinked | SyncWriteFailed | BacklogWriteFailed | BacklogItemNotFound

const projectOfRow = (project: string): string | null => (project.trim() === '' ? null : BacklogItems.projectPath(project))

const errorView = (error: { readonly _tag: string; readonly message: string }) => ({ code: error._tag.slice(0, 64), message: error.message.slice(0, 1_000) })

/**
 * Opens the backend a settings row names, with its credential resolved on the Host: the bound reference, then the Host
 * environment, then (GitHub) a signed-in `gh` CLI. A GitHub row without a repository takes it from the project's git
 * remote; a Linear row without a team uses the key's only team.
 */
export class RemoteBackends extends Context.Service<
  RemoteBackends,
  {
    readonly open: (input: {
      readonly row: BackendRow
      readonly project: string | null
      readonly repositoryHint?: string | undefined
    }) => Effect.Effect<RemoteBackend, ConfigError>
    readonly credentialSource: (row: Pick<BackendRow, 'backend' | 'secret'>) => Effect.Effect<CredentialSource | 'missing'>
    readonly test: (draft: SyncBackendDraft) => Effect.Effect<SyncConnectionTest>
  }
>()('@dshfiles/backlog/RemoteBackends') {
  static readonly layer = Layer.effect(
    RemoteBackends,
    Effect.gen(function* () {
      const secrets = yield* SecretReferenceResolver
      const http = yield* HttpClient.HttpClient
      const probes = yield* SyncLocalProbes

      const environmentOf = (backend: SyncBackendKind) =>
        environmentVariables[backend].map(name => ({ name, value: process.env[name] ?? '' })).find(variable => variable.value !== '')

      const resolveCredential = Effect.fnUntraced(function* (
        row: Pick<BackendRow, 'backend' | 'secret'>,
      ): Effect.fn.Return<Option.Option<{ readonly key: Redacted.Redacted; readonly source: CredentialSource }>, SecretReferenceResolverError> {
        const environment = environmentOf(row.backend)
        const resolved = yield* secrets.resolveWithLabel({
          referenceText: row.secret,
          environmentValue: environment?.value,
          environmentVariableName: environment?.name ?? environmentVariables[row.backend][0],
        })
        if (Option.isSome(resolved)) {
          return Option.some({ key: Redacted.make(resolved.value.value), source: row.secret.trim() === '' ? 'environment' : 'reference' })
        }
        if (row.backend !== 'github' || row.secret.trim() !== '') return Option.none()
        return Option.map(yield* probes.githubCliToken, key => ({ key, source: 'github-cli' as const }))
      })

      const credentialOrMissing = (row: BackendRow) =>
        resolveCredential(row).pipe(
          Effect.catch(error => Effect.as(Effect.logWarning('backlog sync: the credential could not be resolved', error), Option.none())),
          Effect.flatMap(credential =>
            Option.isSome(credential)
              ? Effect.succeed(credential.value)
              : Effect.fail(new SyncCredentialMissing({ backend: row.backend, environmentVariable: environmentVariables[row.backend][0] })),
          ),
        )

      /** The repository a GitHub row serves for `project`: its own, the issue reference's, then the project's git remote. */
      const repositoryOf = Effect.fnUntraced(function* (input: {
        readonly target: string
        readonly project: string | null
        readonly hint?: string | undefined
      }): Effect.fn.Return<Option.Option<{ readonly key: string; readonly source: 'setting' | 'git-remote' }>> {
        const configured = input.target.trim()
        if (configured !== '') return Option.some({ key: configured, source: 'setting' })
        if (input.hint !== undefined) return Option.some({ key: input.hint, source: 'setting' })
        if (input.project === null) return Option.none()
        return Option.map(yield* probes.githubRepository(input.project), key => ({ key, source: 'git-remote' as const }))
      })

      const open = Effect.fn('backlog sync open backend')(
        function* (input: { readonly row: BackendRow; readonly project: string | null; readonly repositoryHint?: string | undefined }) {
          const credential = yield* credentialOrMissing(input.row)
          if (input.row.backend === 'linear') return yield* makeLinearBackend({ teamKey: input.row.target.trim(), apiKey: credential.key })
          const project = projectOfRow(input.row.project) ?? input.project
          const repository = yield* repositoryOf({ target: input.row.target, project, hint: input.repositoryHint })
          if (Option.isNone(repository)) return yield* new SyncTargetMissing({ backend: 'github', project })
          return yield* makeGithubBackend({ repository: repository.value.key, token: credential.key })
        },
        Effect.provideService(HttpClient.HttpClient, http),
      )

      const credentialSource = (row: Pick<BackendRow, 'backend' | 'secret'>): Effect.Effect<CredentialSource | 'missing'> => {
        if (row.secret.trim() !== '') return Effect.succeed('reference')
        if (environmentOf(row.backend) !== undefined) return Effect.succeed('environment')
        if (row.backend === 'linear') return Effect.succeed('missing')
        return Effect.map(probes.githubCliToken, token => (Option.isSome(token) ? 'github-cli' : 'missing'))
      }

      const failedTest = (input: {
        readonly credential: SyncConnectionTest['credential']
        readonly error: { readonly _tag: string; readonly message: string }
      }) =>
        ({
          ok: false,
          credential: input.credential,
          account: null,
          target: null,
          targetSource: null,
          teams: [],
          error: errorView(input.error),
        }) satisfies SyncConnectionTest

      const test = Effect.fn('backlog sync test connection')(
        function* (draft: SyncBackendDraft) {
          yield* Effect.annotateCurrentSpan({ 'dshx.plugin.package': '@dshfiles/backlog', 'dshx.backlog.sync.backend': draft.backend })
          const resolved = yield* Effect.result(resolveCredential(draft))
          if (resolved._tag === 'Failure') return failedTest({ credential: 'reference', error: resolved.failure })
          if (Option.isNone(resolved.success)) {
            return failedTest({
              credential: 'missing',
              error: new SyncCredentialMissing({ backend: draft.backend, environmentVariable: environmentVariables[draft.backend][0] }),
            })
          }
          const credential = resolved.success.value
          const project = projectOfRow(draft.project)
          const repository = draft.backend === 'github' ? yield* repositoryOf({ target: draft.target, project }) : Option.none()
          const backend =
            draft.backend === 'linear'
              ? yield* makeLinearBackend({ teamKey: draft.target.trim(), apiKey: credential.key })
              : yield* makeGithubBackend({ repository: Option.match(repository, { onNone: () => '', onSome: found => found.key }), token: credential.key })
          const connection = yield* Effect.result(backend.connection)
          if (connection._tag === 'Failure') return failedTest({ credential: credential.source, error: connection.failure })
          return connectionReport({
            draft,
            project,
            credential: credential.source,
            connection: connection.success,
            repositorySource: Option.getOrUndefined(repository)?.source,
          })
        },
        Effect.provideService(HttpClient.HttpClient, http),
      )

      return RemoteBackends.of({ open, credentialSource, test })
    }),
  )
}

const connectionReport = (input: {
  readonly draft: SyncBackendDraft
  readonly project: string | null
  readonly credential: CredentialSource
  readonly connection: RemoteConnection
  readonly repositorySource: 'setting' | 'git-remote' | undefined
}): SyncConnectionTest => {
  const base = { credential: input.credential, account: input.connection.account, target: input.connection.target, teams: input.connection.teams }
  if (input.connection.target !== null) {
    const targetSource = input.draft.backend === 'github' ? (input.repositorySource ?? 'setting') : input.draft.target.trim() === '' ? 'only-team' : 'setting'
    return { ...base, ok: true, targetSource, error: null }
  }
  if (input.draft.backend === 'github' && input.project === null) return { ...base, ok: true, targetSource: 'per-project', error: null }
  if (input.draft.backend === 'linear' && input.draft.target.trim() !== '') {
    const missing = new SyncRemoteRejected({ backend: 'linear', status: 404, detail: `no team with key ${input.draft.target.trim()} visible to this key` })
    return { ...base, ok: false, targetSource: null, error: errorView(missing) }
  }
  return { ...base, ok: false, targetSource: null, error: errorView(new SyncTargetMissing({ backend: input.draft.backend, project: input.project })) }
}

const errorRecord = (error: { readonly _tag: string; readonly message: string }, at: number) => ({
  code: error._tag.slice(0, 64),
  message: error.message.slice(0, 1_000),
  at,
})

/** The kind an imported issue's labels name, first match wins. */
const kindLabels: readonly (readonly [string, BacklogKind])[] = [
  ['bug', 'bug'],
  ['idea', 'idea'],
  ['feature', 'idea'],
  ['question', 'question'],
]

const kindOfTags = (tags: readonly string[]): BacklogKind | undefined => kindLabels.find(([label]) => tags.includes(label))?.[1]

/**
 * Two-way sync of backlog items with remote trackers. Every mapping is plugin-owned state in the `backlog_sync` domain;
 * one item syncs at a time, and a failing remote never touches the item: the mapping records the error and the next
 * pass retries.
 */
export class BacklogSync extends Context.Service<
  BacklogSync,
  {
    readonly status: (input: { readonly ids?: readonly number[] | undefined }) => Effect.Effect<SyncStatusView>
    readonly syncNow: (input: {
      readonly id?: number | undefined
      readonly project?: string | null | undefined
    }) => Effect.Effect<{ readonly results: readonly SyncItemResult[] }, SyncItemNotLinked>
    readonly link: (input: {
      readonly id: number
      readonly backend: SyncBackendKind
      readonly reference?: string | undefined
      readonly create?: boolean | undefined
      readonly remove?: boolean | undefined
      readonly actor: BacklogActor
    }) => Effect.Effect<{ readonly item: SyncItemView | null; readonly result: SyncItemResult | null }, LinkError>
    readonly importRemote: (input: {
      readonly backend?: SyncBackendKind | undefined
      readonly reference: string
      readonly project?: string | null | undefined
      readonly actor: BacklogActor
    }) => Effect.Effect<{ readonly detail: BacklogDetailView; readonly created: boolean }, LinkError | SyncReferenceUnrecognized>
    readonly testConnection: (draft: SyncBackendDraft) => Effect.Effect<SyncConnectionTest>
    /** Every saved row's connection, in settings order. */
    readonly testSaved: Effect.Effect<{
      readonly results: readonly (Pick<BackendRow, 'backend' | 'project' | 'target' | 'enabled'> & { readonly report: SyncConnectionTest })[]
    }>
    /** One auto-sync round: every row with an interval that is due. */
    readonly autoSyncTick: Effect.Effect<void>
    /**
     * Deletes an item, its attachments and its remote mapping, so a later item can never inherit the deleted one's
     * issue. The remote issue itself is left alone.
     */
    readonly deleteItem: (input: { readonly id: number }) => Effect.Effect<BacklogResult<void>, BacklogWriteFailed | SyncWriteFailed>
  }
>()('@dshfiles/backlog/BacklogSync') {
  static readonly layer = Layer.effect(
    BacklogSync,
    Effect.gen(function* () {
      const store = yield* BacklogStore
      const settings = yield* BacklogSettingsTag
      const tables = yield* BacklogSyncTables
      const backends = yield* RemoteBackends
      const lock = yield* Semaphore.make(1)
      const lastRun = yield* Ref.make<ReadonlyMap<string, number>>(new Map())

      const mappings = tables.mappings.entries.pipe(
        Effect.map(rows => rows.map(([, mapping]) => mapping)),
        Effect.orDie,
      )
      const mappingOf = (id: number) => Effect.map(tables.mappings.get(String(id)).pipe(Effect.orDie), Option.getOrUndefined)
      const save = (mapping: SyncMapping) =>
        tables.mappings.put(String(mapping.itemId), mapping).pipe(Effect.mapError(cause => new SyncWriteFailed({ itemId: mapping.itemId, cause })))
      const itemOf = (id: number) => Effect.map(store.get(id), found => (found.ok ? found.value.item : undefined))

      const backendFor = (input: { readonly backend: SyncBackendKind; readonly project: string | null; readonly reference?: string | undefined }) =>
        Effect.gen(function* () {
          const row = rowFor((yield* settings.get).syncBackends, input.backend, input.project)
          if (row === undefined) return yield* new SyncBackendUnconfigured({ backend: input.backend, project: input.project })
          const repositoryHint = input.backend === 'github' && input.reference !== undefined ? GithubMapping.repositoryOfReference(input.reference) : undefined
          return yield* backends.open({ row, project: input.project, repositoryHint })
        })

      const viewOf = (mapping: SyncMapping, item: BacklogItem | undefined): SyncItemView => ({
        itemId: mapping.itemId,
        ...(item !== undefined && { ref: BacklogReference.refOf(item) }),
        backend: mapping.backend,
        remoteKey: mapping.remoteKey,
        url: mapping.url,
        state: BacklogSyncModel.stateOf(mapping, item),
        lastSyncedAt: mapping.lastSyncedAt,
        lastError: mapping.lastError,
        conflicts: mapping.conflicts.slice(-5),
      })

      /** Carries remote comments over to the item and local replies over to the issue, once each. */
      const syncComments = Effect.fnUntraced(function* (mapping: SyncMapping, backend: RemoteBackend, remote: RemoteIssue) {
        const knownRemote = new Set(mapping.comments.map(pair => pair.remote))
        const incoming = [...remote.comments].filter(comment => !knownRemote.has(comment.id)).sort((left, right) => left.createdAt - right.createdAt)
        // Sequential on purpose (forEach's default): comments land in the order they were written.
        const pulledPairs = yield* Effect.forEach(incoming, comment =>
          Effect.map(
            store.comment({
              id: mapping.itemId,
              text: BacklogSyncModel.importedCommentText(mapping.backend, comment),
              actor: { kind: 'system' },
              origin: `remote:${mapping.backend}`,
            }),
            result => ({
              local: result.ok ? (result.value.item.events.findLast(event => event.kind === 'commented')?.commentId ?? '') : '',
              remote: comment.id,
            }),
          ),
        )
        const knownLocal = new Set([...mapping.comments, ...pulledPairs].map(pair => pair.local))
        const item = yield* itemOf(mapping.itemId)
        const pushAgentComments = rowFor((yield* settings.get).syncBackends, mapping.backend, item?.project ?? null)?.pushAgentComments === true
        const outgoing = (item?.events ?? []).flatMap(event =>
          event.kind === 'commented' &&
          event.commentId !== undefined &&
          event.actor !== 'system' &&
          (pushAgentComments || !BacklogOrigins.isAgent(BacklogOrigins.of(event))) &&
          !knownLocal.has(event.commentId) &&
          event.at >= mapping.pushCommentsSince &&
          event.detail.trim() !== ''
            ? [{ commentId: event.commentId, actor: event.actor, detail: event.detail }]
            : [],
        )
        const pushedPairs = yield* Effect.forEach(outgoing, event =>
          Effect.map(
            backend.comment(
              mapping.remoteId,
              BacklogSyncModel.exportedCommentText(BacklogReference.labelOf(item ?? { id: mapping.itemId }), event.actor, event.detail),
            ),
            created => ({
              local: event.commentId,
              remote: created.id,
            }),
          ),
        )
        const pairs = [...mapping.comments, ...pulledPairs, ...pushedPairs]
        const pulled = pulledPairs.length
        const pushed = pushedPairs.length
        return { pairs: pairs.slice(-BacklogSyncModel.maxCommentPairs), pulled, pushed }
      })

      const passOf = Effect.fnUntraced(function* (mapping: SyncMapping) {
        const item = yield* itemOf(mapping.itemId)
        if (item === undefined) return yield* new BacklogItemNotFound({ ids: [mapping.itemId] })
        const backend = yield* backendFor({ backend: mapping.backend, project: item.project, reference: mapping.url })
        const remote = yield* backend.fetch(mapping.remoteId)
        const at = yield* Clock.currentTimeMillis
        const plan = BacklogSyncModel.plan({ item, remote, base: mapping.base, at })
        const pulled = Object.keys(plan.pull).filter((field): field is SyncField => BacklogSyncModel.syncedFields.some(known => known === field))
        const pushed = Object.keys(plan.push).filter((field): field is SyncField => BacklogSyncModel.syncedFields.some(known => known === field))
        if (pulled.length > 0) yield* store.update({ id: item.id, ...plan.pull, actor: { kind: 'system' } })
        const remoteAfter = pushed.length > 0 ? yield* backend.update(mapping.remoteId, plan.push) : remote
        const comments = yield* syncComments(mapping, backend, remoteAfter)
        if (plan.conflicts.length > 0) {
          yield* store.comment({
            id: item.id,
            text: BacklogSyncModel.conflictNote(mapping.backend, remoteAfter.key, plan.conflicts),
            actor: { kind: 'system' },
          })
        }
        const final = (yield* itemOf(item.id)) ?? item
        const next: SyncMapping = {
          ...mapping,
          remoteKey: remoteAfter.key,
          url: remoteAfter.url.slice(0, BacklogItems.maxTargetChars),
          lastSyncedAt: at,
          remoteUpdatedAt: remoteAfter.updatedAt,
          localSyncedAt: final.lastActivityAt,
          base: { local: BacklogSyncModel.localSnapshot(final), remote: BacklogSyncModel.remoteSnapshot(remoteAfter) },
          comments: comments.pairs,
          state: plan.conflicts.length > 0 ? 'conflict' : 'synced',
          conflicts: [...mapping.conflicts, ...plan.conflicts].slice(-BacklogSyncModel.maxConflicts),
          lastError: null,
        }
        yield* save(next)
        return {
          itemId: item.id,
          ref: BacklogReference.refOf(item),
          remoteKey: next.remoteKey,
          state: next.state,
          pulled,
          pushed,
          conflicts: plan.conflicts,
          commentsPulled: comments.pulled,
          commentsPushed: comments.pushed,
          error: null,
        } satisfies SyncItemResult
      })

      /** One item's sync pass; a failure is recorded on the mapping and answered, never thrown. */
      const syncMapping = Effect.fn('backlog sync')(function* (mapping: SyncMapping) {
        yield* Effect.annotateCurrentSpan({
          'dshx.plugin.package': '@dshfiles/backlog',
          'dshx.backlog.item_id': mapping.itemId,
          'dshx.backlog.sync.backend': mapping.backend,
        })
        const outcome = yield* Effect.result(passOf(mapping))
        if (outcome._tag === 'Success') {
          yield* Effect.annotateCurrentSpan({
            'dshx.backlog.sync.outcome': outcome.success.state,
            'dshx.backlog.sync.pulled': outcome.success.pulled.length,
            'dshx.backlog.sync.pushed': outcome.success.pushed.length,
            'dshx.backlog.sync.conflicts': outcome.success.conflicts.length,
          })
          return outcome.success
        }
        const at = yield* Clock.currentTimeMillis
        const error = errorRecord(outcome.failure, at)
        yield* Effect.annotateCurrentSpan({ 'dshx.backlog.sync.outcome': 'error', 'error.type': error.code })
        yield* save({ ...mapping, state: 'error', lastError: error }).pipe(
          Effect.catch(failure => Effect.logWarning('backlog sync: the error could not be recorded', failure)),
        )
        return {
          itemId: mapping.itemId,
          remoteKey: mapping.remoteKey,
          state: 'error',
          pulled: [],
          pushed: [],
          conflicts: [],
          commentsPulled: 0,
          commentsPushed: 0,
          error: { code: error.code, message: error.message },
        } satisfies SyncItemResult
      })

      const syncLocked = (mapping: SyncMapping) => lock.withPermit(Effect.flatMap(mappingOf(mapping.itemId), current => syncMapping(current ?? mapping)))

      const status = Effect.fn('backlog sync status')(function* (input: { readonly ids?: readonly number[] | undefined }) {
        const rows = (yield* settings.get).syncBackends
        const wanted = input.ids === undefined ? undefined : new Set(input.ids)
        const all = (yield* mappings).filter(mapping => wanted === undefined || wanted.has(mapping.itemId))
        const items = yield* Effect.forEach(all, mapping => Effect.map(itemOf(mapping.itemId), item => viewOf(mapping, item)))
        const views = yield* Effect.forEach(rows, row =>
          Effect.map(backends.credentialSource(row), (credential): SyncBackendView => ({
            project: row.project === '' ? null : row.project,
            backend: row.backend,
            target: row.target,
            enabled: row.enabled,
            autoSyncMinutes: row.autoSyncMinutes,
            credential,
          })),
        )
        return { backends: views, items }
      })

      const syncNow = Effect.fn('backlog sync now')(function* (input: { readonly id?: number | undefined; readonly project?: string | null | undefined }) {
        if (input.id !== undefined) {
          const mapping = yield* mappingOf(input.id)
          if (mapping === undefined) return yield* new SyncItemNotLinked({ itemId: input.id })
          return { results: [yield* syncLocked(mapping)] }
        }
        const project = input.project === undefined ? undefined : BacklogItems.projectOf(input.project)
        const all = yield* mappings
        const selected = yield* Effect.filter(all, mapping =>
          project === undefined ? Effect.succeed(true) : Effect.map(itemOf(mapping.itemId), item => item !== undefined && item.project === project),
        )
        return { results: yield* Effect.forEach(selected, syncLocked) }
      })

      const unlink = Effect.fnUntraced(function* (id: number, actor: BacklogActor) {
        const mapping = yield* mappingOf(id)
        if (mapping === undefined) return { item: null, result: null }
        yield* tables.mappings.delete(String(id)).pipe(Effect.mapError(cause => new SyncWriteFailed({ itemId: id, cause })))
        yield* store.link({ id, link: { type: 'url', target: mapping.url }, remove: true, actor })
        return { item: null, result: null }
      })

      const link = Effect.fn('backlog sync link')(function* (input: {
        readonly id: number
        readonly backend: SyncBackendKind
        readonly reference?: string | undefined
        readonly create?: boolean | undefined
        readonly remove?: boolean | undefined
        readonly actor: BacklogActor
      }) {
        if (input.remove === true) return yield* lock.withPermit(unlink(input.id, input.actor))
        const item = yield* itemOf(input.id)
        if (item === undefined) return yield* new BacklogItemNotFound({ ids: [input.id] })
        const existing = yield* mappingOf(input.id)
        const backend = yield* backendFor({ backend: input.backend, project: item.project, reference: input.reference })
        const at = yield* Clock.currentTimeMillis
        const remote = input.create === true ? undefined : yield* backend.resolve(input.reference ?? '')
        if (existing !== undefined && (remote === undefined || existing.remoteId !== remote.id || existing.backend !== input.backend)) {
          return yield* new SyncAlreadyLinked({ itemId: input.id, remoteKey: existing.remoteKey })
        }
        if (remote !== undefined && existing === undefined) {
          const other = (yield* mappings).find(mapping => mapping.backend === input.backend && mapping.remoteId === remote.id)
          if (other !== undefined) return yield* new SyncAlreadyLinked({ itemId: other.itemId, remoteKey: other.remoteKey })
        }
        const issue = remote ?? (yield* backend.create({ title: item.title, body: item.body, status: item.status, kind: item.kind, tags: item.tags }))
        const created = remote === undefined
        const mapping: SyncMapping = existing ?? {
          itemId: item.id,
          backend: input.backend,
          remoteId: issue.id,
          remoteKey: issue.key,
          url: issue.url.slice(0, BacklogItems.maxTargetChars),
          linkedAt: at,
          lastSyncedAt: null,
          remoteUpdatedAt: null,
          localSyncedAt: null,
          // A created issue starts equal to the item; a linked one is adopted on its first pass.
          base: created ? { local: BacklogSyncModel.localSnapshot(item), remote: BacklogSyncModel.remoteSnapshot(issue) } : null,
          comments: [],
          pushCommentsSince: created ? 0 : at,
          state: 'synced',
          conflicts: [],
          lastError: null,
        }
        yield* save(mapping)
        yield* store.link({ id: item.id, link: { type: 'url', target: mapping.url, relation: 'related' }, actor: input.actor })
        const result = yield* syncLocked(mapping)
        const stored = (yield* mappingOf(item.id)) ?? mapping
        return { item: viewOf(stored, yield* itemOf(item.id)), result }
      })

      const importRemote = Effect.fn('backlog sync import')(function* (input: {
        readonly backend?: SyncBackendKind | undefined
        readonly reference: string
        readonly project?: string | null | undefined
        readonly actor: BacklogActor
      }) {
        const tracker = input.backend ?? BacklogSyncModel.backendOfReference(input.reference)
        if (tracker === undefined) return yield* new SyncReferenceUnrecognized({ reference: input.reference })
        const rows = (yield* settings.get).syncBackends
        const project =
          input.project === undefined
            ? (() => {
                const row = rows.find(candidate => candidate.enabled && candidate.backend === tracker)
                return row === undefined || row.project === '' ? null : BacklogItems.projectPath(row.project)
              })()
            : BacklogItems.projectOf(input.project)
        const backend = yield* backendFor({ backend: tracker, project, reference: input.reference })
        const remote = yield* backend.resolve(input.reference)
        const known = (yield* mappings).find(mapping => mapping.backend === tracker && mapping.remoteId === remote.id)
        if (known !== undefined) {
          const found = yield* store.get(known.itemId)
          if (found.ok) return { detail: found.value, created: false }
        }
        const captured = yield* store.capture({ text: remote.title.replace(/\s+/gu, ' ').trim() || remote.key, project, actor: input.actor })
        const id = captured.item.id
        const kind = kindOfTags(remote.tags)
        yield* store.update({
          id,
          body: remote.body.slice(0, BacklogItems.maxBodyChars),
          tags: remote.tags.slice(0, 20),
          ...(remote.status !== null && { status: remote.status }),
          ...(kind !== undefined && { kind }),
          actor: { kind: 'system' },
        })
        const item = (yield* itemOf(id)) ?? captured.item
        const at = yield* Clock.currentTimeMillis
        const mapping: SyncMapping = {
          itemId: id,
          backend: tracker,
          remoteId: remote.id,
          remoteKey: remote.key,
          url: remote.url.slice(0, BacklogItems.maxTargetChars),
          linkedAt: at,
          lastSyncedAt: null,
          remoteUpdatedAt: null,
          localSyncedAt: null,
          base: { local: BacklogSyncModel.localSnapshot(item), remote: BacklogSyncModel.remoteSnapshot(remote) },
          comments: [],
          pushCommentsSince: at,
          state: 'synced',
          conflicts: [],
          lastError: null,
        }
        yield* save(mapping)
        yield* store.link({ id, link: { type: 'url', target: mapping.url, relation: 'related' }, actor: input.actor })
        yield* syncLocked(mapping)
        const found = yield* store.get(id)
        if (!found.ok) return yield* new BacklogItemNotFound({ ids: [id] })
        return { detail: found.value, created: true }
      })

      const autoSyncTick = Effect.gen(function* () {
        const rows = (yield* settings.get).syncBackends.filter(row => row.enabled && row.autoSyncMinutes > 0)
        if (rows.length === 0) return
        const at = yield* Clock.currentTimeMillis
        const ran = yield* Ref.get(lastRun)
        const due = rows.filter(row => at - (ran.get(rowKey(row)) ?? 0) >= row.autoSyncMinutes * 60_000)
        if (due.length === 0) return
        yield* Ref.update(lastRun, current => new Map([...current, ...due.map(row => [rowKey(row), at] as const)]))
        const all = yield* mappings
        const allRows = (yield* settings.get).syncBackends
        yield* Effect.forEach(
          all,
          mapping =>
            Effect.flatMap(itemOf(mapping.itemId), item => {
              const serving = item === undefined ? undefined : rowFor(allRows, mapping.backend, item.project)
              return serving !== undefined && due.some(row => rowKey(row) === rowKey(serving)) ? syncLocked(mapping) : Effect.void
            }),
          { discard: true },
        )
      })

      const testSaved = Effect.gen(function* () {
        const rows = (yield* settings.get).syncBackends
        const results = yield* Effect.forEach(
          rows,
          row =>
            Effect.map(backends.test({ backend: row.backend, project: row.project, target: row.target, secret: row.secret }), report => ({
              backend: row.backend,
              project: row.project,
              target: row.target,
              enabled: row.enabled,
              report,
            })),
          { concurrency: 4 },
        )
        return { results }
      })

      const deleteItem = Effect.fn('backlog sync delete item')(function* (input: { readonly id: number }) {
        const deleted = yield* store.delete(input)
        yield* tables.mappings.delete(String(input.id)).pipe(Effect.mapError(cause => new SyncWriteFailed({ itemId: input.id, cause })))
        return deleted
      }, lock.withPermit)

      return BacklogSync.of({ status, syncNow, link, importRemote, autoSyncTick, testConnection: backends.test, testSaved, deleteItem })
    }),
  )
}

/** Auto-sync: a minute tick runs every backend row whose interval is due; a failing tick is logged and retried. */
export const RemoteSyncLoop = Layer.effectDiscard(
  Effect.gen(function* () {
    const sync = yield* BacklogSync
    const tick = sync.autoSyncTick.pipe(
      Effect.catchCause(cause => (Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.logWarning('backlog remote sync failed', cause))),
    )
    yield* DshxPlugin.worker(Effect.sleep('1 minute').pipe(Effect.andThen(Effect.repeat(tick, Schedule.spaced('1 minute')))))
  }),
)

export class BacklogSyncConfig {
  static readonly rowFor = rowFor
  static readonly environmentVariables = environmentVariables
}
