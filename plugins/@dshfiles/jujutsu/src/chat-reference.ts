import { z } from 'zod'

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

const chatReferenceFromCode = (input: ChatReferenceText): ChatReference | undefined => {
  const candidate = input.value.trim()
  // An explicit `jj:` token is the author saying "this is a reference", so it needs no repository lookup.
  if (input.prefixed === true || candidate.startsWith(CHAT_REFERENCE_PREFIX)) return referenceOf(withoutPrefix(candidate))
  const named = referenceOf(candidate)
  return named?.kind === 'revision' ? named : input.bookmarks.includes(candidate) ? { value: candidate, kind: 'bookmark' } : undefined
}

/** What the reader sees: the prefix is a writing convention, not part of the name. */
const chatReferenceDisplay = (value: string): string => withoutPrefix(value.trim())

const resolveChatReference = <
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

/**
 * Hovering a reference asks the overlay for a graph; leaving it takes the request back. Both travel as window events
 * because the reference is a native `<code>` node this plugin decorated, not a React element it owns.
 */
export const chatReferencePreviewEvent = 'dshfiles:jujutsu-reference-preview'
export const chatReferencePreviewDismissEvent = 'dshfiles:jujutsu-reference-preview-dismiss'
export const chatReferenceTitleRequestEvent = 'dshfiles:jujutsu-reference-title-request'
export const chatReferenceTitleResolvedEvent = 'dshfiles:jujutsu-reference-title-resolved'

const referenceIdentitySchema = z.object({ value: z.string().min(1).max(255), kind: z.enum(['revision', 'bookmark']) })

export const chatReferencePreviewRequestSchema = z.object({
  /** The Session repository the reference is read in; the Host resolves its repoId from this path. */
  cwd: z.string().min(1).max(2048),
  reference: referenceIdentitySchema,
  anchor: z.object({ left: z.number(), top: z.number(), width: z.number(), height: z.number() }),
})

export const chatReferenceTitleRequestSchema = z.object({
  sessionId: z.string().min(1).max(256),
  cwd: z.string().min(1).max(2048),
  reference: referenceIdentitySchema,
})

export const chatReferenceTitleResolvedSchema = chatReferenceTitleRequestSchema.extend({ title: z.string().min(1).max(255) })

export type ChatReferencePreviewRequest = z.infer<typeof chatReferencePreviewRequestSchema>
export type ChatReferenceTitleRequest = z.infer<typeof chatReferenceTitleRequestSchema>
export type ChatReferenceTitleResolved = z.infer<typeof chatReferenceTitleResolvedSchema>

const CHAT_REFERENCE_TITLE_LIMIT = 52

const chatReferenceTitleLabel = (input: { readonly title: string; readonly fallback: string }): string => {
  const title = input.title.trim().replace(/\s+/gu, ' ')
  if (title.length === 0) return input.fallback
  const characters = Array.from(title)
  if (characters.length <= CHAT_REFERENCE_TITLE_LIMIT) return title
  return `${characters
    .slice(0, CHAT_REFERENCE_TITLE_LIMIT - 1)
    .join('')
    .trimEnd()}…`
}

export class ChatReferenceModel {
  static readonly fromCode = chatReferenceFromCode
  static readonly display = chatReferenceDisplay
  static readonly resolve = resolveChatReference
  static readonly titleLabel = chatReferenceTitleLabel
}
