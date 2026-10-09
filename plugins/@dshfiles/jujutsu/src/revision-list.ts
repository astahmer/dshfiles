import type { Revision } from './api.js'
import type { RevisionGraphRow } from './graph.js'

/** One virtualized row of the revision graph: a day heading or a revision with its graph layout. */
export type RevisionListItem<Row extends Pick<Revision, 'commitId'> = Revision> =
  | { readonly kind: 'day'; readonly key: string; readonly day: string; readonly count: number; readonly firstLayout: RevisionGraphRow | undefined }
  | { readonly kind: 'revision'; readonly key: string; readonly revision: Row; readonly layout: RevisionGraphRow }

/** Day headings stay listed when collapsed; rows the graph did not lay out are skipped. */
export const flattenRevisionGroups = <Row extends Pick<Revision, 'commitId'>>(input: {
  readonly groups: readonly { readonly day: string; readonly rows: readonly Row[] }[]
  readonly collapsedDays: ReadonlySet<string>
  readonly layouts: ReadonlyMap<string, RevisionGraphRow>
}): readonly RevisionListItem<Row>[] =>
  input.groups.flatMap(group => {
    const revisions = group.rows.flatMap(revision => {
      const layout = input.layouts.get(revision.commitId)
      return layout === undefined ? [] : [{ kind: 'revision' as const, key: revision.commitId, revision, layout }]
    })
    const heading: RevisionListItem<Row>[] =
      group.day.length > 0 ? [{ kind: 'day', key: 'day:' + group.day, day: group.day, count: group.rows.length, firstLayout: revisions[0]?.layout }] : []
    return [...heading, ...(input.collapsedDays.has(group.day) ? [] : revisions)]
  })

/** The day heading that owns the first visible row, kept mounted as the sticky header. */
export const activeDayIndex = (items: readonly { readonly kind: 'day' | 'revision' }[], startIndex: number): number | null => {
  for (let index = Math.min(startIndex, items.length - 1); index >= 0; index -= 1) {
    if (items[index]?.kind === 'day') return index
  }
  return null
}
