import type { ParentQuestionAgent, ParentQuestionOutcome, ParentQuestionService } from './service.js'
import type { ParentQuestionExpiryBehavior, ParentQuestionRecord } from './store.js'

export class ParentQuestionToolFlow {
  static ask = async (input: {
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
  }): Promise<ParentQuestionOutcome> => {
    const receipt = await input.service.request({
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
    return input.service.wait({ agent: input.agent, questionId: receipt.questionId, signal: input.signal })
  }

  static reattach = (input: {
    readonly service: ParentQuestionService
    readonly agent: ParentQuestionAgent
    readonly questionId: string
    readonly signal: AbortSignal
  }): Promise<ParentQuestionOutcome> =>
    input.service.wait({
      agent: input.agent,
      questionId: input.questionId,
      signal: input.signal,
    })

  static answer = (input: {
    readonly service: ParentQuestionService
    readonly agent: ParentQuestionAgent
    readonly questionId: string
    readonly answer: string
  }): Promise<ParentQuestionOutcome> =>
    input.service.answer({
      agent: input.agent,
      questionId: input.questionId,
      answer: input.answer,
    })
}
