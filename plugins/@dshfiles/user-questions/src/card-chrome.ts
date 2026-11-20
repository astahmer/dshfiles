/** What the question card draws around its question, decided apart from the vendored component so it can be tested. */

/** The pager walks between questions: one question has nowhere to page to, so it shows none. */
const showsPager = (questionCount: number): boolean => questionCount > 1

/**
 * The card's way out, besides Collapse and Skip. A pending tool-call question only leaves the composer seat (its
 * transcript row brings it back), which the card says in words: `later`. A recorded answer under review `close`s, and a
 * request no tool call names has no way back, so leaving it is a `cancel`.
 */
const exitOf = (input: { readonly dismissal: 'hide' | 'cancel'; readonly review: boolean }): 'later' | 'cancel' | 'close' => {
  if (input.dismissal === 'cancel') return 'cancel'
  return input.review ? 'close' : 'later'
}

export const CardChrome = { showsPager, exitOf } as const
