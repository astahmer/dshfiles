import { spawn } from 'node:child_process'
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
}

const DEFAULT_TIMEOUT_MS = 60_000

/** Lines that mean the plugin did not load, as opposed to ordinary boot chatter. */
const failureMarkers = ['failed to import', 'Failed plugins', 'Cannot find module', 'ERR_MODULE_NOT_FOUND', 'is not a function', 'Cannot read properties of']

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
  })

  const collect = (chunk: Buffer): void => {
    output += chunk.toString('utf8')
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)

  const url = await new Promise<string | undefined>(resolve => {
    const timer = setInterval(() => {
      const match = /http:\/\/127\.0\.0\.1:\d+\/\S*/.exec(output)
      if (match?.[0] !== undefined) {
        clearInterval(timer)
        resolve(match[0])
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
  const settled = Date.now() - startedAt > 2000 ? 0 : 2000
  if (settled > 0) await new Promise(resolve => setTimeout(resolve, settled))

  child.kill('SIGTERM')
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 3000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
  await rm(profileRoot, { recursive: true, force: true })

  const failures = output
    .split('\n')
    .map(line => line.trim())
    .filter(line => failureMarkers.some(marker => line.includes(marker)))

  const timedOut = url === undefined
  return {
    ok: !timedOut && failures.length === 0,
    failures,
    timedOut,
    ...(url === undefined ? {} : { url }),
  }
}
