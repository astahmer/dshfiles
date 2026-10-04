import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { homedir } from 'node:os'
import { isAbsolute } from 'node:path'
import type { SecretCliRequest } from './secret-operations.js'

const MAX_STDOUT_BYTES = 1_000_000
const COMMAND_TIMEOUT_MS = 15_000
const RANGE_WAIT_MS = 5_000

type SecretSubprocess = Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'>
type SecretSessionEnvironment = Partial<Pick<NodeJS.ProcessEnv, 'BW_SESSION' | 'SECRET_SESSION_FILE'>>

const sessionEnvironment = (source: SecretSessionEnvironment): Record<string, string> => {
  const result: Record<string, string> = {}
  if (source.BW_SESSION !== undefined && source.BW_SESSION.length > 0) result.BW_SESSION = source.BW_SESSION
  if (source.SECRET_SESSION_FILE !== undefined && source.SECRET_SESSION_FILE.length > 0) result.SECRET_SESSION_FILE = source.SECRET_SESSION_FILE
  return result
}

const waitForRange = async (handle: SubprocessHandle): Promise<boolean> => {
  try {
    return await handle.waitForExit(AbortSignal.timeout(RANGE_WAIT_MS))
  } catch {
    return false
  }
}

/** Run the fixed secret CLI through DSH's managed process boundary. */
export const runSecretCli = async (
  runtime: SecretSubprocess,
  request: SecretCliRequest,
  environment: SecretSessionEnvironment = process.env,
): Promise<string> => {
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, COMMAND_TIMEOUT_MS)
  let handle: SubprocessHandle | undefined
  try {
    const env = sessionEnvironment(environment)
    const executable = await runtime.resolveExecutable('secret', env, controller.signal)
    if (!isAbsolute(executable) || executable.includes('\0')) throw new Error('Secret CLI executable could not be resolved.')
    handle = runtime.spawn({
      argv: [executable, ...request.args],
      cwd: request.cwd ?? homedir(),
      env,
      stdio: {
        stdin: request.stdin === undefined ? 'ignore' : 'pipe',
        stdout: { maxBytes: request.captureStdout ? MAX_STDOUT_BYTES : 1 },
        stderr: { maxBytes: 1 },
      },
      graceMs: 1_000,
      signal: controller.signal,
    })
    if (request.stdin !== undefined) {
      if (handle.stdin === undefined) throw new Error('Secret CLI stdin was unavailable.')
      handle.stdin.end(request.stdin)
    }
    const outcome = await handle.done
    if (controller.signal.aborted) throw new Error('Secret CLI command deadline elapsed.')
    if (!(await waitForRange(handle))) throw new Error('Secret CLI process range did not exit.')
    if (outcome.exitCode !== 0) throw new Error('Secret CLI command returned a failure status.')
    if (!request.captureStdout) return ''
    const output = handle.collected.stdout?.readFrom(0)
    if (output === undefined || output.lossy) throw new Error('Secret CLI response exceeded the safe size limit.')
    return output.text
  } catch {
    if (handle !== undefined) {
      handle.terminate()
      await waitForRange(handle)
    }
    throw new Error(timedOut ? 'Secret CLI command timed out.' : 'Secret CLI command failed.')
  } finally {
    clearTimeout(timeout)
  }
}
