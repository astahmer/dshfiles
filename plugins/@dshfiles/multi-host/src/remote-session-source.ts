import type {
  SessionAddress,
  SessionCancelRequest,
  SessionCancelValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionPage,
  SessionPageRequest,
  SessionProjectionsRequest,
  SessionProjectionsValue,
  SessionPromptRequest,
  SessionPromptValue,
  SessionSummary,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionSourcePayload, type MirroredSessionSource } from '@dshfiles/session-source-port'
import type { Gateway } from './connectors/gateway.js'
import type { PooledGateway } from './gateway-pool.js'

/** The Session a runtime owns for one address; a subagent address names its child Session. */
const ownedSessionOf = (address: SessionAddress): SessionId => (address.kind === 'session' ? address.sessionId : address.childSessionId)

/** One runtime this Host can reach, as the source needs it. */
export interface RemoteRuntimeTarget {
  readonly id: string
  readonly label: string
}

/** The runtime access the source borrows from multi-host's Host half. */
export interface RemoteRuntimes {
  list(): Promise<readonly RemoteRuntimeTarget[]>
  recordedSessions(): Promise<readonly { readonly sessionId: string; readonly runtimeId: string; readonly cwd?: string }[]>
  acquire(runtimeId: string): Promise<PooledGateway>
  run<Result>(runtimeId: string, request: (gateway: Gateway) => Promise<Result>, options: { readonly mutation: boolean }): Promise<Result>
}

/**
 * Sessions of every reachable runtime, offered to this Host's Session controller as a source. The source is the only
 * place that knows which runtime owns a Session: `list` claims ids from the runtime's own `session/list`, and every
 * other endpoint forwards the request unchanged to that runtime.
 *
 * Writes are never replayed: a stream that drops surfaces its failure so the browser's own journal can reconnect and
 * repair, and a prompt/cancel/queue mutation goes through the pool's no-replay path.
 */
export const createRemoteSessionSource = ({ runtimes }: { readonly runtimes: RemoteRuntimes }): MirroredSessionSource => {
  const ownerBySessionRefresh = new Map<string, Promise<RemoteRuntimeTarget | undefined>>()
  let recent: { readonly key: string; readonly at: number; readonly rows: readonly SessionSummary[] } | undefined
  const listCacheMs = 2_000

  const runtimeFor = async (sessionId: string): Promise<RemoteRuntimeTarget | undefined> => {
    const ongoingRefresh = ownerBySessionRefresh.get(sessionId)
    if (ongoingRefresh !== undefined) return ongoingRefresh
    const lookup = (async (): Promise<RemoteRuntimeTarget | undefined> => {
      const runtimesNow = await runtimes.list()
      const recorded = (await runtimes.recordedSessions()).find(thread => thread.sessionId === sessionId)
      const recordedRuntime = recorded === undefined ? undefined : runtimesNow.find(runtime => runtime.id === recorded.runtimeId)
      if (recorded !== undefined) return recordedRuntime
      for (const runtime of runtimesNow) {
        try {
          const value = await runtimes.run(runtime.id, gateway => gateway.run('session', 'list', { _request: {} }), { mutation: false })
          const row = SessionSourcePayload.summaries(value).find(item => String(item.sessionId) === sessionId)
          if (row === undefined) continue
          return runtime
        } catch {
          // A Session owned by an unreachable runtime cannot authorize a routed operation.
        }
      }
      return undefined
    })()
    ownerBySessionRefresh.set(sessionId, lookup)
    try {
      return await lookup
    } finally {
      if (ownerBySessionRefresh.get(sessionId) === lookup) ownerBySessionRefresh.delete(sessionId)
    }
  }

  const requireRuntime = async (sessionId: SessionId): Promise<RemoteRuntimeTarget> => {
    const runtime = await runtimeFor(sessionId)
    if (runtime === undefined) throw new Error(`No connected runtime owns Session ${sessionId}.`)
    return runtime
  }

  return {
    id: 'multi-host',
    label: 'Remote hosts',
    list: async request => {
      const key = JSON.stringify(request)
      const recordedSessions = await runtimes.recordedSessions()
      // oxlint-disable-next-line antislop/no-passthrough-variable -- snapshot: `recent` is reassigned across awaits and its narrowing does not reach the `.some` callback.
      const cached = recent
      if (
        cached !== undefined &&
        cached.key === key &&
        Date.now() - cached.at < listCacheMs &&
        recordedSessions.every(thread => cached.rows.some(row => String(row.sessionId) === thread.sessionId))
      )
        return cached.rows
      const rows: SessionSummary[] = []
      const recordedByRuntime = new Map<string, Map<string, { readonly sessionId: string; readonly cwd?: string }>>()
      for (const thread of recordedSessions) {
        const sessions = recordedByRuntime.get(thread.runtimeId) ?? new Map()
        sessions.set(thread.sessionId, thread)
        recordedByRuntime.set(thread.runtimeId, sessions)
      }
      for (const runtime of await runtimes.list()) {
        try {
          const value = await runtimes.run(runtime.id, gateway => gateway.run('session', 'list', { _request: request }, undefined), { mutation: false })
          const listedRows = SessionSourcePayload.summaries(value)
          const listedIds = new Set(listedRows.map(row => String(row.sessionId)))
          const missingRecorded = [...(recordedByRuntime.get(runtime.id)?.values() ?? [])].filter(thread => !listedIds.has(thread.sessionId))
          const runtimeRows: readonly SessionSummary[] = [
            ...listedRows,
            ...missingRecorded.map(thread => ({
              sessionId: thread.sessionId as SessionId,
              updatedAt: 0,
              running: false,
              blank: true,
              agentAvailable: true,
              ...(thread.cwd === undefined ? {} : { cwd: thread.cwd }),
            })),
          ]
          rows.push(
            ...runtimeRows.map(row => ({
              agentAvailable: row.agentAvailable,
              blank: row.blank,
              ...(row.cwd === undefined ? {} : { cwd: row.cwd }),
              ...(row.formatStatus === undefined ? {} : { formatStatus: row.formatStatus }),
              ...(row.origin === undefined ? {} : { origin: row.origin }),
              ...(row.parentSessionId === undefined ? {} : { parentSessionId: row.parentSessionId }),
              ...(row.projections === undefined ? {} : { projections: row.projections }),
              running: row.running,
              sessionId: row.sessionId,
              updatedAt: row.updatedAt,
            })),
          )
        } catch {
          // One host down is not a list failure.
        }
      }
      recent = { key, at: Date.now(), rows }
      return rows
    },
    owns: async sessionId => (await runtimeFor(sessionId)) !== undefined,
    runtimeIdForSession: async sessionId => (await runtimeFor(sessionId))?.id,
    follow: async function* (request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
      const runtime = await requireRuntime(ownedSessionOf(request.address))
      const leased = await runtimes.acquire(runtime.id)
      try {
        for await (const frame of leased.gateway.stream('session/follow', { request }, signal)) {
          yield SessionSourcePayload.followFrame(frame)
        }
      } finally {
        leased.release()
      }
    },
    page: async (request: SessionPageRequest, signal: AbortSignal): Promise<SessionPage> => {
      const runtime = await requireRuntime(ownedSessionOf(request.address))
      const value = await runtimes.run(runtime.id, gateway => gateway.run('session', 'page', { request }, signal), { mutation: false })
      return SessionSourcePayload.page(value)
    },
    prompt: async (request: SessionPromptRequest, signal: AbortSignal): Promise<SessionPromptValue> => {
      const runtime = await requireRuntime(request.sessionId)
      const value = await runtimes.run(runtime.id, gateway => gateway.run('session', 'prompt', { request }, signal), { mutation: true })
      return SessionSourcePayload.prompt(value)
    },
    cancel: async (request: SessionCancelRequest): Promise<SessionCancelValue> => {
      const runtime = await requireRuntime(request.sessionId)
      const value = await runtimes.run(runtime.id, gateway => gateway.run('session', 'cancel', { request }), { mutation: true })
      return SessionSourcePayload.cancel(value)
    },
    updateQueue: async (request: SessionUpdateQueueRequest): Promise<SessionUpdateQueueValue> => {
      const runtime = await requireRuntime(request.sessionId)
      const value = await runtimes.run(runtime.id, gateway => gateway.run('session', 'updateQueue', { request }), { mutation: true })
      return SessionSourcePayload.queue(value)
    },
    projections: async (request: SessionProjectionsRequest, signal: AbortSignal): Promise<SessionProjectionsValue> => {
      const runtime = await requireRuntime(request.sessionId)
      const value = await runtimes.run(runtime.id, gateway => gateway.run('session', 'projections', { request }, signal), { mutation: false })
      return SessionSourcePayload.projections(value)
    },
    selectModel: async (request: SessionSelectModelRequest): Promise<SessionSelectModelValue> => {
      const runtime = await requireRuntime(request.sessionId)
      const value = await runtimes.run(runtime.id, gateway => gateway.run('session', 'selectModel', { request }), { mutation: true })
      return SessionSourcePayload.selectedModel(value)
    },
  }
}
