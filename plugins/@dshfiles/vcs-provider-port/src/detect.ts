import { Context, Effect, FileSystem, Layer, Option, Path } from 'effect'
/** The version-control systems a path can belong to; jj wins when a checkout has both `.jj` and `.git`. */
export type VcsKind = 'jj' | 'git'

/**
 * Which backend owns a path: the nearest ancestor holding `.jj` or `.git`, jj first when one folder holds both (a
 * colocated repository is jj's). A path inside neither keeps jj, so its errors read as before git support existed.
 * Only the filesystem is read: no process starts, so routing costs nothing next to the command it routes.
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

      const markerAt = Effect.fnUntraced(function* (directory: string) {
        if (yield* exists(path.join(directory, '.jj'))) return Option.some<VcsKind>('jj')
        if (yield* exists(path.join(directory, '.git'))) return Option.some<VcsKind>('git')
        return Option.none<VcsKind>()
      })

      const detect = (target: string): Effect.Effect<VcsKind | undefined> =>
        Effect.gen(function* () {
          let directory = path.resolve(target)
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
