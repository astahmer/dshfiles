import { defineApi } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { method } from './api-schema.js'
import { AiAccountsSchema } from './effect-schema.js'

export const MAX_FALLBACK_ROUTES = 16

const sessionIdSchema = AiAccountsSchema.id(128)

/** One rung of a fallback chain: the provider route (an account or a native provider), its model and an optional effort. */
export const fallbackRouteSchema = Schema.Struct({
  provider: AiAccountsSchema.id(128),
  model: AiAccountsSchema.id(256),
  reasoningEffort: Schema.optional(AiAccountsSchema.id(64)),
})

export type FallbackRoute = typeof fallbackRouteSchema.Type

export const fallbackChainSchema = AiAccountsSchema.list(fallbackRouteSchema, MAX_FALLBACK_ROUTES)

/**
 * What a thread does once a fallback served it: `stay` keeps it there (the provider's prompt cache stays warm) until
 * the user returns it, `next-turn` starts every turn from the selected model again.
 */
export const FALLBACK_RETURN_POLICIES = ['stay', 'next-turn'] as const

export const fallbackReturnPolicySchema = Schema.Literals(FALLBACK_RETURN_POLICIES)

export type FallbackReturnPolicy = typeof fallbackReturnPolicySchema.Type

export const modelFallbackSnapshotSchema = Schema.Struct({
  /** The chain only runs under the Priority request distribution. */
  distribution: Schema.Literals(['sticky', 'priority', 'round-robin', 'balanced']),
  returnPolicy: fallbackReturnPolicySchema,
  defaultChain: fallbackChainSchema,
  /** The thread's own chain; null when it follows the default. */
  threadChain: Schema.NullOr(fallbackChainSchema),
  /** The fallback currently serving the thread instead of its selected model; null when the selection serves it. */
  active: Schema.NullOr(fallbackRouteSchema),
})

export type ModelFallbackSnapshot = typeof modelFallbackSnapshotSchema.Type

export const aiAccountsModelFallbackApi = defineApi({
  id: 'ai-accounts-model-fallback',
  version: 1,
  // The composer picker imports this contract; without an owner it would derive its own channel.
  owner: '@dshfiles/ai-accounts',
  methods: {
    state: method({
      input: Schema.Struct({ sessionId: Schema.optional(sessionIdSchema) }),
      output: modelFallbackSnapshotSchema,
      description:
        'Read the model fallback chain a thread walks when its model request fails (exhausted quota, rate limit, connection) under Priority distribution: the global default, the thread override, the return policy and the fallback serving the thread now. Read-only.',
      tool: { name: 'model_fallback_state', readOnly: true },
    }),
    setChain: method({
      input: Schema.Struct({
        /** Omit to edit the global default chain. */
        sessionId: Schema.optional(sessionIdSchema),
        /** The ordered routes; null drops the thread override so the thread follows the default again. */
        chain: Schema.NullOr(fallbackChainSchema),
      }),
      output: modelFallbackSnapshotSchema,
      description:
        'Replace the ordered model fallback chain of one thread (sessionId) or the global default (no sessionId); chain null makes a thread follow the default again. Routes may cross providers. Run only when the user asked to change fallbacks.',
      tool: { name: 'set_model_fallback_chain', readOnly: false },
    }),
    setReturnPolicy: method({
      input: Schema.Struct({ returnPolicy: fallbackReturnPolicySchema }),
      output: modelFallbackSnapshotSchema,
      description:
        "Choose whether a thread stays on the fallback that served it ('stay', keeps the provider cache) or starts every turn from its selected model ('next-turn'). Run only when the user asked.",
      tool: { name: 'set_model_fallback_return', readOnly: false },
    }),
    returnToSelection: method({
      input: Schema.Struct({ sessionId: sessionIdSchema }),
      output: modelFallbackSnapshotSchema,
      description: "Stop serving a thread from its active fallback, so its next request uses the thread's selected model again. Run only when the user asked.",
      tool: { name: 'return_to_selected_model', readOnly: false },
    }),
  },
})
