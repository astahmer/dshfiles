import type { MessageSource } from '@deepseek-ai/dsh-llm'
import { Option, Schema } from 'effect'

/**
 * `@deepseek-ai/dsh-user-questions` adds this message source when an answer is steered back into the Agent. Backlog
 * reads the kind without depending on that package's types, so a DSH upgrade that adds another source stays harmless.
 */
const answeredQuestionSource = Schema.Struct({ kind: Schema.Literal('user-question-reply') })

export class BacklogQuestionReply {
  static readonly isAnswer = (source: MessageSource): boolean => Option.isSome(Schema.decodeUnknownOption(answeredQuestionSource)(source))
}
