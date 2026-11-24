import { replyPairsOf, type QuestionReplyAnswer, type QuestionReplyQuestion } from './native/question-reply.ts'
import { QuestionMarkdownText } from './rich/question-markdown.ts'

/**
 * The words of an `ask_user_question` call's transcript row (unslop round three, item 24): `Asked · {header}` while
 * the question is open and `Asked · {header} · {answer}` once answered. Never the call's JSON, even while it streams.
 */

/** Labels the row needs, from the `question` dictionary. */
export type AskedLabel = (key: 'row.asked' | 'row.show' | 'row.inspect' | 'reply.skipped') => string

/** What the row says about one call. */
export interface AskedRowView {
  readonly title: string
  readonly questions: readonly { readonly question: string; readonly answer: string | undefined }[]
}

const plain = (question: QuestionReplyQuestion): string => QuestionMarkdownText.plainText(question.question)

const answerOf = (answers: readonly QuestionReplyAnswer[], id: string, skipped: string, label: (value: string) => string): string => {
  const answer = answers.find(item => item.id === id)
  const custom = answer?.custom?.trim() ?? ''
  const values = [...(answer?.selected ?? []).map(label), ...(custom === '' ? [] : [custom])]
  return values.length === 0 ? skipped : values.join(', ')
}

/**
 * The row's words for one call.
 * @param input.argsRaw - the call's arguments as recorded; partial or absent while they stream.
 * @param input.answers - the answers the result or a late reply recorded; undefined while the question is open.
 * @param input.cancelled - the user dismissed the whole set.
 * @param input.t - the row's labels.
 * @param input.optionLabel - an option label as shown, without its recommendation suffix.
 * @returns the title line and the questions with their answers for the expanded row.
 */
export const askedRowView = (input: {
  readonly argsRaw: string | undefined
  readonly answers: readonly QuestionReplyAnswer[] | undefined
  readonly cancelled: boolean
  readonly t: AskedLabel
  readonly optionLabel: (label: string) => string
}): AskedRowView => {
  const questions = input.argsRaw === undefined ? [] : replyPairsOf(input.argsRaw).questions
  const first = questions[0]
  const header = first === undefined ? undefined : (first.header?.trim() || plain(first))
  const skipped = input.t('reply.skipped')
  const answered = input.answers === undefined ? undefined : questions.map(question => answerOf(input.answers ?? [], question.id, skipped, input.optionLabel))
  const recorded = answered === undefined || answered.length === 0 ? undefined : answered.join('; ')
  const answer = input.cancelled ? skipped : recorded
  return {
    title: [input.t('row.asked'), header, answer].filter(part => part !== undefined && part !== '').join(' · '),
    questions: questions.map((question, index) => ({ question: plain(question), answer: input.cancelled ? skipped : answered?.[index] })),
  }
}
