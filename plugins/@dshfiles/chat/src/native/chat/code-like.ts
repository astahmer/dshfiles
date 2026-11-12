/**
 * dshfiles (visual refresh T2.1): whether a user message is mostly code or JSON, so its bubble renders it in the mono
 * face and wraps it instead of reading as prose. A heuristic over the raw text: most non-empty lines look like code
 * (indented, bracketed, `key: value` JSON, statement endings), or the whole message is one bracketed value.
 */
const CODE_LINE = /^\s{2,}\S|^\s*[[{<}\]]|[{};,(]\s*$|"[^"\n]+"\s*:|^\s*(?:import|export|const|let|function|def|class|return)\b|=>/

/** Messages shorter than this stay prose even when they look bracketed: `[ok]` is not code. */
const MIN_SINGLE_LINE = 40

export const looksLikeCode = (text: string): boolean => {
  const trimmed = text.trim()
  if (trimmed === '') return false
  if (trimmed.startsWith('```')) return true
  const lines = trimmed.split('\n').filter(line => line.trim() !== '')
  if (lines.length === 1) return trimmed.length >= MIN_SINGLE_LINE && /^[[{].*[\]}]$/s.test(trimmed)
  const codeLines = lines.filter(line => CODE_LINE.test(line)).length
  return codeLines / lines.length >= 0.6
}
