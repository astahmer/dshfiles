/**
 * Trigger detection pure core. Scans backward from
 * the caret for a live trigger char under the guard tier and applies the
 * word-boundary rules. Zero React / DOM / cordis.
 */
import { activeAtToken } from '@deepseek-ai/dsh-file-reference/grammar'
import type { TriggerChar } from '../types.js'
import type { DetectTrigger } from './contract.js'

const WORD_CHAR = /[\p{L}\p{N}_]/u
const WHITESPACE = /\s/u
const UNQUOTED_AT_TOKEN = /(?:^|\s)(@[^\r\n@]*)$/u

const hasCaretToken = (query: string): boolean => {
  const token = query.match(/\S+$/u)?.[0]
  return token !== undefined && !/^\p{P}+$/u.test(token)
}

/**
 * Word-boundary rule: a trigger char opens only at start-of-draft, after
 * whitespace (newlines included), or after punctuation. Two URL carve-outs
 * keep '/' dead inside URLs (both pinned by tests): '/' after a ':' that
 * itself follows a non-whitespace char (scheme separator, `https:/…`), and
 * '/' directly after another '/' (second slash of `//`).
 */
function boundaryOk(draft: string, index: number, char: TriggerChar): boolean {
  if (index === 0) return true
  const prev = draft.charAt(index - 1)
  if (WHITESPACE.test(prev)) return true
  if (WORD_CHAR.test(prev)) return false
  if (char === '/') {
    if (prev === '/') return false
    if (prev === ':' && index >= 2 && !WHITESPACE.test(draft.charAt(index - 2))) return false
  }
  return true
}

/**
 * Detect a trigger token at the caret. `@` first uses the shared grammar,
 * then accepts an unquoted same-line query with spaces. Slash detection
 * scans left to the first whitespace; slashes failing the word boundary are
 * treated as ordinary token chars and the scan continues (URL slashes).
 * Guard tiers: plain = both chars live; claimed = '/' fully suppressed,
 * '@' live; frozen = none.
 *
 * @param draft - Full draft text.
 * @param caret - Caret offset into `draft`.
 * @param guard - Availability tier derived from the input phase.
 * @returns The hit with `query` = trigger-to-caret slice and `span` =
 * `{start: triggerIndex, end: caret}`; `span.draftRev` is a placeholder `0`
 * — the calling shell stamps the real revision. Null when no trigger is
 * live at the caret.
 */
export const detectTrigger: DetectTrigger = (draft, caret, guard) => {
  if (guard.tier === 'frozen') return null
  const at = activeAtToken(draft, caret)
  const lineStart = draft.lastIndexOf('\n', caret - 1) + 1
  const unquotedAt = UNQUOTED_AT_TOKEN.exec(draft.slice(lineStart, caret))?.[1]
  const prefix = at?.prefix ?? unquotedAt
  const query = at?.query ?? unquotedAt?.slice(1) ?? ''
  const caretTokenIsActive = query === '' || hasCaretToken(query)
  if (prefix !== undefined && (at?.quoted === true || caretTokenIsActive)) {
    const start = caret - prefix.length
    return {
      trigger: '@',
      query: at?.query ?? prefix.slice(1),
      quoted: at?.quoted ?? false,
      position: draft.search(/\S/) === start ? 'leading' : 'inline',
      span: { start, end: caret, draftRev: 0 },
    }
  }
  for (let i = caret - 1; i >= 0; i--) {
    const ch = draft.charAt(i)
    if (WHITESPACE.test(ch)) return null
    if (ch !== '/') continue
    if (guard.tier === 'claimed') continue
    if (!boundaryOk(draft, i, ch)) continue
    return {
      trigger: ch,
      query: draft.slice(i + 1, caret),
      quoted: false,
      position: draft.search(/\S/) === i ? 'leading' : 'inline',
      span: { start: i, end: caret, draftRev: 0 },
    }
  }
  return null
}
