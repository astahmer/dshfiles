/** One row of the activity feed: an id to dedupe by and a timestamp to order by. */
export interface FeedItem {
  readonly id: string
  readonly at: number
}

/**
 * Merges the accumulated older pages with the newest page. Both sides are already ordered, so one pass plus a single
 * order keeps the history stable, and the previous array is reused whenever it holds exactly the same items — a
 * five-second poll that changed nothing must not re-render every mounted row.
 */
export const mergeFeedItems = <Item extends FeedItem>(input: {
  readonly older: readonly Item[]
  readonly newest: readonly Item[]
  readonly previous?: readonly Item[] | undefined
}): readonly Item[] => {
  const seen = new Set<string>()
  const merged: Item[] = []
  for (const item of [...input.older, ...input.newest]) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    merged.push(item)
  }
  merged.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id))
  const previous = input.previous
  if (previous !== undefined && previous.length === merged.length && previous.every((item, index) => item === merged[index])) return previous
  return merged
}
