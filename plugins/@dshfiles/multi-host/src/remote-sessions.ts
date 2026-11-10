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
  SessionForkRequest,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionSummary,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionPayload, SessionForkUnavailable, SessionPromptRefused, type EffectSessionSource } from '@dshfiles/session-source-port'
import { Clock, Context, Duration, Effect, Fiber, FiberHandle, Layer, Option, Ref, Schema, Stream } from 'effect'
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
const decodeRegisteredRepository = Schema.decodeUnknownOption(Schema.Struct({ repoId: Schema.String }))
const maxRemembered = 20_000
const maxStagedUploads = 2_000
const followTimeout = 15_000
/** Unknown ids refresh the remote listings in the background at most this often. */
const refreshMillis = 10_000
const listTimeout = Duration.seconds(15)
/** A runtime whose listing failed is skipped for 30 s, doubling per failure up to 10 min. */
const backoffStartMillis = 30_000
const backoffMaxMillis = 600_000

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
    /** The repository ids the owner issued for this thread's own folder: it mints a new one per registration. */
    readonly threadRepositoryIds: (sessionId: string) => Effect.Effect<ReadonlySet<string>>
    /** Note the id a registration of the thread's folder returned. */
    readonly rememberRepository: (input: { readonly sessionId: string; readonly reply: unknown }) => Effect.Effect<void>
    /** The folder a mirrored thread works in, as its runtime reports it. */
    readonly threadFolder: (sessionId: string) => Effect.Effect<string | undefined, SessionOwnerMissing>
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
      const remembered = yield* Ref.make(new Map<string, RuntimeTarget>())
      const unreachable = yield* Ref.make(new Map<string, { readonly failures: number; readonly retryAt: number }>())
      const lastRefreshAt = yield* Ref.make(Number.NEGATIVE_INFINITY)
      const refreshing = yield* FiberHandle.make<void, never>()
      const recent = yield* Ref.make<{ readonly key: string; readonly at: number; readonly rows: readonly SessionSummary[] } | undefined>(undefined)
      const listedCwds = yield* Ref.make(new Map<string, string>())
      const stagedUploads = yield* Ref.make<ReadonlyMap<string, StagedUpload>>(new Map())

      const targets = directory.listRuntimes().pipe(
        Effect.map(runtimes => runtimes.map((runtime): RuntimeTarget => ({ id: runtime.id, label: runtime.name }))),
        Effect.orElseSucceed((): readonly RuntimeTarget[] => []),
      )
      const recorded = threads.list.pipe(Effect.orElseSucceed((): readonly RemoteThread[] => []))

      const rememberAll = (owned: readonly { readonly sessionId: string; readonly runtime: RuntimeTarget }[]) =>
        Ref.update(remembered, current => {
          const next = new Map(current)
          for (const { sessionId, runtime } of owned) {
            next.delete(sessionId)
            next.set(sessionId, runtime)
          }
          for (const oldest of next.keys()) {
            if (next.size <= maxRemembered) break
            next.delete(oldest)
          }
          return next
        })
      const remember = (sessionId: string, runtime: RuntimeTarget) => rememberAll([{ sessionId, runtime }])

      const forget = (sessionId: string) =>
        Ref.update(remembered, current => {
          const next = new Map(current)
          next.delete(sessionId)
          return next
        })

      const markUnreachable = (runtimeId: string) =>
        Effect.flatMap(Clock.currentTimeMillis, now =>
          Ref.update(unreachable, current => {
            const failures = (current.get(runtimeId)?.failures ?? 0) + 1
            const delay = Math.min(backoffStartMillis * 2 ** (failures - 1), backoffMaxMillis)
            return new Map(current).set(runtimeId, { failures, retryAt: now + delay })
          }),
        )
      const markReachable = (runtimeId: string) =>
        Ref.update(unreachable, current => {
          if (!current.has(runtimeId)) return current
          const next = new Map(current)
          next.delete(runtimeId)
          return next
        })
      // A connection opened by any other path proves the runtime is back, so its backoff ends early.
      yield* Stream.runForEach(pool.connected, markReachable).pipe(Effect.forkScoped)

      /**
       * One runtime's own `session/list` answer; a host that is down contributes no rows. A runtime whose listing failed
       * is not asked again until its backoff ends: an unreachable SSH host takes seconds to fail every time.
       */
      const listed = Effect.fnUntraced(function* (runtimeId: string, request: SessionListRequest | Record<string, never>) {
        const now = yield* Clock.currentTimeMillis
        if (((yield* Ref.get(unreachable)).get(runtimeId)?.retryAt ?? 0) > now) return []
        return yield* pool
          .use(
            runtimeId,
            gateway => Effect.flatMap(gateway.run({ namespace: 'session', method: 'list', args: { _request: request } }), SessionPayload.summaries),
            { mutation: false },
          )
          .pipe(
            Effect.timeout(listTimeout),
            Effect.matchEffect({
              onFailure: () => Effect.as(markUnreachable(runtimeId), []),
              onSuccess: rows => Effect.as(markReachable(runtimeId), rows),
            }),
          )
      })

      /** Every runtime's listing, remembered for later lookups; it runs in the background, never under a request. */
      const refresh = Effect.gen(function* () {
        yield* Ref.set(lastRefreshAt, yield* Clock.currentTimeMillis)
        const perRuntime = yield* Effect.forEach(
          yield* targets,
          runtime => Effect.map(listed(runtime.id, {}), rows => rows.map(row => ({ sessionId: String(row.sessionId), runtime }))),
          { concurrency: 'unbounded' },
        )
        yield* rememberAll(perRuntime.flat())
      })
      const requestRefresh = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        if (now - (yield* Ref.get(lastRefreshAt)) < refreshMillis) return
        if (Option.isSome(FiberHandle.getUnsafe(refreshing))) return
        yield* FiberHandle.run(refreshing, refresh, { onlyIfMissing: true })
      })

      /**
       * The runtime owning a Session, from what this Host already knows: recorded threads and ids remembered from earlier
       * listings. It never waits on a runtime; an unknown id (every New chat draft) asks for a background refresh instead.
       */
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
        yield* requestRefresh
        return undefined
      })

      const requireRuntime = (sessionId: string) =>
        Effect.flatMap(lookup(sessionId), runtime => (runtime === undefined ? Effect.fail(new SessionOwnerMissing({ sessionId })) : Effect.succeed(runtime)))

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
        yield* rememberAll(collected.map(({ runtime, row }) => ({ sessionId: String(row.sessionId), runtime })))
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
            Effect.mapError(error =>
              error instanceof RemoteRequestFailed && error.code === 'session/attachment-invalid'
                ? new SessionPromptRefused({ reason: RemotePromptGuard.attachmentNotStagedMessage(runtime.label) })
                : error,
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

      /** A mentioned remote Session may not be known yet, so a snapshot may wait for the refresh its lookup started. */
      const awaitedLookup = Effect.fnUntraced(function* (sessionId: string) {
        const known = yield* lookup(sessionId)
        if (known !== undefined) return known
        const running = FiberHandle.getUnsafe(refreshing)
        if (Option.isNone(running)) return undefined
        yield* Fiber.join(running.value)
        return yield* lookup(sessionId)
      })

      const snapshot = (input: { readonly sessionId: string; readonly maxMessages: number }) =>
        Effect.flatMap(awaitedLookup(input.sessionId), runtime =>
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
      /** A fork of a mirrored thread stays on its host, so this Host records it as that host's thread. */
      const fork = Effect.fn('multi-host remote session fork')(function* (request: SessionForkRequest) {
        const runtime = yield* requireRuntime(request.sessionId)
        const created = yield* forward({ sessionId: request.sessionId, method: 'fork', request, mutation: true, decode: SessionPayload.forked }).pipe(
          // The native client reads this code to say why a thread cannot fork yet.
          Effect.mapError(error =>
            error instanceof RemoteRequestFailed && error.code === 'session/fork-unavailable'
              ? new SessionForkUnavailable({ sessionId: request.sessionId, reason: error.detail })
              : error,
          ),
        )
        const cwd = yield* cwdFor(request.sessionId, runtime)
        if (cwd !== undefined)
          yield* threads.record({ runtimeId: runtime.id, sessionId: created.sessionId, cwd, title: '', createdAt: new Date().toISOString() })
        return created
      })

      const source: EffectSessionSource = {
        id: 'multi-host',
        label: 'Remote hosts',
        list,
        owns: (sessionId: SessionId) => Effect.map(lookup(sessionId), runtime => runtime !== undefined),
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
        fork,
        rename: (request: SessionRenameRequest): Effect.Effect<SessionRenameValue, unknown> =>
          forward({ sessionId: request.sessionId, method: 'rename', request, mutation: true, decode: SessionPayload.renamed }),
        selectModel: (request: SessionSelectModelRequest): Effect.Effect<SessionSelectModelValue, unknown> =>
          forward({ sessionId: request.sessionId, method: 'selectModel', request, mutation: true, decode: SessionPayload.selectedModel }),
      }

      const threadFolder = (sessionId: string) => Effect.flatMap(requireRuntime(sessionId), runtime => cwdFor(sessionId, runtime))

      const threadRepositories = yield* Ref.make<ReadonlyMap<string, ReadonlySet<string>>>(new Map())
      const threadRepositoryIds = (sessionId: string) => Effect.map(Ref.get(threadRepositories), known => known.get(sessionId) ?? new Set<string>())
      const rememberRepository = (input: { readonly sessionId: string; readonly reply: unknown }) =>
        Option.match(decodeRegisteredRepository(input.reply), {
          onNone: () => Effect.void,
          onSome: ({ repoId }) =>
            Ref.update(threadRepositories, current => new Map(current).set(input.sessionId, new Set([...(current.get(input.sessionId) ?? []), repoId]))),
        })

      return RemoteSessions.of({ source, snapshot, recordUpload, threadFolder, threadRepositoryIds, rememberRepository })
    }),
  )
}
