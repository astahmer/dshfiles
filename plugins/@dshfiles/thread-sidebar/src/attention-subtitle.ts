import type { RowInlineVerb } from './thread-status.js'

/**
 * What a Needs-you row's second line says (round five B2). An approval's description often restates the thread's
 * title ("Publish preview build" / "Publish the preview build"); a second reading of the title tells nothing, so the
 * line names the kind of ask and the project instead. Only a real question may take two lines.
 */
export type AttentionAsk = 'question' | 'approval'

const FILLER = new Set(['a', 'an', 'the', 'to', 'of'])

const words = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length > 0 && !FILLER.has(word))

/** The kind of ask a Needs-you row's verb answers: Answer is a question, every other verb an approval. */
const askOf = (verb: RowInlineVerb | undefined): AttentionAsk => (verb === 'Answer' ? 'question' : 'approval')

/** True when the description says nothing the title does not: the same words, ignoring case, punctuation and articles. */
const repeatsTitle = (detail: string, title: string): boolean => {
  const said = words(detail)
  const titled = words(title)
  return said.length > 0 && said.length === titled.length && said.every((word, index) => word === titled[index])
}

export const AttentionSubtitleModel = { askOf, repeatsTitle } as const
