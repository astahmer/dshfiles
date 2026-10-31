import { Effect, Schema } from 'effect'
import type { ParentQuestionAgent, ParentQuestionService } from './service.js'
import type { ParentQuestionExpiryBehavior, ParentQuestionRecord } from './store.js'

class ParentQuestionToolFlowError extends Schema.TaggedError<ParentQuestionToolFlowError>()('ParentQuestionToolFlowError', {
  message: Schema.String,
}) {}

const failure = (error: unknown): ParentQuestionToolFlowError =>
  new ParentQuestionToolFlowError({ message: error instanceof Error ? error.message : String(error) })

export class ParentQuestionToolFlow {
  static ask = Effect.fn('question ask')(
    (input: {
      readonly service: ParentQuestionService
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
        const receipt = yield* Effect.tryPromise({
          try: () =>
            input.service.request({
              agent: input.agent,
              operationId: input.operationId,
              question: input.question,
              ...(input.context !== undefined && { context: input.context }),
              options: input.options,
              recommendedOptionId: input.recommendedOptionId,
              expiryBehavior: input.expiryBehavior,
              timeoutMs: input.timeoutMs,
              signal: input.signal,
            }),
          catch: failure,
        })
        return yield* Effect.tryPromise({
          try: () => input.service.wait({ agent: input.agent, questionId: receipt.questionId, signal: input.signal }),
          catch: failure,
        })
      }),
  )

  static reattach = Effect.fn('question reattach')(
    (input: { readonly service: ParentQuestionService; readonly agent: ParentQuestionAgent; readonly questionId: string; readonly signal: AbortSignal }) =>
      Effect.tryPromise({
        try: () => input.service.wait({ agent: input.agent, questionId: input.questionId, signal: input.signal }),
        catch: failure,
      }),
  )

  static answer = Effect.fn('question answer')(
    (input: { readonly service: ParentQuestionService; readonly agent: ParentQuestionAgent; readonly questionId: string; readonly answer: string }) =>
      Effect.tryPromise({
        try: () => input.service.answer({ agent: input.agent, questionId: input.questionId, answer: input.answer }),
        catch: failure,
      }),
  )
}
