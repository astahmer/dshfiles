/** The link scheme a chat message uses to name a thread: `[Fix auth](thread:session-…)`. */
export const THREAD_LINK_SCHEME = 'thread'

/** Shortest id prefix accepted, so `t:12` cannot pick one of hundreds of threads by chance. */
const MIN_PREFIX = 6

export type ThreadReferenceResolution =
  | { readonly kind: 'found'; readonly sessionId: string }
  | { readonly kind: 'none'; readonly reference: string }
  | { readonly kind: 'ambiguous'; readonly reference: string; readonly candidates: readonly string[] }
  | { readonly kind: 'invalid'; readonly reference: string }

/**
 * The listed thread a reference names. Accepts the full `session-<uuid>`, the bare uuid, and the short `t:<prefix>` or
 * `<prefix>` memory prints (at least 6 characters), so an Agent need not dig the full id out of storage.
 * @param input - the reference as written, and the thread ids this window lists.
 * @returns the thread, or why none was picked (none, several, malformed).
 */
const resolve = (input: { readonly reference: string; readonly listed: readonly string[] }): ThreadReferenceResolution => {
  const reference = input.reference.trim().replace(/^`|`$/gu, '')
  const bare = reference
    .replace(/^thread:/iu, '')
    .replace(/^t:/iu, '')
    .replace(/^session-/iu, '')
    .replace(/#\d+$/u, '')
    .toLowerCase()
  if (!/^[0-9a-z-]+$/u.test(bare) || bare.replaceAll('-', '').length < MIN_PREFIX) return { kind: 'invalid', reference }
  const exact = input.listed.find(id => id.toLowerCase() === `session-${bare}`)
  if (exact !== undefined) return { kind: 'found', sessionId: exact }
  const candidates = input.listed.filter(id => id.toLowerCase().startsWith(`session-${bare}`))
  if (candidates.length === 1 && candidates[0] !== undefined) return { kind: 'found', sessionId: candidates[0] }
  if (candidates.length > 1) return { kind: 'ambiguous', reference, candidates: candidates.slice(0, 10) }
  return { kind: 'none', reference }
}

/** Why a reference opened nothing, with what to do next. */
const explain = (resolution: Exclude<ThreadReferenceResolution, { readonly kind: 'found' }>): string => {
  switch (resolution.kind) {
    case 'invalid':
      return `${resolution.reference} is not a thread id. Pass session-<uuid>, or a t:<id> from memory with at least ${String(MIN_PREFIX)} characters.`
    case 'ambiguous':
      return `${resolution.reference} matches several threads: ${resolution.candidates.join(', ')}. Pass the full session id.`
    case 'none':
      return `No thread in this window's list matches ${resolution.reference}: it may be archived, on another host, or belong to another project. Check it with thread_list.`
  }
}

/** A Markdown link that opens the thread in a tab when clicked; brackets in the title are dropped. */
const link = (input: { readonly sessionId: string; readonly title: string }): string =>
  `[${input.title.replace(/[[\]]/gu, '').trim() || input.sessionId}](${THREAD_LINK_SCHEME}:${input.sessionId})`

export class ThreadReference {
  static readonly resolve = resolve
  static readonly explain = explain
  static readonly link = link
}
