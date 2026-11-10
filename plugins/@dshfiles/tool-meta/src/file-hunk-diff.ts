import { parseDiffFromFile, type FileDiffMetadata } from '@dshfiles/plugin-ui/diff'
import type { FileHunk } from './file-tool-models.js'

/** One applied hunk, parsed by the diff engine the review surfaces already render. */
export interface HunkDiff {
  readonly hunk: FileHunk
  readonly diff: FileDiffMetadata
  readonly added: number
  readonly removed: number
}

export interface HunkTotals {
  readonly added: number
  readonly removed: number
}

const lineCounts = (diff: FileDiffMetadata): HunkTotals =>
  diff.hunks.reduce(
    (total, hunk) =>
      hunk.hunkContent.reduce(
        (hunkTotal, part) => (part.type === 'change' ? { added: hunkTotal.added + part.additions, removed: hunkTotal.removed + part.deletions } : hunkTotal),
        total,
      ),
    { added: 0, removed: 0 },
  )

/**
 * Turn each reported hunk into a renderable one-file diff. The edit tools already narrowed a call to its changed
 * region with three context lines, so the parser only has to align the two sides; a hunk with no before-image (a
 * created or emptied file) becomes the matching create/delete diff.
 */
export const hunkDiffs = (hunks: readonly FileHunk[]): readonly HunkDiff[] =>
  hunks.map(hunk => {
    const diff = parseDiffFromFile(hunk.oldText === null ? null : { name: hunk.path, contents: hunk.oldText }, { name: hunk.path, contents: hunk.newText })
    return { hunk, diff, ...lineCounts(diff) }
  })

/** Changed lines across every hunk of a call, context left out. */
export const hunkTotals = (diffs: readonly HunkDiff[]): HunkTotals =>
  diffs.reduce((total, diff) => ({ added: total.added + diff.added, removed: total.removed + diff.removed }), { added: 0, removed: 0 })
