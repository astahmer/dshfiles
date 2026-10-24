import { commandAttributes, tracingEnabled, withSpan } from '@dshfiles/dshx/tracing'

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

/** One `jj <subcommand>` client span around a jj run: flag names and argument count only, plus whether output was cut. */
export const withJjSpan = <Result extends { readonly truncated: boolean }>(input: {
  readonly args: readonly string[]
  readonly run: () => Promise<Result>
}): Promise<Result> => {
  if (!tracingEnabled()) return input.run()
  const attributes = commandAttributes({ executable: 'jj', args: input.args, valueFlags: JJ_VALUE_FLAGS })
  return withSpan(`jj ${String(attributes['process.command.verb'])}`.trim(), { kind: 'client', attributes }, async span => {
    const result = await input.run()
    span.setAttribute('jj.output.truncated', result.truncated)
    return result
  })
}
