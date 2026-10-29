import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-token-meter'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createHostApiClient } from '@dshfiles/dshx/host'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { threadModelApi } from '@dshfiles/session-controller/thread-model-api'
import { accountStoreService } from './account-store.js'
import { accountRuntime } from './account-runtime.js'
import { servingAccountSessionForCaller } from './serving-account-host.js'
import { threadAccountApi, type ThreadAccountPreview } from './thread-account-api.js'
import { ThreadAccountModel } from './thread-account-model.js'

const threadModels = (ctx: Context) => createHostApiClient(ctx, threadModelApi, '@dshfiles/ai-accounts')

const previewThreadAccount = async (
  ctx: Context,
  input: { readonly sessionId?: string | undefined; readonly instanceId: string },
  caller: ApiCaller,
): Promise<ThreadAccountPreview> => {
  const sessionId = servingAccountSessionForCaller(input, caller)
  const session = await threadModels(ctx).snapshot({ sessionId })
  const file = await accountStoreService.readAccountFile()
  const account = file.accounts.find(account => account.instanceId === input.instanceId)
  if (account === undefined || !account.enabled || account.kind === 'cursor') throw new Error('Choose an enabled account that can run models on this Host.')
  if (!ctx.llm.listProviders().some(provider => provider.id === account.instanceId))
    throw new Error('This account has no active model route. Connect the account first.')
  const models = await ctx.llm.listModels(account.instanceId)
  const choice = ThreadAccountModel.choose({
    current: session.selection,
    provider: account.instanceId,
    models,
    defaultModel: ctx.get('agentDefaultModel')?.currentSelection().model,
  })
  const resolved = await ctx.llm.resolveModelInfo(account.instanceId, choice.model.id)
  const retainedEffort =
    choice.strategy === 'same-model' && resolved.reasoning?.efforts.some(effort => effort.id === session.selection.reasoningEffort)
      ? session.selection.reasoningEffort
      : undefined
  const target: ThreadAccountPreview['target'] = {
    provider: account.instanceId,
    model: choice.model.id,
  }
  if (retainedEffort !== undefined) target.reasoningEffort = retainedEffort
  let context: ThreadAccountPreview['context'] = null
  const liveSession = ctx.get('agents')?.get(SessionId(sessionId))?.session
  const meter = ctx.get('tokenMeter')
  if (liveSession !== undefined && meter !== undefined) {
    const previous = liveSession.requestHeader()
    const header = previous === undefined ? undefined : { ...previous, config: { ...previous.config, provider: target.provider, model: target.model } }
    try {
      const measured = meter.measure(liveSession, header)
      if (Number.isFinite(measured.totalTokens) && measured.totalTokens >= 0) {
        const targetWindow = resolved.context?.contextWindow ?? null
        context = {
          estimatedTokens: measured.totalTokens,
          targetWindow,
          suggestCompaction: ThreadAccountModel.suggestCompaction(measured.totalTokens, targetWindow),
        }
      }
    } catch {
      // Optional advice must not gate an otherwise valid account selection or invent a context size.
    }
  }
  return {
    sessionId,
    instanceId: account.instanceId,
    displayName: account.displayName,
    current: session.selection,
    target,
    modelName: choice.model.name,
    strategy: choice.strategy,
    expectedRevision: session.revision,
    running: session.running,
    context,
  }
}

export const threadAccountHostApi = threadAccountApi.host({
  preview: ({ ctx, input, caller }) => previewThreadAccount(ctx, input, caller),
  switch: async ({ ctx, input, caller }) => {
    const preview = await previewThreadAccount(ctx, input, caller)
    if (preview.expectedRevision !== input.expectedRevision || !ThreadAccountModel.same(preview.target, input.target))
      throw new Error('The thread selection or account catalog changed. Review the new target before switching.')
    await threadModels(ctx).select({
      sessionId: preview.sessionId,
      selection: preview.target,
      expectedRevision: preview.expectedRevision,
      preferSelectedProvider: true,
    })
    const runtime = accountRuntime(ctx)
    runtime?.accounts?.pool.unbind(preview.sessionId)
    runtime?.modelFallbackRouter?.returnToSelection(preview.sessionId)
    runtime?.releaseRetryWait?.(preview.sessionId)
    return preview
  },
})
