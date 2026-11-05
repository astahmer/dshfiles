import { Api, DshxPlugin, hostService } from '@dshfiles/dshx/effect'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { Effect, Layer } from 'effect'
import { AgentPresets } from './agent-presets-promise.js'
import { agentsApi } from './api.js'
import { DelegationGuard } from './delegation-guard.js'
import { AgentsRegistry } from './store.js'

/**
 * Registering a subagent or a workflow is denied before dispatch when the agent that started the thread set
 * `delegation.subagents: false`. The tool guard is synchronous, so it reads the registry's in-memory state.
 */
const delegationGuard = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* hostService('tools')
    const registry = yield* AgentsRegistry
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        tools.guard(execution =>
          DelegationGuard.refusal({ toolName: execution.name, agent: execution.agent === undefined ? null : registry.threadAgentNow(execution.agent.id) }),
        ),
      ),
      dispose => Effect.sync(dispose),
    )
  }),
)

const registryLayer = AgentsRegistry.layer.pipe(Layer.provide(StorageDomain.layer))

export default DshxPlugin.make({
  name: '@dshfiles/agents',
  inject: ['storageDomain'],
  layer: Layer.mergeAll(delegationGuard, AgentPresets.layer).pipe(Layer.provideMerge(registryLayer)),
  apis: [
    Api.bind(agentsApi, {
      list: () => AgentsRegistry.use(registry => registry.snapshot),
      get: input => AgentsRegistry.use(registry => Effect.map(registry.resolve(input.handle), agent => ({ agent }))),
      presets: () => AgentPresets.use(presets => Effect.map(presets.list, rows => ({ presets: [...rows] }))),
      save: input => AgentsRegistry.use(registry => registry.save(input.agent)),
      remove: input => AgentsRegistry.use(registry => registry.remove(input.handle)),
      recordUse: input => AgentsRegistry.use(registry => registry.recordUse(input.handle, input.thread)),
      threads: input => AgentsRegistry.use(registry => Effect.map(registry.threads(input.handle), threads => ({ threads }))),
      threadAgent: input => AgentsRegistry.use(registry => Effect.map(registry.threadAgent(input.sessionId), agent => ({ agent }))),
      threadHandles: () => AgentsRegistry.use(registry => Effect.map(registry.threadHandles, threads => ({ threads: [...threads] }))),
    }),
  ],
})
