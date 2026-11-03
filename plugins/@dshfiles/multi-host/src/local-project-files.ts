import { posix } from 'node:path'
import { Duration, Effect, FileSystem, Option, Path, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import type { LocalProjectFileCandidate } from './api.js'
import { LocalProjectFailed } from './errors.js'

const maxListedFiles = 256
const maxCopyFiles = 128
const maxCopiedBytes = 50 * 1024 * 1024
const maxArchiveBytes = 55 * 1024 * 1024
const maxScanOutputBytes = 16 * 1024 * 1024
const processTimeout = Duration.seconds(30)

/** The bounded stdout of one local git or tar run; a non-zero exit becomes the error the caller names. */
const runBounded = Effect.fnUntraced(function* (input: {
  readonly executable: 'git' | 'tar'
  readonly args: readonly string[]
  readonly cwd: string
  readonly maxBytes: number
  readonly onExit: (exitCode: number) => LocalProjectFailed | undefined
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const failed = (cause?: unknown) => new LocalProjectFailed({ code: 'local-process-failed', cause })
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner
        .spawn(ChildProcess.make(input.executable, [...input.args], { cwd: input.cwd, stdin: 'ignore', stderr: 'ignore' }))
        .pipe(Effect.mapError(cause => failed(cause)))
      const [collected, exitCode] = yield* Effect.all(
        [
          Stream.runFoldEffect(
            handle.stdout,
            () => ({ chunks: new Array<Uint8Array>(), bytes: 0 }),
            (state, chunk) => {
              const bytes = state.bytes + chunk.byteLength
              if (bytes > input.maxBytes) return Effect.fail(failed())
              state.chunks.push(chunk)
              return Effect.succeed({ chunks: state.chunks, bytes })
            },
          ),
          handle.exitCode,
        ],
        { concurrency: 'unbounded' },
      )
      const refused = exitCode === 0 ? undefined : (input.onExit(exitCode) ?? failed())
      if (refused !== undefined) return yield* refused
      return Buffer.concat(collected.chunks)
    }),
  ).pipe(Effect.timeoutOrElse({ duration: processTimeout, orElse: () => Effect.fail(failed()) }))
})

const pathListOf = (output: Buffer): string[] => output.toString('utf8').split('\0').filter(Boolean)

const safeRelativePath = (value: string): boolean => {
  if (value.length === 0 || value.includes('\0') || posix.isAbsolute(value)) return false
  return value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
}

const pathIsCopyable = (value: string): boolean => !value.split('/').includes('node_modules')

const isPotentialSecretPath = (value: string): boolean => {
  const path = value.toLowerCase()
  const filename = posix.basename(path)
  if (/^\.env\.(?:example|sample|template|dist)$/u.test(filename)) return false
  return (
    /(^|\/)\.env(?:rc)?(?:\.[^/]+)?$/u.test(path) ||
    /(^|\/)(?:\.npmrc|\.pypirc|\.netrc|\.aws|\.ssh)(?:\/|$)/u.test(path) ||
    /(^|\/)(?:\.?(?:secrets?|credentials?|tokens?))(?:\/|$)/u.test(path) ||
    /(^|[._-])(?:secret|credentials?|token|private[-_.]?key)(?:[._-]|$)/u.test(filename) ||
    /(^|\/)(?:id_(?:rsa|dsa|ecdsa|ed25519)|authorized_keys|known_hosts|application_default_credentials\.json|service[-_]?account(?:_[^/]+)?\.json)$/u.test(
      path,
    ) ||
    /\.(?:pem|key|p12|pfx|jks|keystore|tfstate)$/u.test(path)
  )
}

/** The canonical root of the Git project at `requested`; that folder must be the root itself. */
const repositoryRoot = Effect.fnUntraced(function* (requested: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  if (!path.isAbsolute(requested)) return yield* new LocalProjectFailed({ code: 'local-path-not-absolute' })
  const canonical = yield* fileSystem.realPath(requested).pipe(Effect.mapError(cause => new LocalProjectFailed({ code: 'local-path-unavailable', cause })))
  const stdout = yield* runBounded({
    executable: 'git',
    args: ['rev-parse', '--show-toplevel'],
    cwd: canonical,
    maxBytes: 64 * 1024,
    onExit: exitCode => (exitCode === 128 ? new LocalProjectFailed({ code: 'not-a-git-project' }) : undefined),
  })
  const root = stdout.toString('utf8').trim()
  if (root.length === 0) return yield* new LocalProjectFailed({ code: 'not-a-git-project' })
  const projectRoot = yield* fileSystem.realPath(root).pipe(Effect.mapError(cause => new LocalProjectFailed({ code: 'local-path-unavailable', cause })))
  if (canonical !== projectRoot) return yield* new LocalProjectFailed({ code: 'local-path-not-project-root' })
  return projectRoot
})

/** One file the user could copy into a fresh remote clone, with the reason it cannot be copied when it cannot. */
const candidateOf = (input: { readonly root: string; readonly relativePath: string; readonly ignored: boolean }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const facts = yield* fileSystem.stat(path.join(input.root, input.relativePath)).pipe(Effect.option)
    if (Option.isNone(facts) || facts.value.type !== 'File') return Option.none<LocalProjectFileCandidate>()
    const bytes = Number(facts.value.size)
    const copyReason = isPotentialSecretPath(input.relativePath) ? 'potential-secret' : bytes > maxCopiedBytes ? 'too-large' : undefined
    return Option.some({
      path: input.relativePath,
      bytes,
      ignored: input.ignored,
      copyable: copyReason === undefined,
      ...(copyReason !== undefined && { copyReason }),
    } satisfies LocalProjectFileCandidate)
  })

/** Untracked files of a local Git project, plus its ignored ones when asked, that could be copied to a remote clone. */
const list = Effect.fn('local project files scan', { kind: 'internal' })(function* (input: {
  readonly path: string
  readonly includeIgnored?: boolean | undefined
}) {
  const root = yield* repositoryRoot(input.path)
  const untracked = yield* runBounded({
    executable: 'git',
    args: ['ls-files', '--others', '--exclude-standard', '-z'],
    cwd: root,
    maxBytes: maxScanOutputBytes,
    onExit: () => undefined,
  })
  const ignoredOutput =
    input.includeIgnored === true
      ? yield* runBounded({
          executable: 'git',
          args: ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'],
          cwd: root,
          maxBytes: maxScanOutputBytes,
          onExit: () => undefined,
        })
      : Buffer.alloc(0)
  const ignored = new Set(pathListOf(ignoredOutput))
  const paths = [...new Set([...pathListOf(untracked), ...ignored])]
    .filter(value => safeRelativePath(value) && pathIsCopyable(value))
    .sort((left, right) => left.localeCompare(right))
  const found = yield* Effect.forEach(paths.slice(0, maxListedFiles), relativePath => candidateOf({ root, relativePath, ignored: ignored.has(relativePath) }), {
    concurrency: 8,
  })
  const candidates = found.flatMap(file => Option.toArray(file))
  yield* Effect.annotateCurrentSpan('dshfiles.multi_host.local_file_count', candidates.length)
  return { root, files: candidates, truncated: paths.length > maxListedFiles }
})

/** A tar archive of the selected copyable files of the project at `root`. */
const archive = Effect.fn('local project files archive', { kind: 'internal' })(function* (input: {
  readonly root: string
  readonly paths: readonly string[]
  readonly includeIgnored?: boolean | undefined
}) {
  if (input.paths.length > maxCopyFiles) return yield* new LocalProjectFailed({ code: 'too-many-files' })
  if (input.paths.some(value => !safeRelativePath(value) || !pathIsCopyable(value))) return yield* new LocalProjectFailed({ code: 'invalid-file-path' })
  const scan = yield* list({ path: input.root, includeIgnored: input.includeIgnored })
  const candidates = new Map(scan.files.map(file => [file.path, file]))
  const selected = [...new Set(input.paths)].sort((left, right) => left.localeCompare(right))
  let totalBytes = 0
  for (const value of selected) {
    const file = candidates.get(value)
    if (file === undefined) return yield* new LocalProjectFailed({ code: 'file-not-copyable' })
    if (file.copyReason === 'potential-secret') return yield* new LocalProjectFailed({ code: 'credential-like-file' })
    if (!file.copyable) return yield* new LocalProjectFailed({ code: 'file-too-large' })
    totalBytes += file.bytes
    if (totalBytes > maxCopiedBytes) return yield* new LocalProjectFailed({ code: 'copy-size-limit' })
  }
  if (selected.length === 0) return Buffer.alloc(0)
  const tar = yield* runBounded({
    executable: 'tar',
    args: ['-C', scan.root, '-cf', '-', '--', ...selected],
    cwd: scan.root,
    maxBytes: maxArchiveBytes + 1,
    onExit: () => undefined,
  })
  if (tar.byteLength > maxArchiveBytes) return yield* new LocalProjectFailed({ code: 'archive-too-large' })
  yield* Effect.annotateCurrentSpan({ 'dshfiles.multi_host.local_file_count': selected.length, 'dshfiles.multi_host.local_file_bytes': totalBytes })
  return tar
})

/** The local Git project files a remote clone can carry along: scanned over the spawner, archived with tar. */
export class LocalProjectFiles {
  static readonly list = list
  static readonly archive = archive
}
