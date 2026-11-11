import { createHash } from 'node:crypto'
import { Context, Effect, FileSystem, Layer, Path } from 'effect'

/**
 * The files the profile reconciler writes and DSH reads only at boot. `cordis.patch.yml` is left out: DSH itself
 * rewrites it on every settings change, which would read as a pending update.
 */
const PROFILE_FILES = ['package.json', '.dshfiles-profile-sync.json']

/** The profile this Host booted: `--profile <name>`, else `web` for `dsh web`. */
export const bootProfileName = (argv: ReadonlyArray<string>): string => {
  const flag = argv.findIndex(argument => argument === '--profile')
  const value = flag === -1 ? argv.find(argument => argument.startsWith('--profile='))?.slice('--profile='.length) : argv[flag + 1]
  return value !== undefined && /^[A-Za-z0-9][\w-]*$/u.test(value) ? value : 'web'
}

/** Whether the booted profile's dependency manifest or reconciler record changed on disk since this Host started. */
export class ProfileChange extends Context.Service<ProfileChange, { readonly changed: Effect.Effect<boolean> }>()('@dshfiles/thread-sidebar/ProfileChange') {
  static readonly layerWith = (input: { readonly profileDirectory: string }) =>
    Layer.effect(
      ProfileChange,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const fingerprint = Effect.forEach(PROFILE_FILES, file =>
          fs.readFileString(path.join(input.profileDirectory, file)).pipe(Effect.orElseSucceed(() => '')),
        ).pipe(Effect.map(contents => contents.reduce((digest, text) => digest.update(text).update('\0'), createHash('sha256')).digest('hex')))
        const atBoot = yield* fingerprint
        return ProfileChange.of({ changed: Effect.map(fingerprint, now => now !== atBoot) })
      }),
    )
}
