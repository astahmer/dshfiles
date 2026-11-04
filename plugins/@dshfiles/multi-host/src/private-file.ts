import { randomUUID } from 'node:crypto'
import { Effect, FileSystem, Path, type PlatformError } from 'effect'

const isNotFound = (error: PlatformError.PlatformError): boolean => error.reason._tag === 'NotFound'

/** The file's info without following a symlink, or undefined when nothing is there. */
const lstatIfPresent = (input: { readonly fileSystem: FileSystem.FileSystem; readonly path: string }) =>
  input.fileSystem.lstat(input.path).pipe(
    Effect.map((info): FileSystem.File.Info | undefined => info),
    Effect.catchIf(isNotFound, () => Effect.succeed(undefined)),
  )

/**
 * Tighten a private data file and its directory to 0600/0700. `invalid` when either is not what it claims to be (a
 * symlink, a directory in place of the file), which callers refuse instead of following.
 */
const secure = Effect.fnUntraced(function* (file: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const parent = path.dirname(file)
  const parentInfo = yield* lstatIfPresent({ fileSystem, path: parent })
  if (parentInfo === undefined) return 'missing' as const
  if (parentInfo.type !== 'Directory') return 'invalid' as const
  yield* fileSystem.chmod(parent, 0o700)
  const fileInfo = yield* lstatIfPresent({ fileSystem, path: file })
  if (fileInfo === undefined) return 'missing' as const
  if (fileInfo.type !== 'File') return 'invalid' as const
  yield* fileSystem.chmod(file, 0o600)
  return 'secured' as const
})

/** The file's text, or undefined when it does not exist. */
const readIfPresent = Effect.fnUntraced(function* (file: string) {
  const fileSystem = yield* FileSystem.FileSystem
  return yield* fileSystem.readFileString(file).pipe(
    Effect.map((text): string | undefined => text),
    Effect.catchIf(isNotFound, () => Effect.succeed(undefined)),
  )
})

/**
 * Write a 0600 file in a 0700 directory through a private temporary file: `rename` replaces the target, `link`
 * refuses an existing one so the first concurrent writer wins. The temporary file never survives a failure.
 */
const write = Effect.fnUntraced(function* (input: { readonly path: string; readonly body: string; readonly commit: 'rename' | 'link' }) {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const parent = path.dirname(input.path)
  yield* fileSystem.makeDirectory(parent, { recursive: true, mode: 0o700 })
  yield* fileSystem.chmod(parent, 0o700)
  const temporary = `${input.path}.${process.pid}.${randomUUID()}.tmp`
  const removeTemporary = Effect.ignore(fileSystem.remove(temporary, { force: true }))
  yield* Effect.scoped(
    Effect.gen(function* () {
      const file = yield* fileSystem.open(temporary, { flag: 'wx', mode: 0o600 })
      yield* file.writeAll(new TextEncoder().encode(input.body))
      yield* file.sync
    }),
  ).pipe(Effect.onError(() => removeTemporary))
  const commit = input.commit === 'link' ? Effect.andThen(fileSystem.link(temporary, input.path), removeTemporary) : fileSystem.rename(temporary, input.path)
  yield* commit.pipe(
    Effect.andThen(fileSystem.chmod(input.path, 0o600)),
    Effect.onError(() => removeTemporary),
  )
})

export class PrivateFile {
  static readonly secure = secure
  static readonly readIfPresent = readIfPresent
  static readonly write = write
  static readonly isNotFound = isNotFound
}
