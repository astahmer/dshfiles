import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ScratchRegistry, SCRATCH_OWNER_ENV, type ScratchOwner, type ScratchRecordKind } from './registry.js'

/**
 * The built guard next to this module, or — when the E2E harness runs these sources directly — the TypeScript source,
 * which Node 22.18+ runs through type stripping.
 */
interface GuardEntry {
  readonly script: string
  readonly nodeArgs: readonly string[]
}

const parentGuardEntry = (): GuardEntry => {
  const built = fileURLToPath(new URL('./parent-guard.js', import.meta.url))
  if (existsSync(built)) return { script: built, nodeArgs: [] }
  return { script: fileURLToPath(new URL('./parent-guard.ts', import.meta.url)), nodeArgs: ['--no-warnings'] }
}

export interface GuardedCommand {
  readonly command: string
  readonly args: readonly string[]
  readonly owner: ScratchOwner
  /** Hold a pipe the guard watches: its EOF (the spawner died, however) stops the command. */
  readonly pipe: boolean
  /** Write a registry record for the command (scratch Hosts only). */
  readonly recordKind?: ScratchRecordKind
  readonly env: NodeJS.ProcessEnv
}

/**
 * The argv and environment that run `command` under the parent-death guard. Spawn it detached: the guard must lead
 * its own process group, so stopping the recorded pid's group stops the command and everything it started.
 */
export interface GuardedLaunch {
  readonly command: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
}

export const guardedCommand = (options: GuardedCommand): GuardedLaunch => {
  const entry = parentGuardEntry()
  return {
    command: process.execPath,
    args: [
      ...entry.nodeArgs,
      entry.script,
      ...(options.pipe ? ['--pipe'] : []),
      ...(options.recordKind === undefined ? [] : ['--record-kind', options.recordKind, '--record-dir', ScratchRegistry.directory()]),
      '--',
      options.command,
      ...options.args,
    ],
    env: { ...options.env, [SCRATCH_OWNER_ENV]: ScratchRegistry.formatOwner(options.owner) },
  }
}

/**
 * Start a guarded command in its own process group, logging to `log`, and return the guard's pid (the group to stop)
 * with `release`, which hands the command over to its marker owner: the pipe closes without stopping it.
 */
export interface GuardedProcess {
  /** The guard's pid, which leads the process group to stop. */
  readonly pid: number
  readonly release: () => void
}

export const spawnGuardedDetached = (options: GuardedCommand & { readonly cwd: string; readonly log: string }): GuardedProcess => {
  const guarded = guardedCommand(options)
  const output = openSync(options.log, 'a', 0o600)
  try {
    const child = spawn(guarded.command, guarded.args, {
      cwd: options.cwd,
      env: guarded.env,
      detached: true,
      stdio: [options.pipe ? 'pipe' : 'ignore', output, output],
    })
    child.unref()
    if (child.pid === undefined) throw new Error(`${options.command} did not start under the parent guard.`)
    return {
      pid: child.pid,
      release: () => {
        child.stdin?.end('release\n')
      },
    }
  } finally {
    closeSync(output)
  }
}
