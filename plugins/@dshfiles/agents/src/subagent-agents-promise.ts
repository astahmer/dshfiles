import { HostContext } from '@dshfiles/dshx/effect'
import { SUBAGENT_AGENT_RESOLVER_SERVICE, type SubagentAgentResolver } from '@dshfiles/tool-subagent/agent-resolver'
import { Effect, Layer, Schema } from 'effect'
import { AgentsRegistry } from './store.js'
import { SubagentAgents } from './subagent-agents.js'

/** The agent was removed between the resolution and the child's start; the tool reports this and starts nothing. */
class SubagentAgentRemoved extends Schema.TaggedError<SubagentAgentRemoved>()('SubagentAgentRemoved', { handle: Schema.String }) {
  override get message(): string {
    return `@${this.handle} was removed before its subagent started; pick another agent (list_subagent_models) or omit \`agent\`.`
  }
}

/**
 * The `@dshfiles/tool-subagent/agent-resolver` provider: the `subagent` tool asks it, synchronously, which agent a
 * fresh child starts as, and awaits its `record` before the child exists so tool-search applies that agent's tools
 * from the child's first request.
 */
export const SubagentAgentsProviderLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* HostContext
    const registry = yield* AgentsRegistry
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>())
    const parentOf = (subject: Parameters<SubagentAgentResolver['list']>[0]) => ({
      agents: registry.agentsNow(),
      parent: registry.threadPolicyNow(subject).agent,
    })
    const resolver: SubagentAgentResolver = {
      resolve: request => {
        const decision = SubagentAgents.decide({ ...parentOf(request.parent), handle: request.handle })
        if (decision.kind !== 'agent') return decision
        const { agent } = decision
        return {
          kind: 'agent',
          handle: agent.handle,
          route: agent.route,
          preset: agent.preset,
          preamble: SubagentAgents.preamble(agent),
          record: childSessionId =>
            runPromise(
              registry.recordThreadAgent(childSessionId, agent.handle).pipe(
                Effect.flatMap(view => (view === null ? Effect.fail(new SubagentAgentRemoved({ handle: agent.handle })) : Effect.void)),
                Effect.withSpan('agents subagent agent record', { attributes: { handle: agent.handle } }),
              ),
            ),
        }
      },
      list: subject => SubagentAgents.listing(parentOf(subject)),
    }
    yield* Effect.acquireRelease(
      Effect.sync(() => host.ctx.provide(SUBAGENT_AGENT_RESOLVER_SERVICE, resolver)),
      withdraw => Effect.sync(withdraw),
    )
  }),
)
