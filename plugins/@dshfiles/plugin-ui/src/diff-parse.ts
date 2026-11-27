import { parseDiffFromFile, parsePatchFiles, type FileDiffMetadata as ParsedFileDiff } from '@pierre/diffs'

export type FileDiffMetadata = ParsedFileDiff

/**
 * Diff parsing without the renderer: a collapsed row that only counts added and removed lines uses this, so page
 * boot does not parse `PatchView`, its virtualizer and shiki; `@dshfiles/plugin-ui/diff` loads them when a diff shows.
 */
export class DiffParse {
  static readonly fromFile = parseDiffFromFile
  static readonly patchFiles = parsePatchFiles
}
