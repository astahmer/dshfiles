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

  /** A one-sentence scope note is a label beside the scope badge, so it loses its full stop; a longer summary keeps it. */
  static readonly scopeNote = (text: string): string => (/[.!?]\s/u.test(text) ? text : text.replace(/\.$/u, ''))

  /**
   * A file header names its scope only when that is news: with one scope every file has it, so "Code · Source changes"
   * on each header is inferable noise, unless a written summary says more (council round 6, D2).
   */
  static readonly showScope = (input: { readonly scopeCount: number; readonly summarized: boolean }): boolean => input.scopeCount > 1 || input.summarized
}
