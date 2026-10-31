import { Effect } from 'effect'
import type { ParentQuestionAgent, ParentQuestionServiceEffectApi } from './service.js'
import type { ParentQuestionExpiryBehavior, ParentQuestionRecord } from './store.js'

export class ParentQuestionToolFlow {
  static ask = Effect.fn('question ask')(
    (input: {
      readonly service: ParentQuestionServiceEffectApi
      readonly agent: ParentQuestionAgent
      readonly operationId: string
      readonly question: string
      readonly context?: string
      readonly options: ParentQuestionRecord['options']
      readonly recommendedOptionId: string
      readonly expiryBehavior: ParentQuestionExpiryBehavior
      readonly timeoutMs: number
      readonly signal: AbortSignal
    }) =>
      Effect.gen(function* () {
        const receipt = yield* input.service.request({
          agent: input.agent,
          operationId: input.operationId,
          question: input.question,
          ...(input.context !== undefined && { context: input.context }),
          options: input.options,
          recommendedOptionId: input.recommendedOptionId,
          expiryBehavior: input.expiryBehavior,
          timeoutMs: input.timeoutMs,
          signal: input.signal,
        })
        return yield* input.service.wait({ agent: input.agent, questionId: receipt.questionId, signal: input.signal })
      }),
  )

  static reattach = Effect.fn('question reattach')(
    (input: {
      readonly service: ParentQuestionServiceEffectApi
      readonly agent: ParentQuestionAgent
      readonly questionId: string
      readonly signal: AbortSignal
    }) => input.service.wait({ agent: input.agent, questionId: input.questionId, signal: input.signal }),
  )

  static answer = Effect.fn('question answer')(
    (input: { readonly service: ParentQuestionServiceEffectApi; readonly agent: ParentQuestionAgent; readonly questionId: string; readonly answer: string }) =>
      input.service.answer({ agent: input.agent, questionId: input.questionId, answer: input.answer }),
  )
}
