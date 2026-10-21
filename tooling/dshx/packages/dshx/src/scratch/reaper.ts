import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { scratchDown, type DownAction } from './lifecycle.js'
import { DEFAULT_IDLE_TIMEOUT_MINUTES, DEFAULT_WARN_MINUTES, ScratchStateRuntime, type ScratchState, type ScratchWarning } from './state.js'

export interface ReapedScratch {
  readonly name: string
  readonly stateDir: string
  readonly reason: string
  readonly actions: readonly DownAction[]
  readonly leftRunning: readonly number[]
}

export interface WarnedScratch {
  readonly name: string
  readonly stateDir: string
  readonly warning: ScratchWarning
}

export type ReapOutcome =
  | { readonly kind: 'in-use' }
  | { readonly kind: 'warned'; readonly warned: WarnedScratch }
  | { readonly kind: 'stopped'; readonly stopped: ReapedScratch }

type LeaseVerdict =
  | { readonly kind: 'in-use' }
  | { readonly kind: 'warn'; readonly idleReason: string; readonly warnMinutes: number }
  | { readonly kind: 'warned'; readonly warning: ScratchWarning }
  | { readonly kind: 'stop'; readonly reason: string }

const leaseVerdict = (options: { readonly state: ScratchState; readonly lastUsedAt: number; readonly now: number }): LeaseVerdict => {
  const host = ScratchStateRuntime.ownedProcessStatus(options.state.host)
  if (host === 'gone') return { kind: 'stop', reason: `dsh pid ${options.state.host.pid} exited` }
  if (host === 'foreign') return { kind: 'stop', reason: `dsh pid ${options.state.host.pid} now runs another command` }
  const idleTimeoutMinutes = options.state.kept === true ? 0 : (options.state.idleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES)
  if (idleTimeoutMinutes === 0) return { kind: 'in-use' }
  const idleMinutes = (options.now - options.lastUsedAt) / 60_000
  if (idleMinutes < idleTimeoutMinutes) return { kind: 'in-use' }
  const idleReason = `idle ${Math.floor(idleMinutes)} min, past its ${idleTimeoutMinutes} min idle timeout`
  const warnMinutes = options.state.warnMinutes ?? DEFAULT_WARN_MINUTES
  if (warnMinutes === 0) return { kind: 'stop', reason: idleReason }
  const warning = ScratchStateRuntime.scratchWarning(options.state, options.now)
  if (warning === undefined) return { kind: 'warn', idleReason, warnMinutes }
  if (warning.minutesLeft > 0) return { kind: 'warned', warning }
  return { kind: 'stop', reason: `${idleReason} and no keep during its ${warnMinutes} min warning grace (warned at ${warning.warnedAt})` }
}

/**
 * Enter the warning phase without stopping: record `warnedAt`, keep the lease where it was, and leave one line in
 * `watchdog.log` so the instance is discoverable from a shell.
 */
const startWarned = async (options: {
  readonly state: ScratchState
  readonly stateDir: string
  readonly lastUsedAt: number
  readonly now: number
  readonly idleReason: string
  readonly warnMinutes: number
}): Promise<WarnedScratch> => {
  const warnedAt = new Date(options.now).toISOString()
  await ScratchStateRuntime.markWarned({ state: options.state, warnedAt, lastUsedAt: options.lastUsedAt })
  const warning: ScratchWarning = {
    warnedAt,
    graceEndsAt: new Date(options.now + options.warnMinutes * 60_000).toISOString(),
    minutesLeft: options.warnMinutes,
  }
  await ScratchStateRuntime.logScratchEvent(
    options.stateDir,
    `warning for "${options.state.name}": ${options.idleReason}; stops in ${options.warnMinutes} min unless kept (dshx dev keep --name ${options.state.name})`,
  )
  return { name: options.state.name, stateDir: options.stateDir, warning }
}

/** Decide and act for the instance recorded in `stateDir`: enter its warning, stop it past the grace, or leave it be. */
const reapIfStale = async (options: { readonly stateDir: string; readonly now: number }): Promise<ReapOutcome> => {
  const state = await ScratchStateRuntime.read(options.stateDir, options.stateDir).catch(() => undefined)
  const lastUsedAt = await ScratchStateRuntime.lastUsedAt(options.stateDir)
  if (state === undefined || lastUsedAt === undefined) return { kind: 'in-use' }
  const verdict = leaseVerdict({ state, lastUsedAt, now: options.now })
  if (verdict.kind === 'in-use') return verdict
  if (verdict.kind === 'warn') {
    const warned = await startWarned({
      state,
      stateDir: options.stateDir,
      lastUsedAt,
      now: options.now,
      idleReason: verdict.idleReason,
      warnMinutes: verdict.warnMinutes,
    })
    return { kind: 'warned', warned }
  }
  if (verdict.kind === 'warned') return { kind: 'warned', warned: { name: state.name, stateDir: state.stateDir, warning: verdict.warning } }
  const result = await scratchDown(state, false)
  return {
    kind: 'stopped',
    stopped: { name: state.name, stateDir: state.stateDir, reason: verdict.reason, actions: result.actions, leftRunning: result.leftRunning },
  }
}

/** Reap every stale instance recorded under the state root, plus `extraStateDirs` (an explicit --state-dir). */
const sweepStaleScratches = async (options: {
  readonly root: string
  readonly extraStateDirs?: readonly string[]
  readonly now?: number
}): Promise<{ readonly reaped: readonly ReapedScratch[]; readonly warned: readonly WarnedScratch[] }> => {
  const entries = await readdir(options.root, { withFileTypes: true }).catch(() => [])
  const stateDirs = new Set([
    ...entries.filter(entry => entry.isDirectory()).map(entry => resolve(join(options.root, entry.name))),
    ...(options.extraStateDirs ?? []).map(stateDir => resolve(stateDir)),
  ])
  const reaped: ReapedScratch[] = []
  const warned: WarnedScratch[] = []
  for (const stateDir of stateDirs) {
    const result = await reapIfStale({ stateDir, now: options.now ?? Date.now() })
    if (result.kind === 'stopped') reaped.push(result.stopped)
    if (result.kind === 'warned') warned.push(result.warned)
  }
  return { reaped, warned }
}

export class ScratchReaperRuntime {
  static readonly reapIfStale = reapIfStale
  static readonly sweepStaleScratches = sweepStaleScratches
}
