import type { ChildProcess } from 'node:child_process'
import { spawnOwnedProcess, stopOwnedProcess } from './owned-process.js'
import { compositionFailures, readProfileComposition } from './profile-composition.js'

export interface BootCheckOptions {
  readonly projectRoot: string
  readonly profile: string
  readonly port: number
  readonly executable?: string
  readonly timeoutMs?: number
  readonly dshHome: string
  readonly profileRoot: string
  readonly expectedBundles: readonly [string, ...string[]]
}

export interface BootCheckResult {
  readonly ok: boolean
  readonly failures: readonly string[]
  /** Public origin only; the tokenized route is never returned. */
  readonly url?: string
  readonly timedOut: boolean
  readonly compositionFailures: readonly string[]
  readonly unsupportedNode: boolean
  readonly processError?: string
}

const DEFAULT_TIMEOUT_MS = 60_000
const UNSUPPORTED_NODE_MARKER = 'node-addon-require-builtin unsupported'
const FAILURE_MARKERS = ['failed to import', 'Failed plugins', 'Cannot find module', 'ERR_MODULE_NOT_FOUND', 'is not a function', 'Cannot read properties of']

const waitForHostUrl = (child: ChildProcess, output: () => string, startedAt: number, timeoutMs: number) =>
  new Promise<{ readonly url?: string; readonly processError?: string }>(resolve => {
    let settled = false
    const finish = (value: { readonly url?: string; readonly processError?: string }): void => {
      if (settled) return
      settled = true
      clearInterval(timer)
      child.off('error', handleError)
      child.off('close', handleClose)
      resolve(value)
    }
    const handleError = (error: Error): void => finish({ processError: `The Host process failed: ${error.message}` })
    const handleClose = (code: number | null): void => finish({ processError: `The Host exited with code ${String(code)} before announcing readiness.` })
    const timer = setInterval(() => {
      const match = /http:\/\/127\.0\.0\.1:\d+\/\S*/.exec(output())
      if (match?.[0] !== undefined) {
        finish({ url: match[0] })
        return
      }
      if (Date.now() - startedAt > timeoutMs) finish({})
    }, 250)
    child.once('error', handleError)
    child.once('close', handleClose)
  })

export const checkPluginBoot = async (options: BootCheckOptions): Promise<BootCheckResult> => {
  const executable = options.executable ?? 'dsh'
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let output = ''
  let launchUrl: string | undefined
  let processError: string | undefined
  let expectedBundleFailures: readonly string[] = []
  let child: ChildProcess | undefined

  try {
    const dump = await readProfileComposition({
      projectRoot: options.projectRoot,
      profile: options.profile,
      profileRoot: options.profileRoot,
      dshHome: options.dshHome,
      executable,
      timeoutMs,
    })
    expectedBundleFailures = compositionFailures(dump, options.expectedBundles)
    if (expectedBundleFailures.length === 0) {
      const startedAt = Date.now()
      child = spawnOwnedProcess(executable, ['--profile', options.profile, '--port', String(options.port), '--no-open'], {
        cwd: options.projectRoot,
        env: { ...process.env, DSH_HOME: options.dshHome, DSHX_BOOT_PROFILE_ROOT: options.profileRoot },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const collect = (chunk: Buffer): void => {
        output += chunk.toString('utf8')
      }
      child.stdout?.on('data', collect)
      child.stderr?.on('data', collect)
      const readiness = await waitForHostUrl(child, () => output, startedAt, timeoutMs)
      launchUrl = readiness.url
      processError = readiness.processError
      if (launchUrl !== undefined) await new Promise(resolve => setTimeout(resolve, Math.max(0, 2_000 - (Date.now() - startedAt))))
    }
  } catch (error) {
    processError = error instanceof Error ? error.message : String(error)
  } finally {
    try {
      if (child !== undefined) await stopOwnedProcess(child)
    } catch (error) {
      processError ??= `Could not stop the check-owned Host: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  const failures = output
    .split('\n')
    .map(line => line.trim())
    .filter(line => FAILURE_MARKERS.some(marker => line.includes(marker)))
  const timedOut = launchUrl === undefined && processError === undefined && expectedBundleFailures.length === 0
  const unsupportedNode = output.includes(UNSUPPORTED_NODE_MARKER) || (processError?.includes(UNSUPPORTED_NODE_MARKER) ?? false)
  return {
    ok: !timedOut && !unsupportedNode && processError === undefined && expectedBundleFailures.length === 0 && failures.length === 0,
    failures,
    timedOut,
    unsupportedNode,
    compositionFailures: expectedBundleFailures,
    ...(processError === undefined ? {} : { processError }),
    ...(launchUrl === undefined ? {} : { url: new URL(launchUrl).origin }),
  }
}
