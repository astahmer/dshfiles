export interface PatchEdit {
  readonly old: string
  readonly new: string
  readonly replaceAll?: boolean
}

export interface EditsOutcome {
  readonly content: string
  /** Edits that matched literally. */
  readonly exact: number
  /** Edits that only matched after collapsing whitespace. */
  readonly fuzzy: number
}

export type EditsFailure =
  | { readonly kind: 'empty-old'; readonly edit: number }
  | { readonly kind: 'missing'; readonly edit: number }
  | { readonly kind: 'ambiguous'; readonly edit: number; readonly lines: readonly number[] }

export type EditsResult = { readonly ok: true; readonly value: EditsOutcome } | { readonly ok: false; readonly error: EditsFailure }

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

/** Every whitespace run in the needle matches any whitespace run, which absorbs reindents and moved line breaks. */
const whitespacePattern = (old: string): RegExp | undefined => {
  const parts = old.trim().split(/\s+/u)
  return parts.length === 0 ? undefined : new RegExp(parts.map(escapeRegExp).join('\\s+'), 'gu')
}

const matchStartLines = (content: string, starts: readonly number[]): readonly number[] => starts.map(start => content.slice(0, start).split('\n').length)

const exactStarts = ({ content, needle, all }: { readonly content: string; readonly needle: string; readonly all: boolean }): readonly number[] => {
  const starts: number[] = []
  let from = 0
  while (from <= content.length) {
    const at = content.indexOf(needle, from)
    if (at === -1) break
    starts.push(at)
    if (!all) break
    from = at + Math.max(1, needle.length)
  }
  return starts
}

const replaceRanges = ({
  content,
  needle,
  replacement,
  starts,
}: {
  readonly content: string
  readonly needle: string
  readonly replacement: string
  readonly starts: readonly number[]
}): string => {
  let next = content
  for (const start of [...starts].reverse()) next = next.slice(0, start) + replacement + next.slice(start + needle.length)
  return next
}

const fuzzyMatches = ({ content, needle }: { readonly content: string; readonly needle: string }): readonly RegExpMatchArray[] => {
  const pattern = whitespacePattern(needle)
  return pattern === undefined ? [] : [...content.matchAll(pattern)]
}

const applyOne = ({ content, edit, index }: { readonly content: string; readonly edit: PatchEdit; readonly index: number }): EditsResult => {
  if (edit.old.length === 0) return { ok: false, error: { kind: 'empty-old', edit: index } }
  const exact = exactStarts({ content, needle: edit.old, all: true })
  if (exact.length > 1 && edit.replaceAll !== true) return { ok: false, error: { kind: 'ambiguous', edit: index, lines: matchStartLines(content, exact) } }
  if (exact.length > 0) {
    return {
      ok: true,
      value: {
        content: replaceRanges({ content, needle: edit.old, replacement: edit.new, starts: edit.replaceAll === true ? exact : exact.slice(0, 1) }),
        exact: exact.length,
        fuzzy: 0,
      },
    }
  }
  const fuzzy = fuzzyMatches({ content, needle: edit.old })
  if (fuzzy.length === 0) return { ok: false, error: { kind: 'missing', edit: index } }
  const starts = fuzzy.map(match => match.index ?? 0)
  if (fuzzy.length > 1 && edit.replaceAll !== true) return { ok: false, error: { kind: 'ambiguous', edit: index, lines: matchStartLines(content, starts) } }
  const selected = edit.replaceAll === true ? fuzzy : fuzzy.slice(0, 1)
  let next = content
  for (const match of [...selected].reverse()) {
    const start = match.index ?? 0
    next = next.slice(0, start) + edit.new + next.slice(start + match[0].length)
  }
  return { ok: true, value: { content: next, exact: 0, fuzzy: selected.length } }
}

/**
 * Apply literal edits in order, one file at a time. Exact matches win; when none
 * exists the needle is retried with every whitespace run widened, which is what
 * makes a reindented or rewrapped block findable. Line endings of the original
 * file are preserved.
 */
export const applyEdits = ({ content, edits }: { readonly content: string; readonly edits: readonly PatchEdit[] }): EditsResult => {
  const crlf = content.includes('\r\n')
  const normalize = (text: string) => (crlf ? text.replace(/\r\n/gu, '\n') : text)
  let next = normalize(content)
  let exact = 0
  let fuzzy = 0
  for (const [index, edit] of edits.entries()) {
    const old = normalize(edit.old)
    const replacement = normalize(edit.new)
    const normalized: PatchEdit = edit.replaceAll === undefined ? { old, new: replacement } : { old, new: replacement, replaceAll: edit.replaceAll }
    if (old.length > 0 && old === replacement) continue
    const result = applyOne({ content: next, index, edit: normalized })
    if (!result.ok) return result
    next = result.value.content
    exact += result.value.exact
    fuzzy += result.value.fuzzy
  }
  return { ok: true, value: { content: crlf ? next.replace(/\n/gu, '\r\n') : next, exact, fuzzy } }
}

export const describeEditsFailure = (failure: EditsFailure): string => {
  switch (failure.kind) {
    case 'empty-old':
      return `edit ${failure.edit + 1}: "old" is empty`
    case 'missing':
      return `edit ${failure.edit + 1}: "old" was not found, even ignoring whitespace — read the file and copy a smaller anchor`
    case 'ambiguous':
      return `edit ${failure.edit + 1}: "old" matches ${failure.lines.length} places (lines ${failure.lines.join(', ')}); add surrounding lines or set replaceAll`
  }
}
