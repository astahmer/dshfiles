import type { RowInlineVerb } from './thread-status.js'

/**
 * What a Needs-you row's second line says: the kind of ask, then the project (council round 13 B3), never the ask's
 * description. An approval's description often restated the title (round five B2), and a question cut to one line told
 * less than the Inbox card does.
 */
export type AttentionAsk = 'question' | 'approval'

/** The kind of ask a Needs-you row's verb answers: Answer is a question, every other verb an approval. */
const askOf = (verb: RowInlineVerb | undefined): AttentionAsk => (verb === 'Answer' ? 'question' : 'approval')

/** The words an attention kind is said in, already in the user's language. */
export interface AttentionKindWords {
  readonly question: string
  readonly approval: string
  /** What a Failed row says when its status carries no reason of its own. */
  readonly failed: string
}

/**
 * What an attention row's line 2 calls it, in the one word list (council round 14 A1, round 15 B3): Question or Approval
 * on a Needs-you row, the reason on a Failed one ("Turn failed"). Undefined for every other status, so the palette can
 * say the word the list does.
 */
const kindOf = (
  status: { readonly status: string; readonly verb: RowInlineVerb | undefined; readonly detail: string | undefined },
  words: AttentionKindWords,
): string | undefined => {
  if (status.status === 'needs-you') return askOf(status.verb) === 'question' ? words.question : words.approval
  if (status.status === 'failed') return status.detail ?? words.failed
  return undefined
}

export const AttentionSubtitleModel = { askOf, kindOf } as const
