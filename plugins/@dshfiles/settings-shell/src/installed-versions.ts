import { createRequire } from 'node:module'
import { Context, Effect, FileSystem, Layer, Option, Schema } from 'effect'
import { PORTED_FROM, WELCOME_PORTED_FROM } from './upstream.js'

const packageVersionJson = Schema.fromJsonString(Schema.Struct({ version: Schema.String }))

/**
 * Native package versions as the running `dsh` resolves them, read once from beside its entry script; null when
 * unreadable. They cannot change while the Host process runs.
 */
export class InstalledVersions extends Context.Service<
  InstalledVersions,
  {
    readonly dsh: string | null
    /** The native settings shell this plugin ports. */
    readonly upstream: string | null
    /** The native welcome notice this plugin ports. */
    readonly welcome: string | null
  }
>()('@dshfiles/settings-shell/InstalledVersions') {
  static readonly layerFrom = (input: { readonly entryScript: string | undefined }) =>
    Layer.effect(
      InstalledVersions,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const entry = input.entryScript === undefined ? Option.none() : yield* Effect.option(fs.realPath(input.entryScript))

        const versionOf = (packageName: string) =>
          Option.match(entry, {
            onNone: () => Effect.succeed(null),
            onSome: realEntry =>
              Effect.try(() => createRequire(realEntry).resolve(`${packageName}/package.json`)).pipe(
                Effect.flatMap(manifestPath => fs.readFileString(manifestPath)),
                Effect.flatMap(Schema.decodeUnknownEffect(packageVersionJson)),
                Effect.map(manifest => manifest.version),
                Effect.orElseSucceed(() => null),
              ),
          })

        const [dsh, upstream, welcome] = yield* Effect.all(
          [versionOf('@deepseek-ai/dsh'), versionOf(PORTED_FROM.packageName), versionOf(WELCOME_PORTED_FROM.packageName)],
          { concurrency: 'unbounded' },
        )
        return InstalledVersions.of({ dsh, upstream, welcome })
      }).pipe(Effect.withSpan('settings-shell installed versions read')),
    )

  static readonly layer = InstalledVersions.layerFrom({ entryScript: process.argv[1] })
}
