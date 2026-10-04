/**
 * Decide which bash commands may join a parallel group.
 *
 * The verdict is not a purity proof. It is an OPTIMISM flag: commands marked
 * parallel still run confined, so a wrong `true` surfaces as a denied write the
 * model can retry, never as silent corruption. Anything we cannot confidently
 * call a read is exclusive.
 */

/** Verbs that only read, under every flag we have audited. */
const READ_ONLY_VERBS = new Set([
  'cat', 'echo', 'printf', 'grep', 'egrep', 'fgrep', 'head', 'tail', 'wc',
  'ls', 'dir', 'find', 'fd', 'stat', 'du', 'df', 'file', 'diff', 'tree',
  'sort', 'uniq', 'cut', 'tr', 'sed', 'awk', 'jq', 'yq', 'comm', 'join',
  'paste', 'column', 'nl', 'fold', 'fmt', 'basename', 'dirname', 'realpath',
  'readlink', 'which', 'type', 'md5sum', 'shasum', 'sha256sum', 'cksum',
  'seq', 'date', 'env', 'printenv', 'pwd', 'whoami', 'id', 'uname', 'hostname',
  'uptime', 'ps', 'pgrep', 'strings', 'xxd', 'od', 'hexdump', 'cmp', 'sleep',
  'ast-outline', 'node', 'tsc', 'oxlint', 'oxfmt', 'lsof',
])

/**
 * A change to the shell's own working directory is a process-local effect: each
 * parallel command runs in its own shell, so `cd` cannot leak between them.
 */
const LOCAL_ONLY_VERBS = new Set(['cd', 'pushd', 'popd', 'set', 'shopt', 'export', 'unset'])

/**
 * Verbs with mutating subcommands, so membership alone is not enough. A verb
 * appears here only when some subcommand writes.
 *
 * Every `jj` subcommand snapshots the working copy first, which records an
 * operation, so a bare `jj` is never parallel-safe. `--ignore-working-copy`
 * selects the read-only form.
 */
const VERB_SUBCOMMAND_ALLOWLIST = new Map<string, ReadonlySet<string>>([
  ['git', new Set([
    'status', 'log', 'show', 'diff', 'blame', 'branch', 'tag', 'remote', 'config',
    'rev-parse', 'rev-list', 'ls-files', 'ls-tree', 'ls-remote', 'describe',
    'cat-file', 'shortlog', 'reflog', 'symbolic-ref', 'for-each-ref',
    'count-objects', 'verify-commit', 'whatchanged', 'grep', 'help', 'version',
  ])],
  ['jj', new Set([
    'status', 'log', 'diff', 'show', 'file', 'root', 'bookmarks', 'op', 'oplog',
    'util', 'evolog', 'config', 'version', 'help',
  ])],
])

/**
 * Flags that turn an allowlisted verb into a writer, scoped per verb where the
 * same short flag means different things across tools: `-a` is `grep --text` but
 * `tee --append`, and `-f` is a `grep` pattern file but `file --files-from`.
 */
const MUTATING_FLAGS_BY_VERB = new Map<string, ReadonlySet<string>>([
  ['find', new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprintf', '-fls'])],
  ['fd', new Set(['-exec', '-exec-dir', '-X', '--exec', '--exec-dir'])],
  ['sed', new Set(['-i', '--in-place'])],
  ['awk', new Set(['-i', '--in-place'])],
  ['tee', new Set(['-a', '--append'])],
  ['file', new Set(['-f', '--files-from', '-m', '--magic-file'])],
  ['sort', new Set(['-o', '--output'])],
  ['grep', new Set(['--output'])],
  ['tar', new Set(['--delete', '--remove-files'])],
  ['rsync', new Set(['--delete', '--remove-source-files', '--backup'])],
  ['curl', new Set(['-o', '--output'])],
  ['git', new Set(['--worktree'])],
])

/** Flags that mutate for every allowlisted verb. */
const UNIVERSAL_MUTATING_FLAGS = new Set(['--in-place'])

/** Commands whose own name proves they write. */
const ALWAYS_WRITES = new Set(['tee', 'dd', 'truncate', 'shred', 'mktemp', 'install', 'rsync'])

/** Commands that run a nested shell, which can hide anything. */
const SHELL_RUNNERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'eval', 'exec', 'source', '.', 'xargs', 'env'])

export interface Verdict {
  readonly parallel: boolean
  readonly reason: string
}

const exclusive = (reason: string): Verdict => ({ parallel: false, reason })

interface Split {
  /** Command text with quoting preserved. */
  readonly segment: string
  /** True when the segment is followed by `;`, `&&`, `||`, or a newline. */
  readonly terminated: boolean
}

/** Split on shell operators, honoring quotes and escapes. */
const splitCommands = (command: string): Split[] => {
  const segments: Split[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let terminated = false
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!
    if (quote !== null) {
      current += char
      if (char === quote && command[index - 1] !== '\\') quote = null
      continue
    }
    if (char === '\\') { current += char + (command[index + 1] ?? ''); index += 1; continue }
    if (char === '"' || char === "'") { quote = char; current += char; continue }
    if (char === ';' || char === '\n') {
      segments.push({ segment: current, terminated: true })
      current = ''
      continue
    }
    if (char === '&' || char === '|') {
      segments.push({ segment: current, terminated: true })
      current = ''
      if (command[index + 1] === char) index += 1
      continue
    }
    current += char
    terminated = false
  }
  segments.push({ segment: current, terminated })
  return segments
}

/** Tokenize one command, honoring quotes and escapes. */
const tokenize = (segment: string): string[] => {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let started = false
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index]!
    if (quote !== null) {
      if (char === quote && segment[index - 1] !== '\\') { quote = null; continue }
      current += char
      continue
    }
    if (char === '"' || char === "'") { quote = char; started = true; continue }
    if (char === '\\') { current += segment[index + 1] ?? ''; started = true; index += 1; continue }
    if (/\s/.test(char)) {
      if (started || current.length > 0) { tokens.push(current); current = ''; started = false }
      continue
    }
    current += char
    started = true
  }
  if (started || current.length > 0) tokens.push(current)
  return tokens
}

/** Command substitution hides arbitrary work; `$(` or a backtick disqualifies. */
const hasCommandSubstitution = (command: string): boolean => {
  let quote: '"' | "'" | null = null
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!
    if (quote !== null) { if (char === quote && command[index - 1] !== '\\') quote = null; continue }
    if (char === '\\') { index += 1; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '$' && command[index + 1] === '(') return true
    if (char === '`') return true
  }
  return false
}

/**
 * Inspect redirections while ignoring ones that cannot reach the filesystem.
 * A read redirect is fine; a write redirect is not. `>&2` duplicates a
 * descriptor rather than naming a file, and `>/dev/null` is a discard.
 */
const redirectionVerdict = (segment: string): Verdict | undefined => {
  let quote: '"' | "'" | null = null
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index]!
    if (quote !== null) { if (char === quote && segment[index - 1] !== '\\') quote = null; continue }
    if (char === '\\') { index += 1; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    // heredoc and here-string: a here-doc writes a temp file
    if (char === '<' && segment[index + 1] === '<') {
      return exclusive('here-doc writes a temporary file')
    }
    // read redirect `<` and fd duplication `>&` / `<&` name no writable file
    if (char === '>') {
      const fdDup = segment[index - 1] === '&' || segment[index - 1] === '0'
      if (fdDup && segment[index + 1] === '&') continue
      const rest = segment.slice(index + 1).trim()
      const target = /^(?:&|-|\d+\b)?\s*(?:"([^"]*)"|'([^']*)'|([^\s|&;]+))/.exec(rest)
      const path = target?.[1] ?? target?.[2] ?? target?.[3] ?? ''
      if (path === '/dev/null') continue
      return exclusive(`write redirect to ${path || 'unknown target'}`)
    }
    // process substitution with a write side
    if (char === '>' && segment[index + 1] === '(') return exclusive('write process substitution')
    if (char === '<' && segment[index + 1] === '(') return exclusive('process substitution')
  }
  return undefined
}

const classifyVerb = (tokens: readonly string[]): Verdict => {
  const [rawVerb, ...rest] = tokens
  if (rawVerb === undefined) return exclusive('no command')
  const verb = rawVerb.split('/').pop()!.toLowerCase()

  if (ALWAYS_WRITES.has(verb)) return exclusive(`${verb} writes`)
  if (SHELL_RUNNERS.has(verb)) return exclusive(`${verb} can run arbitrary commands`)

  const subcommandAllowlist = VERB_SUBCOMMAND_ALLOWLIST.get(verb)
  if (subcommandAllowlist !== undefined) {
    const subcommand = rest.find((token) => !token.startsWith('-'))
    if (subcommand === undefined) return exclusive(`${verb} subcommand is ambiguous`)
    if (!subcommandAllowlist.has(subcommand.toLowerCase())) return exclusive(`${verb} ${subcommand} may mutate`)
    if (verb === 'jj' && !rest.includes('--ignore-working-copy')) {
      return exclusive('jj snapshots the working copy without --ignore-working-copy')
    }
  } else if (!READ_ONLY_VERBS.has(verb) && !LOCAL_ONLY_VERBS.has(verb)) {
    return exclusive(`${verb} is not on the read-only allowlist`)
  }

  const verbMutatingFlags = MUTATING_FLAGS_BY_VERB.get(verb)
  for (const token of rest) {
    if (token === '--') break
    if (LOCAL_ONLY_VERBS.has(verb)) continue
    if (UNIVERSAL_MUTATING_FLAGS.has(token)) return exclusive(`${verb} ${token} mutates`)
    if (verbMutatingFlags?.has(token)) return exclusive(`${verb} ${token} mutates`)
  }
  return { parallel: true, reason: `${verb} reads` }
}

/**
 * Classify one complete `bash -c` command string. Fail-closed: only an exact
 * `parallel: true` opts the call into a concurrent group.
 */
export const classifyBashCommand = (command: string): Verdict => {
  if (command.trim().length === 0) return exclusive('empty command')
  if (hasCommandSubstitution(command)) return exclusive('command substitution can hide writes')

  const segments = splitCommands(command)
  if (segments.length === 0) return exclusive('no executable command')

  for (const [index, { segment, terminated }] of segments.entries()) {
    const isLast = index === segments.length - 1
    const trimmed = segment.trim()
    if (trimmed.length === 0) {
      // A trailing or doubled operator is malformed, not a harmless extra.
      if (!isLast || segments.length > 1) return exclusive('empty command segment')
      return exclusive('no executable command')
    }
    // A lone operator such as a trailing `|` leaves an empty final segment.
    if (!isLast && trimmed.length === 0) return exclusive('empty command segment')

    const redirectVerdict = redirectionVerdict(segment)
    if (redirectVerdict !== undefined) return redirectVerdict

    // Background execution: a segment ending at `&` that is not `&&`.
    if (!terminated && /(^|[^&])&\s*$/.test(segment)) return exclusive('background execution')
    if (terminated && /(^|[^&])&$/.test(segment.trim())) return exclusive('background execution')

    const tokens = tokenize(segment)
    const verdict = classifyVerb(tokens)
    if (!verdict.parallel) return verdict
  }
  return { parallel: true, reason: 'every command reads' }
}