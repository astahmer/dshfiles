import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

export const MAX_FALLBACK_ROUTES = 16

const sessionIdSchema = z.string().min(1).max(128)

/** One rung of a fallback chain: the provider route (an account or a native provider), its model and an optional effort. */
export const fallbackRouteSchema = z
  .object({
    provider: z.string().min(1).max(128),
    model: z.string().min(1).max(256),
    reasoningEffort: z.string().min(1).max(64).optional(),
  })
  .strict()

export type FallbackRoute = z.infer<typeof fallbackRouteSchema>

export const fallbackChainSchema = z.array(fallbackRouteSchema).max(MAX_FALLBACK_ROUTES)

/**
 * What a thread does once a fallback served it: `stay` keeps it there (the provider's prompt cache stays warm) until
 * the user returns it, `next-turn` starts every turn from the selected model again.
 */
export const FALLBACK_RETURN_POLICIES = ['stay', 'next-turn'] as const

export const fallbackReturnPolicySchema = z.enum(FALLBACK_RETURN_POLICIES)

export type FallbackReturnPolicy = z.infer<typeof fallbackReturnPolicySchema>

export const modelFallbackSnapshotSchema = z
  .object({
    /** The chain only runs under the Priority request distribution. */
    distribution: z.enum(['sticky', 'priority', 'round-robin', 'balanced']),
    returnPolicy: fallbackReturnPolicySchema,
    defaultChain: fallbackChainSchema,
    /** The thread's own chain; null when it follows the default. */
    threadChain: fallbackChainSchema.nullable(),
    /** The fallback currently serving the thread instead of its selected model; null when the selection serves it. */
    active: fallbackRouteSchema.nullable(),
  })
  .strict()

export type ModelFallbackSnapshot = z.infer<typeof modelFallbackSnapshotSchema>

export const aiAccountsModelFallbackApi = defineApi({
  id: 'ai-accounts-model-fallback',
  version: 1,
  // The composer picker imports this contract; without an owner it would derive its own channel.
  owner: '@dshfiles/ai-accounts',
  methods: {
    state: method({
      input: z.object({ sessionId: sessionIdSchema.optional() }).strict(),
      output: modelFallbackSnapshotSchema,
      description:
        'Read the model fallback chain a thread walks when its model request fails (exhausted quota, rate limit, connection) under Priority distribution: the global default, the thread override, the return policy and the fallback serving the thread now. Read-only.',
      tool: { name: 'model_fallback_state', readOnly: true },
    }),
    setChain: method({
      input: z
        .object({
          /** Omit to edit the global default chain. */
          sessionId: sessionIdSchema.optional(),
          /** The ordered routes; null drops the thread override so the thread follows the default again. */
          chain: fallbackChainSchema.nullable(),
        })
        .strict(),
      output: modelFallbackSnapshotSchema,
      description:
        'Replace the ordered model fallback chain of one thread (sessionId) or the global default (no sessionId); chain null makes a thread follow the default again. Routes may cross providers. Run only when the user asked to change fallbacks.',
      tool: { name: 'set_model_fallback_chain', readOnly: false },
    }),
    setReturnPolicy: method({
      input: z.object({ returnPolicy: fallbackReturnPolicySchema }).strict(),
      output: modelFallbackSnapshotSchema,
      description:
        "Choose whether a thread stays on the fallback that served it ('stay', keeps the provider cache) or starts every turn from its selected model ('next-turn'). Run only when the user asked.",
      tool: { name: 'set_model_fallback_return', readOnly: false },
    }),
    returnToSelection: method({
      input: z.object({ sessionId: sessionIdSchema }).strict(),
      output: modelFallbackSnapshotSchema,
      description: "Stop serving a thread from its active fallback, so its next request uses the thread's selected model again. Run only when the user asked.",
      tool: { name: 'return_to_selected_model', readOnly: false },
    }),
  },
})
