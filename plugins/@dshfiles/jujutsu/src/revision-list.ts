import type { Revision } from './api.js'
import type { RevisionGraphRow } from './graph.js'

/** The selected bookmark's remote-tracking target is the pushed base for that branch. */
export const remoteBookmarkRevision = <Row extends Pick<Revision, 'commitId' | 'bookmarks'>>(input: {
  readonly revisions: readonly Row[]
  readonly bookmark: string
  readonly remote: string
}): Row | undefined => input.revisions.find(revision => revision.bookmarks.includes(`${input.bookmark}@${input.remote}`))

/** One virtualized row of the revision graph: a date/push heading or a revision with its graph layout. */
export type RevisionListItem<Row extends Pick<Revision, 'commitId'> = Revision> =
  | { readonly kind: 'day'; readonly key: string; readonly day: string; readonly count: number; readonly firstLayout: RevisionGraphRow | undefined }
  | {
      readonly kind: 'push'
      readonly key: string
      readonly bookmark: string
      readonly remote: string
      readonly firstLayout: RevisionGraphRow
    }
  | { readonly kind: 'revision'; readonly key: string; readonly revision: Row; readonly layout: RevisionGraphRow }

/** Day headings stay listed when collapsed; graph rows and push boundaries without a visible layout are skipped. */
export const flattenRevisionGroups = <Row extends Pick<Revision, 'commitId'>>(input: {
  readonly groups: readonly { readonly day: string; readonly rows: readonly Row[] }[]
  readonly collapsedDays: ReadonlySet<string>
  readonly layouts: ReadonlyMap<string, RevisionGraphRow>
  readonly pushBoundary?: { readonly commitId: string; readonly bookmark: string; readonly remote: string }
}): readonly RevisionListItem<Row>[] => {
  const headingsPerDay = new Map<string, number>()
  return input.groups.flatMap(group => {
    const revisions = group.rows.flatMap(revision => {
      const layout = input.layouts.get(revision.commitId)
      if (layout === undefined) return []
      const boundary =
        input.pushBoundary?.commitId === revision.commitId
          ? [
              {
                kind: 'push' as const,
                key: `push:${input.pushBoundary.bookmark}@${input.pushBoundary.remote}`,
                bookmark: input.pushBoundary.bookmark,
                remote: input.pushBoundary.remote,
                firstLayout: layout,
              },
            ]
          : []
      return [...boundary, { kind: 'revision' as const, key: revision.commitId, revision, layout }]
    })
    // One day can head several runs when the graph order interleaves days.
    const repeat = headingsPerDay.get(group.day) ?? 0
    headingsPerDay.set(group.day, repeat + 1)
    const key = repeat === 0 ? 'day:' + group.day : `day:${group.day}#${repeat}`
    const firstItem = revisions[0]
    const firstLayout = firstItem === undefined ? undefined : firstItem.kind === 'push' ? firstItem.firstLayout : firstItem.layout
    const heading: RevisionListItem<Row>[] = group.day.length > 0 ? [{ kind: 'day', key, day: group.day, count: group.rows.length, firstLayout }] : []
    return [...heading, ...(input.collapsedDays.has(group.day) ? [] : revisions)]
  })
}

/** The day heading that owns the first visible row, kept mounted as the sticky header. */
export const activeDayIndex = (items: readonly { readonly kind: string }[], startIndex: number): number | null => {
  for (let index = Math.min(startIndex, items.length - 1); index >= 0; index -= 1) {
    if (items[index]?.kind === 'day') return index
  }
  return null
}
