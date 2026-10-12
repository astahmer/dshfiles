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
  /** Parsed tool arguments, when the registry exposes them (it does for every dispatch). */
  readonly arguments?: unknown
  readonly agent?:
    | {
        readonly id: string
        readonly session: { readonly header: { readonly cwd?: string | undefined } }
      }
    | undefined
}

/**
 * Structured write tools whose target path is a real argument, unlike a shell
 * command string. Guarding these is precise; a `bash` command remains the
 * documented hole below, because deciding what a shell string writes is not
 * something a tool-level cwd guard can do.
 */
const STRUCTURED_WRITE_TOOLS = new Set(['write', 'edit'])

const absolutePathsIn = (value: unknown, out: string[] = [], depth = 0): string[] => {
  if (depth > 4 || out.length > 32) return out
  if (typeof value === 'string') {
    if (value.startsWith('/')) out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) absolutePathsIn(item, out, depth + 1)
    return out
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) absolutePathsIn(item, out, depth + 1)
    return out
  }
  return out
}

const stringsIn = (value: unknown, out: string[] = [], depth = 0): string[] => {
  if (depth > 4 || out.length > 256) return out
  if (typeof value === 'string') {
    out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) stringsIn(item, out, depth + 1)
    return out
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) stringsIn(item, out, depth + 1)
    return out
  }
  return out
}

/**
 * The last known good recovery store must outlive the failure it exists for, so
 * no tool call may name it — not a shell string, not a write target, and not the
 * launcher either: `dsh-recover` reaches the store without ever spelling its
 * path. Matching text is deliberately blunt: a false positive costs one refused
 * call and names the path, while a false negative costs the recovery copy.
 */
export const PROTECTED_TOOL_NAMES = ['dsh-recover', 'dsh-lkg'] as const

export const protectedHit = (value: unknown, protectedPaths: readonly string[]): string | undefined => {
  if (protectedPaths.length === 0) return undefined
  const texts = stringsIn(value)
  for (const path of protectedPaths) {
    const needles = [path, path.replace(/^\/(?:Users|home)\/[^/]+/, '~')]
    for (const needle of needles) {
      if (needle.length === 0) continue
      if (texts.some(text => text.includes(needle))) return path
    }
  }
  const named = PROTECTED_TOOL_NAMES.find(name => texts.some(text => text.includes(name)))
  return named === undefined ? undefined : protectedPaths[0]
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
  /** Absolute paths no tool call may name, whatever the tool and whatever workspace it runs in. */
  readonly protectedPaths?: readonly string[] | undefined
  readonly hostname: () => string
  readonly now?: (() => number) | undefined
  readonly cacheMs?: number | undefined
  readonly heldEpochs?: Map<string, number> | undefined
  readonly onDeny?:
    | ((input: {
        readonly sessionId: string
        readonly workspaceId: string
        readonly toolName: string
        readonly code: OwnershipCode
        readonly reason: string
      }) => void)
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

  /**
   * A structured write whose target resolves inside another isolated workspace.
   * Only workspaces this plugin provisioned are checked, so a checkout merely
   * discovered from a cwd is never fenced by this rule.
   */
  const foreignTarget = async (args: unknown, ownWorkspaceId: string): Promise<string | undefined> => {
    for (const candidate of absolutePathsIn(args)) {
      const found = await deps.ownershipForPath(candidate)
      if (found === undefined || found.workspaceId === ownWorkspaceId || !found.view.isolated) continue
      return `"${candidate}" is inside workspace "${found.view.workspaceName}", which this thread does not own; write inside your own workspace or take that lease explicitly`
    }
    return undefined
  }

  return async <Decision extends { readonly kind: string }>(execution: GateExecution, next: () => Promise<Decision>): Promise<Decision | GateDeny> => {
    // Checked before any workspace lookup: the recovery store is protected in
    // every Session, isolated or not.
    const hit = protectedHit(execution.arguments, deps.protectedPaths ?? [])
    if (hit !== undefined) {
      const reason = `"${hit}" is the last known good recovery store. It is deliberately not writable from a DSH Session: ask the operator to run dsh-recover, or to promote a new snapshot with the dsh-lkg tool.`
      deps.onDeny?.({ sessionId: execution.agent?.id ?? 'unknown', workspaceId: 'protected', toolName: execution.name, code: 'protected-path', reason })
      return { kind: 'deny', reason }
    }
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
      if (STRUCTURED_WRITE_TOOLS.has(execution.name)) {
        const reason = await foreignTarget(execution.arguments, entry.workspaceId)
        if (reason !== undefined) {
          deps.onDeny?.({ sessionId, workspaceId: entry.workspaceId, toolName: execution.name, code: 'foreign-workspace', reason })
          return { kind: 'deny', reason }
        }
      }
      return next()
    } catch (error) {
      deps.onError?.({ sessionId, error })
      const reason = error instanceof Error ? error.message : String(error)
      return { kind: 'deny', reason: `workspace ownership could not be verified in "${cwd}": ${reason}` }
    }
  }
}
