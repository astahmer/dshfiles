/**
 * User text as an FTS5 MATCH expression. A search box is not a query language: "I can't find" used to reach MATCH
 * as raw text and fail with `fts5: syntax error near "'"`, and words such as AND, NEAR or a leading `-` changed the
 * query instead of being searched. Every term becomes one FTS5 string (double quotes doubled), so the tokenizer
 * splits it the way it split the indexed text and no character is read as syntax. Two user conventions survive:
 * a "quoted phrase" stays one phrase, and a trailing `*` on a word asks for a prefix match.
 */

/** A phrase, or a word with an optional trailing `*`. A lone `"` opens a phrase that runs to the end. */
const TERM = /"([^"]*)"?|(\S+)/gu
/** The unicode61 tokenizer keeps letters and digits; a term without one indexes to nothing and matches nothing. */
const SEARCHABLE = /[\p{L}\p{N}]/u

const fts5String = (text: string): string => `"${text.replaceAll('"', '""')}"`

export class FtsQuery {
  /** The MATCH expression for user text, or `null` when the text holds nothing searchable (an empty result, no error). */
  static readonly of = (text: string): string | null => {
    const terms: string[] = []
    for (const match of text.matchAll(TERM)) {
      const phrase = match[1]
      if (phrase !== undefined) {
        const trimmed = phrase.trim()
        if (SEARCHABLE.test(trimmed)) terms.push(fts5String(trimmed))
        continue
      }
      const word = match[2] ?? ''
      const prefix = word.length > 1 && word.endsWith('*')
      const body = prefix ? word.replace(/\*+$/u, '') : word
      if (!SEARCHABLE.test(body)) continue
      terms.push(prefix ? `${fts5String(body)} *` : fts5String(body))
    }
    return terms.length === 0 ? null : terms.join(' ')
  }
}
