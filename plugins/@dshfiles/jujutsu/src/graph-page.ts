import { reverseHexChangeId } from './graph.js'

const quoteRevsetString = (value: string): string =>
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r')}"`

const searchRevset = (query: string): string => {
  const pattern = `substring-i:${quoteRevsetString(query)}`
  const matches = [`description(${pattern})`, `bookmarks(${pattern})`, `remote_bookmarks(${pattern})`, `tags(${pattern})`, 'working_copies()']
  if (/^[a-f0-9]{6,}$/i.test(query)) {
    const prefix = query.toLowerCase()
    matches.push(`commit_id(${prefix})`)
    if (prefix.length <= 32) matches.push(`change_id(${reverseHexChangeId(prefix, prefix.length)})`)
  }
  if (/^[k-z]{3,32}$/i.test(query)) matches.push(`change_id(${query.toLowerCase()})`)
  return `all() & (${matches.join(' | ')})`
}

/** Graph page revsets and the candidate pick that keeps every page's jj evaluation flat. */
export class GraphPage {
  static revset(query: string): string {
    const trimmed = query.trim()
    return trimmed.length === 0 ? 'all()' : searchRevset(trimmed)
  }

  static commitIdsRevset(commitIds: readonly string[]): string {
    return commitIds.map(commitId => `commit_id(${commitId})`).join(' | ')
  }

  /**
   * Picks the next page's candidates from an ordered id listing. Skipping already loaded revisions here instead of in
   * the revset keeps each page's cost flat: a `~ commit_id(…)` union grows with every loaded page.
   */
  static nextCandidates(input: {
    readonly listedCommitIds: readonly string[]
    readonly excludeCommitIds: readonly string[]
    readonly size: number
    readonly scanLimit: number
  }) {
    const excluded = new Set(input.excludeCommitIds)
    return {
      commitIds: input.listedCommitIds.filter(commitId => !excluded.has(commitId)).slice(0, input.size),
      listingTruncated: input.listedCommitIds.length >= input.scanLimit,
    }
  }
}
