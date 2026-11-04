import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-query'
import { HostContext } from '@dshfiles/dshx/effect'
import { Llm, LlmCallFailed } from '@dshfiles/dshx/effect/llm'
import type { SessionId } from '@dshfiles/dshx/ids'
import { Context, Effect, Layer, Option } from 'effect'

export interface SummaryCompletion {
  readonly provider: string
  readonly model: string
  /** The thread whose model route this call borrows; providers keyed per Session need it. */
  readonly sessionId?: SessionId | undefined
  readonly system: string
  readonly input: string
}

/** The thread's model route and one model call, from the Host's session log and language-model services. */
export class SummaryRoutes extends Context.Service<
  SummaryRoutes,
  {
    /** False when the Host has no language-model service. */
    readonly available: boolean
    /** The provider the thread's own model requests use, from its session log. */
    readonly providerOf: (sessionId: SessionId) => Effect.Effect<string | undefined>
    readonly modelsOf: (provider: string) => Effect.Effect<readonly string[]>
    readonly complete: (request: SummaryCompletion) => Effect.Effect<string, LlmCallFailed>
  }
>()('@dshfiles/pulls-review/SummaryRoutes') {
  static readonly layer = Layer.effect(
    SummaryRoutes,
    Effect.gen(function* () {
      const ctx = (yield* HostContext).ctx
      const sessionQuery = ctx.get('sessionQuery')
      const models = ctx.get('llm')
      const llm = yield* Layer.build(Llm.layer).pipe(
        Effect.map(services => Context.get(services, Llm)),
        Effect.option,
      )
      return SummaryRoutes.of({
        available: Option.isSome(llm),
        providerOf: sessionId =>
          Effect.tryPromise(() => (sessionQuery === undefined ? Promise.resolve(undefined) : sessionQuery.readSession(sessionId))).pipe(
            Effect.map(log => {
              const header = log?.events.findLast(event => event.type === 'request/header')
              return header?.type === 'request/header' ? header.data.header.config.provider : undefined
            }),
            Effect.orElseSucceed(() => undefined),
          ),
        modelsOf: provider =>
          Effect.tryPromise(() => (models === undefined ? Promise.resolve([]) : models.listModels(provider))).pipe(
            Effect.map(listed => listed.map(model => model.id)),
            Effect.orElseSucceed(() => []),
          ),
        complete: request =>
          Option.match(llm, {
            onNone: () =>
              Effect.fail(new LlmCallFailed({ provider: request.provider, model: request.model, reason: 'the Host has no language-model service' })),
            onSome: service => service.complete({ ...request, maxTokens: 1_024, purpose: 'compaction' }),
          }),
      })
    }),
  )
}
