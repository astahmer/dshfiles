/**
 * Deterministic classification of one background job from its kind and label.
 * The label is the command line a producer registered (or its one-line
 * description), so the classifier normalizes shell wrappers before reading the
 * command that actually did the work.
 */

export const jobCategoryValues = [
  'tests',
  'typecheck',
  'lint-format',
  'build',
  'install-deps',
  'vcs',
  'inspect',
  'scripts',
  'process',
  'files',
  'dsh',
  'workflow',
  'terminal',
  'other',
] as const

export type JobCategory = (typeof jobCategoryValues)[number]

/** Wrapper words that precede the real command; the value is how many arguments to skip. */
const wrappers = new Map<string, number>([
  ['cd', 1],
  ['pushd', 1],
  ['popd', 0],
  ['source', 1],
  ['.', 1],
  ['export', 1],
  ['set', 1],
  ['unset', 1],
  ['local', 1],
  ['declare', 1],
  ['time', 0],
  ['nice', 0],
  ['nohup', 0],
  ['stdbuf', 0],
  ['command', 0],
  ['builtin', 0],
  ['sudo', 0],
  ['doas', 0],
  ['env', 0],
  ['exec', 0],
  ['eval', 0],
  ['xargs', 0],
  ['watch', 0],
  ['timeout', 1],
  ['fnm', 0],
  ['nix', 0],
  ['develop', 0],
  ['shell', 1],
  ['flake', 0],
])

/** Segments whose only purpose is printing a banner; the next segment owns the command. */
const bannerWords = new Set(['echo', 'printf', ':', 'true', 'false', 'pwd', 'vacuum', '{', '}', '(', ')'])

const assignment = /^[A-Za-z_][A-Za-z0-9_]*=/

const commandCategories = new Map<string, JobCategory>([
  ['jj', 'vcs'],
  ['git', 'vcs'],
  ['gh', 'vcs'],
  ['hg', 'vcs'],
  ['oxlint', 'lint-format'],
  ['oxfmt', 'lint-format'],
  ['eslint', 'lint-format'],
  ['prettier', 'lint-format'],
  ['biome', 'lint-format'],
  ['tsc', 'typecheck'],
  ['vitest', 'tests'],
  ['jest', 'tests'],
  ['playwright', 'tests'],
  ['mocha', 'tests'],
  ['turbo', 'build'],
  ['rollup', 'build'],
  ['esbuild', 'build'],
  ['tsup', 'build'],
  ['make', 'build'],
  ['node', 'scripts'],
  ['python', 'scripts'],
  ['python3', 'scripts'],
  ['deno', 'scripts'],
  ['ruby', 'scripts'],
  ['go', 'scripts'],
  ['cargo', 'scripts'],
  ['jq', 'scripts'],
  ['bash', 'scripts'],
  ['sh', 'scripts'],
  ['zsh', 'scripts'],
  ['pwsh', 'scripts'],
  ['curl', 'process'],
  ['wget', 'process'],
  ['ps', 'process'],
  ['pgrep', 'process'],
  ['pkill', 'process'],
  ['lsof', 'process'],
  ['kill', 'process'],
  ['sleep', 'process'],
  ['top', 'process'],
  ['cp', 'files'],
  ['mv', 'files'],
  ['rm', 'files'],
  ['mkdir', 'files'],
  ['rmdir', 'files'],
  ['touch', 'files'],
  ['chmod', 'files'],
  ['ln', 'files'],
  ['rsync', 'files'],
  ['tar', 'files'],
  ['unzip', 'files'],
  ['zip', 'files'],
  ['rg', 'inspect'],
  ['grep', 'inspect'],
  ['find', 'inspect'],
  ['fd', 'inspect'],
  ['ls', 'inspect'],
  ['cat', 'inspect'],
  ['sed', 'inspect'],
  ['awk', 'inspect'],
  ['head', 'inspect'],
  ['tail', 'inspect'],
  ['wc', 'inspect'],
  ['stat', 'inspect'],
  ['du', 'inspect'],
  ['df', 'inspect'],
  ['diff', 'inspect'],
  ['tree', 'inspect'],
  ['xxd', 'inspect'],
  ['strings', 'inspect'],
  ['bat', 'inspect'],
  ['file', 'inspect'],
  ['ast-outline', 'inspect'],
  ['dsh', 'dsh'],
  ['dshx', 'dsh'],
  ['session-log', 'dsh'],
])

const labelPatterns: ReadonlyArray<readonly [JobCategory, RegExp]> = [
  ['tests', /(^|[\s&|;(])(pnpm|npm|yarn|bun)\s+(run\s+)?(test|test:[\w:-]+|check:e2e|e2e)\b|--run\b|\bvitest\b|\bplaywright\b/],
  ['typecheck', /(^|[\s&|;(])(pnpm|npm)\s+(run\s+)?(typecheck|tsc)\b|\btsc\b/],
  ['lint-format', /(^|[\s&|;(])(pnpm|npm)\s+(run\s+)?(lint|fmt|format|fmt:check)\b|\boxlint\b|\boxfmt\b|\bprettier\b/],
  ['build', /(^|[\s&|;(])(pnpm|npm|turbo)\s+(run\s+)?build\b|\bturbo\s+run\b|\bvite\s+build\b/],
  [
    'install-deps',
    /(^|[\s&|;(])(pnpm|npm|yarn|bun|fnm)\s+(i|install|add|remove|rm|update|dedupe|exec|why|outdated)\b|\bnix\s+(shell|run|develop|profile|flake)\b|\bcomma\b/,
  ],
  ['dsh', /(^|[\s&|;(])dshx\s+(dev|status|doctor|inspect)\b|\bdsh\s+(web|dev|lkg|plugin)\b|\bsession\.v\d|dsh-sessions/],
  ['vcs', /(^|[\s&|;(])(jj|git)\s/],
  ['process', /127\.0\.0\.1:\d+|localhost:\d+|\bpgrep\b|\blsof\b/],
  ['inspect', /\b(rg|grep|ast-outline|sed|cat|head|tail|wc|ls|find)\b/],
]

const packageManagerScripts: ReadonlyArray<readonly [JobCategory, RegExp]> = [
  ['tests', /\b(test|check|e2e|vitest|playwright|verify)\b/],
  ['lint-format', /\b(lint|fmt|format|oxlint|oxfmt|prettier)\b/],
  ['typecheck', /\b(typecheck|tsc)\b/],
  ['build', /\b(build|compile|turbo)\b/],
  ['install-deps', /\b(install|add|remove|rm|update|dedupe|why|outdated|exec|dlx|create|approve-builds)\b/],
]

const commandWord = (label: string): string => {
  for (const segment of label.split(/&&|\|\||;|\n|\|/)) {
    const tokens = segment
      .trim()
      .split(/\s+/)
      .filter(token => token.length > 0)
    if (tokens.length === 0) continue
    const first = tokens[0] ?? ''
    if (bannerWords.has(first)) continue
    let index = 0
    while (index < tokens.length) {
      const token = tokens[index] ?? ''
      if (token.startsWith('-') || assignment.test(token) || bannerWords.has(token) || token === '$') {
        index += 1
        continue
      }
      const name = token.split('/').pop() ?? token
      if (name.includes('=') || name.startsWith('$')) {
        index += 1
        continue
      }
      const skip = wrappers.get(name)
      if (skip !== undefined) {
        index += 1 + skip
        continue
      }
      return name
    }
  }
  return ''
}

const packageManagerCategory = (label: string): JobCategory | undefined => {
  const match = /(?:^|[\s&|;(])(pnpm|npm|yarn|bun|npx)\b/.exec(label)
  if (match === null) return undefined
  const remainder = label.slice(match.index + match[0].length)
  const found = packageManagerScripts.find(([, pattern]) => pattern.test(remainder))
  return found?.[0] ?? 'install-deps'
}

export const classifyJob = ({ kind, label }: { readonly kind: string; readonly label: string }): JobCategory => {
  if (kind === 'workflow') return 'workflow'
  if (kind === 'pty-send') return 'terminal'
  const command = commandWord(label)
  const byCommand = commandCategories.get(command)
  if (byCommand !== undefined) return byCommand
  const byPackageManager = packageManagerCategory(label)
  if (byPackageManager !== undefined) return byPackageManager
  const byPattern = labelPatterns.find(([, pattern]) => pattern.test(label))
  return byPattern?.[0] ?? 'other'
}
