import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { Context, Duration, Effect, Layer, Schema, Stream } from 'effect'
import { githubPullRequestViewSchema, type GitHubPullRequestView } from './pull-request-model.js'

const POLL_FIELDS = 'state,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,comments,reviews'
const PULL_REQUEST_PROJECTION =
  '. | {state, mergeable, mergeStateStatus, reviewDecision, statusCheckRollup: (.statusCheckRollup // [] | map(if has("context") then {context, state} else {name, status, conclusion} end)), comments: (.comments | map({author, createdAt})), reviews: (.reviews | map({author, state, submittedAt}))}'
const collectText = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => '',
      (text, chunk) => text + chunk,
    ),
  )

export class GhCommandFailed extends Schema.TaggedError<GhCommandFailed>()('GhCommandFailed', {
  operation: Schema.Literals(['repo-view', 'pr-view']),
  rateLimited: Schema.Boolean,
  exitCode: Schema.optional(Schema.Number),
}) {
  override get message(): string {
    return this.rateLimited
      ? 'GitHub CLI reported rate limiting; the pull-request watcher will back off.'
      : `GitHub CLI ${this.operation === 'repo-view' ? 'could not identify the repository' : 'could not read the pull request'}.`
  }
}

export class GhResponseInvalid extends Schema.TaggedError<GhResponseInvalid>()('GhResponseInvalid', {
  operation: Schema.Literals(['repo-view', 'pr-view']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `GitHub CLI returned an invalid ${this.operation === 'repo-view' ? 'repository' : 'pull-request'} response.`
  }
}

const isRateLimitMessage = (text: string): boolean => {
  const normalized = text.toLowerCase()
  return normalized.includes('rate limit') || normalized.includes('abuse detection')
}

export const withGitHubCommandSpan = <A, E, R>(input: {
  readonly name: 'pull request gh repo' | 'pull request gh view'
  readonly attributes: Record<string, string | number | boolean>
  readonly effect: Effect.Effect<A, E, R>
}): Effect.Effect<A, E, R> => input.effect.pipe(Effect.withSpan(input.name, { kind: 'client', attributes: input.attributes }))

const runGh = Effect.fnUntraced(function* (input: {
  readonly operation: GhCommandFailed['operation']
  readonly args: readonly string[]
  readonly cwd?: string
  readonly span: 'pull request gh repo' | 'pull request gh view'
  readonly attributes: Record<string, string | number | boolean>
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const commandOptions: ChildProcess.CommandOptions =
    input.cwd === undefined || input.cwd.length === 0
      ? { stdin: 'ignore', forceKillAfter: Duration.seconds(1) }
      : { stdin: 'ignore', forceKillAfter: Duration.seconds(1), cwd: input.cwd }
  const command = ChildProcess.make('gh', input.args, commandOptions)
  return yield* withGitHubCommandSpan({
    name: input.span,
    attributes: input.attributes,
    effect: Effect.scoped(
      Effect.gen(function* () {
        const process = yield* spawner.spawn(command)
        const [stdout, stderr, exitCode] = yield* Effect.all([collectText(process.stdout), collectText(process.stderr), process.exitCode], {
          concurrency: 'unbounded',
        })
        if (exitCode !== 0) return yield* new GhCommandFailed({ operation: input.operation, rateLimited: isRateLimitMessage(stderr), exitCode })
        return stdout
      }).pipe(
        Effect.timeout(Duration.seconds(30)),
        Effect.mapError(error => (error._tag === 'GhCommandFailed' ? error : new GhCommandFailed({ operation: input.operation, rateLimited: false }))),
      ),
    ),
  })
})

const repositoryNameSchema = Schema.Struct({ nameWithOwner: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u)) })

export const decodeGitHubPullRequestJson = (text: string): GitHubPullRequestView => {
  const json: unknown = JSON.parse(text)
  return Schema.decodeUnknownSync(githubPullRequestViewSchema)(json)
}

export class GitHubCli extends Context.Service<
  GitHubCli,
  {
    readonly repositoryName: (input: { readonly cwd: string }) => Effect.Effect<string, GhCommandFailed | GhResponseInvalid>
    readonly pullRequest: (input: {
      readonly repo: string
      readonly number: number
      readonly cwd: string
    }) => Effect.Effect<GitHubPullRequestView, GhCommandFailed | GhResponseInvalid>
  }
>()('@dshfiles/pull-requests/GitHubCli') {
  static readonly layer = Layer.effect(
    GitHubCli,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const repositoryName = Effect.fn('pull-requests gh repo')(function* (input: { readonly cwd: string }) {
        const output = yield* runGh({
          operation: 'repo-view',
          args: ['repo', 'view', '--json', 'nameWithOwner'],
          cwd: input.cwd,
          span: 'pull request gh repo',
          attributes: { 'dshx.plugin.package': '@dshfiles/pull-requests' },
        }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))
        return yield* Effect.try({
          try: () => Schema.decodeUnknownSync(repositoryNameSchema)(JSON.parse(output)).nameWithOwner,
          catch: cause => new GhResponseInvalid({ operation: 'repo-view', cause }),
        })
      })

      const pullRequest = Effect.fn('pull-requests gh view')(function* (input: { readonly repo: string; readonly number: number; readonly cwd: string }) {
        const output = yield* runGh({
          operation: 'pr-view',
          args: ['pr', 'view', String(input.number), '--repo', input.repo, '--json', POLL_FIELDS, '--jq', PULL_REQUEST_PROJECTION],
          cwd: input.cwd,
          span: 'pull request gh view',
          attributes: {
            'dshx.plugin.package': '@dshfiles/pull-requests',
            'github.repository': input.repo,
            'github.pull_request.number': input.number,
          },
        }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))
        return yield* Effect.try({
          try: () => decodeGitHubPullRequestJson(output),
          catch: cause => new GhResponseInvalid({ operation: 'pr-view', cause }),
        })
      })

      return GitHubCli.of({ repositoryName, pullRequest })
    }),
  )
}
