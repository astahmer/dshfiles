import type { Agent } from '@deepseek-ai/dsh-agent'
import '@deepseek-ai/dsh-working-directory'
import { hostService } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer } from 'effect'
import { FffSearchError } from './fff-search.js'

/** The Host's Promise working-directory service: where one Agent's searches are rooted. */
export class WorkingDirectories extends Context.Service<WorkingDirectories, { readonly ensure: (agent: Agent) => Effect.Effect<string, FffSearchError> }>()(
  '@dshfiles/fff-search/WorkingDirectories',
) {
  static readonly layer = Layer.effect(
    WorkingDirectories,
    Effect.gen(function* () {
      const workingDirectory = yield* hostService('workingDirectory')
      return WorkingDirectories.of({
        ensure: agent =>
          Effect.tryPromise({
            try: signal => workingDirectory.ensure(agent, signal),
            catch: cause => new FffSearchError({ reason: 'The Agent has no usable working directory; set the thread folder and retry.', cause }),
          }),
      })
    }),
  )
}
