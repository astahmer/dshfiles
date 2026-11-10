import { randomUUID } from 'node:crypto'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-config-editor'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-workspace'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import { Api, DshxPlugin, HostContext, hostService } from '@dshfiles/dshx/effect'
import { Clock, Context, Effect, Layer, Option, Ref, Schema, Semaphore } from 'effect'
import { cleanupApi, type previewSchema, type receiptSchema } from './cleanup-api.js'
import { purgeJsonlFiles, SUPPORTED_SESSION_FORMAT } from './jsonl-files.js'
import { storageCall } from './storage-edges-promise.js'

const decodeRoot = Schema.decodeUnknownEffect(Schema.Struct({ root: Schema.String.check(Schema.isMinLength(1)) }))
const decodeSidebarSettings = Schema.decodeUnknownEffect(Schema.Struct({ settledSessionIds: Schema.optional(Schema.Array(Schema.String)) }))
const BATCH_SIZE = 200
const PREVIEW_LIFETIME = 10 * 60 * 1000
const PACKAGE_ID = '@dshfiles/conversation-cleanup'
const JSONL_PROVIDER = '@deepseek-ai/dsh-session-persistence-jsonl'

const unsupportedBackend = new PluginApiError(
  'Cleanup supports only the stock DSH 0.2.1-rc.2 JSONL provider on macOS/Linux with one configured root. Keep this plugin disabled on other backends, platforms or versions.',
  { code: 'unsupported-backend' },
)
const lifecycleUnavailable = new PluginApiError(
  'Thread-sidebar settings have an unexpected shape. Update @dshfiles/thread-sidebar and @dshfiles/conversation-cleanup together, then retry the preview.',
  { code: 'lifecycle-unavailable' },
)
const cleanupForbidden = new PluginApiError(
  'Permanent global cleanup requires a root conversation with Full access. Use the owner’s Conversation cleanup settings instead; do not elevate permissions automatically.',
  { code: 'cleanup-forbidden' },
)
const previewExpired = new PluginApiError('This preview expired, was already used, or belongs to a previous Host. Generate a new preview before deleting.', {
  code: 'stale-preview',
})
const storageChanged = new PluginApiError('Session storage changed since the preview. Generate a new preview.', { code: 'stale-backend' })

type Storage = { readonly root: string; readonly identity: symbol }
type ReceiptResult = (typeof receiptSchema.Type)['results'][number]

const sameStorage = (left: Storage, right: Storage) => left.root === right.root && left.identity === right.identity

const callerKey = (caller: ApiCaller): string => {
  if (caller.kind === 'agent') return `agent:${caller.sessionId ?? ''}`
  if (caller.kind === 'plugin') return `plugin:${caller.packageId}`
  return 'client'
}

const makeCleanup = Effect.gen(function* () {
  const host = yield* HostContext
  const ctx = host.ctx
  const exclusive = (yield* Semaphore.make(1)).withPermits(1)
  type Snapshot = Awaited<ReturnType<typeof ctx.sessionPersistence.list>>[number]
  type Plan = {
    readonly preview: typeof previewSchema.Type
    readonly snapshots: readonly Snapshot[]
    readonly storage: Storage
  }
  const plans = yield* Ref.make(new Map<string, Plan>())

  const backend = Effect.fn('conversation cleanup backend')(function* () {
    const entries = ctx.configEditor.entries().filter(entry => entry.options.name === JSONL_PROVIDER)
    const entry = entries.length === 1 ? entries[0] : undefined
    if (
      process.platform === 'win32' ||
      entry?.fiber === undefined ||
      ctx.sessionPersistence.name !== 'session-persistence-jsonl' ||
      SESSION_FORMAT_VERSION !== SUPPORTED_SESSION_FORMAT
    ) {
      return yield* Effect.fail(unsupportedBackend)
    }
    const { root } = yield* decodeRoot(entry.fiber.config).pipe(Effect.mapError(() => unsupportedBackend))
    return { root, identity: ctx.sessionPersistence.identity }
  })

  const readFlags = Effect.fn('conversation cleanup flags')(function* () {
    const descriptor = ctx.settings.describe().find(item => item.ns === 'thread-sidebar')
    const sidebar = descriptor === undefined ? undefined : yield* decodeSidebarSettings(descriptor.value).pipe(Effect.mapError(() => lifecycleUnavailable))
    const archived = new Set<string>(ctx.workspaceRegistry.archivedSessionIds)
    const settled = new Set(sidebar?.settledSessionIds ?? [])
    return { archived, settled, isCandidate: (sessionId: string) => archived.has(sessionId) || settled.has(sessionId) }
  })

  const attached = (sessionId: string) => ctx.agents.get(SessionId(sessionId)) !== undefined || ctx.sessions.get(SessionId(sessionId)) !== undefined
  const hasActivity = (sessionId: string) =>
    storageCall(() => ctx.waterfall('workspace/session-activity', { sessionId: SessionId(sessionId) }, async () => [])).pipe(
      Effect.map(activity => activity.length > 0),
    )

  const preview = Effect.fn('conversation cleanup preview')(function* (input: { readonly caller: ApiCaller }) {
    const storage = yield* backend()
    const snapshots = yield* storageCall(signal => ctx.sessionPersistence.list({ signal }))
    const state = yield* readFlags()
    const matching = snapshots.filter(snapshot => state.isCandidate(snapshot.header.id))
    const inspected = yield* Effect.forEach(
      matching,
      snapshot =>
        Effect.gen(function* () {
          if (attached(snapshot.header.id) || snapshot.formatStatus === 'migration-required' || (yield* hasActivity(snapshot.header.id))) return undefined
          return snapshot
        }),
      { concurrency: 3 },
    )
    const available = inspected.filter(snapshot => snapshot !== undefined)
    const selected = available.sort((left, right) => left.header.id.localeCompare(right.header.id)).slice(0, BATCH_SIZE)
    const now = yield* Clock.currentTimeMillis
    const result = {
      previewId: randomUUID(),
      candidates: selected.map(snapshot => ({
        sessionId: String(snapshot.header.id),
        archived: state.archived.has(snapshot.header.id),
        settled: state.settled.has(snapshot.header.id),
      })),
      protectedCount: matching.length - available.length,
      remainingCount: available.length - selected.length,
      expiresAt: now + PREVIEW_LIFETIME,
    }
    yield* Ref.update(plans, current => {
      const retained = new Map([...current].filter(([, plan]) => plan.preview.expiresAt > now))
      retained.set(callerKey(input.caller), { preview: result, snapshots: selected, storage })
      return retained
    })
    return result
  })

  const authorize = Effect.fn('conversation cleanup authorize')(function* (caller: ApiCaller) {
    if (caller.kind === 'client') return
    if (caller.kind !== 'agent') return yield* Effect.fail(cleanupForbidden)
    const session = caller.sessionId === undefined ? undefined : ctx.sessions.get(SessionId(caller.sessionId))
    const policy = Option.getOrUndefined(yield* Effect.option(hostService('sandboxPolicy')))
    if (
      session === undefined ||
      policy === undefined ||
      session.header.origin === 'subagent' ||
      session.header.parentSession !== undefined ||
      (session.header.delegationDepth ?? 0) > 0 ||
      policy.resolve({ session }).mode !== 'danger-full-access'
    ) {
      return yield* Effect.fail(cleanupForbidden)
    }
  })

  const purgeSnapshot = Effect.fn('conversation cleanup purge session')(function* (input: {
    readonly snapshot: Snapshot
    readonly storage: Storage
    readonly caller: ApiCaller
  }) {
    const sessionId = input.snapshot.header.id
    const skipped = (message: string): ReceiptResult => ({ sessionId, status: 'skipped', message })
    const failed = (message: string): ReceiptResult => ({ sessionId, status: 'failed', message })
    const deleted = (message: string): ReceiptResult => ({ sessionId, status: 'deleted', message })
    const state = yield* readFlags()
    if (!state.isCandidate(sessionId)) return skipped('No longer settled or archived. Generate a fresh preview if needed.')
    if (attached(sessionId)) return skipped('Session is loaded. Leave it untouched; preview again after a user-managed DSH restart.')
    if (yield* hasActivity(sessionId)) return skipped('Session owns background activity. Finish its jobs or remove its schedules, then preview again.')
    const current = yield* storageCall(signal => ctx.sessionPersistence.stat(sessionId, { signal }))
    if (current === undefined) return skipped('Session already absent.')
    if (current.revision !== input.snapshot.revision) return skipped('Session changed since preview. Generate a fresh preview.')
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const acquired = yield* Effect.acquireRelease(
          storageCall(signal => ctx.sessionPersistence.open(sessionId, 'write', { signal })).pipe(Effect.option),
          Option.match({ onNone: () => Effect.void, onSome: handle => storageCall(() => handle.close()).pipe(Effect.orDie) }),
        )
        if (Option.isNone(acquired)) return failed('Session storage is locked by another writer. Finish that writer, then preview again.')
        const writer = acquired.value
        const locked = yield* storageCall(signal => ctx.sessionPersistence.stat(sessionId, { signal }))
        if (yield* hasActivity(sessionId)) return skipped('Session acquired background activity. Finish its jobs or remove its schedules, then preview again.')
        const latest = yield* readFlags()
        if (attached(sessionId) || !latest.isCandidate(sessionId)) return skipped('Session became loaded or its lifecycle changed. Generate a fresh preview.')
        if (locked?.revision !== input.snapshot.revision || writer.header.id !== sessionId || writer.header.cwd !== input.snapshot.header.cwd)
          return skipped('Session changed while acquiring its write lock. Generate a fresh preview.')
        yield* authorize(input.caller)
        yield* purgeJsonlFiles({
          root: input.storage.root,
          sessionId,
          expectedRevision: input.snapshot.revision,
          ...(writer.header.cwd === undefined ? undefined : { cwd: writer.header.cwd }),
        })
        const after = yield* storageCall(signal => ctx.sessionPersistence.stat(sessionId, { signal }))
        if (after !== undefined) return failed('Session storage still reports the log. Stop here and inspect storage before retrying.')
        return deleted('Local conversation log generations permanently removed.')
      }),
    ).pipe(
      Effect.catchTag('JsonlPurgeRefused', refusal => Effect.succeed(failed(refusal.message))),
      Effect.catchDefect(defect =>
        Effect.logWarning('Conversation cleanup failed; inspect this session before retrying.', { sessionId, defect }).pipe(
          Effect.as(
            failed(
              'Deletion did not complete. Inspect Host storage diagnostics, then generate a fresh preview. Historical generations may already have been removed.',
            ),
          ),
        ),
      ),
    )
  })

  const deletePreviewed = Effect.fn('conversation cleanup delete')(function* (input: { readonly previewId: string; readonly caller: ApiCaller }) {
    yield* authorize(input.caller)
    const key = callerKey(input.caller)
    const plan = yield* Ref.modify(plans, current => {
      const selected = current.get(key)
      if (selected?.preview.previewId !== input.previewId) return [undefined, current]
      const remaining = new Map(current)
      remaining.delete(key)
      return [selected, remaining]
    })
    const now = yield* Clock.currentTimeMillis
    if (plan === undefined || plan.preview.expiresAt <= now) return yield* Effect.fail(previewExpired)
    const storage = yield* backend()
    if (!sameStorage(plan.storage, storage)) return yield* Effect.fail(storageChanged)
    const results = yield* Effect.forEach(plan.snapshots, snapshot => purgeSnapshot({ snapshot, storage, caller: input.caller }), { concurrency: 1 })
    return { results }
  })

  return { preview, deletePreviewed: (input: { readonly previewId: string; readonly caller: ApiCaller }) => exclusive(deletePreviewed(input)) }
})

class Cleanup extends Context.Service<Cleanup, Effect.Success<typeof makeCleanup>>()('@dshfiles/conversation-cleanup/Cleanup') {
  static readonly layer = Layer.effect(Cleanup, makeCleanup).pipe(Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)))
}

export default DshxPlugin.make({
  name: PACKAGE_ID,
  inject: ['agents', 'sessions', 'sessionPersistence', 'workspaceRegistry', 'settings', 'configEditor'],
  layer: Cleanup.layer,
  apis: [
    Api.bind(cleanupApi, {
      preview: (_input, call) => Cleanup.use(cleanup => cleanup.preview({ caller: call.caller })),
      delete: (input, call) => Cleanup.use(cleanup => cleanup.deletePreviewed({ previewId: input.previewId, caller: call.caller })),
    }),
  ],
})
