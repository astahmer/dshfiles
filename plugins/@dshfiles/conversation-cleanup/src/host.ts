import { randomUUID } from 'node:crypto'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-workspace'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import { Api, DshxPlugin, HostContext, hostService } from '@dshfiles/dshx/effect'
import { Cause, Clock, Context, Effect, Layer, Option, Ref, Schema, Semaphore } from 'effect'
import { cleanupApi, type previewSchema, type receiptSchema } from './cleanup-api.js'
import { purgeJsonlFiles } from './jsonl-files.js'

const decodeRoot = Schema.decodeUnknownSync(Schema.Struct({ root: Schema.String.check(Schema.isMinLength(1)) }))
const decodeSettled = Schema.decodeUnknownSync(Schema.Struct({ settledSessionIds: Schema.Array(Schema.String) }))
const BATCH_SIZE = 200
const PREVIEW_LIFETIME = 10 * 60 * 1000
const PACKAGE_ID = '@dshfiles/conversation-cleanup'

const call = <A>(run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: cause =>
      new PluginApiError('Cleanup could not access session storage. Retry the preview; consult Host diagnostics if it persists.', {
        code: 'storage-unavailable',
        cause,
      }),
  })

const makeCleanup = Effect.gen(function* () {
  const host = yield* HostContext
  const ctx = host.ctx
  const exclusive = (yield* Semaphore.make(1)).withPermits(1)
  type Snapshot = Awaited<ReturnType<typeof ctx.sessionPersistence.list>>[number]
  type Plan = {
    readonly preview: typeof previewSchema.Type
    readonly snapshots: readonly Snapshot[]
    readonly root: string
    readonly identity: symbol
  }
  const plans = yield* Ref.make(new Map<string, Plan>())

  const backend = Effect.try({
    try: () => {
      const entries = ctx.configEditor.entries().filter(entry => entry.options.name === '@deepseek-ai/dsh-session-persistence-jsonl')
      const entry = entries.length === 1 ? entries[0] : undefined
      if (process.platform === 'win32' || entry?.fiber === undefined || ctx.sessionPersistence.name !== 'session-persistence-jsonl') {
        throw new Error('Unsupported persistence provider')
      }
      return { root: decodeRoot(entry.fiber.config).root, identity: ctx.sessionPersistence.identity }
    },
    catch: () =>
      new PluginApiError(
        'Cleanup supports only the stock DSH 0.2.1-rc.2 JSONL provider on macOS/Linux with one configured root. Keep this plugin disabled on other backends, platforms or versions.',
        { code: 'unsupported-backend' },
      ),
  })

  const flags = () => {
    const descriptor = ctx.settings.describe().find(item => item.ns === 'thread-sidebar')
    const settled = descriptor === undefined ? [] : decodeSettled(descriptor.value).settledSessionIds
    return { archived: new Set<string>(ctx.workspaceRegistry.archivedSessionIds), settled: new Set(settled) }
  }
  const readFlags = Effect.try({
    try: flags,
    catch: () =>
      new PluginApiError('Sidebar lifecycle state could not be read. Enable the matching thread-sidebar plugin, then retry.', {
        code: 'lifecycle-unavailable',
      }),
  })
  const attached = (sessionId: string) => ctx.agents.get(SessionId(sessionId)) !== undefined || ctx.sessions.get(SessionId(sessionId)) !== undefined
  const hasActivity = (sessionId: string) =>
    call(() => ctx.waterfall('workspace/session-activity', { sessionId: SessionId(sessionId) }, async () => [])).pipe(
      Effect.map(activity => activity.length > 0),
    )

  const preview = Effect.fn('conversation cleanup preview')(function* () {
    const storage = yield* backend
    const snapshots = yield* call(signal => ctx.sessionPersistence.list({ signal }))
    const state = yield* readFlags
    const matching = snapshots.filter(snapshot => state.archived.has(snapshot.header.id) || state.settled.has(snapshot.header.id))
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
      const retained = new Map([...current].filter(([, plan]) => plan.preview.expiresAt > now).slice(-15))
      retained.set(result.previewId, { preview: result, snapshots: selected, root: storage.root, identity: storage.identity })
      return retained
    })
    return result
  })

  const authorize = (caller: ApiCaller) =>
    Effect.gen(function* () {
      if (caller.kind !== 'agent') return
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
        return yield* Effect.fail(
          new PluginApiError(
            'Permanent global cleanup requires a root conversation with Full access. Use the owner’s Conversation cleanup settings instead; do not elevate permissions automatically.',
            { code: 'cleanup-forbidden' },
          ),
        )
      }
    })

  const remove = Effect.fn('conversation cleanup delete')(function* (previewId: string, caller: ApiCaller) {
    yield* authorize(caller)
    const plan = yield* Ref.modify(plans, current => {
      const selected = current.get(previewId)
      const remaining = new Map(current)
      remaining.delete(previewId)
      return [selected, remaining]
    })
    const now = yield* Clock.currentTimeMillis
    if (plan === undefined || plan.preview.expiresAt <= now) {
      return yield* Effect.fail(
        new PluginApiError('This preview expired, was already used, or belongs to a previous Host. Generate a new preview before deleting.', {
          code: 'stale-preview',
        }),
      )
    }
    const storage = yield* backend
    if (storage.identity !== plan.identity || storage.root !== plan.root) {
      return yield* Effect.fail(new PluginApiError('Session storage changed since the preview. Generate a new preview.', { code: 'stale-backend' }))
    }
    const results = yield* Effect.forEach(
      plan.snapshots,
      snapshot =>
        Effect.gen(function* () {
          const sessionId = snapshot.header.id
          const skipped = (message: string): (typeof receiptSchema.Type.results)[number] => ({ sessionId, status: 'skipped', message })
          const state = yield* readFlags
          if (!state.archived.has(sessionId) && !state.settled.has(sessionId))
            return skipped('No longer settled or archived. Generate a fresh preview if needed.')
          if (attached(sessionId)) return skipped('Session is loaded. Leave it untouched; preview again after a user-managed DSH restart.')
          if (yield* hasActivity(sessionId)) return skipped('Session owns background activity. Finish its jobs or remove its schedules, then preview again.')
          const current = yield* call(signal => ctx.sessionPersistence.stat(sessionId, { signal }))
          if (current === undefined) return skipped('Session already absent.')
          if (current.revision !== snapshot.revision) return skipped('Session changed since preview. Generate a fresh preview.')
          return yield* Effect.scoped(
            Effect.gen(function* () {
              const writer = yield* Effect.acquireRelease(
                call(signal => ctx.sessionPersistence.open(sessionId, 'write', { signal })),
                handle => call(() => handle.close()).pipe(Effect.orDie),
              )
              const locked = yield* call(signal => ctx.sessionPersistence.stat(sessionId, { signal }))
              if (yield* hasActivity(sessionId))
                return skipped('Session acquired background activity. Finish its jobs or remove its schedules, then preview again.')
              const latest = yield* readFlags
              if (attached(sessionId) || (!latest.archived.has(sessionId) && !latest.settled.has(sessionId)))
                return skipped('Session became loaded or its lifecycle changed. Generate a fresh preview.')
              if (locked?.revision !== snapshot.revision || writer.header.id !== sessionId || writer.header.cwd !== snapshot.header.cwd)
                return skipped('Session changed while acquiring its write lock. Generate a fresh preview.')
              yield* authorize(caller)
              yield* purgeJsonlFiles({
                root: storage.root,
                sessionId,
                expectedRevision: snapshot.revision,
                ...(writer.header.cwd === undefined ? undefined : { cwd: writer.header.cwd }),
              })
              const after = yield* call(signal => ctx.sessionPersistence.stat(sessionId, { signal }))
              if (after !== undefined)
                return yield* Effect.fail(
                  new PluginApiError('Session storage still reports the log. Stop here and inspect storage before retrying.', { code: 'purge-incomplete' }),
                )
              return { sessionId: String(sessionId), status: 'deleted' as const, message: 'Local conversation log generations permanently removed.' }
            }),
          )
        }).pipe(
          Effect.catchCause(cause => {
            if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause)
            return Effect.logWarning('Conversation cleanup failed; inspect this session before retrying.', {
              sessionId: String(snapshot.header.id),
              cause,
            }).pipe(
              Effect.as({
                sessionId: String(snapshot.header.id),
                status: 'failed' as const,
                message:
                  'Deletion did not complete. Inspect Host storage diagnostics, then generate a fresh preview. Historical generations may already have been removed.',
              }),
            )
          }),
        ),
      { concurrency: 1 },
    )
    return { results }
  })
  return { preview, remove: (previewId: string, caller: ApiCaller) => exclusive(remove(previewId, caller)) }
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
      preview: () => Cleanup.use(cleanup => cleanup.preview()),
      delete: (input, call) => Cleanup.use(cleanup => cleanup.remove(input.previewId, call.caller)),
    }),
  ],
})
