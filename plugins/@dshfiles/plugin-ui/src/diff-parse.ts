/**
 * Diff parsing without the renderer: a collapsed row that only counts added and removed lines imports this, so page
 * boot does not parse `PatchView`, its virtualizer and shiki; `@dshfiles/plugin-ui/diff` loads them when a diff shows.
 */
export { parseDiffFromFile, parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'
