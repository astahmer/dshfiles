import type {
  SessionAddress,
  SessionCancelRequest,
  SessionCancelValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionListRequest,
  SessionPage,
  SessionPageRequest,
  SessionProjectionsRequest,
  SessionProjectionsValue,
  SessionPromptRequest,
  SessionPromptValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionSummary,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionPayload, SessionPromptRefused, type EffectSessionSource } from '@dshfiles/session-source-port'
import { Clock, Context, Effect, Fiber, FiberMap, Layer, Option, Ref, Stream } from 'effect'
import { homedir } from 'node:os'
import { RemoteRequestFailed, SessionOwnerMissing } from './errors.js'
import { HostDirectory } from './host-directory.js'
import { RemoteInteractions } from './remote-interactions.js'
import { RemotePromptGuard, type StagedUpload } from './remote-prompt-guard.js'
import { RemoteThreads, type RemoteThread } from './remote-threads.js'
import { RuntimePool } from './runtime-pool.js'

/** The Session a runtime owns for one address; a subagent address names its child Session. */
const ownedSessionOf = (address: SessionAddress): SessionId => (address.kind === 'session' ? address.sessionId : address.childSessionId)

const listCacheMillis = 2_000
const maxRemembered = 20_000
const maxStagedUploads = 2_000
const followTimeout = 15_000

/** One runtime this Host can reach, as the Session source lists it. */
interface RuntimeTarget {
  readonly id: string
  readonly label: string
}

/**
 * Sessions of every reachable runtime, offered to this Host's Session controller as a mirrored source. The source is
 * the only place that knows which runtime owns a Session: `list` claims ids from the runtime's own `session/list`, and
 * every other endpoint forwards the request unchanged to that runtime.
 *
 * Writes are never replayed: a stream that drops surfaces its failure so the browser's own journal can reconnect and
 * repair, and a prompt/cancel/queue mutation goes through the pool's no-replay path.
 */
export class RemoteSessions extends Context.Service<
  RemoteSessions,
  {
    /** The source the Host's Session controller registers; it also answers remote Session references. */
    readonly source: EffectSessionSource
    /** One conversation snapshot from the runtime owning `sessionId`, or nothing when no runtime answers. */
    readonly snapshot: (input: { readonly sessionId: string; readonly maxMessages: number }) => Effect.Effect<readonly unknown[] | undefined>
    /** Remember where an upload was staged, so a message on another thread or machine is refused here. */
    readonly recordUpload: (input: StagedUpload & { readonly receiptId: string }) => Effect.Effect<void>
  }
>()('@dshfiles/multi-host/RemoteSessions') {
  static readonly layer = Layer.effect(
    RemoteSessions,
    Effect.gen(function* () {
      const pool = yield* RuntimePool
      const directory = yield* HostDirectory
      const threads = yield* RemoteThreads
      const interactions = yield* RemoteInteractions
      const discoveries = yield* FiberMap.make<string, RuntimeTarget | undefined, never>()
      const remembered = yield* Ref.make(new Map<string, RuntimeTarget>())
      const recent = yield* Ref.make<{ readonly key: string; readonly at: number; readonly rows: readonly SessionSummary[] } | undefined>(undefined)
      const listedCwds = yield* Ref.make(new Map<string, string>())
      const stagedUploads = yield* Ref.make<ReadonlyMap<string, StagedUpload>>(new Map())

      const targets = directory.listRuntimes().pipe(
        Effect.map(runtimes => runtimes.map((runtime): RuntimeTarget => ({ id: runtime.id, label: runtime.name }))),
        Effect.orElseSucceed((): readonly RuntimeTarget[] => []),
      )
      const recorded = threads.list.pipe(Effect.orElseSucceed((): readonly RemoteThread[] => []))

      const remember = (sessionId: string, runtime: RuntimeTarget) =>
        Ref.update(remembered, current => {
          const next = new Map(current)
          next.delete(sessionId)
          next.set(sessionId, runtime)
          for (const oldest of next.keys()) {
            if (next.size <= maxRemembered) break
            next.delete(oldest)
          }
          return next
        })

      const forget = (sessionId: string) =>
        Ref.update(remembered, current => {
          const next = new Map(current)
          next.delete(sessionId)
          return next
        })

      /** One runtime's own `session/list` answer; a host that is down contributes no rows. */
      const listed = (runtimeId: string, request: SessionListRequest | Record<string, never>) =>
        pool
          .use(
            runtimeId,
            gateway => Effect.flatMap(gateway.run({ namespace: 'session', method: 'list', args: { _request: request } }), SessionPayload.summaries),
            { mutation: false },
          )
          .pipe(Effect.orElseSucceed((): readonly SessionSummary[] => []))

      const lookup = Effect.fnUntraced(function* (sessionId: string) {
        const runtimes = yield* targets
        const record = (yield* recorded).find(thread => thread.sessionId === sessionId)
        if (record !== undefined) {
          const owning = runtimes.find(runtime => runtime.id === record.runtimeId)
          if (owning !== undefined) yield* remember(sessionId, owning)
          return owning
        }
        const known = (yield* Ref.get(remembered)).get(sessionId)
        if (known !== undefined) {
          const stillRegistered = runtimes.find(runtime => runtime.id === known.id)
          if (stillRegistered !== undefined) return stillRegistered
          yield* forget(sessionId)
        }
        // A Session owned by an unreachable runtime cannot authorize a routed operation, so a failing runtime is skipped.
        const owner = yield* Effect.findFirst(runtimes, runtime =>
          listed(runtime.id, {}).pipe(Effect.map(rows => rows.some(row => String(row.sessionId) === sessionId))),
        )
        if (Option.isNone(owner)) return undefined
        yield* remember(sessionId, owner.value)
        return owner.value
      })

      /**
       * Concurrent lookups of one Session share a single discovery. `run` with `onlyIfMissing` hands a second caller an
       * interrupted fiber rather than the running one, so the running discovery is looked up and joined first.
       */
      const runningDiscovery = (sessionId: string) => FiberMap.getUnsafe(discoveries, sessionId)
      const runtimeFor = (sessionId: string) =>
        Effect.flatMap(
          Effect.suspend(() =>
            Option.match(runningDiscovery(sessionId), {
              onNone: () =>
                Effect.map(FiberMap.run(discoveries, sessionId, lookup(sessionId), { onlyIfMissing: true }), started =>
                  Option.getOrElse(runningDiscovery(sessionId), () => started),
                ),
              onSome: Effect.succeed,
            }),
          ),
          Fiber.join,
        )
      const requireRuntime = (sessionId: string) =>
        Effect.flatMap(runtimeFor(sessionId), runtime =>
          runtime === undefined ? Effect.fail(new SessionOwnerMissing({ sessionId })) : Effect.succeed(runtime),
        )

      const forward = <Value>(input: {
        readonly sessionId: string
        readonly method: string
        readonly request: unknown
        readonly mutation: boolean
        readonly decode: (value: unknown) => Effect.Effect<Value, unknown>
      }) =>
        Effect.flatMap(requireRuntime(input.sessionId), runtime =>
          pool.use(
            runtime.id,
            gateway => Effect.flatMap(gateway.run({ namespace: 'session', method: input.method, args: { request: input.request } }), input.decode),
            {
              mutation: input.mutation,
            },
          ),
        )

      const list = Effect.fn('multi-host remote sessions list')(function* (request: SessionListRequest) {
        const key = JSON.stringify(request)
        const recordedThreads = yield* recorded
        const now = yield* Clock.currentTimeMillis
        const cached = yield* Ref.get(recent)
        if (
          cached !== undefined &&
          cached.key === key &&
          now - cached.at < listCacheMillis &&
          recordedThreads.every(thread => cached.rows.some(row => String(row.sessionId) === thread.sessionId))
        )
          return cached.rows
        const recordedByRuntime = new Map<string, Map<string, { readonly sessionId: string; readonly cwd?: string }>>()
        for (const thread of recordedThreads) {
          const sessions = recordedByRuntime.get(thread.runtimeId) ?? new Map()
          sessions.set(thread.sessionId, thread)
          recordedByRuntime.set(thread.runtimeId, sessions)
        }
        const perRuntime = yield* Effect.forEach(yield* targets, runtime =>
          listed(runtime.id, request).pipe(
            Effect.map(listedRows => {
              const listedIds = new Set(listedRows.map(row => String(row.sessionId)))
              const missingRecorded = [...(recordedByRuntime.get(runtime.id)?.values() ?? [])].filter(thread => !listedIds.has(thread.sessionId))
              const rows: readonly SessionSummary[] = [
                ...listedRows,
                ...missingRecorded.map(thread => ({
                  // SAFETY: a recorded thread id is the remote runtime's own Session id.
                  sessionId: thread.sessionId as SessionId,
                  updatedAt: 0,
                  running: false,
                  blank: true,
                  agentAvailable: true,
                  ...(thread.cwd !== undefined && { cwd: thread.cwd }),
                })),
              ]
              return rows.map(row => ({ runtime, row }))
            }),
          ),
        )
        const collected = perRuntime.flat()
        yield* Effect.forEach(collected, ({ runtime, row }) => remember(String(row.sessionId), runtime))
        yield* Ref.update(listedCwds, current => {
          const next = new Map(current)
          for (const { row } of collected) if (row.cwd !== undefined) next.set(String(row.sessionId), row.cwd)
          return next
        })
        const rows: readonly SessionSummary[] = collected.map(({ row }) => ({
          agentAvailable: row.agentAvailable,
          blank: row.blank,
          ...(row.cwd !== undefined && { cwd: row.cwd }),
          ...(row.formatStatus !== undefined && { formatStatus: row.formatStatus }),
          ...(row.origin !== undefined && { origin: row.origin }),
          ...(row.parentSessionId !== undefined && { parentSessionId: row.parentSessionId }),
          ...(row.projections !== undefined && { projections: row.projections }),
          running: row.running,
          sessionId: row.sessionId,
          updatedAt: row.updatedAt,
        }))
        yield* Ref.set(recent, { key, at: now, rows })
        return rows
      })

      const runtimeIdForSession = Effect.fnUntraced(function* (sessionId: string) {
        const record = (yield* recorded).find(thread => thread.sessionId === sessionId)
        const runtimeId = record?.runtimeId ?? (yield* Ref.get(remembered)).get(sessionId)?.id
        if (runtimeId === undefined) return Option.none<string>()
        const runtime = (yield* targets).find(item => item.id === runtimeId)
        if (runtime === undefined) return Option.none<string>()
        yield* remember(sessionId, runtime)
        return Option.some(runtime.id)
      })

      /** The thread's folder on its runtime; a folder this Host never listed is read from that runtime. */
      const cwdFor = (sessionId: string, runtime: RuntimeTarget) =>
        Effect.gen(function* () {
          const recordedCwd = (yield* recorded).find(thread => thread.sessionId === sessionId)?.cwd
          if (recordedCwd !== undefined) return recordedCwd
          const known = (yield* Ref.get(listedCwds)).get(sessionId)
          if (known !== undefined) return known
          const rows = yield* listed(runtime.id, {})
          return rows.find(row => String(row.sessionId) === sessionId)?.cwd
        })

      const refuseLocalPaths = (sessionId: string, runtime: RuntimeTarget, texts: readonly string[]) =>
        Effect.gen(function* () {
          if (!texts.some(text => text.includes('@'))) return
          const cwd = yield* cwdFor(sessionId, runtime)
          for (const text of texts) {
            const reason = RemotePromptGuard.localPathRefusal({ text, cwd, localHome: homedir(), hostName: runtime.label })
            if (reason !== undefined) return yield* new SessionPromptRefused({ reason })
          }
        })

      const prompt = (request: SessionPromptRequest): Effect.Effect<SessionPromptValue, unknown> =>
        Effect.gen(function* () {
          const runtime = yield* requireRuntime(request.sessionId)
          yield* refuseLocalPaths(
            request.sessionId,
            runtime,
            request.content.flatMap(part => (part.type === 'text' ? [part.text] : [])),
          )
          const foreignUpload = RemotePromptGuard.foreignUploadRefusal({
            receiptIds: request.content.flatMap(part => (part.type === 'file' ? [String(part.receiptId)] : [])),
            staged: yield* Ref.get(stagedUploads),
            runtimeId: runtime.id,
            sessionId: request.sessionId,
            hostName: runtime.label,
          })
          if (foreignUpload !== undefined) return yield* new SessionPromptRefused({ reason: foreignUpload })
          return yield* forward({ sessionId: request.sessionId, method: 'prompt', request, mutation: true, decode: SessionPayload.prompt }).pipe(
            Effect.catchIf(
              error => error instanceof RemoteRequestFailed && error.code === 'session/attachment-invalid',
              () => Effect.fail(new SessionPromptRefused({ reason: RemotePromptGuard.attachmentNotStagedMessage(runtime.label) })),
            ),
          )
        })

      const updateQueue = (request: SessionUpdateQueueRequest): Effect.Effect<SessionUpdateQueueValue, unknown> =>
        Effect.gen(function* () {
          const runtime = yield* requireRuntime(request.sessionId)
          if (request.action.kind === 'edit') {
            yield* refuseLocalPaths(
              request.sessionId,
              runtime,
              request.action.content.map(block => block.text),
            )
          }
          return yield* forward({ sessionId: request.sessionId, method: 'updateQueue', request, mutation: true, decode: SessionPayload.queue })
        })

      const recordUpload = (input: StagedUpload & { readonly receiptId: string }) =>
        Ref.update(stagedUploads, current => {
          const next = new Map(current).set(input.receiptId, { runtimeId: input.runtimeId, sessionId: input.sessionId })
          for (const oldest of next.keys()) {
            if (next.size <= maxStagedUploads) break
            next.delete(oldest)
          }
          return next
        })

      const snapshot = (input: { readonly sessionId: string; readonly maxMessages: number }) =>
        Effect.flatMap(runtimeFor(input.sessionId), runtime =>
          runtime === undefined
            ? Effect.sync(() => undefined)
            : pool
                .use(
                  runtime.id,
                  gateway =>
                    gateway.follow({
                      endpoint: 'session/follow',
                      args: { request: { address: { kind: 'session', sessionId: input.sessionId }, maxMessages: input.maxMessages } },
                      timeout: followTimeout,
                    }),
                  { mutation: false },
                )
                .pipe(Effect.orElseSucceed(() => undefined)),
        )

      const source: EffectSessionSource = {
        id: 'multi-host',
        label: 'Remote hosts',
        list,
        owns: (sessionId: SessionId) => Effect.map(runtimeFor(sessionId), runtime => runtime !== undefined),
        runtimeIdForSession,
        follow: (request: SessionFollowRequest): Stream.Stream<SessionFollowFrame, unknown> =>
          Stream.flatMap(Stream.fromEffect(requireRuntime(ownedSessionOf(request.address))), runtime =>
            Stream.unwrap(
              // Following a thread is what keeps its questions and approvals in reach of this Host's clients.
              Effect.andThen(
                interactions.hold(runtime.id),
                pool.use(runtime.id, gateway => Effect.succeed(gateway.stream({ endpoint: 'session/follow', args: { request } })), { mutation: false }),
              ),
            ),
          ).pipe(Stream.mapEffect(SessionPayload.followFrame)),
        page: (request: SessionPageRequest): Effect.Effect<SessionPage, unknown> =>
          forward({ sessionId: ownedSessionOf(request.address), method: 'page', request, mutation: false, decode: SessionPayload.page }),
        prompt,
        cancel: (request: SessionCancelRequest): Effect.Effect<SessionCancelValue, unknown> =>
          forward({ sessionId: request.sessionId, method: 'cancel', request, mutation: true, decode: SessionPayload.cancel }),
        updateQueue,
        projections: (request: SessionProjectionsRequest): Effect.Effect<SessionProjectionsValue, unknown> =>
          forward({ sessionId: request.sessionId, method: 'projections', request, mutation: false, decode: SessionPayload.projections }),
        selectModel: (request: SessionSelectModelRequest): Effect.Effect<SessionSelectModelValue, unknown> =>
          forward({ sessionId: request.sessionId, method: 'selectModel', request, mutation: true, decode: SessionPayload.selectedModel }),
      }

      return RemoteSessions.of({ source, snapshot, recordUpload })
    }),
  )
}
