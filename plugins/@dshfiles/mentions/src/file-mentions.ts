// Ported from @deepseek-ai/dsh-file-reference (grammar) and @deepseek-ai/dsh-util-workspace-path 0.2.0-rc.2 (MIT):
// neither is a DSH Client module, so a plugin cannot import them at runtime, and the chips must keep their exact grammar.

const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

const isWindowsStylePath = (value: string): boolean => /^[A-Za-z]:[/\\]/u.test(value) || value.startsWith('\\\\')
const encodeSegment = (segment: string): string => encodeURIComponent(segment).replace(/%3A/giu, ':')
const sessionFileAddress = (sessionId: string, path: string): string => {
  const normalized = path.replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '')
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${normalized.split('/').map(encodeSegment).join('/')}`
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
}
