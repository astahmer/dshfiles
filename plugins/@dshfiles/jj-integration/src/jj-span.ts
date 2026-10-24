import { commandAttributes, tracingEnabled, withSpan } from '@dshfiles/dshx/tracing'
import type { JjExecutor } from './threads.js'

/** jj flags whose next argument is a value (a path, an operation id, a template) and must stay out of span attributes. */
const JJ_VALUE_FLAGS = [
  '-R',
  '--repository',
  '--at-operation',
  '--at-op',
  '--config',
  '--config-toml',
  '--config-file',
  '-T',
  '--template',
  '-r',
  '--revisions',
  '-m',
  '--message',
]

/** Wrap a jj executor so every run is one `jj <subcommand>` client span with its exit code; arguments stay out. */
export const traceJjExecutor =
  (execute: JjExecutor): JjExecutor =>
  input => {
    if (!tracingEnabled()) return execute(input)
    const attributes = commandAttributes({ executable: 'jj', args: input.args, valueFlags: JJ_VALUE_FLAGS })
    return withSpan(`jj ${String(attributes['process.command.verb'])}`.trim(), { kind: 'client', attributes }, async span => {
      const result = await execute(input)
      span.setAttributes({ 'process.exit.code': result.exitCode, 'jj.output.truncated': result.stdoutLossy })
      if (result.exitCode !== 0) span.setStatus('error', `exit ${String(result.exitCode)}`)
      return result
    })
  }
