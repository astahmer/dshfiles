import { randomUUID } from 'node:crypto'
import { Context, Effect, FileSystem, Layer, Path, type PlatformError } from 'effect'
import { dshHome } from './dsh-home.js'

const isMissing = (error: PlatformError.PlatformError): boolean => error.reason._tag === 'NotFound'

/**
 * The plugin's owner-only state files under `<DSH home>/runtime`: read with a fallback for a file that does not exist
 * yet, and replaced atomically (a temporary file renamed over the old one, removed when anything fails).
 */
export class StateFiles extends Context.Service<
  StateFiles,
  {
    readonly home: string
    readonly runtimePath: (name: string) => string
    readonly read: (input: { readonly path: string; readonly missing: string }) => Effect.Effect<string, PlatformError.PlatformError>
    readonly write: (input: { readonly path: string; readonly text: string }) => Effect.Effect<void, PlatformError.PlatformError>
  }
>()('@dshfiles/thread-sidebar/StateFiles') {
  static readonly layerAt = (home: string) =>
    Layer.effect(
      StateFiles,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const resolvedHome = path.resolve(home)
        const runtime = path.join(resolvedHome, 'runtime')
        return StateFiles.of({
          home: resolvedHome,
          runtimePath: name => path.join(runtime, name),
          read: Effect.fn('runtime file read')(function* (input) {
            return yield* fs.readFileString(input.path).pipe(Effect.catchIf(isMissing, () => Effect.succeed(input.missing)))
          }),
          write: Effect.fn('runtime file write')(function* (input) {
            yield* fs.makeDirectory(path.dirname(input.path), { recursive: true, mode: 0o700 })
            const temporaryPath = `${input.path}.${randomUUID()}.tmp`
            yield* fs.writeFileString(temporaryPath, input.text, { flag: 'wx', mode: 0o600 }).pipe(
              Effect.andThen(fs.rename(temporaryPath, input.path)),
              Effect.onError(() => fs.remove(temporaryPath, { force: true }).pipe(Effect.ignore)),
            )
          }),
        })
      }),
    )

  static readonly layer = Layer.unwrap(Effect.sync(() => StateFiles.layerAt(dshHome())))
}
