import { Context, Effect, Layer, Schema } from 'effect'
import { forgeTargetOf, pullRequestUrlOf, type ForgeKind, type ForgeTarget } from './forge.js'
import { GhCommandFailed, GhResponseInvalid, GitHubCli } from './github-cli.js'
import { GitLabCli, GlabCommandFailed, GlabResponseInvalid } from './gitlab-cli.js'
import type { GitHubPullRequestView } from './pull-request-model.js'

export class UnsupportedRepository extends Schema.TaggedError<UnsupportedRepository>()('UnsupportedRepository', { repo: Schema.String }) {
  override get message(): string {
    return `${this.repo} does not name a GitHub or GitLab repository. Use a GitHub pull-request URL, a GitLab merge-request URL, or a checkout whose origin is one of those forges.`
  }
}

export type ForgeFailure = GhCommandFailed | GhResponseInvalid | GlabCommandFailed | GlabResponseInvalid | UnsupportedRepository

export interface ForgeRepositoryInfo {
  readonly repo: string
  readonly kind: ForgeKind
  readonly host: string
  readonly project: string
  readonly defaultBranch: string | null
}

/** One repository resolved for creation: its forge, its project path and the CLI adapter result. */
export interface ResolvedForgeRepository {
  readonly kind: ForgeKind
  readonly host: string
  readonly project: string
  /** The stored repository key: bare `owner/name` on GitHub, host-qualified on GitLab. */
  readonly repo: string
}

const repoKeyOf = (target: ForgeTarget, project: string): string => (target.kind === 'github' ? project : `${target.host}/${project}`)

/**
 * The forge port: one small surface the watcher and the creator use, with the GitHub and GitLab CLIs behind it.
 * The repository key names the forge (a bare `owner/name` is GitHub), so a stored record keeps resolving after a
 * restart without a migration.
 */
export class ForgePullRequests extends Context.Service<
  ForgePullRequests,
  {
    readonly repositoryInfo: (input: { readonly cwd: string }) => Effect.Effect<ForgeRepositoryInfo, ForgeFailure>
    readonly pullRequest: (input: {
      readonly repo: string
      readonly number: number
      readonly cwd: string
    }) => Effect.Effect<GitHubPullRequestView, ForgeFailure>
    readonly authStatus: (input: { readonly repo: string }) => Effect.Effect<void, ForgeFailure>
    readonly openPullRequestFor: (input: { readonly repo: string; readonly cwd: string; readonly head: string }) => Effect.Effect<string | null, ForgeFailure>
    readonly createPullRequest: (input: {
      readonly repo: string
      readonly cwd: string
      readonly head: string
      readonly base: string
      readonly title: string
      readonly body: string
      readonly draft: boolean
    }) => Effect.Effect<string, ForgeFailure>
  }
>()('@dshfiles/pull-requests/ForgePullRequests') {
  static readonly layer = Layer.effect(
    ForgePullRequests,
    Effect.gen(function* () {
      const github = yield* GitHubCli
      const gitlab = yield* GitLabCli

      const targetOf = (repo: string): Effect.Effect<ForgeTarget, UnsupportedRepository> => {
        const target = forgeTargetOf(repo)
        return target === undefined ? Effect.fail(new UnsupportedRepository({ repo })) : Effect.succeed(target)
      }

      const repositoryInfo = Effect.fn('pull-requests forge repository')(function* (input: { readonly cwd: string }) {
        const gh = yield* github.repositoryInfo({ cwd: input.cwd }).pipe(Effect.option)
        if (gh._tag === 'Some') {
          const target = forgeTargetOf(gh.value.repo)
          return {
            repo: gh.value.repo,
            kind: 'github' as const,
            host: target?.host ?? 'github.com',
            project: target?.project ?? gh.value.repo,
            defaultBranch: gh.value.defaultBranch,
          }
        }
        const gl = yield* gitlab.repositoryInfo({ cwd: input.cwd })
        return { repo: `${gl.host}/${gl.project}`, kind: 'gitlab' as const, host: gl.host, project: gl.project, defaultBranch: gl.defaultBranch }
      })

      const pullRequest = Effect.fn('pull-requests forge view')(function* (input: { readonly repo: string; readonly number: number; readonly cwd: string }) {
        const target = yield* targetOf(input.repo)
        return target.kind === 'github'
          ? yield* github.pullRequest({ repo: target.project, number: input.number, cwd: input.cwd })
          : yield* gitlab.mergeRequest({ project: target.project, number: input.number, cwd: input.cwd })
      })

      const authStatus = Effect.fn('pull-requests forge auth')(function* (input: { readonly repo: string }) {
        const target = yield* targetOf(input.repo)
        yield* target.kind === 'github' ? github.authStatus : gitlab.authStatus
      })

      const openPullRequestFor = Effect.fn('pull-requests forge list')(function* (input: {
        readonly repo: string
        readonly cwd: string
        readonly head: string
      }) {
        const target = yield* targetOf(input.repo)
        return target.kind === 'github'
          ? yield* github.openPullRequestFor({ repo: target.project, cwd: input.cwd, head: input.head })
          : yield* gitlab.openMergeRequestFor({ project: target.project, cwd: input.cwd, head: input.head })
      })

      const createPullRequest = Effect.fn('pull-requests forge create')(function* (input: {
        readonly repo: string
        readonly cwd: string
        readonly head: string
        readonly base: string
        readonly title: string
        readonly body: string
        readonly draft: boolean
      }) {
        const target = yield* targetOf(input.repo)
        return target.kind === 'github'
          ? yield* github.createPullRequest({
              repo: target.project,
              cwd: input.cwd,
              head: input.head,
              base: input.base,
              title: input.title,
              body: input.body,
              draft: input.draft,
            })
          : yield* gitlab.createMergeRequest({
              project: target.project,
              cwd: input.cwd,
              head: input.head,
              base: input.base,
              title: input.title,
              body: input.body,
              draft: input.draft,
            })
      })

      return ForgePullRequests.of({ repositoryInfo, pullRequest, authStatus, openPullRequestFor, createPullRequest })
    }),
  )
}

export { pullRequestUrlOf, repoKeyOf }
