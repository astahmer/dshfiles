import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { waitForManagedExit } from '@dshfiles/dshx/host'
import { redactIdentifier, withSpan } from '@dshfiles/dshx/tracing'
import { basename, isAbsolute } from 'node:path'

type ProcessFailure = 'spawn-failed' | 'process-group-failed' | 'cancelled' | 'timed-out'

export interface ProcessResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly failure: ProcessFailure | null
}

interface ManagedProcessRequest {
  readonly subprocess: Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'>
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly timeoutMs: number
  readonly signal: AbortSignal | undefined
}

/** One `project-checks run` span per managed process: executable name, argument count, exit code and failure kind only. */
export const runManagedProcess = (request: ManagedProcessRequest): Promise<ProcessResult> =>
  withSpan(
    'project-checks run',
    {
      kind: 'client',
      attributes: { 'process.executable.name': redactIdentifier(basename(request.command)), 'dshx.project-checks.argument_count': request.args.length },
    },
    async span => {
      const result = await runUntracedProcess(request)
      span.setAttributes({ 'process.exit.code': result.exitCode ?? undefined, 'dshx.project-checks.failure': result.failure ?? undefined })
      if (result.failure !== null || result.exitCode !== 0) span.setStatus('error', result.failure ?? 'exit')
      return result
    },
  )

const runUntracedProcess = async ({ subprocess, command, args, cwd, timeoutMs, signal }: ManagedProcessRequest): Promise<ProcessResult> => {
  const controller = new AbortController()
  let timedOut = false
  let managedExit = false
  let handle: ReturnType<ManagedProcessRequest['subprocess']['spawn']> | undefined
  const abortFromCaller = (): void => controller.abort(signal?.reason)
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('Project action timed out.'))
  }, timeoutMs)

  signal?.addEventListener('abort', abortFromCaller, { once: true })
  if (signal?.aborted === true) abortFromCaller()

  const stopAndConfirm = async (failure: 'cancelled' | 'timed-out'): Promise<ProcessResult> => {
    if (handle === undefined) return { exitCode: null, stdout: '', stderr: '', failure }
    handle.terminate()
    managedExit = await waitForManagedExit({ handle, timeoutMs: 10_000 }).catch(() => false)
    return managedExit ? { exitCode: null, stdout: '', stderr: '', failure } : { exitCode: null, stdout: '', stderr: '', failure: 'process-group-failed' }
  }

  try {
    if (controller.signal.aborted) return { exitCode: null, stdout: '', stderr: '', failure: 'cancelled' }
    const executable = await subprocess.resolveExecutable(command, undefined, controller.signal)
    if (!isAbsolute(executable) || executable.includes('\0')) return { exitCode: null, stdout: '', stderr: '', failure: 'spawn-failed' }

    handle = subprocess.spawn({
      argv: [executable, ...args],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 16_384 },
        stderr: { maxBytes: 4_096 },
      },
      graceMs: 1_000,
      signal: controller.signal,
    })
    const outcome = await handle.done
    if (controller.signal.aborted) return stopAndConfirm(timedOut ? 'timed-out' : 'cancelled')

    managedExit = await waitForManagedExit({ handle, timeoutMs, signal: controller.signal })
    if (!managedExit) {
      handle.terminate()
      return { exitCode: outcome.exitCode, stdout: '', stderr: '', failure: 'process-group-failed' }
    }

    const stdout = handle.collected.stdout?.readFrom(0)
    const stderr = handle.collected.stderr?.readFrom(0)
    return { exitCode: outcome.exitCode, stdout: stdout?.text ?? '', stderr: stderr?.text ?? '', failure: null }
  } catch {
    if (controller.signal.aborted) return stopAndConfirm(timedOut ? 'timed-out' : 'cancelled')
    return { exitCode: null, stdout: '', stderr: '', failure: 'spawn-failed' }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abortFromCaller)
    if (handle !== undefined && !managedExit) {
      handle.terminate()
      await waitForManagedExit({ handle, timeoutMs: 10_000 }).catch(() => false)
    }
  }
}
