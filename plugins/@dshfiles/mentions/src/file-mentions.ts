// Ported from @deepseek-ai/dsh-file-reference (grammar) and @deepseek-ai/dsh-util-workspace-path 0.2.0-rc.2 (MIT):
// neither is a DSH Client module, so a plugin cannot import them at runtime, and the chips must keep their exact grammar.

const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

const isWindowsStylePath = (value: string): boolean => /^[A-Za-z]:[/\\]/u.test(value) || value.startsWith('\\\\')
const encodeSegment = (segment: string): string => encodeURIComponent(segment).replace(/%3A/giu, ':')
const sessionFileAddress = (sessionId: string, path: string): string => {
  const normalized = path.replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '')
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${normalized.split('/').map(encodeSegment).join('/')}`
}

/** One `@path` token already written in plain text. */
export interface FileMentionMatch {
  /** Offset of the leading `@`. */
  readonly start: number
  readonly end: number
  /** The exact mention spelling, quotes included. */
  readonly mention: string
  readonly path: string
  readonly kind: 'file' | 'directory'
}

/** The `@path` grammar the native reference chips, send-time serialization and the model prompt agree on. */
export class FileMentions {
  /** `@path`, `@"path with spaces"`, or an open `@"dir/` for a quoted directory; undefined for a path the editor cannot hold. */
  static format(candidate: { readonly path: string; readonly kind: 'file' | 'directory' }, preserveQuote: boolean): string | undefined {
    const path = candidate.kind === 'directory' ? `${candidate.path}/` : candidate.path
    if (FileMentions.hasUnquotableCharacter(path)) return undefined
    if (!(preserveQuote || /\s/u.test(path))) return `@${path}`
    if (candidate.kind === 'directory') return `@"${path}`
    return `@"${path}"`
  }

  private static hasUnquotableCharacter(path: string): boolean {
    for (let index = 0; index < path.length; index += 1) {
      const code = path.charCodeAt(index)
      if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x22) return true
    }
    return false
  }

  static abbreviateHome(path: string, home: string | undefined): string {
    if (home === undefined || home === '' || isWindowsStylePath(path) || isWindowsStylePath(home)) return path
    const root = home.replace(/\/+$/u, '')
    if (root === '' || root === '/') return path
    if (path.replace(/\/+$/u, '') === root) return '~'
    if (path.startsWith(`${root}/`)) return `~${path.slice(root.length)}`
    return path
  }

  /** The address the right sidebar opens for a path mentioned in one Session. */
  static addressFor(input: { readonly sessionId: string; readonly cwd: string | undefined; readonly path: string }): string {
    const normalized = input.path.replace(/\\/gu, '/')
    if (!(normalized.startsWith('/') || isWindowsStylePath(normalized))) return sessionFileAddress(input.sessionId, normalized)
    const root = input.cwd === undefined ? '' : input.cwd.replace(/\\/gu, '/').replace(/\/+$/u, '')
    if (root !== '' && normalized === root) return sessionFileAddress(input.sessionId, '')
    if (root !== '' && normalized.startsWith(`${root}/`)) return sessionFileAddress(input.sessionId, normalized.slice(root.length + 1))
    return sessionFileAddress(input.sessionId, normalized)
  }

  /**
   * Every file mention a written text still names: a quoted `@"path"` always, and an unquoted `@path` when the path
   * looks like one (a separator or an extension) and is not another mention scope such as `@agent:` or `@{luna}`.
   */
  static matches(text: string): readonly FileMentionMatch[] {
    const matches: FileMentionMatch[] = []
    for (const quoted of text.matchAll(/@"([^"\n]*)"/gu)) {
      const path = quoted[1]
      if (path === undefined || path === '') continue
      const start = quoted.index ?? 0
      matches.push({ start, end: start + quoted[0].length, mention: quoted[0], path, kind: path.endsWith('/') ? 'directory' : 'file' })
    }
    // A quoted directory keeps its quote open until the writer types the closing one or moves on.
    const open = /@"([^"\n]*)$/u.exec(text)
    const openPath = open?.[1]
    if (open !== null && openPath !== undefined && openPath !== '' && openPath.endsWith('/')) {
      const start = open.index
      matches.push({ start, end: start + open[0].length, mention: open[0], path: openPath, kind: 'directory' })
    }
    for (const bare of text.matchAll(/(?<![\w@/"])(@[^\s"',;:()]+)/gu)) {
      const raw = bare[1]?.slice(1)
      if (raw === undefined) continue
      const path = raw.replace(/[.,;:!?]+$/u, '')
      if (path === '' || path.startsWith('{') || !(path.includes('/') || /\.[\w-]+$/u.test(path))) continue
      const start = bare.index ?? 0
      const mention = `@${path}`
      matches.push({ start, end: start + mention.length, mention, path, kind: 'file' })
    }
    return matches.sort((left, right) => left.start - right.start)
  }
}
