import type { MessageSource } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'

/**
 * `@deepseek-ai/dsh-user-questions` adds this message source when an answer is steered back into the Agent. Backlog
 * reads the kind without depending on that package's types, so a DSH upgrade that adds another source stays harmless.
 */
const answeredQuestionSource = z.object({ kind: z.literal('user-question-reply') }).passthrough()

export class BacklogQuestionReply {
  static readonly isAnswer = (source: MessageSource): boolean => answeredQuestionSource.safeParse(source).success
}
