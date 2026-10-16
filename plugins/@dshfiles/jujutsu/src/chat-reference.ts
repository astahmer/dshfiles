export interface ChatReference {
  readonly value: string
  readonly kind: 'revision' | 'bookmark'
}

export interface ChatReferenceText {
  readonly value: string
  readonly bookmarks: readonly string[]
  /** The value is the displayed name of a token the author wrote as `jj:<name>`, so a plain name is already explicit. */
  readonly prefixed?: boolean
}

// JJ change IDs use the letters k–z and commit IDs the hex alphabet, so a revision-shaped token is
// unambiguous enough to mark, while an arbitrary word only counts when the repository really has it
// as a bookmark. Hex starts at 7 so ordinary short words (`dead`, `face`) never become links.
const COMMIT_ID = /^[0-9a-f]{7,64}$/iu
const CHANGE_ID = /^[k-z]{8,64}$/u
// Same shape the Host accepts for a bookmark name, so an explicit `jj:` token is never validated twice.
const BOOKMARK = /^[A-Za-z0-9][A-Za-z0-9._/+:-]{0,254}$/u

export const CHAT_REFERENCE_PREFIX = 'jj:'

const referenceOf = (token: string): ChatReference | undefined => {
  if (COMMIT_ID.test(token) || CHANGE_ID.test(token)) return { value: token, kind: 'revision' }
  return BOOKMARK.test(token) ? { value: token, kind: 'bookmark' } : undefined
}

const withoutPrefix = (candidate: string): string => (candidate.startsWith(CHAT_REFERENCE_PREFIX) ? candidate.slice(CHAT_REFERENCE_PREFIX.length) : candidate)

export const chatReferenceFromCode = (input: ChatReferenceText): ChatReference | undefined => {
  const candidate = input.value.trim()
  // An explicit `jj:` token is the author saying "this is a reference", so it needs no repository lookup.
  if (input.prefixed === true || candidate.startsWith(CHAT_REFERENCE_PREFIX)) return referenceOf(withoutPrefix(candidate))
  const named = referenceOf(candidate)
  return named?.kind === 'revision' ? named : input.bookmarks.includes(candidate) ? { value: candidate, kind: 'bookmark' } : undefined
}

/** What the reader sees: the prefix is a writing convention, not part of the name. */
export const chatReferenceDisplay = (value: string): string => withoutPrefix(value.trim())

export const resolveChatReference = <
  Revision extends {
    readonly commitId: string
    readonly changeId: string
    readonly bookmarks: readonly string[]
    readonly localBookmarks: readonly string[]
  },
>(input: {
  readonly reference: ChatReference
  readonly revisions: readonly Revision[]
}): Revision | undefined => {
  const value = input.reference.value.toLocaleLowerCase()
  const matches = input.revisions.filter(revision =>
    input.reference.kind === 'bookmark'
      ? revision.bookmarks.includes(input.reference.value) || revision.localBookmarks.includes(input.reference.value)
      : revision.commitId.toLocaleLowerCase().startsWith(value) || revision.changeId.toLocaleLowerCase().startsWith(value),
  )
  return matches.length === 1 ? matches.at(0) : undefined
}
