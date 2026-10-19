import { defineDomain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  fallbackChainSchema,
  fallbackReturnPolicySchema,
  fallbackRouteSchema,
  type FallbackReturnPolicy,
  type FallbackRoute,
  type ModelFallbackSnapshot,
} from './model-fallback-api.js'
import { ModelFallbackModel } from './model-fallback.js'

const MAX_THREAD_ROWS = 2_000
const DEFAULT_KEY = 'default'
const POLICY_KEY = 'policy'

const chainRecordSchema = z.object({ chain: fallbackChainSchema, updatedAt: z.number().int().nonnegative() }).strict()
const activeRecordSchema = z.object({ route: fallbackRouteSchema, from: fallbackRouteSchema, since: z.number().int().nonnegative() }).strict()
const preferenceRecordSchema = z.object({ returnPolicy: fallbackReturnPolicySchema }).strict()

type ChainRecord = z.infer<typeof chainRecordSchema>
type ActiveRecord = z.infer<typeof activeRecordSchema>
type PreferenceRecord = z.infer<typeof preferenceRecordSchema>

export const modelFallbackDomain = defineDomain({
  name: 'dshfiles_ai_accounts_model_fallbacks',
  version: 1,
  tables: {
    /** `default` plus one row per thread that overrides it. */
    chains: { valueSchema: chainRecordSchema, __key: 'chains' },
    /** Threads a fallback is serving instead of their selected model. */
    active: { valueSchema: activeRecordSchema, __key: 'active' },
    preferences: { valueSchema: preferenceRecordSchema, __key: 'preferences' },
  },
})

export interface ModelFallbackTables {
  readonly chains: KvTable<string, ChainRecord>
  readonly active: KvTable<string, ActiveRecord>
  readonly preferences: KvTable<string, PreferenceRecord>
}

const threadKey = (sessionId: string): string => `thread:${sessionId}`

/** Keeps per-thread rows bounded: the least recently written ones go first. */
const evictOldest = async <Value>(table: KvTable<string, Value>, input: { readonly reserved: string; readonly writtenAt: (value: Value) => number }) => {
  const rows = [...table.entries()].filter(([key]) => key !== input.reserved).sort(([, left], [, right]) => input.writtenAt(left) - input.writtenAt(right))
  for (const [key] of rows.slice(0, Math.max(0, rows.length - MAX_THREAD_ROWS + 1))) await table.delete(key)
}

export const createModelFallbackStore = (input: { readonly tables: ModelFallbackTables; readonly now?: () => number }) => {
  const now = input.now ?? Date.now
  const { chains, active, preferences } = input.tables

  const defaultChain = (): readonly FallbackRoute[] => chains.get(DEFAULT_KEY)?.chain ?? []
  const threadChain = (sessionId: string | undefined): readonly FallbackRoute[] | null =>
    sessionId === undefined ? null : (chains.get(threadKey(sessionId))?.chain ?? null)
  const returnPolicy = (): FallbackReturnPolicy => preferences.get(POLICY_KEY)?.returnPolicy ?? 'stay'

  return {
    returnPolicy,

    chainFor: (sessionId: string): readonly FallbackRoute[] =>
      ModelFallbackModel.effectiveChain({ defaultChain: defaultChain(), threadChain: threadChain(sessionId) }),

    activeFor: (sessionId: string): Omit<ActiveRecord, 'since'> | undefined => {
      const record = active.get(sessionId)
      return record === undefined ? undefined : { route: record.route, from: record.from }
    },

    snapshot: (request: { readonly sessionId?: string | undefined; readonly distribution: ModelFallbackSnapshot['distribution'] }): ModelFallbackSnapshot => ({
      distribution: request.distribution,
      returnPolicy: returnPolicy(),
      defaultChain: [...defaultChain()],
      threadChain: request.sessionId === undefined ? null : (threadChain(request.sessionId)?.slice() ?? null),
      active: request.sessionId === undefined ? null : (active.get(request.sessionId)?.route ?? null),
    }),

    setChain: async (request: { readonly sessionId?: string | undefined; readonly chain: readonly FallbackRoute[] | null }): Promise<void> => {
      const key = request.sessionId === undefined ? DEFAULT_KEY : threadKey(request.sessionId)
      if (request.chain === null) {
        if (key === DEFAULT_KEY) await chains.put(DEFAULT_KEY, { chain: [], updatedAt: now() })
        else await chains.delete(key)
        return
      }
      if (key !== DEFAULT_KEY && chains.get(key) === undefined) await evictOldest(chains, { reserved: DEFAULT_KEY, writtenAt: record => record.updatedAt })
      await chains.put(key, { chain: ModelFallbackModel.normalizeChain(request.chain), updatedAt: now() })
    },

    setReturnPolicy: async (policy: FallbackReturnPolicy): Promise<void> => {
      await preferences.put(POLICY_KEY, { returnPolicy: policy })
    },

    activate: async (sessionId: string, standing: Omit<ActiveRecord, 'since'>): Promise<void> => {
      if (active.get(sessionId) === undefined) await evictOldest(active, { reserved: '', writtenAt: record => record.since })
      await active.put(sessionId, { ...standing, since: now() })
    },

    deactivate: async (sessionId: string): Promise<void> => {
      if (active.get(sessionId) !== undefined) await active.delete(sessionId)
    },
  }
}

export type ModelFallbackStore = ReturnType<typeof createModelFallbackStore>
