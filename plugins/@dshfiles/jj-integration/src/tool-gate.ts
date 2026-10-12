import { decideToolCall, type OwnershipCode, type WorkspaceOwnershipView } from './ownership.js'

/**
 * The execution boundary for exclusive writers.
 *
 * A tool call is admitted only when the calling Session owns the workspace its
 * cwd sits in. The decision is taken from durable state (through the service),
 * never from a frontend flag, and a check that cannot complete denies.
 */

export interface GateExecution {
  readonly name: string
  readonly agent?:
    | {
        readonly id: string
        readonly session: { readonly header: { readonly cwd?: string | undefined } }
      }
    | undefined
}

export interface GateDeny {
  readonly kind: 'deny'
  readonly reason: string
}

export interface ToolGateDependencies {
  readonly ownershipForPath: (path: string) => Promise<{ readonly workspaceId: string; readonly view: WorkspaceOwnershipView } | undefined>
  readonly acquireWriter: (input: { readonly workspaceId: string; readonly sessionId: string; readonly host: string }) => Promise<{
    readonly writerLease: { readonly epoch: number } | null
  }>
  readonly heartbeatWriter: (input: { readonly workspaceId: string; readonly sessionId: string }) => Promise<unknown>
  readonly staleAfterMs: number
  readonly readOnlyTools: readonly string[]
  readonly hostname: () => string
  readonly now?: (() => number) | undefined
  readonly cacheMs?: number | undefined
  readonly heldEpochs?: Map<string, number> | undefined
  readonly onDeny?:
    | ((input: { readonly sessionId: string; readonly workspaceId: string; readonly toolName: string; readonly code: OwnershipCode; readonly reason: string }) => void)
    | undefined
  readonly onError?: ((input: { readonly sessionId: string; readonly error: unknown }) => void) | undefined
}

interface CacheEntry {
  readonly at: number
  readonly workspaceId: string
  readonly view: WorkspaceOwnershipView
}

export const createToolGate = (deps: ToolGateDependencies) => {
  const now = deps.now ?? Date.now
  const cacheMs = deps.cacheMs ?? 500
  const heldEpochs = deps.heldEpochs ?? new Map<string, number>()
  const cache = new Map<string, CacheEntry>()

  const entryFor = async (sessionId: string, cwd: string): Promise<CacheEntry | undefined> => {
    const cached = cache.get(sessionId)
    if (cached !== undefined && now() - cached.at < cacheMs) return cached
    const found = await deps.ownershipForPath(cwd)
    if (found === undefined) {
      cache.delete(sessionId)
      return undefined
    }
    const entry: CacheEntry = { at: now(), workspaceId: found.workspaceId, view: found.view }
    cache.set(sessionId, entry)
    return entry
  }

  return async <Decision extends { readonly kind: string }>(execution: GateExecution, next: () => Promise<Decision>): Promise<Decision | GateDeny> => {
    const agent = execution.agent
    const cwd = agent?.session.header.cwd
    if (agent === undefined || cwd === undefined || cwd.length === 0) return next()
    const sessionId = agent.id
    try {
      const entry = await entryFor(sessionId, cwd)
      if (entry === undefined) return next()
      const decision = decideToolCall({
        workspace: entry.view,
        sessionId,
        toolName: execution.name,
        heldEpoch: heldEpochs.get(entry.workspaceId) ?? null,
        now: now(),
        staleAfterMs: deps.staleAfterMs,
        readOnlyTools: deps.readOnlyTools,
      })
      if (decision.kind === 'deny') {
        deps.onDeny?.({ sessionId, workspaceId: entry.workspaceId, toolName: execution.name, code: decision.code, reason: decision.reason })
        return { kind: 'deny', reason: decision.reason }
      }
      if (decision.kind === 'acquire') {
        const claimed = await deps.acquireWriter({ workspaceId: entry.workspaceId, sessionId, host: deps.hostname() })
        if (claimed.writerLease !== null) heldEpochs.set(entry.workspaceId, claimed.writerLease.epoch)
        cache.delete(sessionId)
      } else {
        void deps.heartbeatWriter({ workspaceId: entry.workspaceId, sessionId }).catch(() => undefined)
      }
      return next()
    } catch (error) {
      deps.onError?.({ sessionId, error })
      const reason = error instanceof Error ? error.message : String(error)
      return { kind: 'deny', reason: `workspace ownership could not be verified in "${cwd}": ${reason}` }
    }
  }
}
