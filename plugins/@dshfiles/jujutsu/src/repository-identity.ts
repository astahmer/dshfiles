import { Context, Effect, FileSystem, Layer, Option, type PlatformError } from 'effect'
import { InvalidRepositoryPath, RepositoryMoved } from './errors.js'

/** A repository the browser selected: its canonical root and that directory's `dev:ino` at registration. */
export interface RegisteredRepo {
  readonly id: string
  readonly root: string
  readonly identity: string
}

/**
 * The device and inode of a repository directory. A registration is bound to them, so a directory swapped in under
 * the registered path (a rename plus a new checkout, or a symlink) is refused instead of read or mutated.
 */
export class RepositoryIdentity extends Context.Service<
  RepositoryIdentity,
  {
    /** `dev:ino` of a canonical directory path; a path that resolves through a symlink, or a file, is refused. */
    readonly of: (path: string) => Effect.Effect<string, InvalidRepositoryPath | PlatformError.PlatformError>
    /** Fails with `RepositoryMoved` unless the registered root is still the same directory. */
    readonly verify: (repo: RegisteredRepo) => Effect.Effect<void, RepositoryMoved>
  }
>()('@dshfiles/jujutsu/RepositoryIdentity') {
  static readonly layer = Layer.effect(
    RepositoryIdentity,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem

      const of = Effect.fnUntraced(function* (path: string) {
        const canonical = yield* fileSystem.realPath(path)
        if (canonical !== path) return yield* new InvalidRepositoryPath({ reason: 'symlink' })
        const info = yield* fileSystem.stat(canonical)
        if (info.type !== 'Directory') return yield* new InvalidRepositoryPath({ reason: 'not-directory' })
        return String(info.dev) + ':' + String(Option.getOrElse(info.ino, () => 0n))
      })

      const verify = Effect.fnUntraced(function* (repo: RegisteredRepo) {
        const current = yield* of(repo.root).pipe(Effect.mapError(cause => new RepositoryMoved({ reason: 'unavailable', cause })))
        if (current !== repo.identity) return yield* new RepositoryMoved({ reason: 'changed' })
      })

      return RepositoryIdentity.of({ of, verify })
    }),
  )
}
