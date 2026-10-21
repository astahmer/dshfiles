import type { ExecutionPolicy, RemoteHost } from './core.js'

export interface RemoteEndpointState {
  readonly inFlight: number
  /** Wall-clock time until which this remote is skipped after a failure. */
  readonly coolingDownUntil: number
}

export type ExecutionEndpoint = { readonly kind: 'local' } | { readonly kind: 'remote'; readonly remote: RemoteHost }

export interface ExecutionChoice {
  readonly endpoint: ExecutionEndpoint
  readonly reason: 'local-target' | 'remote-target' | 'balanced' | 'remote-unavailable' | 'local-floor'
}

export interface ExecutionSelection {
  readonly policy: ExecutionPolicy
  readonly remotes: readonly RemoteHost[]
  readonly localMemoryFloorMb: number
  readonly freeMemoryMb: number
  readonly now: number
  readonly states: ReadonlyMap<string, RemoteEndpointState>
}

export const LOCAL_ENDPOINT_KEY = 'local'

const stateFor = (input: ExecutionSelection, key: string): RemoteEndpointState => input.states.get(key) ?? { inFlight: 0, coolingDownUntil: 0 }

const isAvailable = (input: ExecutionSelection, remote: RemoteHost, ignoreCooldown: boolean): boolean => {
  if (!remote.enabled) return false
  if (ignoreCooldown) return true
  return stateFor(input, remote.id).coolingDownUntil <= input.now
}

const byPriority = (left: RemoteHost, right: RemoteHost): number => left.priority - right.priority || left.id.localeCompare(right.id)

const pinnedRemote = (input: ExecutionSelection): RemoteHost | undefined => {
  if (input.policy.remote === undefined) return undefined
  return input.remotes.find(remote => remote.id === input.policy.remote)
}

const leastBusy = (input: ExecutionSelection, remotes: readonly RemoteHost[]): ExecutionChoice => {
  const remoteCandidates = remotes.map(remote => ({
    endpoint: { kind: 'remote', remote } as const,
    inFlight: stateFor(input, remote.id).inFlight,
    rank: 0,
    priority: remote.priority,
    id: remote.id,
  }))
  const localEligible = input.freeMemoryMb >= input.localMemoryFloorMb
  const localCandidates = localEligible
    ? [{ endpoint: { kind: 'local' } as const, inFlight: stateFor(input, LOCAL_ENDPOINT_KEY).inFlight, rank: 1, priority: 0, id: LOCAL_ENDPOINT_KEY }]
    : []
  const candidates = [...remoteCandidates, ...localCandidates].sort(
    (left, right) => left.inFlight - right.inFlight || left.rank - right.rank || left.priority - right.priority || left.id.localeCompare(right.id),
  )
  const chosen = candidates[0]
  if (chosen === undefined) return { endpoint: { kind: 'local' }, reason: 'local-floor' }
  if (chosen.endpoint.kind === 'local') return { endpoint: chosen.endpoint, reason: localEligible ? 'balanced' : 'local-floor' }
  return { endpoint: chosen.endpoint, reason: 'balanced' }
}

export type RemoteFailureDecision = 'fallback-local' | 'cancelled' | 'fail'

export interface RemoteFailurePlan {
  readonly decision: RemoteFailureDecision
  readonly failure: 'remote-failed' | null
  readonly remoteFailure: { readonly remoteId: string; readonly code: string; readonly message: string }
}

export class ExecutionModel {
  /** Remote trouble never blocks the work by default: run the check locally and record why. */
  static readonly decideRemoteFailure = ({ policy, code }: { readonly policy: ExecutionPolicy; readonly code: string }): RemoteFailureDecision => {
    if (code === 'peer-cancelled') return 'cancelled'
    return policy.onRemoteFailure === 'fail' ? 'fail' : 'fallback-local'
  }

  /** The receipt fields a failed remote attempt contributes, whatever runs afterwards. */
  static readonly planRemoteFailure = ({
    policy,
    remoteId,
    code,
    message,
  }: {
    readonly policy: ExecutionPolicy
    readonly remoteId: string
    readonly code: string
    readonly message: string
  }): RemoteFailurePlan => {
    const decision = ExecutionModel.decideRemoteFailure({ policy, code })
    return {
      decision,
      failure: decision === 'fail' ? 'remote-failed' : null,
      remoteFailure: { remoteId, code, message: message.slice(0, 240) },
    }
  }

  /** Picks where one action runs: the laptop, a named peer, or the least busy eligible endpoint. */
  static readonly choose = (input: ExecutionSelection): ExecutionChoice => {
    if (input.policy.target === 'local') return { endpoint: { kind: 'local' }, reason: 'local-target' }

    const pinned = pinnedRemote(input)
    if (pinned !== undefined) {
      if (isAvailable(input, pinned, true)) return { endpoint: { kind: 'remote', remote: pinned }, reason: 'remote-target' }
      return { endpoint: { kind: 'local' }, reason: 'remote-unavailable' }
    }

    if (input.policy.target === 'remote') {
      const chosen = [...input.remotes].filter(remote => isAvailable(input, remote, false)).sort(byPriority)[0]
      if (chosen === undefined) return { endpoint: { kind: 'local' }, reason: 'remote-unavailable' }
      return { endpoint: { kind: 'remote', remote: chosen }, reason: 'remote-target' }
    }

    return leastBusy(
      input,
      input.remotes.filter(remote => isAvailable(input, remote, false)),
    )
  }
}
