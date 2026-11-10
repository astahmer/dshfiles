/** Most words one find keeps, and the longest word; a find bar never needs more and FTS5 cost grows with both. */
const MAX_WORDS = 16
const MAX_WORD_CHARS = 128

const searchable = /[\p{L}\p{N}]/u

/**
 * Turn the text a person types into a find bar into an FTS5 expression: every word must match, each word is quoted
 * so punctuation and FTS5 operators stay literal, and the last word matches as a prefix so results follow typing.
 * @returns the expression, or null when the text has no searchable word.
 */
export const findExpression = (text: string): string | null => {
  const words = text
    .trim()
    .split(/\s+/u)
    .filter(word => searchable.test(word))
    .slice(0, MAX_WORDS)
    .map(word => `"${Array.from(word).slice(0, MAX_WORD_CHARS).join('').replaceAll('"', '""')}"`)
  if (words.length === 0) return null
  return `${words.join(' ')}*`
}
