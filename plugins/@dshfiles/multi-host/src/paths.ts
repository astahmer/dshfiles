import { Config, Context, Effect, Layer, Path } from 'effect'

/** Where this runtime keeps its DSH home and the multi-host plugin data under it. */
export class MultiHostPaths extends Context.Service<
  MultiHostPaths,
  {
    readonly dshHome: string
    readonly dataDirectory: string
    readonly dataPath: (fileName: string) => string
  }
>()('@dshfiles/multi-host/MultiHostPaths') {
  static readonly make = (input: { readonly dshHome: string; readonly path: Path.Path }) => {
    const dataDirectory = input.path.join(input.dshHome, 'plugins', 'multi-host')
    return MultiHostPaths.of({ dshHome: input.dshHome, dataDirectory, dataPath: fileName => input.path.join(dataDirectory, fileName) })
  }

  /** `DSH_HOME`, or `~/.dsh` like the DSH CLI, read from the active ConfigProvider. */
  static readonly layer = Layer.effect(
    MultiHostPaths,
    Effect.gen(function* () {
      const path = yield* Path.Path
      const configured = yield* Config.option(Config.NonEmptyString('DSH_HOME'))
      const home = yield* Config.NonEmptyString('HOME').pipe(Config.withDefault('/'))
      const dshHome = configured._tag === 'Some' ? configured.value : path.join(home, '.dsh')
      return MultiHostPaths.make({ dshHome, path })
    }).pipe(Effect.orDie),
  )
}
