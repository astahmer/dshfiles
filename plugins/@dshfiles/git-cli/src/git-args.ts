/** git flags whose next argument is a value (a path, a config entry, a message, a format) and must stay out of spans and errors. */
const GIT_VALUE_FLAGS: readonly string[] = ['-c', '-C', '-b', '-B', '-m', '--message', '--format', '--pretty', '--max-count', '--git-dir', '--work-tree']

const SUBCOMMAND = /^[a-z][a-z0-9-]{0,31}$/u
const MAX_FLAGS = 32
const REDACTED_VALUE = '<redacted>'

const flagName = (argument: string): string => (argument.startsWith('--') ? (argument.split('=', 1)[0] ?? argument) : argument.slice(0, 2))

/**
 * Bounded, value-free attributes for one git run, the same shape `@dshfiles/jj-cli` records for jj: up to two leading
 * subcommand words (`worktree list`) and flag names. Positional arguments and flag values are never recorded.
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
      if (flag === argument && GIT_VALUE_FLAGS.includes(flag)) index += 1
      if (verbs.length > 0) verbPhase = false
      continue
    }
    if (verbPhase && verbs.length < 2 && SUBCOMMAND.test(argument)) verbs.push(argument)
    else verbPhase = false
  }
  return {
    'process.executable.name': 'git',
    'process.command.verb': verbs.join(' '),
    'process.command.flags': [...flags],
    'process.command.arg_count': args.length,
  }
}

/** The first subcommand word: `git rev-parse`, `git worktree`; a span name never carries a positional value. */
const verb = (args: readonly string[]): string => attributes(args)['process.command.verb'].split(' ')[0] ?? ''

const spanName = (args: readonly string[]): string => `git ${verb(args)}`.trim()

/** The arguments with every value-flag value replaced, so a message, format or config value never reaches an error. */
const redact = (args: readonly string[]): readonly string[] => {
  const redacted: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? ''
    const flag = flagName(argument)
    const takesValue = argument.startsWith('-') && GIT_VALUE_FLAGS.includes(flag)
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

/** Value-free views of git arguments for spans and errors. */
export class GitArgs {
  static readonly attributes = attributes
  static readonly verb = verb
  static readonly spanName = spanName
  static readonly redact = redact
}
