import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { waitForManagedExit } from '@dshfiles/dshx/host'
import { commandAttributes, withSpan } from '@dshfiles/dshx/tracing'

const COMMAND_TIMEOUT_MS = 30_000
const MAX_STDERR_BYTES = 16_000
const MANAGED_EXIT_GRACE_MS = 1_500

export interface JjRunInput {
  readonly path: string
  readonly args: readonly string[]
  readonly signal?: AbortSignal | undefined
  readonly outputLimit?: number | undefined
  readonly timeoutMs?: number | undefined
}

export interface JjRunOutput {
  readonly stdout: string
  readonly truncated: boolean
}

/** `jj` is not installed, or could not be resolved to an executable. */
export class JjUnavailableError extends Error {}

/** `jj` ran and failed; `reason` classifies the failure without carrying its stderr. */
export class JjCommandError extends Error {
  readonly reason: 'not-a-repository' | 'jj-failed'
  constructor(reason: 'not-a-repository' | 'jj-failed') {
    super(reason)
    this.reason = reason
  }
}

export type JjRun = (input: JjRunInput) => Promise<JjRunOutput>

const isMissingRepository = (stderr: string): boolean => /no jj repo|not a jj repository|There is no jj repo/i.test(stderr)

/**
 * Run `jj` with explicit arguments in one working directory, bounded output and
 * cancellation. stderr is read only to classify a failure and never leaves this
 * module: jj prints credential-bearing remote URLs there.
 */
export const createJjRun = (ctx: { readonly subprocess: Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'> }): JjRun => {
  let executable: Promise<string> | undefined
  const resolveExecutable = (signal: AbortSignal): Promise<string> => {
    executable ??= ctx.subprocess.resolveExecutable('jj', undefined, signal).catch(() => {
      executable = undefined
      throw new JjUnavailableError('jj could not be resolved on PATH.')
    })
    return executable
  }

  const run: JjRun = async input => {
    const controller = new AbortController()
    const forwardAbort = (): void => controller.abort()
    if (input.signal?.aborted === true) controller.abort()
    else input.signal?.addEventListener('abort', forwardAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? COMMAND_TIMEOUT_MS)

    let handle: ReturnType<SubprocessRuntime['spawn']> | undefined
    try {
      const binary = await resolveExecutable(controller.signal)
      handle = ctx.subprocess.spawn({
        argv: [binary, '--color=never', '--no-pager', ...input.args],
        cwd: input.path,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: input.outputLimit ?? 1_200_000 },
          stderr: { maxBytes: MAX_STDERR_BYTES },
        },
        graceMs: MANAGED_EXIT_GRACE_MS,
        signal: controller.signal,
      })
      const outcome = await handle.done
      if (controller.signal.aborted) {
        handle.terminate()
        throw new Error(input.signal?.aborted === true ? 'Jujutsu request was cancelled.' : 'Jujutsu command timed out.')
      }
      if (!(await waitForManagedExit({ handle, timeoutMs: input.timeoutMs ?? COMMAND_TIMEOUT_MS, signal: controller.signal }))) {
        handle.terminate()
        throw new Error('Jujutsu process group did not exit.')
      }
      const stdout = handle.collected.stdout?.readFrom(0)
      if (stdout === undefined) throw new Error('Jujutsu output stream was unavailable.')
      if (outcome.exitCode !== 0) {
        const stderr = handle.collected.stderr?.readFrom(0)?.text ?? ''
        throw new JjCommandError(isMissingRepository(stderr) ? 'not-a-repository' : 'jj-failed')
      }
      return { stdout: stdout.text, truncated: stdout.lossy }
    } catch (error) {
      handle?.terminate()
      throw error
    } finally {
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', forwardAbort)
    }
  }
  return input => {
    const attributes = commandAttributes({ executable: 'jj', args: input.args, valueFlags: ['-r', '--revisions', '-T', '--template', '--from', '--to', '-R'] })
    return withSpan(`jj ${String(attributes['process.command.verb'])}`.trim(), { kind: 'client', attributes }, async span => {
      const output = await run(input)
      span.setAttribute('jj.output.truncated', output.truncated)
      return output
    })
  }
}
