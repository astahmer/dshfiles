import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Boot verification.
 *
 * Several failures are invisible to every other check: the build succeeds,
 * typecheck passes, and the plugin then fails when the Host loads it. A
 * Host-provided package resolved from the wrong tree, a bad entry export, a
 * module that throws at import — none of those reach the build.
 *
 * The only honest test is a real boot in a throwaway profile, so that is what this
 * does: it asks the installed `dsh` to start with only this plugin, on a port
 * nothing else holds, and reports what it printed. The profile is disposable and
 * removed afterwards, because the point is to prove the plugin loads without
 * anything else masking the failure.
 */

export interface BootCheckOptions {
  /** Directory holding the plugin source and package. */
  readonly projectRoot: string
  /** Profile name used for the throwaway boot. */
  readonly profile: string
  /** Port for the disposable Host; it must be free. */
  readonly port: number
  /** DSH executable, resolved from PATH by default. */
  readonly executable?: string
  readonly timeoutMs?: number
}

export interface BootCheckResult {
  /** Whether the Host started and served its page without an import failure. */
  readonly ok: boolean
  /** Lines mentioning a failed load, an error, or a thrown exception. */
  readonly failures: readonly string[]
  /** First URL the Host announced, when it started. */
  readonly url?: string
  readonly timedOut: boolean
  /** The Host died on a Node build its native loader cannot probe (for example Nix's nodejs). */
  readonly unsupportedNode: boolean
}

const DEFAULT_TIMEOUT_MS = 60_000

/** Lines that mean the plugin did not load, as opposed to ordinary boot chatter. */
const failureMarkers = ['failed to import', 'Failed plugins', 'Cannot find module', 'ERR_MODULE_NOT_FOUND', 'is not a function', 'Cannot read properties of']

const announcedUrlPattern = /http:\/\/127\.0\.0\.1:\d+\/\S*/
const inactiveSummaryPattern = /did not activate$/
/** One `<id> (<package>): <detail>` row the Host prints under its inactive-entry summary. */
const inactiveEntryPattern = /^\S+ \(\S+\): \S.*$/

const unsupportedNodeMarker = 'node-addon-require-builtin unsupported'

export const detectUnsupportedNode = ({ output }: { readonly output: string }): boolean => output.includes(unsupportedNodeMarker)

const signalProcessGroup = ({ child, signal }: { readonly child: ChildProcess; readonly signal: NodeJS.Signals | 0 }): boolean => {
  if (child.pid === undefined) return false
  try {
    process.kill(-child.pid, signal)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
}

/**
 * `dsh` is a pnpm shell shim that does not forward signals to the node process
 * it starts, so killing the shim alone leaves the Host holding its port. The
 * child is spawned as a process-group leader and the whole group is stopped,
 * even when the shim itself already exited.
 */
export const stopProcessGroup = async ({ child, graceMs }: { readonly child: ChildProcess; readonly graceMs: number }): Promise<void> => {
  if (!signalProcessGroup({ child, signal: 'SIGTERM' })) return
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100))
    if (!signalProcessGroup({ child, signal: 0 })) return
  }
  signalProcessGroup({ child, signal: 'SIGKILL' })
}

export const findAnnouncedUrl = ({ output }: { readonly output: string }): string | undefined => announcedUrlPattern.exec(output)?.[0]

/**
 * The Host reports inactive entries as a summary line followed by one row per
 * entry, and a pending row carries no failure marker, so rows are kept by
 * position under the summary rather than by content.
 */
export const parseBootFailures = ({ output }: { readonly output: string }): readonly string[] => {
  const failures: string[] = []
  let underInactiveSummary = false
  for (const line of output.split('\n').map(raw => raw.trim())) {
    if (inactiveSummaryPattern.test(line)) {
      failures.push(line)
      underInactiveSummary = true
      continue
    }
    if (underInactiveSummary && inactiveEntryPattern.test(line)) {
      failures.push(line)
      continue
    }
    underInactiveSummary = false
    if (failureMarkers.some(marker => line.includes(marker))) failures.push(line)
  }
  return failures
}

export const checkPluginBoot = async (options: BootCheckOptions): Promise<BootCheckResult> => {
  const executable = options.executable ?? 'dsh'
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const profileRoot = await mkdtemp(join(tmpdir(), 'dshx-boot-'))
  let output = ''
  const startedAt = Date.now()

  const child = spawn(executable, ['--profile', options.profile, '--port', String(options.port), '--no-open'], {
    cwd: options.projectRoot,
    env: { ...process.env, DSHX_BOOT_PROFILE_ROOT: profileRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  const collect = (chunk: Buffer): void => {
    output += chunk.toString('utf8')
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)

  const url = await new Promise<string | undefined>(resolve => {
    const timer = setInterval(() => {
      const announced = findAnnouncedUrl({ output })
      if (announced !== undefined) {
        clearInterval(timer)
        resolve(announced)
      }
      // Stop watching once the window has passed with no announcement.
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer)
        resolve(undefined)
      }
    }, 250)
    child.once('exit', () => {
      clearInterval(timer)
      resolve(undefined)
    })
  })

  // Give a started Host a moment to surface a later load failure.
  const hasExited = (): boolean => child.exitCode !== null || child.signalCode !== null
  const settled = hasExited() || Date.now() - startedAt > 2000 ? 0 : 2000
  if (settled > 0) await new Promise(resolve => setTimeout(resolve, settled))

  await stopProcessGroup({ child, graceMs: 3000 })
  await rm(profileRoot, { recursive: true, force: true })

  const failures = parseBootFailures({ output })

  const timedOut = url === undefined
  const unsupportedNode = detectUnsupportedNode({ output })
  return {
    ok: !timedOut && !unsupportedNode && failures.length === 0,
    failures,
    timedOut,
    unsupportedNode,
    ...(url === undefined ? {} : { url }),
  }
}
