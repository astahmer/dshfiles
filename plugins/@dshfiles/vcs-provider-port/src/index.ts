import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { defineApi, method, type ApiClient, type ApiContract } from '@dshfiles/dshx/api'
import { createHostApiClient, listApis } from '@dshfiles/dshx/host'
import { Schema } from 'effect'

const matchSchema = Schema.Struct({
  /** Short provider-chosen name of the version-control system, such as `jj` or `git`. */
  vcs: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  /** Higher wins when several providers claim one path: a jj repository colocated with git is jj's. */
  priority: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1000)),
  repoRoot: Schema.String.check(Schema.isMinLength(1)),
  workspaceRoot: Schema.String.check(Schema.isMinLength(1)),
  /** Whether the path is a workspace this provider created to isolate a thread. */
  isolated: Schema.Boolean,
})

const methods = {
  detect: method({
    input: Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1)) }),
    output: Schema.Struct({ match: Schema.NullOr(matchSchema) }),
    description: 'Whether this provider manages the repository holding a path, and where its root and current workspace are. Read-only.',
  }),
  provision: method({
    input: Schema.Struct({
      workspaceId: Schema.String.check(Schema.isMinLength(1)),
      /** Omitted: the provider's own default (jj-integration's `isolateByDefault`). */
      isolate: Schema.optional(Schema.Boolean),
      base: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
    }),
    output: Schema.Struct({ workspaceId: Schema.String.check(Schema.isMinLength(1)), isolated: Schema.Boolean }),
    description:
      'Where a new thread starts: an isolated workspace created from the repository of a DSH workspace, or the project checkout unchanged when isolation is off or unavailable.',
  }),
  snapshot: method({
    input: Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1)) }),
    output: Schema.Struct({ snapshot: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)) }),
    description: 'Record the files of the workspace at a path and return an opaque token restore accepts. Does not change any file.',
  }),
  restore: method({
    input: Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1)), snapshot: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)) }),
    output: Schema.Struct({ previous: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)) }),
    description: 'Put the files of the workspace at a path back to a snapshot; returns a snapshot of what they were, so the restore can be reversed.',
  }),
}

export type VcsProviderMethods = typeof methods
export type VcsMatch = typeof matchSchema.Type

/**
 * Version-control providers are dshx APIs that share one id and method set and differ by owner, so jj-integration and
 * git-worktrees each serve their own and a caller asks every served one which claims a path.
 */
export class VcsProviders {
  static readonly apiId = 'vcs-provider'

  static contract(owner: string): ApiContract<VcsProviderMethods> {
    return defineApi({ id: VcsProviders.apiId, version: 1, owner, methods })
  }

  static owners(ctx: CordisContext): string[] {
    return listApis(ctx)
      .filter(api => api.id === VcsProviders.apiId)
      .map(api => api.owner)
  }

  /** The provider with the highest priority that claims the path; a provider whose detect fails is skipped. */
  static async resolve(
    ctx: CordisContext,
    input: { readonly path: string; readonly callerPackageId: string; readonly signal?: AbortSignal },
  ): Promise<{ readonly owner: string; readonly match: VcsMatch; readonly client: ApiClient<VcsProviderMethods> } | undefined> {
    const answers = await Promise.all(
      VcsProviders.owners(ctx).map(async owner => {
        const client = createHostApiClient(ctx, VcsProviders.contract(owner), input.callerPackageId)
        const detected = await client.safe.detect({ path: input.path }, input.signal === undefined ? undefined : { signal: input.signal })
        return detected.ok && detected.value.match !== null ? { owner, match: detected.value.match, client } : undefined
      }),
    )
    return answers
      .filter(answer => answer !== undefined)
      .reduce<(typeof answers)[number]>((best, answer) => (best === undefined || answer.match.priority > best.match.priority ? answer : best), undefined)
  }
}
