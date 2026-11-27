import { HostContext } from '@dshfiles/dshx/effect'
import type { ToolAccessProvider } from '@dshfiles/tool-search/access'
import { Effect, Layer } from 'effect'
import { AgentsRegistry } from './store.js'

/**
 * The `@dshfiles/tool-search/access` provider: tool-search asks it, synchronously, which agent a live thread has and
 * what tools that agent allows, and follows its change reports (overrides) from the thread's next request.
 */
export const ToolAccessProviderLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* HostContext
    const registry = yield* AgentsRegistry
    const provider: ToolAccessProvider = {
      resolve: subject => registry.threadPolicyNow(subject),
      subscribe: listener => registry.subscribe(listener),
    }
    yield* Effect.acquireRelease(
      Effect.sync(() => host.ctx.provide('dshfilesToolAccess', provider)),
      withdraw => Effect.sync(withdraw),
    )
  }),
)
