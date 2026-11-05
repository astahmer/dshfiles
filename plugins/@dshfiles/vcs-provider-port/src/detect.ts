import { Context, Effect, FileSystem, Layer, Option, Path } from 'effect'
/** The version-control systems a path can belong to; jj wins when a checkout has both `.jj` and `.git`. */
export type VcsKind = 'jj' | 'git'

const GITDIR_LINE = /^gitdir:\s*(.+?)\s*$/mu

/**
 * Which backend owns a path: the nearest ancestor holding `.jj` or `.git`, jj first when one folder holds both (a
 * colocated repository is jj's). A linked `git worktree` (whose `.git` is a file) of a colocated repository is jj's
 * too: its common git directory sits beside the repository's `.jj`, so the git adapter must not manage it. The path
 * is resolved through symlinks first, so a link into a repository routes like the folder it names. A path inside
 * neither keeps jj, so its errors read as before git support existed. Only the filesystem is read: no process starts,
 * so routing costs nothing next to the command it routes.
 */
export class VcsDetector extends Context.Service<
  VcsDetector,
  {
    readonly kindOf: (target: string) => Effect.Effect<VcsKind>
    /** Undefined outside any repository; `kindOf` reads this as jj. */
    readonly detect: (target: string) => Effect.Effect<VcsKind | undefined>
  }
>()('@dshfiles/vcs-provider-port/VcsDetector') {
  static readonly layer = Layer.effect(
    VcsDetector,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const exists = (target: string) => fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false))

      const readText = (target: string) => fileSystem.readFileString(target).pipe(Effect.option)

      /** The common git directory a linked worktree's `.git` file points at, through its `commondir` file. */
      const commonDirOf = Effect.fnUntraced(function* (dotGit: string) {
        const pointer = yield* readText(dotGit)
        const gitdir = Option.flatMap(pointer, text => Option.fromNullishOr(GITDIR_LINE.exec(text)?.[1]))
        if (Option.isNone(gitdir)) return Option.none<string>()
        const worktreeGitDir = path.resolve(path.dirname(dotGit), gitdir.value)
        const common = yield* readText(path.join(worktreeGitDir, 'commondir'))
        return Option.some(Option.isSome(common) ? path.resolve(worktreeGitDir, common.value.trim()) : worktreeGitDir)
      })

      const markerAt = Effect.fnUntraced(function* (directory: string) {
        if (yield* exists(path.join(directory, '.jj'))) return Option.some<VcsKind>('jj')
        const dotGit = path.join(directory, '.git')
        const info = yield* fileSystem.stat(dotGit).pipe(Effect.option)
        if (Option.isNone(info)) return Option.none<VcsKind>()
        if (info.value.type === 'File') {
          const common = yield* commonDirOf(dotGit)
          if (Option.isSome(common) && (yield* exists(path.join(path.dirname(common.value), '.jj')))) return Option.some<VcsKind>('jj')
        }
        return Option.some<VcsKind>('git')
      })

      /** Symlinks resolved; a missing tail keeps its resolved parent, so a deleted folder still walks the real tree. */
      const canonical = (target: string): Effect.Effect<string> =>
        fileSystem.realPath(target).pipe(
          Effect.catch(() => {
            const parent = path.dirname(target)
            return parent === target ? Effect.succeed(target) : Effect.map(canonical(parent), real => path.join(real, path.basename(target)))
          }),
        )

      const detect = (target: string): Effect.Effect<VcsKind | undefined> =>
        Effect.gen(function* () {
          let directory = yield* canonical(path.resolve(target))
          for (;;) {
            const found = yield* markerAt(directory)
            if (Option.isSome(found)) return found.value
            const parent = path.dirname(directory)
            if (parent === directory) return undefined
            directory = parent
          }
        })

      return VcsDetector.of({ detect, kindOf: target => Effect.map(detect(target), kind => kind ?? 'jj') })
    }),
  )
}
