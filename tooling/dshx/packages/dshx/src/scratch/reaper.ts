import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { scratchDown, type DownAction } from './lifecycle.js'
import { DEFAULT_IDLE_TIMEOUT_MINUTES, ScratchStateRuntime, type ScratchState } from './state.js'

export interface ReapedScratch {
  readonly name: string
  readonly stateDir: string
  readonly reason: string
  readonly actions: readonly DownAction[]
  readonly leftRunning: readonly number[]
}

/** Why an instance should stop on its own, or undefined while it is alive and in use. */
const staleReason = (options: { readonly state: ScratchState; readonly lastUsedAt: number; readonly now: number }): string | undefined => {
  const host = ScratchStateRuntime.ownedProcessStatus(options.state.host)
  if (host === 'gone') return `dsh pid ${options.state.host.pid} exited`
  if (host === 'foreign') return `dsh pid ${options.state.host.pid} now runs another command`
  const idleTimeoutMinutes = options.state.idleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES
  const idleMinutes = (options.now - options.lastUsedAt) / 60_000
  if (idleTimeoutMinutes > 0 && idleMinutes >= idleTimeoutMinutes) return `idle ${Math.floor(idleMinutes)} min, past its ${idleTimeoutMinutes} min idle timeout`
  return undefined
}

/** Run `down` on the instance recorded in `stateDir` when its lease expired or its dsh process is gone. */
const reapIfStale = async (options: { readonly stateDir: string; readonly now: number }): Promise<ReapedScratch | undefined> => {
  const state = await ScratchStateRuntime.read(options.stateDir, options.stateDir).catch(() => undefined)
  const lastUsedAt = await ScratchStateRuntime.lastUsedAt(options.stateDir)
  if (state === undefined || lastUsedAt === undefined) return undefined
  const reason = staleReason({ state, lastUsedAt, now: options.now })
  if (reason === undefined) return undefined
  const result = await scratchDown(state, false)
  return { name: state.name, stateDir: state.stateDir, reason, actions: result.actions, leftRunning: result.leftRunning }
}

/** Reap every stale instance recorded under the state root, plus `extraStateDirs` (an explicit --state-dir). */
const sweepStaleScratches = async (options: {
  readonly root: string
  readonly extraStateDirs?: readonly string[]
  readonly now?: number
}): Promise<readonly ReapedScratch[]> => {
  const entries = await readdir(options.root, { withFileTypes: true }).catch(() => [])
  const stateDirs = new Set([
    ...entries.filter(entry => entry.isDirectory()).map(entry => resolve(join(options.root, entry.name))),
    ...(options.extraStateDirs ?? []).map(stateDir => resolve(stateDir)),
  ])
  const reaped: ReapedScratch[] = []
  for (const stateDir of stateDirs) {
    const result = await reapIfStale({ stateDir, now: options.now ?? Date.now() })
    if (result !== undefined) reaped.push(result)
  }
  return reaped
}

export class ScratchReaperRuntime {
  static readonly reapIfStale = reapIfStale
  static readonly sweepStaleScratches = sweepStaleScratches
}
