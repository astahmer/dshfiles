/**
 * The Review page header in plain words (DESIGN.md › Language): the revset `main..@` reads "since main", the empty
 * state names the project, and line stats wait for a change to count.
 */
export class ReviewHeader {
  /** "main..@" → "since main"; a saved change-ID range keeps its own form. */
  static readonly rangeLabel = (range: string): string => {
    const base = /^(.+)\.\.@$/u.exec(range)?.[1]
    return base === undefined ? range : `since ${base}`
  }

  static readonly emptyText = (input: { readonly target: string; readonly base: string }): string => `No changes since ${input.base} in ${input.target}.`

  /** "+0 −0" and an empty bar say nothing: the stats line shows once a file changed. */
  static readonly showStats = (fileCount: number): boolean => fileCount > 0
}
