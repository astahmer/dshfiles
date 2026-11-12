/**
 * Keyboard review in the Changes facet (productivity pass T3.2): which file and hunk J/K, N/P and V move to, and the
 * lines C comments on. Pure, so the facet's key handlers stay one line each and the moves are tested without a DOM.
 */

/** The hunk fields of `@pierre/diffs`' `FileDiffMetadata['hunks']` the moves read. */
export interface KeyHunk {
  readonly collapsedBefore: number
  readonly additionStart: number
  readonly additionCount: number
  readonly deletionStart: number
  readonly deletionCount: number
}

export interface KeyFile {
  readonly name: string
  readonly hunks: readonly KeyHunk[]
}

/** Where N/P stands: one hunk of one file. */
export interface HunkCursor {
  readonly path: string
  readonly hunk: number
}

/** The next (delta 1) or previous (-1) file, clamped at the ends; with no current file, the first or last. */
const stepFile = (paths: readonly string[], current: string | null, delta: 1 | -1): string | undefined => {
  if (paths.length === 0) return undefined
  const index = current === null ? -1 : paths.indexOf(current)
  if (index === -1) return delta === 1 ? paths[0] : paths.at(-1)
  return paths[Math.min(paths.length - 1, Math.max(0, index + delta))]
}

/** After marking `current` viewed: the next file still unviewed after it, wrapping round; undefined when none is left. */
const nextUnviewed = (paths: readonly string[], viewed: ReadonlySet<string>, current: string | null): string | undefined => {
  const start = current === null ? -1 : paths.indexOf(current)
  for (let offset = 1; offset <= paths.length; offset += 1) {
    const path = paths[(start + offset + paths.length) % paths.length]
    if (path !== undefined && path !== current && !viewed.has(path)) return path
  }
  return undefined
}

/** Every hunk in display order, flattened across files. */
const hunksOf = (files: readonly KeyFile[]): readonly HunkCursor[] => files.flatMap(file => file.hunks.map((_, hunk) => ({ path: file.name, hunk })))

/**
 * The next or previous hunk across files. With no cursor, N starts at the current file's first hunk (or the first
 * hunk), P at the current file's last; at either end it stays put.
 */
const stepHunk = (files: readonly KeyFile[], cursor: HunkCursor | null, delta: 1 | -1, currentFile: string | null): HunkCursor | undefined => {
  const all = hunksOf(files)
  if (all.length === 0) return undefined
  const at = cursor === null ? -1 : all.findIndex(entry => entry.path === cursor.path && entry.hunk === cursor.hunk)
  if (at === -1) {
    const inFile = all.filter(entry => entry.path === currentFile)
    if (inFile.length > 0) return delta === 1 ? inFile[0] : inFile.at(-1)
    return delta === 1 ? all[0] : all.at(-1)
  }
  return all[Math.min(all.length - 1, Math.max(0, at + delta))]
}

/**
 * Which hunk separator of a file sits right above hunk `index`: the diff draws one separator per hunk that has
 * collapsed lines before it, so hunk 0 of a file that starts changing on its first line has none (scroll to the file).
 */
const separatorIndex = (hunks: readonly KeyHunk[], index: number): number | undefined => {
  const hunk = hunks[index]
  if (hunk === undefined || hunk.collapsedBefore === 0) return undefined
  return hunks.slice(0, index + 1).filter(entry => entry.collapsedBefore > 0).length - 1
}

/** The lines C comments on: the hunk's new-side lines, or its old-side lines when it only deletes. */
const hunkLines = (hunk: KeyHunk): { readonly start: number; readonly end: number; readonly side: 'additions' | 'deletions' } =>
  hunk.additionCount > 0
    ? { start: hunk.additionStart, end: hunk.additionStart + hunk.additionCount - 1, side: 'additions' }
    : { start: hunk.deletionStart, end: hunk.deletionStart + Math.max(0, hunk.deletionCount - 1), side: 'deletions' }

export class ChangesKeysModel {
  static readonly stepFile = stepFile
  static readonly nextUnviewed = nextUnviewed
  static readonly hunksOf = hunksOf
  static readonly stepHunk = stepHunk
  static readonly separatorIndex = separatorIndex
  static readonly hunkLines = hunkLines
}
