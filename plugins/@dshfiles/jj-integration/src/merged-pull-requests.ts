/**
 * Merged pull requests for a set of thread Sessions.
 *
 * Published as the `@dshfiles/jj-integration/merged-pull-requests` dshx module. Jujutsu integration owns the cleanup
 * that wants this state, and `@dshfiles/pull-requests` already depends on it, so this plugin declares the contract and
 * that one provides it: importing the pull-request API the other way round would close a workspace cycle
 * (`jj-integration ⇄ pull-requests ⇄ thread-sidebar`).
 */
import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'

const methods = {
  merged: method({
    input: Schema.Struct({ sessionIds: Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMaxLength(256)) }),
    output: Schema.Struct({
      /** The merged pull requests recorded for one of those Sessions, each with the Session it belongs to. */
      merged: Schema.Array(
        Schema.Struct({
          sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
          /** `owner/repo#123`. */
          label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160)),
        }),
      ).check(Schema.isMaxLength(512)),
    }),
    description:
      'The merged GitHub pull requests recorded for these thread Sessions, as owner/repo#number. A Session without a merged link reports none. Read-only.',
  }),
}

export type MergedPullRequestMethods = typeof methods

/** One served contract per provider: `pull-requests` provides its own, so the caller asks every served owner. */
export class MergedPullRequests {
  static readonly apiId = 'merged-pull-requests'

  static contract(owner: string) {
    return defineApi({ id: MergedPullRequests.apiId, version: 1, owner, methods })
  }
}
