/**
 * Trigger detection pure core. Scans backward from
 * the caret for a live trigger char under the guard tier and applies the
 * word-boundary rules. Zero React / DOM / cordis.
 */
import { activeAtToken } from '@deepseek-ai/dsh-file-reference/grammar'
import { prefixedTokenAt } from '../caret-token.js'
import type { TriggerChar } from '../types.js'
import type { DetectTrigger } from './contract.js'

const WORD_CHAR = /[\p{L}\p{N}_]/u
const WHITESPACE = /\s/u

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
 * Detect a trigger token at the caret. A quoted `@"…` token (the shared
 * grammar, for paths and titles with spaces) runs to the caret. An unquoted
 * `@` token is the whitespace-delimited token the caret touches, resolved the
 * way Codex does (see caret-token.ts): its span covers the whole token, so a
 * pick replaces all of it. Slash detection
 * scans left to the first whitespace; slashes failing the word boundary are
 * treated as ordinary token chars and the scan continues (URL slashes).
 * Guard tiers: plain = both chars live; claimed = '/' fully suppressed,
 * '@' live; frozen = none.
 *
 * @param draft - Full draft text.
 * @param caret - Caret offset into `draft`.
 * @param guard - Availability tier derived from the input phase.
 * @returns The hit whose `query` and `span` cover the token; `span.draftRev` is a placeholder `0`
 * — the calling shell stamps the real revision. Null when no trigger is
 * live at the caret.
 */
export const detectTrigger: DetectTrigger = (draft, caret, guard) => {
  if (guard.tier === 'frozen') return null
  const quoted = activeAtToken(draft, caret)
  if (quoted?.quoted === true) {
    const start = caret - quoted.prefix.length
    return {
      trigger: '@',
      query: quoted.query,
      quoted: true,
      position: draft.search(/\S/) === start ? 'leading' : 'inline',
      span: { start, end: caret, draftRev: 0 },
    }
  }
  const token = prefixedTokenAt({ text: draft, caret, prefix: '@' })
  if (token !== null) {
    return {
      trigger: '@',
      query: token.query,
      quoted: false,
      position: draft.search(/\S/) === token.start ? 'leading' : 'inline',
      span: { start: token.start, end: token.end, draftRev: 0 },
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
