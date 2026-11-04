import { createHash } from 'node:crypto'
import { isAbsolute, join, normalize, parse } from 'node:path'
import { Result, Schema } from 'effect'
import { workspaceNameSchema, type FileStatus, type Mutation } from './api.js'
import { InvalidJjOutput, InvalidRepositoryPath, MutationRefused } from './errors.js'

export interface FileChange {
  readonly path: string
  readonly additions: number
  readonly deletions: number
  readonly contentDigest: string | null
}

/** Digests of what one action names: its revisions, its bookmark's targets, the remote configuration and workspace. */
export interface TargetState {
  readonly revisions: string
  readonly bookmark: string
  readonly remote: string
  readonly workspace: string
}

export interface PreparedMutation {
  readonly root: string
  readonly identity: string
  /** The state of what the action names when it was previewed; confirmation compares a fresh read of the same. */
  readonly targets: TargetState
  readonly action: Mutation
  /** The folder `workspace-forget` resolves at preview time, snapshotted before the workspace is unregistered. */
  readonly workspaceRoot?: string
  readonly workspaceParentIdentity?: { readonly device: string; readonly inode: string }
  readonly argv: readonly string[]
  readonly title: string
  readonly summary: string
  readonly detail: string
  readonly expiresAt: number
}

/** Reject relative paths and lexical aliases before passing a path as cwd. */
const validatedRepositoryPath = (value: string): Result.Result<string, InvalidRepositoryPath> => {
  if (value.length > 2048 || value.includes('\0') || !isAbsolute(value)) return Result.fail(new InvalidRepositoryPath({ reason: 'relative' }))
  const normalized = normalize(value)
  if (normalized === parse(normalized).root || normalized.length > 2048) return Result.fail(new InvalidRepositoryPath({ reason: 'filesystem-root' }))
  return Result.succeed(normalized)
}

const isCommitId = (value: string): boolean => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)

const isWorkspaceName = Schema.is(workspaceNameSchema)

/** Accept listed workspace-relative paths, including spaces and fileset metacharacters. */
const isSafeSplitPath = (value: string): boolean => {
  if (value.length === 0 || value.length > 1024 || value.includes('\0') || value.includes('\n') || value.includes('\r') || value.startsWith('/')) return false
  const segments = value.split('/')
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
}

const refused = (reason: MutationRefused['reason']) => Result.fail(new MutationRefused({ reason }))

/** Quote one exact workspace-relative file with JJ's root-file fileset form. */
const rootFileFileset = (value: string): Result.Result<string, MutationRefused> => {
  if (!isSafeSplitPath(value)) return refused('split-paths')
  const quoted = value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    // JJ fileset quoting must escape control characters in literal filenames.
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, character => '\\x' + character.charCodeAt(0).toString(16).padStart(2, '0'))
    .replaceAll('\t', '\\t')
  return Result.succeed('root-file:"' + quoted + '"')
}

const isBookmarkName = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._/+:-]{0,254}$/.test(value)

const isRemoteName = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(value)

const checkedCommitId = (value: string): Result.Result<string, MutationRefused> => (isCommitId(value) ? Result.succeed(value) : refused('invalid-revision'))

const literalFilesets = (paths: readonly string[]): Result.Result<string[], MutationRefused> => Result.all(paths.map(rootFileFileset))

/** Construct a fixed JJ command. Every user value remains one argv element. */
const buildMutationArgv = (action: Mutation): Result.Result<readonly string[], MutationRefused | InvalidRepositoryPath> =>
  Result.gen(function* () {
    if ('message' in action && action.message !== undefined && (action.message.includes('\0') || action.message.length > 4000))
      return yield* refused('message-limit')
    switch (action.kind) {
      case 'describe':
        return ['describe', yield* checkedCommitId(action.commitId), '--message', action.message]
      case 'split':
        if (!isCommitId(action.commitId) || action.paths.length === 0) return yield* refused('split-paths')
        return ['split', '--revision', action.commitId, '--message', action.message, ...(yield* literalFilesets(action.paths))]
      case 'squash': {
        if (!isCommitId(action.sourceId) || !isCommitId(action.destinationId) || action.sourceId === action.destinationId) return yield* refused('squash-same')
        const messageArgs = action.message === undefined ? ['--use-destination-message'] : ['--message', action.message]
        return ['squash', '--from', action.sourceId, '--into', action.destinationId, ...messageArgs, ...(yield* literalFilesets(action.paths ?? []))]
      }
      case 'rebase':
        if (!isCommitId(action.sourceId) || !isCommitId(action.destinationId) || action.sourceId === action.destinationId) return yield* refused('rebase-same')
        return ['rebase', '--source', action.sourceId, '--destination', action.destinationId]
      case 'bookmark-move':
        if (!isBookmarkName(action.bookmark) || !isCommitId(action.destinationId)) return yield* refused('bookmark-move')
        return ['bookmark', 'set', '--allow-backwards', '--revision', action.destinationId, action.bookmark]
      case 'bookmark-set':
        if (!isBookmarkName(action.bookmark) || !isCommitId(action.destinationId)) return yield* refused('bookmark-name')
        return ['bookmark', 'set', '--allow-backwards', '--revision', action.destinationId, action.bookmark]
      case 'bookmark-delete':
        if (!isBookmarkName(action.bookmark)) return yield* refused('bookmark-name')
        return ['bookmark', 'delete', action.bookmark]
      case 'fetch':
        if (!isRemoteName(action.remote)) return yield* refused('remote-name')
        return ['git', 'fetch', '--remote', action.remote]
      case 'push':
        if (!isRemoteName(action.remote) || !isBookmarkName(action.bookmark)) return yield* refused('push-target')
        return ['git', 'push', '--remote', action.remote, '--bookmark', action.bookmark]
      case 'workspace-add':
        if (!isCommitId(action.commitId) || !isWorkspaceName(action.name)) return yield* refused('workspace-target')
        return ['workspace', 'add', '--name', action.name, '--revision', action.commitId, join(yield* validatedRepositoryPath(action.parentPath), action.name)]
      case 'workspace-forget':
        if (!isWorkspaceName(action.name)) return yield* refused('workspace-name')
        if (action.name === 'default') return yield* refused('default-workspace')
        return ['workspace', 'forget', action.name]
      case 'workspace-edit':
        if (!isWorkspaceName(action.name)) return yield* refused('workspace-name')
        return ['edit', yield* checkedCommitId(action.commitId)]
      case 'edit':
        return ['edit', yield* checkedCommitId(action.commitId)]
      case 'new':
        return ['new', yield* checkedCommitId(action.commitId)]
      case 'commit':
        yield* checkedCommitId(action.commitId)
        return ['commit', '--message', action.message]
      case 'duplicate':
        return ['duplicate', yield* checkedCommitId(action.commitId)]
      case 'abandon': {
        if (action.commitIds.length === 0) return yield* refused('abandon-empty')
        const commitIds = yield* Result.all(action.commitIds.map(checkedCommitId))
        return ['abandon', ...new Set(commitIds)]
      }
      case 'revert':
        if ((yield* checkedCommitId(action.commitId)) === (yield* checkedCommitId(action.destinationId))) return yield* refused('revert-same')
        return ['revert', '--revision', action.commitId, '--onto', action.destinationId]
      case 'restore':
        if (action.paths.length === 0) return yield* refused('split-paths')
        return ['restore', '--changes-in', yield* checkedCommitId(action.commitId), ...(yield* literalFilesets(action.paths))]
    }
  })

const FILE_STATUS_LETTERS = new Map<string, FileStatus>([
  ['modified', 'M'],
  ['added', 'A'],
  ['removed', 'D'],
  ['renamed', 'R'],
  ['copied', 'C'],
])

/** Map JJ's template status word to the single-letter Source Control marker. */
const fileStatusLetter = (status: string): FileStatus => FILE_STATUS_LETTERS.get(status) ?? 'M'

const decodeJsonLine = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Json))

/** Decode one JSON record per line with `schema`; a malformed or oversized row fails the whole read closed. */
const parseJsonLines = <S extends Schema.ConstraintDecoder<unknown>>(text: string, schema: S): Result.Result<S['Type'][], InvalidJjOutput> => {
  const decodeRow = Schema.decodeUnknownResult(schema)
  return Result.all(
    text
      .split(/\r?\n/)
      .filter(line => line.length > 0)
      .map(line =>
        decodeJsonLine(line).pipe(
          Result.flatMap(value => decodeRow(value)),
          Result.mapError(cause => new InvalidJjOutput({ cause })),
        ),
      ),
  )
}

/** Decode one plain (non-JSON) value per line, the shape some jj templates emit. */
const parseLines = <S extends Schema.ConstraintDecoder<unknown>>(text: string, schema: S): Result.Result<S['Type'][], InvalidJjOutput> => {
  const decodeRow = Schema.decodeUnknownResult(schema)
  return Result.all(
    text
      .split(/\r?\n/)
      .filter(line => line.length > 0)
      .map(line => decodeRow(line).pipe(Result.mapError(cause => new InvalidJjOutput({ cause })))),
  )
}

/** The complete lines of a possibly truncated output: a cut last line is dropped rather than misread. */
const completeLines = (output: { readonly stdout: string; readonly truncated: boolean }): string =>
  output.truncated ? output.stdout.slice(0, output.stdout.lastIndexOf('\n') + 1) : output.stdout

/** Match JJ's recorded argv metadata, never a coincidental phrase in an operation description. */
const isRecordedJjGitPush = (attributes: string): boolean => {
  const args = attributes.split(/\r?\n/).find(line => /^args\s*:/i.test(line))
  if (args === undefined) return false
  const command = args.replace(/^args\s*:\s*/i, '').trimStart()
  // jj records argv shell-quoted (`jj '--color=never' --no-pager git push`); compare the unquoted words.
  const tokens = command.split(/\s+/).map(token => token.replace(/^'(.*)'$/u, '$1'))
  const executable = tokens.shift() ?? ''
  if (!/(?:^|[\\/])jj$/i.test(executable)) return false
  while (tokens[0] === '--color=never' || tokens[0] === '--no-pager') tokens.shift()
  return tokens[0] === 'git' && tokens[1] === 'push' && !tokens.slice(2).some(token => token === '--dry-run' || token.startsWith('--dry-run='))
}

/** Count patch lines and fingerprint each exact per-file diff for review state. */
const parsePatchStats = (patch: string, paths: readonly string[], truncated = false): FileChange[] => {
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
const redactRemoteOutput = (value: string, maxLength = 8000): string =>
  value
    .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:access_token|token|password|secret|key)=)[^&\s]+/gi, '$1[redacted]')
    // HTTP authorization values can contain a scheme and more than one token.
    // Consume the complete header value so `Bearer SENTINEL` never leaks.
    .replace(/^(authorization|proxy-authorization)\s*:\s*[^\r\n]*/gim, '$1: [redacted]')
    .replace(/\b(authorization|proxy[_-]?authorization)(\s*[:=]\s*)[^\r\n]*/gi, '$1$2[redacted]')
    .replace(/\b(password|(?:access|refresh)[_-]?token|token|secret|client[_-]?secret|api[_-]?key)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
    .slice(0, maxLength)

export class JujutsuPathModel {
  static readonly validatedRepositoryPath = validatedRepositoryPath
  static readonly isSafeSplitPath = isSafeSplitPath
  static readonly rootFileFileset = rootFileFileset
}

export class JujutsuMutationModel {
  static readonly isCommitId = isCommitId
  static readonly buildMutationArgv = buildMutationArgv
}

export class JujutsuOutputModel {
  static readonly fileStatusLetter = fileStatusLetter
  static readonly parseJsonLines = parseJsonLines
  static readonly parseLines = parseLines
  static readonly completeLines = completeLines
  static readonly isRecordedJjGitPush = isRecordedJjGitPush
  static readonly parsePatchStats = parsePatchStats
  static readonly redactRemoteOutput = redactRemoteOutput
}
