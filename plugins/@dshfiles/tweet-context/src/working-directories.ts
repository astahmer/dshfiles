import type { Agent } from '@deepseek-ai/dsh-agent'
import '@deepseek-ai/dsh-working-directory'
import { hostService } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Path } from 'effect'
import { AnimationSourceUnavailable } from './errors.js'

/** Where an Agent's relative file paths resolve: its thread folder, from the Host working-directory service. */
export class WorkingDirectories extends Context.Service<
  WorkingDirectories,
  { readonly resolve: (agent: Agent, file: string) => Effect.Effect<string, AnimationSourceUnavailable> }
>()('@dshfiles/tweet-context/WorkingDirectories') {
  /** Resolve against a fixed folder (tests, or any caller that already knows the folder). */
  static readonly fixed = (folder: string) =>
    Layer.effect(
      WorkingDirectories,
      Effect.gen(function* () {
        const path = yield* Path.Path
        return WorkingDirectories.of({ resolve: (_agent, file) => Effect.succeed(path.resolve(folder, file)) })
      }),
    )

  static readonly layer = Layer.effect(
    WorkingDirectories,
    Effect.gen(function* () {
      const workingDirectory = yield* hostService('workingDirectory')
      const path = yield* Path.Path
      return WorkingDirectories.of({
        resolve: (agent, file) =>
          path.isAbsolute(file)
            ? Effect.succeed(path.normalize(file))
            : Effect.tryPromise({
                try: signal => workingDirectory.ensure(agent, signal),
                catch: cause => new AnimationSourceUnavailable({ reason: 'no-working-directory', path: file, cause }),
              }).pipe(Effect.map(folder => path.resolve(folder, file))),
      })
    }),
  )
}
