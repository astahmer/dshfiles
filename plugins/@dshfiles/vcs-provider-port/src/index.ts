import type { Context } from '@deepseek-ai/cordis'
import { defineApi, method, type ApiClient, type ApiContract } from '@dshfiles/dshx/api'
import { createHostApiClient, listApis } from '@dshfiles/dshx/host'
import { z } from 'zod'

const matchSchema = z
  .object({
    /** Short provider-chosen name of the version-control system, such as `jj` or `git`. */
    vcs: z.string().min(1).max(32),
    /** Higher wins when several providers claim one path: a jj repository colocated with git is jj's. */
    priority: z.number().int().min(0).max(1000),
    repoRoot: z.string().min(1),
    workspaceRoot: z.string().min(1),
    /** Whether the path is a workspace this provider created to isolate a thread. */
    isolated: z.boolean(),
  })
  .strict()

const methods = {
  detect: method({
    input: z.object({ path: z.string().min(1) }).strict(),
    output: z.object({ match: matchSchema.nullable() }).strict(),
    description: 'Whether this provider manages the repository holding a path, and where its root and current workspace are. Read-only.',
  }),
  provision: method({
    input: z
      .object({
        workspaceId: z.string().min(1),
        /** Omitted: the provider's own default (jj-integration's `isolateByDefault`). */
        isolate: z.boolean().optional(),
        base: z.string().min(1).max(256).optional(),
      })
      .strict(),
    output: z.object({ workspaceId: z.string().min(1), isolated: z.boolean() }).strict(),
    description:
      'Where a new thread starts: an isolated workspace created from the repository of a DSH workspace, or the project checkout unchanged when isolation is off or unavailable.',
  }),
  snapshot: method({
    input: z.object({ path: z.string().min(1) }).strict(),
    output: z.object({ snapshot: z.string().min(1).max(512) }).strict(),
    description: 'Record the files of the workspace at a path and return an opaque token restore accepts. Does not change any file.',
  }),
  restore: method({
    input: z.object({ path: z.string().min(1), snapshot: z.string().min(1).max(512) }).strict(),
    output: z.object({ previous: z.string().min(1).max(512) }).strict(),
    description: 'Put the files of the workspace at a path back to a snapshot; returns a snapshot of what they were, so the restore can be reversed.',
  }),
}

type VcsProviderMethods = typeof methods
export type VcsMatch = z.infer<typeof matchSchema>

const contracts = new Map<string, ApiContract<VcsProviderMethods>>()

/**
 * Version-control providers are dshx APIs that share one id and method set and differ by owner, so jj-integration and
 * git-worktrees each serve their own and a caller asks every served one which claims a path.
 */
export class VcsProviders {
  static readonly apiId = 'vcs-provider'

  static contract(owner: string): ApiContract<VcsProviderMethods> {
    const known = contracts.get(owner)
    if (known !== undefined) return known
    const contract = defineApi({ id: VcsProviders.apiId, version: 1, owner, methods })
    contracts.set(owner, contract)
    return contract
  }

  static owners(ctx: Context): string[] {
    return listApis(ctx)
      .filter(api => api.id === VcsProviders.apiId)
      .map(api => api.owner)
  }

  /** The provider with the highest priority that claims the path; a provider whose detect fails is skipped. */
  static async resolve(
    ctx: Context,
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
