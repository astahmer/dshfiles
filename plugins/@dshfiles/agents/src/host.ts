import { dshxRegistryApi } from '@dshfiles/dshx/api'
import { Api, DshxPlugin, hostService } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { ToolAccess } from '@dshfiles/tool-search/access'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Context, Effect, Layer } from 'effect'
import { AgentPresets } from './agent-presets-promise.js'
import { agentsApi, type ToolCatalogView } from './api.js'
import { DelegationGuard } from './delegation-guard.js'
import { ProjectLocator } from './project-locator.js'
import { ToolAccessProviderLayer } from './tool-access-provider.js'
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

/** The Host's tools as the dshx registry lists them, grouped by the contract's own rule. */
class ToolCatalog extends Context.Service<ToolCatalog, { readonly read: Effect.Effect<ToolCatalogView> }>()('@dshfiles/agents/ToolCatalog') {
  static readonly layer = Layer.effect(
    ToolCatalog,
    Effect.map(HostApis, apis => {
      const registry = apis.client(dshxRegistryApi)
      return ToolCatalog.of({
        read: Effect.gen(function* () {
          const listed = yield* registry.list({})
          const groups = new Map<
            string,
            { key: string; kind: ToolCatalogView['groups'][number]['kind']; label: string; tools: { name: string; summary: string }[] }
          >()
          for (const tool of listed.tools) {
            const group = ToolAccess.groupOf({ name: tool.name, source: tool.source, owner: tool.owner })
            const entry = groups.get(group.key) ?? { ...group, tools: [] }
            entry.tools.push({ name: tool.name, summary: ToolAccess.summaryOf(tool.description) })
            groups.set(group.key, entry)
          }
          yield* Effect.annotateCurrentSpan({ tools: listed.tools.length, groups: groups.size })
          return {
            groups: [...groups.values()]
              .map(group => ({ ...group, tools: group.tools.sort((left, right) => left.name.localeCompare(right.name)) }))
              .sort((left, right) => left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label)),
          }
        }).pipe(
          Effect.catchTag('ApiCallError', () => Effect.succeed({ groups: [] })),
          Effect.withSpan('agents tool catalog'),
        ),
      })
    }),
  ).pipe(Layer.provide(HostApis.layer))
}

const registryLayer = AgentsRegistry.layer.pipe(Layer.provide(Layer.merge(StorageDomain.layer, ProjectLocator.layer)))

export default DshxPlugin.make({
  name: '@dshfiles/agents',
  inject: ['storageDomain', 'workspaceRegistry'],
  layer: Layer.mergeAll(delegationGuard, ToolAccessProviderLayer, AgentPresets.layer, ToolCatalog.layer).pipe(Layer.provideMerge(registryLayer)),
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
      toolCatalog: () => ToolCatalog.use(catalog => catalog.read),
      toolAccess: input =>
        AgentsRegistry.use(registry => Effect.map(registry.resolve(input.handle), agent => ({ handle: input.handle, access: agent?.tools ?? null }))),
      setToolAccess: input => AgentsRegistry.use(registry => registry.editToolAccess(input.handle, input.edits)),
      setSubagents: input => AgentsRegistry.use(registry => registry.setSubagents(input.handle, input.subagents)),
      projectDefaults: () => AgentsRegistry.use(registry => Effect.map(registry.projectDefaults, projects => ({ projects }))),
      setProjectDefault: input => AgentsRegistry.use(registry => registry.setProjectDefault(input.projectId, input.handle)),
      threadAccess: input =>
        AgentsRegistry.use(registry =>
          Effect.gen(function* () {
            // The live agent's header, when the thread is running, makes a preview match what attaching would decide.
            const live = (yield* Effect.option(hostService('agents'))).pipe(agents =>
              agents._tag === 'Some' ? agents.value.get(SessionId(input.sessionId)) : undefined,
            )
            const header = live?.session.header
            return yield* registry.threadAccess({
              sessionId: input.sessionId,
              cwd: header?.cwd === '' ? undefined : header?.cwd,
              parentSessionId: header?.origin === 'subagent' ? header.parentSession : undefined,
            })
          }),
        ),
      setThreadOverride: input => AgentsRegistry.use(registry => registry.setThreadOverride(input.sessionId, input.override)),
      recordThreadAgent: input => AgentsRegistry.use(registry => Effect.map(registry.recordThreadAgent(input.sessionId, input.handle), view => ({ view }))),
      threadHandles: () => AgentsRegistry.use(registry => Effect.map(registry.threadHandles, threads => ({ threads: [...threads] }))),
    }),
  ],
})
