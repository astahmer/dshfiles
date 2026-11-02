/** jj flags whose next argument is a value (a path, an operation id, a template) and must stay out of spans and errors. */
const JJ_VALUE_FLAGS: readonly string[] = [
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

const SUBCOMMAND = /^[a-z][a-z0-9-]{0,31}$/u
const MAX_FLAGS = 32
const REDACTED_VALUE = '<redacted>'

const flagName = (argument: string): string => (argument.startsWith('--') ? (argument.split('=', 1)[0] ?? argument) : argument.slice(0, 2))

/**
 * Bounded, value-free attributes for one jj run, identical to the dshx `commandAttributes` helper the Promise runners
 * use: up to two leading subcommand words (`workspace list`) and flag names. Positional arguments and flag values are
 * never recorded.
 */
const attributes = (args: readonly string[]) => {
  const verbs: string[] = []
  const flags = new Set<string>()
  let verbPhase = true
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? ''
    if (argument.startsWith('-')) {
      const flag = flagName(argument)
      if (flags.size < MAX_FLAGS) flags.add(flag.slice(0, 64))
      if (flag === argument && JJ_VALUE_FLAGS.includes(flag)) index += 1
      if (verbs.length > 0) verbPhase = false
      continue
    }
    if (verbPhase && verbs.length < 2 && SUBCOMMAND.test(argument)) verbs.push(argument)
    else verbPhase = false
  }
  return {
    'process.executable.name': 'jj',
    'process.command.verb': verbs.join(' '),
    'process.command.flags': [...flags],
    'process.command.arg_count': args.length,
  }
}

const verb = (args: readonly string[]): string => attributes(args)['process.command.verb']

const spanName = (args: readonly string[]): string => `jj ${verb(args)}`.trim()

/** The arguments with every value-flag value replaced, so a message, template or config value never reaches an error. */
const redact = (args: readonly string[]): readonly string[] => {
  const redacted: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? ''
    const flag = flagName(argument)
    const takesValue = argument.startsWith('-') && JJ_VALUE_FLAGS.includes(flag)
    if (takesValue && flag !== argument) {
      redacted.push(`${flag}=${REDACTED_VALUE}`)
      continue
    }
    redacted.push(argument)
    if (takesValue && index + 1 < args.length) {
      redacted.push(REDACTED_VALUE)
      index += 1
    }
  }
  return redacted
}

/** Value-free views of jj arguments for spans and errors. */
export class JjArgs {
  static readonly attributes = attributes
  static readonly verb = verb
  static readonly spanName = spanName
  static readonly redact = redact
}
