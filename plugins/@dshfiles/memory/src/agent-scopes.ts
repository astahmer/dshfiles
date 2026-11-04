import { agentsApi } from '@dshfiles/agents/contract'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Cache, Context, Effect, Layer } from 'effect'

import { resolveAgentScope, type AgentScopeLookup } from './agent-scope.ts'
import { SessionReads } from './session-reads-promise.ts'

/** Session id → the memory scope it reads; a null answer is cached too, so a plain thread costs one lookup. */
export class AgentScopes extends Context.Service<AgentScopes, { readonly of: (sessionId: string) => Effect.Effect<string | null> }>()(
  '@dshfiles/memory/AgentScopes',
) {
  static readonly layer = Layer.effect(
    AgentScopes,
    Effect.gen(function* () {
      const apis = yield* HostApis
      const sessions = yield* SessionReads
      const agents = apis.client(agentsApi)
      const lookup: AgentScopeLookup<never> = {
        threadAgent: sessionId =>
          agents.threadAgent({ sessionId }).pipe(
            Effect.map(result => (result.agent === null ? null : { memoryScope: result.agent.memoryScope })),
            Effect.orElseSucceed(() => null),
          ),
        parentOf: sessions.parentOf,
      }
      const scopes = yield* Cache.make({
        capacity: 4_096,
        lookup: (sessionId: string) =>
          Effect.flatMap(apis.isServed(agentsApi), served => (served ? resolveAgentScope({ sessionId, lookup }) : Effect.succeed(null))),
      })
      return AgentScopes.of({ of: sessionId => Cache.get(scopes, sessionId) })
    }),
  )
}
