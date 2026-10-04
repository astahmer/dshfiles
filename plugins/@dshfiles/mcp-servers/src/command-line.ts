/** Parse display text into argv without ever invoking a shell. */
export function parseCommandLine(source: string): readonly string[] {
  if (source.length > 8192) throw new TypeError('Command line is too long.')
  const words: string[] = []
  let word = ''
  let quote: 'single' | 'double' | undefined
  let escaped = false
  let started = false

  for (const char of source) {
    if (escaped) {
      word += char
      escaped = false
      started = true
      continue
    }
    if (char === '\\' && quote !== 'single') {
      escaped = true
      started = true
      continue
    }
    if (quote === 'single') {
      if (char === "'") quote = undefined
      else word += char
      started = true
      continue
    }
    if (quote === 'double') {
      if (char === '"') quote = undefined
      else word += char
      started = true
      continue
    }
    if (char === "'") {
      quote = 'single'
      started = true
    } else if (char === '"') {
      quote = 'double'
      started = true
    } else if (/\s/.test(char)) {
      if (started) words.push(word)
      word = ''
      started = false
    } else {
      word += char
      started = true
    }
  }
  if (escaped) throw new TypeError('Command line ends with an unfinished escape.')
  if (quote !== undefined) throw new TypeError('Command line has an unfinished quote.')
  if (started) words.push(word)
  if (words.length === 0 || words[0] === '') throw new TypeError('Enter a command.')
  if (words.length > 129 || words.some(value => value.length > 4096)) {
    throw new TypeError('Command line has too many or oversized arguments.')
  }
  return words
}

export function formatCommandLine(words: readonly string[]): string {
  return words
    .map(word => {
      if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(word)) return word
      return `"${word.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
    })
    .join(' ')
}

const SECRET_OPTION = /(?:^|[-_])(?:api[-_]?key|access[-_]?token|token|secret|password|passwd|credential|authorization|bearer)(?:$|[-_])/i
const KNOWN_TOKEN = /(?:\bbearer\s+|\b(?:gh[pousr]_|github_pat_|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-))[A-Za-z0-9._~+/-]{12,}={0,2}/i

/** Catch common inline credential forms so users must use credential references. */
export function hasInlineCredential(argv: readonly string[]): boolean {
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index] ?? ''
    if (KNOWN_TOKEN.test(value) || /^-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)) return true
    const equals = value.indexOf('=')
    const option = equals < 0 ? value : value.slice(0, equals)
    const normalizedOption = option.replace(/^-+/, '')
    if (SECRET_OPTION.test(normalizedOption) && (equals >= 0 || argv[index + 1] !== undefined)) return true
    if (/^https?:\/\//i.test(value)) {
      try {
        const url = new URL(value)
        if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return true
      } catch {
        // Not a URL after all; the native command parser will pass it as an argument.
      }
    }
  }
  return false
}
