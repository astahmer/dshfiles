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
  const ownerBySession = new Map<string, string>()
  let refreshing: Promise<void> | undefined
  let recent: { readonly key: string; readonly at: number; readonly rows: readonly SessionSummary[] } | undefined
  const listCacheMs = 2_000

  const remember = (runtimeId: string, rows: readonly SessionSummary[]): void => {
    for (const row of rows) ownerBySession.set(String(row.sessionId), runtimeId)
  }

  const refreshOwners = async (request: SessionListRequest): Promise<void> => {
    refreshing ??= (async () => {
      for (const runtime of await runtimes.list()) {
        try {
          const value = await runtimes.run(runtime.id, gateway => gateway.run('session', 'list', { _request: request }, undefined), { mutation: false })
          remember(runtime.id, SessionSourcePayload.summaries(value))
        } catch {
          // An unreachable runtime must not keep another runtime's threads from opening.
        }
      }
    })().finally(() => {
      refreshing = undefined
    })
    await refreshing
  }

  const runtimeFor = async (sessionId: SessionId): Promise<RemoteRuntimeTarget | undefined> => {
    const cached = ownerBySession.get(sessionId)
    const runtimesNow = await runtimes.list()
    const claimed = cached === undefined ? undefined : runtimesNow.find(runtime => runtime.id === cached)
    if (claimed !== undefined) return claimed
    await refreshOwners({})
    const refreshed = ownerBySession.get(sessionId)
    return refreshed === undefined ? undefined : runtimesNow.find(runtime => runtime.id === refreshed)
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
      if (recent !== undefined && recent.key === key && Date.now() - recent.at < listCacheMs) return recent.rows
      const rows: SessionSummary[] = []
      for (const runtime of await runtimes.list()) {
        try {
          const value = await runtimes.run(runtime.id, gateway => gateway.run('session', 'list', { _request: request }, undefined), { mutation: false })
          const runtimeRows = SessionSourcePayload.summaries(value)
          remember(runtime.id, runtimeRows)
          rows.push(...runtimeRows)
        } catch {
          // Same rule as refreshOwners: one host down is not a list failure.
        }
      }
      recent = { key, at: Date.now(), rows }
      return rows
    },
    owns: async sessionId => (await runtimeFor(sessionId)) !== undefined,
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
  }
}
