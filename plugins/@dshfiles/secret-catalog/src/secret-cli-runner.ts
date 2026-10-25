import { waitForManagedExit, terminateManagedProcess } from '@dshfiles/dshx/host'
import { commandAttributes, tracingEnabled, withSpan } from '@dshfiles/dshx/tracing'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { homedir } from 'node:os'
import { isAbsolute } from 'node:path'
import type { SecretCliRequest } from './secret-operations.js'

const MAX_STDOUT_BYTES = 1_000_000
const COMMAND_TIMEOUT_MS = 15_000
const RANGE_WAIT_MS = 5_000

export type SecretCliFailureCode = 'cli-missing' | 'cli-timeout' | 'cli-failed'

const failureMessages = {
  'cli-missing': 'Secret CLI executable could not be found on the Host PATH.',
  'cli-timeout': 'Secret CLI command timed out.',
  'cli-failed': 'Secret CLI command failed.',
} as const satisfies Record<SecretCliFailureCode, string>

/** A CLI failure with a stable code, so callers can say what went wrong without parsing message text. */
export class SecretCliError extends Error {
  readonly code: SecretCliFailureCode
  constructor(code: SecretCliFailureCode, cleanupConfirmed = true) {
    super(cleanupConfirmed ? failureMessages[code] : `${failureMessages[code]} Process cleanup could not be confirmed.`)
    this.name = 'SecretCliError'
    this.code = code
  }
}

type SecretSubprocess = Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'>
type SecretSessionEnvironment = Partial<Pick<NodeJS.ProcessEnv, 'BW_SESSION' | 'SECRET_SESSION_FILE'>>

const sessionEnvironment = (source: SecretSessionEnvironment): Record<string, string> => {
  const result: Record<string, string> = {}
  if (source.BW_SESSION !== undefined && source.BW_SESSION.length > 0) result.BW_SESSION = source.BW_SESSION
  if (source.SECRET_SESSION_FILE !== undefined && source.SECRET_SESSION_FILE.length > 0) result.SECRET_SESSION_FILE = source.SECRET_SESSION_FILE
  return result
}

/** Run the fixed secret CLI through DSH's managed process boundary. */
export const runSecretCli = (runtime: SecretSubprocess, request: SecretCliRequest, environment: SecretSessionEnvironment = process.env): Promise<string> => {
  if (!tracingEnabled()) return runUntracedSecretCli(runtime, request, environment)
  const attributes = { ...commandAttributes({ executable: 'secret', args: request.args }), 'process.command.verb': request.args[0] ?? '' }
  return withSpan(`secret ${attributes['process.command.verb']}`.trim(), { kind: 'client', attributes }, () =>
    runUntracedSecretCli(runtime, request, environment),
  )
}

const runUntracedSecretCli = async (runtime: SecretSubprocess, request: SecretCliRequest, environment: SecretSessionEnvironment): Promise<string> => {
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, COMMAND_TIMEOUT_MS)
  let handle: SubprocessHandle | undefined
  let resolved = false
  try {
    const env = sessionEnvironment(environment)
    const executable = await runtime.resolveExecutable('secret', env, controller.signal)
    if (!isAbsolute(executable) || executable.includes('\0')) throw new Error('Secret CLI executable could not be resolved.')
    resolved = true
    handle = runtime.spawn({
      argv: [executable, ...request.args],
      cwd: request.cwd ?? homedir(),
      env,
      stdio: {
        stdin: request.stdin === undefined ? 'ignore' : 'pipe',
        stdout: request.captureStdout ? { maxBytes: MAX_STDOUT_BYTES } : 'pipe',
        stderr: 'pipe',
      },
      graceMs: 1_000,
      signal: controller.signal,
    })
    // Raw pipes are never retained by the provider. Drain unwanted output without even a one-byte diagnostic tail.
    if (handle.stderr === undefined || (!request.captureStdout && handle.stdout === undefined)) throw new Error('Secret CLI output pipes were unavailable.')
    handle.stderr.on('error', () => controller.abort()).resume()
    if (!request.captureStdout) handle.stdout?.on('error', () => controller.abort()).resume()
    if (request.stdin !== undefined) {
      if (handle.stdin === undefined) throw new Error('Secret CLI stdin was unavailable.')
      // Keep listening after EPIPE: another stream error must not crash the Host or turn a failed write into success.
      handle.stdin.on('error', () => controller.abort())
      handle.stdin.end(request.stdin)
    }
    const outcome = await handle.done
    if (controller.signal.aborted) throw new Error('Secret CLI command deadline elapsed.')
    if (!(await waitForManagedExit({ handle, timeoutMs: RANGE_WAIT_MS }))) throw new Error('Secret CLI process range did not exit.')
    if (controller.signal.aborted) throw new Error('Secret CLI command was cancelled while awaiting its process range.')
    if (outcome.exitCode !== 0) throw new Error('Secret CLI command returned a failure status.')
    if (!request.captureStdout) return ''
    const output = handle.collected.stdout?.readFrom(0)
    if (output === undefined || output.lossy) throw new Error('Secret CLI response exceeded the safe size limit.')
    return output.text
  } catch {
    let cleanupConfirmed = true
    if (handle !== undefined) {
      try {
        cleanupConfirmed = await terminateManagedProcess({ handle, timeoutMs: RANGE_WAIT_MS })
      } catch {
        cleanupConfirmed = false
      }
    }
    throw new SecretCliError(timedOut ? 'cli-timeout' : resolved ? 'cli-failed' : 'cli-missing', cleanupConfirmed)
  } finally {
    clearTimeout(timeout)
  }
}
