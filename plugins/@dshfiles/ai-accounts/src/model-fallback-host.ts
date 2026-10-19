import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { accountRuntime } from './account-runtime.js'
import { DEFAULT_DISTRIBUTION } from './account-pool.js'
import { aiAccountsModelFallbackApi, type ModelFallbackSnapshot } from './model-fallback-api.js'
import { createModelFallbackStore, modelFallbackDomain, type ModelFallbackStore } from './model-fallback-store.js'
import { ModelFallbackModel } from './model-fallback.js'

interface OpenedModelFallbacks {
  readonly store: ModelFallbackStore
  readonly close: () => Promise<void>
}

/** One store per Host process: the API handlers and the request routing share its rows. */
let opening: Promise<OpenedModelFallbacks> | undefined

const openModelFallbacks = async (ctx: Context): Promise<OpenedModelFallbacks> => {
  const storage = ctx.get('storageDomain')
  if (storage === undefined) throw new Error('Model fallback storage is unavailable.')
  const domain = await storage.open(modelFallbackDomain)
  const store = createModelFallbackStore({
    tables: { chains: domain.table('chains'), active: domain.table('active'), preferences: domain.table('preferences') },
  })
  return { store, close: () => domain.close() }
}

export const modelFallbacksFor = (ctx: Context): Promise<ModelFallbackStore> => {
  if (opening === undefined) {
    const started = openModelFallbacks(ctx)
    opening = started
    void started.catch(() => {
      if (opening === started) opening = undefined
    })
  }
  return opening.then(opened => opened.store)
}

export const closeModelFallbacks = async (): Promise<void> => {
  if (opening === undefined) return
  const opened = await opening.then(
    value => value,
    () => undefined,
  )
  opening = undefined
  await opened?.close()
}

const snapshot = async (ctx: Context, sessionId: string | undefined): Promise<ModelFallbackSnapshot> => {
  const store = await modelFallbacksFor(ctx)
  const runtime = accountRuntime(ctx)
  const base = store.snapshot({ sessionId, distribution: runtime?.accounts?.pool.distribution() ?? DEFAULT_DISTRIBUTION })
  // The router sees a fail-over before its storage write lands.
  if (sessionId === undefined || runtime?.modelFallbackRouter === undefined) return base
  return { ...base, active: runtime.modelFallbackRouter.active(sessionId) ?? null }
}

export const modelFallbackHostApi = aiAccountsModelFallbackApi.host({
  state: ({ ctx, input }) => snapshot(ctx, input.sessionId),
  setChain: async ({ ctx, input }) => {
    await (await modelFallbacksFor(ctx)).setChain({ sessionId: input.sessionId, chain: input.chain })
    return snapshot(ctx, input.sessionId)
  },
  setReturnPolicy: async ({ ctx, input }) => {
    await (await modelFallbacksFor(ctx)).setReturnPolicy(input.returnPolicy)
    return snapshot(ctx, undefined)
  },
  returnToSelection: async ({ ctx, input }) => {
    await modelFallbacksFor(ctx)
    const selection = accountRuntime(ctx)?.modelFallbackRouter?.returnToSelection(input.sessionId)
    if (selection !== undefined)
      await ctx.get('sessionController')?.selectModel({ sessionId: SessionId(input.sessionId), ...ModelFallbackModel.selectionFor(selection) })
    return snapshot(ctx, input.sessionId)
  },
})
