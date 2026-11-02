import { KeyedMutex } from '@dshfiles/dshx/effect/keyed-mutex'
import { Context, Effect, FileSystem, Layer, Option, Path, type PlatformError } from 'effect'
import { RepositoryInitFailed } from './errors.js'

/** The traced, managed jj runner the caller supplies; no process is spawned here. */
export type RepositoryInitRunner<E> = (cwd: string, args: readonly string[]) => Effect.Effect<{ readonly stdout: string; readonly truncated: boolean }, E>

export interface EnsuredJujutsuRepository {
  readonly root: string
  readonly initialized: boolean
}

type Boundary = { readonly root: string; readonly kind: 'jj' | 'git'; readonly identity: string; readonly worktree: boolean }

const MAX_MARKER_BYTES = 8192

const refuse = (reason: RepositoryInitFailed['reason']) => Effect.fail(new RepositoryInitFailed({ reason }))

const identity = (info: FileSystem.File.Info): string => `${String(info.dev)}:${String(Option.getOrElse(info.ino, () => 0n))}`

/**
 * Opens a folder as a Jujutsu repository, initializing a colocated one in its Git checkout only when the user
 * explicitly opens the graph. The nearest marker wins: never create metadata in a plain folder or beyond a nested Git
 * boundary, and never repair or remove an existing (including broken) `.jj` marker. Concurrent opens of one checkout
 * initialize it once: they queue on its root and the later ones find the new `.jj`.
 *
 * JJ 0.46 rejects --ignore-working-copy for git init. The command-local auto-track override keeps untracked files
 * untracked and preserves staged and unstaged content; JJ may refresh Git's index cache and info/exclude.
 */
export class RepositoryInitializer extends Context.Service<
  RepositoryInitializer,
  {
    readonly ensure: <E>(input: {
      readonly path: string
      readonly runJj: RepositoryInitRunner<E>
    }) => Effect.Effect<EnsuredJujutsuRepository, RepositoryInitFailed>
  }
>()('@dshfiles/jujutsu/RepositoryInitializer') {
  static readonly layer = Layer.effect(
    RepositoryInitializer,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const initializing = yield* KeyedMutex.make<string>()

      const entry = (target: string) =>
        fileSystem.lstat(target).pipe(
          Effect.map(Option.some),
          Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeedNone),
        )

      /** Read at most 8 KiB, even if a malformed marker grows during inspection. */
      const readMarker = (target: string) =>
        Effect.scoped(
          Effect.gen(function* () {
            const file = yield* fileSystem.open(target, { flag: 'r' })
            const info = yield* file.stat
            if (info.type !== 'File' || Number(info.size) > MAX_MARKER_BYTES) return yield* refuse('marker')
            const bytes = Option.getOrElse(yield* file.readAlloc(MAX_MARKER_BYTES + 1), () => new Uint8Array())
            if (bytes.byteLength > MAX_MARKER_BYTES) return yield* refuse('marker')
            return new TextDecoder().decode(bytes)
          }),
        )

      const directoryIdentity = Effect.fnUntraced(function* (target: string) {
        const info = yield* fileSystem.stat(target)
        if (info.type !== 'Directory') return yield* refuse('marker')
        return `${yield* fileSystem.realPath(target)}:${identity(info)}`
      })

      const validateJjMarker = Effect.fnUntraced(function* (root: string) {
        const jjPath = path.join(root, '.jj')
        if ((yield* fileSystem.lstat(jjPath)).type !== 'Directory') return yield* refuse('existing')
        yield* directoryIdentity(path.join(jjPath, 'working_copy'))
        const repoPath = path.join(jjPath, 'repo')
        const repo = yield* fileSystem.lstat(repoPath)
        if (repo.type !== 'Directory' && repo.type !== 'File') return yield* refuse('existing')
        const pointer = repo.type === 'File' ? (yield* readMarker(repoPath)).trim() : undefined
        if (pointer !== undefined && (pointer.length === 0 || /[\r\n\0]/u.test(pointer))) return yield* refuse('existing')
        yield* directoryIdentity(path.join(pointer === undefined ? repoPath : path.resolve(jjPath, pointer), 'store'))
      })

      /** A gitdir file (linked worktree or --separate-git-dir) is a boundary too. */
      const gitIdentity = Effect.fnUntraced(function* (root: string, marker: FileSystem.File.Info) {
        if (marker.type !== 'Directory' && marker.type !== 'File') return yield* refuse('marker')
        const markerPath = path.join(root, '.git')
        const pointer = marker.type === 'File' ? yield* readMarker(markerPath) : ''
        const match = marker.type === 'File' ? /^gitdir: ([^\r\n\0]+)\r?\n?$/u.exec(pointer) : undefined
        if (marker.type === 'File' && match?.[1] === undefined) return yield* refuse('marker')
        const gitDir = yield* fileSystem.realPath(marker.type === 'File' ? path.resolve(root, match?.[1] ?? '') : markerPath)
        const gitDirIdentity = yield* directoryIdentity(gitDir)
        if ((yield* fileSystem.lstat(path.join(gitDir, 'HEAD'))).type !== 'File') return yield* refuse('marker')
        const commonMarker = yield* entry(path.join(gitDir, 'commondir'))
        if (Option.isSome(commonMarker) && commonMarker.value.type !== 'File') return yield* refuse('marker')
        const commonPointer = Option.isNone(commonMarker) ? '' : yield* readMarker(path.join(gitDir, 'commondir'))
        if (Option.isSome(commonMarker) && (commonPointer.trim().length === 0 || commonPointer.includes('\0'))) return yield* refuse('marker')
        const commonDir = Option.isNone(commonMarker) ? gitDir : yield* fileSystem.realPath(path.resolve(gitDir, commonPointer.trim()))
        const commonIdentity = yield* directoryIdentity(commonDir)
        yield* directoryIdentity(path.join(commonDir, 'objects'))
        yield* directoryIdentity(path.join(commonDir, 'refs'))
        return JSON.stringify([identity(yield* fileSystem.stat(root)), identity(marker), pointer, gitDirIdentity, commonPointer, commonIdentity])
      })

      const discover = (selection: string): Effect.Effect<Boundary, RepositoryInitFailed | PlatformError.PlatformError> =>
        Effect.gen(function* () {
          const jj = yield* entry(path.join(selection, '.jj'))
          if (Option.isSome(jj))
            return { root: selection, kind: 'jj', identity: identity(yield* fileSystem.stat(selection)), worktree: false } satisfies Boundary
          const git = yield* entry(path.join(selection, '.git'))
          // A malformed nested marker must never fall through to an outer checkout.
          if (Option.isSome(git)) {
            return { root: selection, kind: 'git', identity: yield* gitIdentity(selection, git.value), worktree: git.value.type === 'File' } satisfies Boundary
          }
          // Stop inside bare repositories and Git administration directories, even inside another working checkout.
          const bare = yield* Effect.all([entry(path.join(selection, 'HEAD')), entry(path.join(selection, 'objects')), entry(path.join(selection, 'refs'))])
          if (bare.every(Option.isSome)) return yield* refuse('missing')
          const parent = path.dirname(selection)
          if (parent === selection) return yield* refuse('missing')
          return yield* discover(parent)
        })

      const verifyRoot = <E>(input: { readonly root: string; readonly runJj: RepositoryInitRunner<E>; readonly existing: boolean }) =>
        Effect.gen(function* () {
          const output = yield* validateJjMarker(input.root).pipe(
            Effect.andThen(input.runJj(input.root, ['--ignore-working-copy', 'root'])),
            Effect.mapError(cause => new RepositoryInitFailed({ reason: input.existing ? 'existing' : 'root', cause })),
          )
          const line = output.stdout.trim()
          if (output.truncated || line.length === 0 || /[\r\n\0]/u.test(line) || !path.isAbsolute(line)) return yield* refuse('root')
          if ((yield* fileSystem.realPath(line)) !== input.root) return yield* refuse('root')
        })

      const initialize = <E>(input: {
        readonly path: string
        readonly selection: string
        readonly boundary: Boundary
        readonly runJj: RepositoryInitRunner<E>
      }) =>
        Effect.gen(function* () {
          if ((yield* fileSystem.realPath(input.path)) !== input.selection) return yield* refuse('changed')
          const confirmed = yield* discover(input.selection)
          if (confirmed.kind === 'jj' && confirmed.root === input.boundary.root) {
            yield* verifyRoot({ root: confirmed.root, runJj: input.runJj, existing: true })
            return { root: confirmed.root, initialized: false }
          }
          if (confirmed.root !== input.boundary.root || confirmed.kind !== 'git' || confirmed.identity !== input.boundary.identity)
            return yield* refuse('changed')
          // Last metadata/identity check immediately before the managed mutation.
          const root = input.boundary.root
          if ((yield* fileSystem.realPath(root)) !== root || Option.isSome(yield* entry(path.join(root, '.jj')))) return yield* refuse('changed')
          yield* input
            .runJj(root, ['--config=snapshot.auto-track=none()', 'git', 'init', '--colocate'])
            .pipe(Effect.mapError(cause => new RepositoryInitFailed({ reason: input.boundary.worktree ? 'worktree' : 'init', cause })))
          if ((yield* gitIdentity(root, yield* fileSystem.lstat(path.join(root, '.git')))) !== input.boundary.identity) return yield* refuse('changed')
          if (Option.isNone(yield* entry(path.join(root, '.jj')))) return yield* refuse('root')
          yield* verifyRoot({ root, runJj: input.runJj, existing: false })
          return { root, initialized: true }
        })

      const ensure = Effect.fn('jujutsu repository ensure')(function* <E>(input: { readonly path: string; readonly runJj: RepositoryInitRunner<E> }) {
        return yield* Effect.gen(function* () {
          if (input.path.length === 0 || input.path.includes('\0')) return yield* refuse('path')
          const selection = yield* fileSystem.realPath(input.path)
          if ((yield* fileSystem.stat(selection)).type !== 'Directory') return yield* refuse('path')
          const boundary = yield* discover(selection)
          if (boundary.kind === 'jj') {
            yield* verifyRoot({ root: boundary.root, runJj: input.runJj, existing: true })
            return { root: boundary.root, initialized: false }
          }
          return yield* initializing.withLock(boundary.root)(initialize({ path: input.path, selection, boundary, runJj: input.runJj }))
        }).pipe(Effect.catchTag('PlatformError', cause => Effect.fail(new RepositoryInitFailed({ reason: 'marker', cause }))))
      })

      return RepositoryInitializer.of({ ensure })
    }),
  )
}
