/**
 * Resolves a direct-message recipient against the mailboxes that can actually read it: a live Agent, or a Session that
 * the persistence backend still lists. A mistyped Session id otherwise stores a message nobody will ever open.
 */

export type RecipientResolution =
  | { readonly status: 'live' }
  | { readonly status: 'durable' }
  | { readonly status: 'unknown'; readonly suggestions: readonly string[] }

const asSessionId = (id: string): string => (id.startsWith('session-') ? id : `session-${id}`)

const sharedPrefixLength = (left: string, right: string): number => {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return index
}

export class RecipientDirectoryModel {
  /** A near-miss keeps the Session prefix and most of the UUID; a shared bare `session-` prefix suggests nothing. */
  private static readonly minSuggestionPrefixLength = 16
  private static readonly maxSuggestions = 3

  static readonly resolve = (input: {
    readonly requestedId: string
    readonly liveIds: readonly string[]
    readonly durableIds: readonly string[]
  }): RecipientResolution => {
    const requested = input.requestedId.trim()
    if (RecipientDirectoryModel.matches({ requested, candidateIds: input.liveIds })) return { status: 'live' }
    if (RecipientDirectoryModel.matches({ requested, candidateIds: input.durableIds })) return { status: 'durable' }
    return {
      status: 'unknown',
      suggestions: RecipientDirectoryModel.suggest({ requestedId: requested, knownIds: [...input.liveIds, ...input.durableIds] }),
    }
  }

  static readonly suggest = (input: { readonly requestedId: string; readonly knownIds: readonly string[] }): readonly string[] => {
    const requested = asSessionId(input.requestedId)
    return [...new Set(input.knownIds.map(asSessionId))]
      .filter(candidate => candidate !== requested)
      .map(candidate => ({ candidate, shared: sharedPrefixLength(requested, candidate) }))
      .filter(entry => entry.shared >= RecipientDirectoryModel.minSuggestionPrefixLength)
      .sort((left, right) => right.shared - left.shared || left.candidate.localeCompare(right.candidate))
      .slice(0, RecipientDirectoryModel.maxSuggestions)
      .map(entry => entry.candidate)
  }

  private static readonly matches = (input: { readonly requested: string; readonly candidateIds: readonly string[] }): boolean =>
    input.candidateIds.some(candidate => candidate === input.requested || asSessionId(candidate) === asSessionId(input.requested))
}
