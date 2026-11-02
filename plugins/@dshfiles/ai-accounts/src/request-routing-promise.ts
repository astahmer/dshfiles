import type { Agent, RequestErrorAction } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig, LlmFailure } from '@deepseek-ai/dsh-llm'
import type {} from '@dshfiles/request-messages'
import { Context, Effect } from 'effect'
import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { threadModelApi, type ThreadModelSelection } from '@dshfiles/session-controller/thread-model-api'
import { AutomaticSelectionRefused } from './errors.js'
import { FailureRecoveryModel } from './failure-recovery.js'
import type { QuotaContinuationService } from './quota-continuation.js'

interface StepPosition {
  readonly turn: number
  readonly step: number
}

interface FailedRequest extends StepPosition {
  readonly provider: string
  readonly failure: LlmFailure
  readonly signal: AbortSignal
}

/** The routing decisions one agent's Cordis waterfalls run, as Effects over the plugin services. */
export interface AgentRoutingHandlers {
  readonly request: (position: StepPosition, proposed: LlmCallConfig) => Effect.Effect<LlmCallConfig, unknown>
  readonly requestError: (failed: FailedRequest, next: Effect.Effect<RequestErrorAction>) => Effect.Effect<RequestErrorAction>
  readonly requestMessagesShrink: (position: StepPosition) => boolean
  readonly turnStopping: () => Effect.Effect<void>
}

/**
 * The Cordis edge of request routing: registers one agent's waterfall listeners and runs each handler with the
 * plugin's detached services. `agent/request` and `agent/request-error` are prepended so the account policy decides
 * before DSH's provider-wide retry, which would otherwise spend its retries on an account that is already spent.
 */
export class RequestRoutingHooks {
  static register(agent: Agent, services: Context.Context<never>, handlers: AgentRoutingHandlers): () => void {
    const run = Effect.runPromiseWith(services)
    const offRequest = agent.ctx.on(
      'agent/request',
      async ({ turn, step }, next) => {
        const proposed = await next()
        // Wrap later request selectors so routing sees their final logical provider and model.
        return run(handlers.request({ turn, step }, proposed))
      },
      { prepend: true },
    )
    const offTurnStopping = agent.ctx.on('agent/turn-stopping', () => run(handlers.turnStopping()))
    const offRequestMessages = agent.ctx.on('agent/request-messages', async ({ turn, step }, next) => {
      const messages = await next()
      return handlers.requestMessagesShrink({ turn, step }) ? FailureRecoveryModel.offloadResentImages(messages) : messages
    })
    const offRequestError = agent.ctx.on(
      'agent/request-error',
      ({ turn, step, provider, failure, signal }, next) => run(handlers.requestError({ turn, step, provider, failure, signal }, Effect.promise(next))),
      { prepend: true },
    )
    return () => {
      offRequest()
      offTurnStopping()
      offRequestError()
      offRequestMessages()
    }
  }

  /** Moves a thread's selection: through the guarded thread policy, or the legacy controller when the thread has none. */
  static selectModel(ctx: CordisContext) {
    return (input: { readonly agent: Agent; readonly selection: ThreadModelSelection; readonly expectedRevision: number; readonly legacy: boolean }) =>
      Effect.tryPromise({
        try: async () => {
          if (input.legacy) {
            // Compatibility with an older controller: there is no thread-switch capability or preferred intent to overwrite.
            const request = { sessionId: input.agent.id, provider: input.selection.provider, model: input.selection.model }
            const reasoningEffort = input.selection.reasoningEffort
            await ctx.get('sessionController')?.selectModel(reasoningEffort === undefined ? request : { ...request, reasoningEffort })
            return
          }
          // The check must run inside the native serialized commit, after metadata awaits, not only in this caller.
          await createHostApiClient(ctx, threadModelApi, '@dshfiles/ai-accounts').select({
            sessionId: input.agent.id,
            selection: input.selection,
            expectedRevision: input.expectedRevision,
            preferSelectedProvider: false,
          })
        },
        catch: cause => new AutomaticSelectionRefused({ sessionId: input.agent.id, cause }),
      })
  }

  /** Quota continuations still run as Promises; a failure to record one fails the request-error hook as before. */
  static recordQuotaFailure(continuations: Pick<QuotaContinuationService, 'recordFailure'>) {
    return (input: {
      readonly agent: Agent
      readonly accountId: string
      readonly autoRetry: boolean
      readonly failedSelection: { readonly provider: string; readonly model: string } | undefined
      readonly message: string
    }) => Effect.promise(() => continuations.recordFailure(input.agent, input.accountId, input.autoRetry, input.failedSelection, input.message))
  }
}
