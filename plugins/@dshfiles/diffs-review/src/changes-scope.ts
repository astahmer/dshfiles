import { Option, Schema } from 'effect'

/**
 * The Changes facet's views. Four show one thread's work, each a pair of revisions:
 *
 * - `turn`: what one turn wrote, from DSH's own turn-start/turn-end snapshot (any version control, even none);
 * - `thread`: the thread's own revisions, from where it left the target bookmark (`fork_point(<bookmark> | @)`) to `@`;
 * - `uncommitted`: the working-copy revision alone (`@-` to `@`);
 * - `target`: the workspace against the target bookmark's current tip (`<bookmark>` to `@`), which also shows what the
 *   bookmark gained since the thread left it.
 *
 * `revisions` shows revisions someone selected in the graph, each as its own change. It is not a pair of revisions (a
 * selection may have gaps), so it has no base, and the facet offers it only while it holds a selection.
 */
export const changesScopes = ['turn', 'thread', 'uncommitted', 'target', 'revisions'] as const
const threadScopes = ['turn', 'thread', 'uncommitted', 'target'] as const
export const changesScopeSchema = Schema.Literals(changesScopes)
export type ChangesScope = typeof changesScopeSchema.Type

/** A revset symbol for a bookmark name, quoted so names with `/`, `-` or `@` stay one symbol. */
const bookmarkSymbol = (bookmark: string): string => JSON.stringify(bookmark)

/** The base revision a revision scope compares `@` against; the turn scope has none. */
const scopeBase = (scope: ChangesScope, bookmark: string): string | undefined => {
  if (scope === 'thread') return `fork_point(${bookmarkSymbol(bookmark)} | @)`
  if (scope === 'uncommitted') return '@-'
  if (scope === 'target') return bookmark
  return undefined
}

const scopeLabel = (scope: ChangesScope, bookmark: string): string => {
  if (scope === 'turn') return 'This turn'
  if (scope === 'thread') return 'Whole thread'
  if (scope === 'uncommitted') return 'Uncommitted'
  if (scope === 'revisions') return 'Revisions'
  return `vs ${bookmark}`
}

const scopeHint = (scope: ChangesScope, bookmark: string): string => {
  if (scope === 'turn') return 'What one turn wrote, from its own before and after snapshot.'
  if (scope === 'thread') return `Every change since this thread left ${bookmark}.`
  if (scope === 'uncommitted') return 'The working-copy revision only.'
  if (scope === 'revisions') return 'The revisions selected in the graph, oldest first, each as its own change.'
  return `The workspace against the current tip of ${bookmark}, including what ${bookmark} gained since.`
}

/** What a caller asks the facet to show: a scope, and for a turn the `workspace/changes` event that announced it. */
export const changesRequestSchema = Schema.Struct({
  scope: changesScopeSchema,
  seq: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  turn: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
  /** With the `revisions` scope: the repository they belong to, which need not be the thread's workspace. */
  workspacePath: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  revisions: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
})
export type ChangesRequest = typeof changesRequestSchema.Type

const decodeRequest = (value: unknown): ChangesRequest | undefined => Option.getOrUndefined(Schema.decodeUnknownOption(changesRequestSchema)(value))

/** What the `revisions` scope reviews. */
export interface RevisionSelection {
  readonly workspacePath: string
  readonly revisions: readonly string[]
}

/** The selection a request carries, or undefined for a request of any other scope. */
const selectionOf = (request: ChangesRequest | undefined): RevisionSelection | undefined => {
  if (request?.scope !== 'revisions' || request.workspacePath === undefined || request.revisions === undefined || request.revisions.length === 0)
    return undefined
  return { workspacePath: request.workspacePath, revisions: request.revisions }
}

/** The native per-turn review address (`dsh-resource://changes-review/session/<id>/<seq>/<turn>`). */
const CHANGES_REVIEW_PREFIX = 'dsh-resource://changes-review/session/'

/** The coordinates a turn's "Edited N files" card opens, or undefined for any other address. */
const parseTurnAddress = (address: string): { readonly sessionId: string; readonly seq: number; readonly turn: number } | undefined => {
  if (!address.startsWith(CHANGES_REVIEW_PREFIX)) return undefined
  const parts = address.slice(CHANGES_REVIEW_PREFIX.length).split('/')
  if (parts.length !== 3) return undefined
  const [sessionId = '', seq = '', turn = ''] = parts
  if (sessionId === '' || !/^\d+$/u.test(seq) || !/^[1-9]\d*$/u.test(turn)) return undefined
  try {
    return { sessionId: decodeURIComponent(sessionId), seq: Number(seq), turn: Number(turn) }
  } catch {
    return undefined
  }
}

/** The scope a facet opens on when nobody asked for one: the whole thread in a thread workspace, else the latest turn. */
const defaultScope = (input: { readonly isolated: boolean; readonly hasTurn: boolean }): ChangesScope =>
  input.isolated ? 'thread' : input.hasTurn ? 'turn' : 'uncommitted'

export class ChangesScopeModel {
  /** The scopes every thread offers; `revisions` joins them only while the facet holds a selection. */
  static readonly scopes = threadScopes
  static readonly selectionOf = selectionOf
  static readonly base = scopeBase
  static readonly label = scopeLabel
  static readonly hint = scopeHint
  static readonly decodeRequest = decodeRequest
  static readonly parseTurnAddress = parseTurnAddress
  static readonly defaultScope = defaultScope
  static readonly turnAddressPattern = `${CHANGES_REVIEW_PREFIX.replace('/session/', '')}/**`
}
