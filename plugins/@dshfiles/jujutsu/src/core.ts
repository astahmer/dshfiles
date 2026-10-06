import { createHash } from 'node:crypto'
import { isAbsolute, normalize, parse } from 'node:path'
import type { Mutation } from './api.js'

export interface FileChange {
  readonly path: string
  readonly additions: number
  readonly deletions: number
  readonly contentDigest: string | null
}

export interface PreparedMutation {
  readonly root: string
  readonly identity: string
  readonly fingerprint: string
  readonly action: Mutation
  readonly argv: readonly string[]
  readonly title: string
  readonly summary: string
  readonly detail: string
  readonly expiresAt: number
}

/** Reject relative paths and lexical aliases before passing a path as cwd. */
export const validatedRepositoryPath = (value: string): string => {
  if (value.length > 2048 || value.includes('\0') || !isAbsolute(value)) {
    throw new Error('Choose an absolute repository path.')
  }
  const normalized = normalize(value)
  if (normalized === parse(normalized).root || normalized.length > 2048) {
    throw new Error('Choose a repository directory, not a filesystem root.')
  }
  return normalized
}

export const isCommitId = (value: string): boolean => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)

/** Accept listed workspace-relative paths, including spaces and fileset metacharacters. */
export const isSafeSplitPath = (value: string): boolean => {
  if (value.length === 0 || value.length > 1024 || value.includes('\0') || value.includes('\n') || value.includes('\r') || value.startsWith('/')) return false
  const segments = value.split('/')
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
}

/** Quote one exact workspace-relative file with JJ's root-file fileset form. */
export const rootFileFileset = (value: string): string => {
  if (!isSafeSplitPath(value)) throw new Error('Split paths must be listed workspace-relative file names without traversal or null bytes.')
  const quoted = value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    // JJ fileset quoting must escape control characters in literal filenames.
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, character => '\\x' + character.charCodeAt(0).toString(16).padStart(2, '0'))
    .replaceAll('\t', '\\t')
  return 'root-file:"' + quoted + '"'
}

/** Construct a fixed JJ command. Every user value remains one argv element. */
export const buildMutationArgv = (action: Mutation): readonly string[] => {
  if ('message' in action && (action.message.includes('\0') || action.message.length > 4000)) {
    throw new Error('Descriptions must fit the supported message limit and cannot contain null bytes.')
  }
  switch (action.kind) {
    case 'describe':
      if (!isCommitId(action.commitId)) throw new Error('Invalid revision id.')
      return ['describe', action.commitId, '--message', action.message]
    case 'split':
      if (!isCommitId(action.commitId) || action.paths.length === 0 || !action.paths.every(isSafeSplitPath)) {
        throw new Error('Split paths must be listed workspace-relative file names without traversal or null bytes.')
      }
      return ['split', '--revision', action.commitId, '--message', action.message, ...action.paths.map(rootFileFileset)]
    case 'squash':
      if (!isCommitId(action.sourceId) || !isCommitId(action.destinationId) || action.sourceId === action.destinationId) {
        throw new Error('Choose two different visible revisions to squash.')
      }
      return ['squash', '--from', action.sourceId, '--into', action.destinationId, '--message', action.message]
    case 'rebase':
      if (!isCommitId(action.sourceId) || !isCommitId(action.destinationId) || action.sourceId === action.destinationId) {
        throw new Error('Choose two different visible revisions to rebase.')
      }
      return ['rebase', '--source', action.sourceId, '--destination', action.destinationId]
    case 'bookmark-move':
      if (!/^[A-Za-z0-9][A-Za-z0-9._/+:-]{0,254}$/.test(action.bookmark) || !isCommitId(action.destinationId)) {
        throw new Error('Invalid bookmark move.')
      }
      return ['bookmark', 'set', '--allow-backwards', '--revision', action.destinationId, action.bookmark]
    case 'fetch':
      if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(action.remote)) throw new Error('Invalid remote name.')
      return ['git', 'fetch', '--remote', action.remote]
    case 'push':
      if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(action.remote) || !/^[A-Za-z0-9][A-Za-z0-9._/+:-]{0,254}$/.test(action.bookmark)) {
        throw new Error('Invalid push target.')
      }
      return ['git', 'push', '--remote', action.remote, '--bookmark', action.bookmark]
  }
}

/** Decode one JSON record per line; malformed or oversized rows fail closed. */
export const parseJsonLines = <T>(text: string, decode: (value: unknown) => T): T[] => {
  const rows: T[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) continue
    let value: unknown
    try {
      value = JSON.parse(line) as unknown
    } catch {
      throw new Error('Jujutsu returned an unreadable revision record.')
    }
    rows.push(decode(value))
  }
  return rows
}

/** Match JJ's recorded argv metadata, never a coincidental phrase in an operation description. */
export const isRecordedJjGitPush = (attributes: string): boolean => {
  const args = attributes.split(/\r?\n/).find(line => /^args\s*:/i.test(line))
  if (args === undefined) return false
  const command = args.replace(/^args\s*:\s*/i, '').trimStart()
  const tokens = command.split(/\s+/)
  const executable = tokens.shift() ?? ''
  if (!/(?:^|[\\/])jj$/i.test(executable)) return false
  while (tokens[0] === '--color=never' || tokens[0] === '--no-pager') tokens.shift()
  return tokens[0] === 'git' && tokens[1] === 'push' && !tokens.slice(2).some(token => token === '--dry-run' || token.startsWith('--dry-run='))
}

/** Count patch lines and fingerprint each exact per-file diff for review state. */
export const parsePatchStats = (patch: string, paths: readonly string[], truncated = false): FileChange[] => {
  const sections = patch.split(/(?=^diff --git )/m).filter(section => section.startsWith('diff --git '))
  return sections.map((section, index) => {
    let additions = 0
    let deletions = 0
    for (const line of section.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) continue
      if (line.startsWith('+')) additions += 1
      else if (line.startsWith('-')) deletions += 1
    }
    return {
      path: paths[index] ?? `Changed file ${index + 1}`,
      additions,
      deletions,
      contentDigest: truncated && index === sections.length - 1 ? null : createHash('sha256').update(section).digest('hex'),
    }
  })
}

/** Remove likely credentials and URL userinfo before a remote preview reaches the browser. */
export const redactRemoteOutput = (value: string, maxLength = 8000): string =>
  value
    .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:access_token|token|password|secret|key)=)[^&\s]+/gi, '$1[redacted]')
    // HTTP authorization values can contain a scheme and more than one token.
    // Consume the complete header value so `Bearer SENTINEL` never leaks.
    .replace(/^(authorization|proxy-authorization)\s*:\s*[^\r\n]*/gim, '$1: [redacted]')
    .replace(/\b(authorization|proxy[_-]?authorization)(\s*[:=]\s*)[^\r\n]*/gi, '$1$2[redacted]')
    .replace(/\b(password|(?:access|refresh)[_-]?token|token|secret|client[_-]?secret|api[_-]?key)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
    .slice(0, maxLength)

/** One-use, expiring confirmation records bind action to repository state. */
export class PreviewStore {
  private readonly entries = new Map<string, PreparedMutation>()

  put(id: string, entry: PreparedMutation, now = Date.now()): void {
    this.prune(now)
    while (this.entries.size >= 32) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    this.entries.set(id, entry)
  }

  take(id: string, root: string, identity: string, fingerprint: string, now = Date.now()): PreparedMutation | undefined {
    const entry = this.entries.get(id)
    this.entries.delete(id)
    if (entry === undefined || entry.expiresAt <= now || entry.root !== root || entry.identity !== identity || entry.fingerprint !== fingerprint) {
      return undefined
    }
    return entry
  }

  private prune(now: number): void {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id)
    }
  }
}
