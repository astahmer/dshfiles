/**
 * Whether this page can reach its Host. The connection's own state only changes when the socket closes or the browser
 * reports offline; a tunnel that silently drops packets (Tailscale switched off on a phone) leaves it "connected" for
 * minutes while the page shows stale data. A cheap HTTP probe on resume, on `online` and on a slow interval closes that
 * gap.
 */

import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'

/** `unknown` until a probe settles; `reachable` and `unreachable` are probe verdicts. */
export type ProbeVerdict = 'unknown' | 'reachable' | 'unreachable'

export interface ReachabilityState {
  readonly probe: ProbeVerdict
  /** Consecutive failed probes; one miss on a phone that just woke is not yet an outage. */
  readonly misses: number
  readonly probing: boolean
}

export type ReachabilityView = 'online' | 'checking' | 'offline'

export const FAILED_PROBES_FOR_OFFLINE = 2

export class ReachabilityModel {
  static readonly initial: ReachabilityState = { probe: 'unknown', misses: 0, probing: false }

  static readonly started = (state: ReachabilityState): ReachabilityState => ({ ...state, probing: true })

  /** A probe answer; `recovered` says the Host came back after an outage, so a stale socket should reconnect. */
  static readonly settled = (state: ReachabilityState, reachable: boolean): { readonly state: ReachabilityState; readonly recovered: boolean } => {
    if (reachable) return { state: { probe: 'reachable', misses: 0, probing: false }, recovered: state.probe === 'unreachable' }
    const misses = state.misses + 1
    return { state: { probe: misses >= FAILED_PROBES_FOR_OFFLINE ? 'unreachable' : state.probe, misses, probing: false }, recovered: false }
  }

  /** What the page shows: the probe outranks a socket that has not noticed the outage yet. */
  static readonly view = (input: { readonly state: ReachabilityState; readonly connection: ConnectionState | undefined }): ReachabilityView => {
    if (input.state.probe === 'unreachable') return input.state.probing ? 'checking' : 'offline'
    if (input.connection === 'disconnected') return 'offline'
    if (input.connection === 'connecting') return 'checking'
    return 'online'
  }
}

const PROBE_TIMEOUT_MS = 4_000

/**
 * One reachability probe: a HEAD of the static web manifest, which every route in front of the Host (phone gateway,
 * tunnel proxy) forwards without a session. Any HTTP answer means the Host is reachable.
 * @param signal - aborts the probe.
 * @returns whether an HTTP answer arrived in time.
 */
export const probeHost = async (signal?: AbortSignal): Promise<boolean> => {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS)
  try {
    await fetch(new URL('/manifest.webmanifest', document.baseURI), {
      method: 'HEAD',
      cache: 'no-store',
      credentials: 'include',
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    })
    return true
  } catch {
    return false
  }
}
