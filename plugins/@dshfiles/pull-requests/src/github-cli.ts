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

const ghOperations = ['repo-view', 'pr-view', 'auth-status', 'repo-info', 'pr-list', 'pr-create'] as const
type GhOperation = (typeof ghOperations)[number]

const operationFailure: Record<GhOperation, string> = {
  'repo-view': 'could not identify the repository',
  'repo-info': 'could not identify the repository',
  'pr-view': 'could not read the pull request',
  'auth-status': 'is not signed in to github.com',
  'pr-list': 'could not list pull requests for the branch',
  'pr-create': 'could not create the pull request',
}

export class GhCommandFailed extends Schema.TaggedError<GhCommandFailed>()('GhCommandFailed', {
  operation: Schema.Literals(ghOperations),
  rateLimited: Schema.Boolean,
  exitCode: Schema.optional(Schema.Number),
  /** The gh executable could not be found or started. */
  missing: Schema.optional(Schema.Boolean),
  /** Bounded, single-line stderr summary for recovery hints; never contains tokens (gh does not print them). */
  detail: Schema.optional(Schema.String),
}) {
  override get message(): string {
    if (this.missing === true) return 'The GitHub CLI (gh) is not installed or not on PATH. Install it from https://cli.github.com, then retry.'
    return this.rateLimited
      ? 'GitHub CLI reported rate limiting; the pull-request watcher will back off.'
      : `GitHub CLI ${operationFailure[this.operation]}${this.detail === undefined || this.detail.length === 0 ? '' : `: ${this.detail}`}.`
  }
}

export class GhResponseInvalid extends Schema.TaggedError<GhResponseInvalid>()('GhResponseInvalid', {
  operation: Schema.Literals(ghOperations),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `GitHub CLI returned an invalid ${this.operation === 'repo-view' || this.operation === 'repo-info' ? 'repository' : 'pull-request'} response.`
  }
}

const isRateLimitMessage = (text: string): boolean => {
  const normalized = text.toLowerCase()
  return normalized.includes('rate limit') || normalized.includes('abuse detection')
}

const MISSING_EXECUTABLE = /ENOENT|not ?found|no such file/iu

/** Whether a spawn failure means the executable is absent, read from the platform error without trusting its shape. */
const isMissingExecutable = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const reason: unknown = Reflect.get(error, 'reason')
  const reasonTag = typeof reason === 'object' && reason !== null ? Reflect.get(reason, '_tag') : undefined
  if (reasonTag === 'NotFound') return true
  return MISSING_EXECUTABLE.test(String(Reflect.get(error, 'message') ?? '')) || MISSING_EXECUTABLE.test(String(Reflect.get(error, 'cause') ?? ''))
}

const summarizeStderr = (stderr: string): string =>
  stderr
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .slice(-2)
    .join(' ')
    .replace(/gh[opsu]_[A-Za-z0-9]{20,}/gu, '<redacted>')
    .slice(0, 300)

export type GitHubCommandSpan = 'pull request gh repo' | 'pull request gh view' | 'pull request gh auth' | 'pull request gh list' | 'pull request gh create'

export const withGitHubCommandSpan = <A, E, R>(input: {
  readonly name: GitHubCommandSpan
  readonly attributes: Record<string, string | number | boolean>
  readonly effect: Effect.Effect<A, E, R>
}): Effect.Effect<A, E, R> => input.effect.pipe(Effect.withSpan(input.name, { kind: 'client', attributes: input.attributes }))

const runGh = Effect.fnUntraced(function* (input: {
  readonly operation: GhCommandFailed['operation']
  readonly args: readonly string[]
  readonly cwd?: string
  readonly span: GitHubCommandSpan
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
        if (exitCode !== 0)
          return yield* new GhCommandFailed({ operation: input.operation, rateLimited: isRateLimitMessage(stderr), exitCode, detail: summarizeStderr(stderr) })
        return stdout
      }).pipe(
        Effect.timeout(Duration.seconds(input.operation === 'pr-create' ? 90 : 30)),
        Effect.mapError(error =>
          error._tag === 'GhCommandFailed'
            ? error
            : new GhCommandFailed({ operation: input.operation, rateLimited: false, ...(isMissingExecutable(error) && { missing: true }) }),
        ),
      ),
    ),
  })
})

const repositoryNameSchema = Schema.Struct({ nameWithOwner: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u)) })
const repositoryInfoSchema = Schema.Struct({
  nameWithOwner: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u)),
  defaultBranchRef: Schema.NullOr(Schema.Struct({ name: Schema.String })),
})
const pullRequestListSchema = Schema.Array(Schema.Struct({ url: Schema.String, state: Schema.optional(Schema.String) }))
const PULL_REQUEST_URL = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*/u

export interface GitHubRepositoryInfo {
  readonly repo: string
  readonly defaultBranch: string | null
}

export interface GitHubPullRequestCreate {
  readonly repo: string
  readonly cwd: string
  readonly head: string
  readonly base: string
  readonly title: string
  readonly body: string
  readonly draft: boolean
}

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
    /** Succeeds when gh is installed and signed in to github.com. */
    readonly authStatus: Effect.Effect<void, GhCommandFailed>
    readonly repositoryInfo: (input: { readonly cwd: string }) => Effect.Effect<GitHubRepositoryInfo, GhCommandFailed | GhResponseInvalid>
    /** The URL of an open pull request whose head branch is `head`, if any. */
    readonly openPullRequestFor: (input: {
      readonly repo: string
      readonly cwd: string
      readonly head: string
    }) => Effect.Effect<string | null, GhCommandFailed | GhResponseInvalid>
    /** Runs `gh pr create` and returns the new pull request URL. */
    readonly createPullRequest: (input: GitHubPullRequestCreate) => Effect.Effect<string, GhCommandFailed | GhResponseInvalid>
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

      const pluginAttributes = { 'dshx.plugin.package': '@dshfiles/pull-requests' }
      const provide = <A, E>(effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>) =>
        effect.pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))

      const authStatus = provide(
        runGh({ operation: 'auth-status', args: ['auth', 'status', '--hostname', 'github.com'], span: 'pull request gh auth', attributes: pluginAttributes }),
      ).pipe(Effect.asVoid, Effect.withSpan('pull-requests gh auth status'))

      const repositoryInfo = Effect.fn('pull-requests gh repo info')(function* (input: { readonly cwd: string }) {
        const output = yield* provide(
          runGh({
            operation: 'repo-info',
            args: ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'],
            cwd: input.cwd,
            span: 'pull request gh repo',
            attributes: pluginAttributes,
          }),
        )
        const decoded = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(repositoryInfoSchema)(JSON.parse(output)),
          catch: cause => new GhResponseInvalid({ operation: 'repo-info', cause }),
        })
        const defaultBranch = decoded.defaultBranchRef?.name ?? ''
        return { repo: decoded.nameWithOwner, defaultBranch: defaultBranch.length > 0 ? defaultBranch : null }
      })

      const openPullRequestFor = Effect.fn('pull-requests gh list')(function* (input: { readonly repo: string; readonly cwd: string; readonly head: string }) {
        const output = yield* provide(
          runGh({
            operation: 'pr-list',
            args: ['pr', 'list', '--repo', input.repo, '--head', input.head, '--state', 'open', '--json', 'url,state', '--limit', '1'],
            cwd: input.cwd,
            span: 'pull request gh list',
            attributes: { ...pluginAttributes, 'github.repository': input.repo },
          }),
        )
        const listed = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(pullRequestListSchema)(JSON.parse(output)),
          catch: cause => new GhResponseInvalid({ operation: 'pr-list', cause }),
        })
        const url = listed[0]?.url
        return url !== undefined && PULL_REQUEST_URL.test(url) ? url : null
      })

      const createPullRequest = Effect.fn('pull-requests gh create')(function* (input: GitHubPullRequestCreate) {
        const output = yield* provide(
          runGh({
            operation: 'pr-create',
            args: [
              'pr',
              'create',
              '--repo',
              input.repo,
              '--head',
              input.head,
              '--base',
              input.base,
              '--title',
              input.title,
              '--body',
              input.body,
              ...(input.draft ? ['--draft'] : []),
            ],
            cwd: input.cwd,
            span: 'pull request gh create',
            attributes: { ...pluginAttributes, 'github.repository': input.repo, 'github.pull_request.draft': input.draft },
          }),
        )
        const url = PULL_REQUEST_URL.exec(output)?.[0]
        if (url === undefined) return yield* new GhResponseInvalid({ operation: 'pr-create' })
        return url
      })

      return GitHubCli.of({ repositoryName, pullRequest, authStatus, repositoryInfo, openPullRequestFor, createPullRequest })
    }),
  )
}
