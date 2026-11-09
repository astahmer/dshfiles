import type { VcsKind } from '@dshfiles/vcs-provider-port/detect'
import type { Effect } from 'effect'
import type { JjReadFailed, JjReadOutput } from './jj.js'

/**
 * What a review needs from a version-control system: which revisions exist, the short id of one, and the git patch
 * between two. `ReviewWorkspace` picks the jj or git adapter by the path it reviews; failures are `JjReadFailed`
 * whichever VCS answered (its reasons name the condition, `jj-missing` meaning "the VCS executable is missing").
 */
export interface ReviewBackend {
  readonly vcs: VcsKind
  /** Base bookmarks (git: branches) tried in order when the caller names none. */
  readonly baseCandidates: readonly string[]
  /** The project's main branch as this backend names it locally, then on origin; tried before `baseCandidates`. */
  readonly projectCandidates: (branch: string) => readonly string[]
  /** The live head a review without a saved range reads: jj's `@`, git's `HEAD` plus its uncommitted files. */
  readonly liveHead: string
  /** A saved land record's id as a revision this backend accepts (jj: a change id, git: a commit id). */
  readonly savedRevision: (id: string) => string
  /** An unknown revision is `false`; a path that is not this VCS's repository fails `not-a-repository`. */
  readonly resolves: (input: { readonly path: string; readonly revision: string }) => Effect.Effect<boolean, JjReadFailed>
  /** The short commit id of a revision, or empty when it does not resolve. */
  readonly commit: (input: { readonly path: string; readonly revision: string }) => Effect.Effect<string, JjReadFailed>
  readonly diff: (input: {
    readonly path: string
    readonly base: string
    readonly head: string
    readonly limit: number
  }) => Effect.Effect<JjReadOutput, JjReadFailed>
  readonly messages: { readonly missing: string; readonly notARepository: string; readonly failed: string }
}
