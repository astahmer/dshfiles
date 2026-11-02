import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Schema } from 'effect'
import { agentPresetRowSchema, type AgentPresetRow } from './api.js'

class AgentPresetsUnreadable extends Schema.TaggedError<AgentPresetsUnreadable>()(
  'AgentPresetsUnreadable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'agent-presets-unreadable' },
) {
  override get message(): string {
    return 'The Agent preset registry could not be read. Check the Agent presets row in Settings, then reopen the agent editor.'
  }
}

const decodePresetRow = Schema.decodeUnknownEffect(agentPresetRowSchema)

/** The Host's Promise Agent preset registry, read lazily: it is optional, and an agent without a preset needs none. */
export class AgentPresets extends Context.Service<AgentPresets, { readonly list: Effect.Effect<readonly AgentPresetRow[], AgentPresetsUnreadable> }>()(
  '@dshfiles/agents/AgentPresets',
) {
  static readonly layer = Layer.effect(
    AgentPresets,
    Effect.gen(function* () {
      const host = yield* HostContext
      return AgentPresets.of({
        list: Effect.gen(function* () {
          const presets = host.ctx.get('agentPresets')
          if (presets === undefined) return []
          const rows = yield* Effect.tryPromise({ try: () => presets.list(), catch: cause => new AgentPresetsUnreadable({ cause }) })
          return yield* Effect.forEach(rows, row =>
            decodePresetRow({ id: row.id, name: row.name, description: row.description, broken: row.broken }).pipe(
              Effect.mapError(cause => new AgentPresetsUnreadable({ cause })),
            ),
          )
        }).pipe(Effect.withSpan('agent presets list')),
      })
    }),
  )
}
