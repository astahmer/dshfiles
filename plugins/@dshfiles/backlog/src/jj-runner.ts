import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { commandAttributes, withSpan } from '@dshfiles/dshx/tracing'

/** Read-only and bounded: `--ignore-working-copy` never snapshots anyone's checkout. One `jj <subcommand>` span per run. */
export const runReadOnlyJj = (input: {
  readonly subprocess: Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'>
  readonly cwd: string
  readonly args: readonly string[]
}): Promise<string> => {
  const attributes = commandAttributes({ executable: 'jj', args: input.args, valueFlags: ['-r', '-T'] })
  return withSpan(`jj ${String(attributes['process.command.verb'])}`.trim(), { kind: 'client', attributes }, async span => {
    const binary = await input.subprocess.resolveExecutable('jj', undefined, AbortSignal.timeout(5_000))
    const handle = input.subprocess.spawn({
      argv: [binary, '--color=never', '--no-pager', '--ignore-working-copy', ...input.args],
      cwd: input.cwd,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 400_000 }, stderr: { maxBytes: 4_000 } },
      graceMs: 1_500,
      signal: AbortSignal.timeout(20_000),
    })
    const outcome = await handle.done
    span.setAttribute('process.exit.code', outcome.exitCode ?? -1)
    if (outcome.exitCode !== 0) throw new Error(`jj exited ${String(outcome.exitCode)} in ${input.cwd}`)
    return handle.collected.stdout?.readFrom(0)?.text ?? ''
  })
}
