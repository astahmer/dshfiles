import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { Context as EffectContext, Effect, Layer, Schema } from 'effect'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { agentsApi, type AgentPresetRow } from './api.js'
import { DelegationGuard } from './delegation-guard.js'
import { AgentRegistry, agentsDomain, type AgentsStore } from './store.js'

class AgentRegistryStorageUnavailable extends Schema.TaggedError<AgentRegistryStorageUnavailable>()('AgentRegistryStorageUnavailable', {
  message: Schema.String,
}) {}

interface AgentsHostService {
  readonly store: AgentsStore
  readonly listPresets: () => Promise<AgentPresetRow[]>
  readonly registerGuard: () => (() => void) | undefined
}

class AgentsHost extends EffectContext.Service<AgentsHost, AgentsHostService>()('dshfiles/agents/AgentsHost') {}

const agentsPlugin = DshxEffect.plugin({
  layer: (ctx: Context) =>
    Layer.effect(
      AgentsHost,
      Effect.gen(function* () {
        const storage = ctx.get('storageDomain')
        if (storage === undefined) return yield* Effect.fail(new AgentRegistryStorageUnavailable({ message: 'Agent registry storage is unavailable.' }))
        const domain = yield* Effect.tryPromise({
          try: () => storage.open(agentsDomain),
          catch: () => new AgentRegistryStorageUnavailable({ message: 'Agent registry storage could not be opened.' }),
        })
        const store = AgentRegistry.createStore({ table: domain.table('agents'), threads: domain.table('threads') })
        yield* Effect.acquireRelease(Effect.succeed(domain), active =>
          Effect.promise(async () => {
            await store.flush()
            await active.close()
          }),
        )
        const presets = ctx.get('agentPresets')
        const tools = ctx.get('tools')
        return {
          store,
          listPresets: async () => {
            if (presets === undefined) return []
            const rows = await presets.list()
            return rows.map(row => {
              const preset: AgentPresetRow = { id: row.id }
              if (row.name !== undefined) preset.name = row.name
              if (row.description !== undefined) preset.description = row.description
              if (row.broken !== undefined) preset.broken = row.broken
              return preset
            })
          },
          registerGuard: () =>
            tools?.guard(execution =>
              DelegationGuard.refusal({ toolName: execution.name, agent: execution.agent === undefined ? null : store.threadAgent(execution.agent.id) }),
            ),
        }
      }),
    ),
  setup: () =>
    Effect.gen(function* () {
      const active = yield* AgentsHost
      const dispose = yield* Effect.sync(() => active.registerGuard())
      if (dispose !== undefined) yield* Effect.acquireRelease(Effect.succeed(dispose), release => Effect.sync(() => release()))
    }),
})

const { hostApi, ...effectHost } = agentsPlugin

const agentsApiHost = hostApi(agentsApi, {
  list: Effect.fn('agents list')(() => AgentsHost.use(active => Effect.sync(() => active.store.snapshot()))),
  get: Effect.fn('agents get')(({ input }) => AgentsHost.use(active => Effect.sync(() => ({ agent: active.store.resolve(input.handle) })))),
  presets: Effect.fn('agents presets')(() =>
    AgentsHost.use(active => Effect.tryPromise({ try: () => active.listPresets(), catch: error => error }).pipe(Effect.map(presets => ({ presets })))),
  ),
  save: Effect.fn('agents save')(({ input }) =>
    AgentsHost.use(active => Effect.tryPromise({ try: () => active.store.save(input.agent), catch: error => error })),
  ),
  remove: Effect.fn('agents remove')(({ input }) =>
    AgentsHost.use(active => Effect.tryPromise({ try: () => active.store.remove(input.handle), catch: error => error })),
  ),
  recordUse: Effect.fn('agents record use')(({ input }) =>
    AgentsHost.use(active => Effect.tryPromise({ try: () => active.store.recordUse(input.handle, input.thread), catch: error => error })),
  ),
  threads: Effect.fn('agents threads')(({ input }) => AgentsHost.use(active => Effect.sync(() => ({ threads: active.store.threads(input.handle) })))),
  threadAgent: Effect.fn('agents thread agent')(({ input }) =>
    AgentsHost.use(active => Effect.sync(() => ({ agent: active.store.threadAgent(input.sessionId) }))),
  ),
})

export default defineHost({
  ...effectHost,
  name: '@dshfiles/agents',
  inject: ['storageDomain'],
  apis: [agentsApiHost],
})
