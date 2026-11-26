import type { RowInlineVerb } from './thread-status.js'

/**
 * What a Needs-you row's second line says: the kind of ask, then the project (council round 13 B3), never the ask's
 * description. An approval's description often restated the title (round five B2), and a question cut to one line told
 * less than the Inbox card does.
 */
export type AttentionAsk = 'question' | 'approval'

/** The kind of ask a Needs-you row's verb answers: Answer is a question, every other verb an approval. */
const askOf = (verb: RowInlineVerb | undefined): AttentionAsk => (verb === 'Answer' ? 'question' : 'approval')

export const AttentionSubtitleModel = { askOf } as const
