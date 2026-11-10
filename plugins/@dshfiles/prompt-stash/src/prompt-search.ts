const SEARCH_SEPARATORS = /[\s-]/g

/**
 * cmdk's default scorer is superlinear in the value length, and one prompt body reaches 20 000 characters, so a saved
 * prompt or a recent message matches on a case-insensitive ordered subsequence instead: the rows it keeps are the same
 * ones the default scorer kept, and every match scores alike so the list keeps its own order while the user types.
 */
export const matchesPromptSearch = (input: { readonly value: string; readonly search: string }): boolean => {
  const needle = input.search.replace(SEARCH_SEPARATORS, ' ').trim().toLowerCase()
  if (needle.length === 0) return true

  const haystack = input.value.replace(SEARCH_SEPARATORS, ' ').toLowerCase()
  let index = 0
  for (const character of needle) {
    index = haystack.indexOf(character, index)
    if (index < 0) return false
    index += 1
  }
  return true
}

/** cmdk's `filter` contract: a positive score keeps the row, and an equal score keeps the list's own order. */
export const promptSearchFilter = (value: string, search: string): number => (matchesPromptSearch({ value, search }) ? 1 : 0)
