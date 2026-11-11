import { createHash } from 'node:crypto'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { Context, Duration, Effect, Layer, Option, Schema, Stream } from 'effect'
import {
  checkRollupSchema,
  commentSchema,
  forgeSearchItemSchema,
  reviewSchema,
  githubPullRequestViewSchema,
  type ForgeSearchItem,
  type GitHubPullRequestView,
  type IssueStatesOutput,
} from './pull-request-model.js'

const collectText = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => '',
      (text, chunk) => text + chunk,
    ),
  )

const ghOperations = ['repo-view', 'pr-view', 'auth-status', 'repo-info', 'pr-list', 'pr-create', 'issue-states', 'pr-batch'] as const
type GhOperation = (typeof ghOperations)[number]

const operationFailure = {
  'repo-view': 'could not identify the repository',
  'repo-info': 'could not identify the repository',
  'pr-view': 'could not read the pull request',
  'auth-status': 'is not signed in to github.com',
  'pr-list': 'could not list pull requests for the branch',
  'pr-create': 'could not create the pull request',
  'issue-states': 'could not read issue states',
  'pr-batch': 'could not read pull requests',
} satisfies Record<GhOperation, string>

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

/** The fields of a spawn failure this check reads; the platform error's shape is not trusted, so each stays unparsed. */
interface SpawnFailureData {
  readonly reason?: unknown
  readonly message?: unknown
  readonly cause?: unknown
}

/** A tagged platform failure reason, e.g. `{ _tag: 'NotFound' }`. */
interface FailureReasonData {
  readonly _tag?: unknown
}

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null

/** Whether a spawn failure means the executable is absent, read from the platform error without trusting its shape. */
const isMissingExecutable = (error: unknown): boolean => {
  const failure: SpawnFailureData | undefined = isObject(error) ? error : undefined
  if (failure === undefined) return false
  const reason: FailureReasonData = isObject(failure.reason) ? failure.reason : {}
  if (reason._tag === 'NotFound') return true
  return MISSING_EXECUTABLE.test(String(failure.message ?? '')) || MISSING_EXECUTABLE.test(String(failure.cause ?? ''))
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

export type GitHubCommandSpan =
  | 'pull request gh repo'
  | 'pull request gh view'
  | 'pull request gh auth'
  | 'pull request gh list'
  | 'pull request gh create'
  | 'pull request gh issues'
  | 'pull request gh batch'

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
  /** Keep stdout of a non-zero exit: `gh api graphql` exits 1 when one alias fails but still prints the others. */
  readonly keepPartialOutput?: boolean
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
        const partial = input.keepPartialOutput === true && stdout.trim().length > 0 && !isRateLimitMessage(stderr)
        if (exitCode !== 0 && !partial)
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
const forgeSearchSchema = Schema.Array(forgeSearchItemSchema)
const ISSUE_BATCH = 50
const ISSUE_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/([1-9]\d*)\/?$/u
const issueNodeSchema = Schema.NullOr(
  Schema.Struct({
    issueOrPullRequest: Schema.NullOr(Schema.Struct({ state: Schema.String, stateReason: Schema.optional(Schema.NullOr(Schema.String)) })),
  }),
)
const issueBatchSchema = Schema.Struct({ data: Schema.NullOr(Schema.Record(Schema.String, issueNodeSchema)) })

/** One aliased GraphQL query for a batch of issues; owner, name and number are already pattern-checked. */
const issueQueryOf = (issues: readonly { readonly owner: string; readonly name: string; readonly number: number }[]): string =>
  `query{${issues
    .map(
      (issue, index) =>
        `i${String(index)}:repository(owner:${JSON.stringify(issue.owner)},name:${JSON.stringify(issue.name)}){issueOrPullRequest(number:${String(issue.number)}){...on Issue{state stateReason}}}`,
    )
    .join('')}}`

/** Pull requests one aliased GraphQL read covers: at fifty a full read costs GitHub 2 points, a fingerprint read 1. */
export const PULL_REQUEST_BATCH = 50
const GITHUB_REPOSITORY = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u
const HEAD_CHECK_COUNTS = 'checkRunCountsByState{state count} statusContextCountsByState{state count}'
const FINGERPRINT_FIELDS = `state updatedAt mergeable mergeStateStatus reviewDecision commits(last:1){nodes{commit{oid statusCheckRollup{state contexts(first:1){${HEAD_CHECK_COUNTS}}}}}}`
const FULL_FIELDS = `state updatedAt mergeable mergeStateStatus reviewDecision body commits(last:1){nodes{commit{oid statusCheckRollup{state contexts(first:100){${HEAD_CHECK_COUNTS} nodes{__typename ...on CheckRun{name status conclusion} ...on StatusContext{context state}}}}}}} comments(last:20){totalCount nodes{author{login} createdAt}} reviews(last:20){totalCount nodes{author{login} state submittedAt}}`

const stateCountsSchema = Schema.NullOr(Schema.Array(Schema.Struct({ state: Schema.String, count: Schema.Number })))
const headCommitsSchema = Schema.Struct({
  nodes: Schema.Array(
    Schema.Struct({
      commit: Schema.Struct({
        oid: Schema.String,
        statusCheckRollup: Schema.NullOr(
          Schema.Struct({
            state: Schema.String,
            contexts: Schema.Struct({
              checkRunCountsByState: stateCountsSchema,
              statusContextCountsByState: stateCountsSchema,
              nodes: Schema.optionalKey(Schema.Array(checkRollupSchema)),
            }),
          }),
        ),
      }),
    }),
  ),
})
const fingerprintNodeSchema = Schema.Struct({
  state: githubPullRequestViewSchema.fields.state,
  updatedAt: Schema.String,
  mergeable: githubPullRequestViewSchema.fields.mergeable,
  mergeStateStatus: githubPullRequestViewSchema.fields.mergeStateStatus,
  reviewDecision: githubPullRequestViewSchema.fields.reviewDecision,
  commits: headCommitsSchema,
})
const fullNodeSchema = Schema.Struct({
  ...fingerprintNodeSchema.fields,
  body: Schema.String,
  comments: Schema.Struct({ totalCount: Schema.Number, nodes: Schema.Array(commentSchema) }),
  reviews: Schema.Struct({ totalCount: Schema.Number, nodes: Schema.Array(reviewSchema) }),
})
const fingerprintAliasSchema = Schema.Struct({ pullRequest: Schema.NullOr(fingerprintNodeSchema) })
const fullAliasSchema = Schema.Struct({ pullRequest: Schema.NullOr(fullNodeSchema) })
const rateLimitSchema = Schema.Struct({ cost: Schema.Number, remaining: Schema.Number, resetAt: Schema.String })
const pullRequestBatchSchema = Schema.Struct({
  data: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ type: Schema.optionalKey(Schema.String) }))),
})
const decodeRateLimit = Schema.decodeUnknownOption(rateLimitSchema)

type FingerprintNode = typeof fingerprintNodeSchema.Type
type FullNode = typeof fullNodeSchema.Type

/** The cheap-read fields of a pull request, digested: equal digests mean nothing a snapshot keeps has changed. */
const fingerprintOf = (node: FingerprintNode): string => {
  const head = node.commits.nodes[0]?.commit
  const counts = (rows: typeof stateCountsSchema.Type) =>
    (rows ?? [])
      .map(row => `${row.state}=${String(row.count)}`)
      .sort()
      .join(',')
  const contexts = head?.statusCheckRollup?.contexts
  const parts = [
    node.state,
    node.updatedAt,
    node.mergeable,
    node.mergeStateStatus,
    node.reviewDecision ?? '',
    head?.oid ?? '',
    head?.statusCheckRollup?.state ?? '',
    counts(contexts?.checkRunCountsByState ?? null),
    counts(contexts?.statusContextCountsByState ?? null),
  ]
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)
}

const viewOf = (node: FullNode): GitHubPullRequestView => ({
  state: node.state,
  mergeable: node.mergeable,
  mergeStateStatus: node.mergeStateStatus,
  reviewDecision: node.reviewDecision,
  statusCheckRollup: node.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? null,
  comments: node.comments.nodes,
  reviews: node.reviews.nodes,
  body: node.body,
  commentsCount: node.comments.totalCount,
  reviewsCount: node.reviews.totalCount,
})

/** One aliased GraphQL read of pull requests, with GitHub's own budget report; owner, name and number are checked. */
const pullRequestQueryOf = (input: {
  readonly targets: readonly { readonly owner: string; readonly name: string; readonly number: number }[]
  readonly full: boolean
}): string =>
  `query{rateLimit{cost remaining resetAt}${input.targets
    .map(
      (target, index) =>
        `p${String(index)}:repository(owner:${JSON.stringify(target.owner)},name:${JSON.stringify(target.name)}){pullRequest(number:${String(target.number)}){${input.full ? FULL_FIELDS : FINGERPRINT_FIELDS}}}`,
    )
    .join('')}}`

export interface GitHubPullRequestTarget {
  /** `owner/name`. */
  readonly repo: string
  readonly number: number
  /** The fingerprint of the last stored snapshot: when the cheap read still matches it, the full read is skipped. */
  readonly known: string | null
}

/** What one batched read answered for one pull request. */
export type PullRequestRead =
  | { readonly kind: 'read'; readonly view: GitHubPullRequestView; readonly fingerprint: string | null }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'failed'; readonly error: 'gh-command-failed' | 'invalid-response' }
  | { readonly kind: 'rate-limited' }
  /** Not read: GitHub's remaining budget fell under the floor before this batch. */
  | { readonly kind: 'deferred' }

/** GitHub's GraphQL budget as the last read reported it; `resetAt` is epoch milliseconds. */
export interface GitHubRateLimit {
  readonly cost: number
  readonly remaining: number
  readonly resetAt: number
}

export interface PullRequestBatchRead {
  /** One entry per target, in order. */
  readonly reads: readonly PullRequestRead[]
  readonly rateLimit: GitHubRateLimit | null
  readonly rateLimited: boolean
}

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

/** A normalized pull-request view, decoded from its JSON text. */
export const githubPullRequestJsonSchema = Schema.fromJsonString(githubPullRequestViewSchema)

const decodeGhJson =
  <S extends Schema.Decoder<unknown>>(operation: GhOperation, schema: S) =>
  (output: string): Effect.Effect<S['Type'], GhResponseInvalid, S['DecodingServices']> =>
    Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(output).pipe(Effect.mapError(cause => new GhResponseInvalid({ operation, cause })))

export class GitHubCli extends Context.Service<
  GitHubCli,
  {
    readonly repositoryName: (input: { readonly cwd: string }) => Effect.Effect<string, GhCommandFailed | GhResponseInvalid>
    /**
     * Pull requests, fifty per `gh api graphql` call. Targets with a known fingerprint get a cheap read first and a full
     * read only when it changed. Never fails: each target gets its own outcome, a rate limit stops the remaining batches,
     * and a batch is deferred once GitHub reports fewer than `minRemaining` points left.
     */
    readonly pullRequests: (input: {
      readonly targets: readonly GitHubPullRequestTarget[]
      readonly minRemaining: number
    }) => Effect.Effect<PullRequestBatchRead>
    /** Succeeds when gh is installed and signed in to github.com. */
    readonly authStatus: Effect.Effect<void, GhCommandFailed>
    readonly repositoryInfo: (input: { readonly cwd: string }) => Effect.Effect<GitHubRepositoryInfo, GhCommandFailed | GhResponseInvalid>
    /** The URL of an open pull request whose head branch is `head`, if any. */
    readonly openPullRequestFor: (input: {
      readonly repo: string
      readonly cwd: string
      readonly head: string
    }) => Effect.Effect<string | null, GhCommandFailed | GhResponseInvalid>
    readonly searchIssues: (input: {
      readonly cwd: string
      readonly query: string
    }) => Effect.Effect<readonly ForgeSearchItem[], GhCommandFailed | GhResponseInvalid>
    /**
     * The open or closed state of GitHub issues, fifty per `gh api graphql` call. Never fails: an issue it could not
     * read comes back in `failed`, and a rate limit stops the remaining batches.
     */
    readonly issueStates: (input: {
      readonly urls: readonly string[]
    }) => Effect.Effect<Omit<IssueStatesOutput, 'issues'> & { readonly issues: readonly Omit<IssueStatesOutput['issues'][number], 'checkedAt'>[] }>
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
        return (yield* decodeGhJson('repo-view', repositoryNameSchema)(output)).nameWithOwner
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
        const decoded = yield* decodeGhJson('repo-info', repositoryInfoSchema)(output)
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
        const listed = yield* decodeGhJson('pr-list', pullRequestListSchema)(output)
        const url = listed[0]?.url
        return url !== undefined && PULL_REQUEST_URL.test(url) ? url : null
      })

      const searchIssues = Effect.fn('pull-requests gh search')(function* (input: { readonly cwd: string; readonly query: string }) {
        const repo = yield* repositoryName({ cwd: input.cwd })
        const output = yield* provide(
          runGh({
            operation: 'pr-list',
            args: ['search', 'issues', '--include-prs', '--repo', repo, '--limit', '30', '--json', 'number,title,state,url,isPullRequest', '--', input.query],
            cwd: input.cwd,
            span: 'pull request gh list',
            attributes: { ...pluginAttributes, 'github.repository': repo },
          }),
        )
        return yield* decodeGhJson('pr-list', forgeSearchSchema)(output)
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

      const issueStates = Effect.fn('pull-requests gh issue states')(function* (input: { readonly urls: readonly string[] }) {
        const parsed = [...new Set(input.urls)].flatMap(url => {
          const match = ISSUE_URL.exec(url)
          return match === null ? [] : [{ url, owner: match[1] ?? '', name: match[2] ?? '', number: Number(match[3]) }]
        })
        const unparsed = input.urls.filter(url => !parsed.some(issue => issue.url === url))
        const batches = Array.from({ length: Math.ceil(parsed.length / ISSUE_BATCH) }, (_, index) =>
          parsed.slice(index * ISSUE_BATCH, (index + 1) * ISSUE_BATCH),
        )
        const issues: { url: string; state: 'OPEN' | 'CLOSED'; stateReason: string | null }[] = []
        const failed: string[] = [...unparsed]
        let rateLimited = false
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- batches run one at a time so a rate limit stops the rest.
        for (const batch of batches) {
          if (rateLimited) {
            failed.push(...batch.map(issue => issue.url))
            continue
          }
          const read = yield* provide(
            runGh({
              operation: 'issue-states',
              args: ['api', 'graphql', '-f', `query=${issueQueryOf(batch)}`],
              span: 'pull request gh issues',
              attributes: { ...pluginAttributes, 'github.issues': batch.length },
              keepPartialOutput: true,
            }),
          ).pipe(Effect.flatMap(decodeGhJson('issue-states', issueBatchSchema)), Effect.result)
          if (read._tag === 'Failure') {
            rateLimited = read.failure._tag === 'GhCommandFailed' && read.failure.rateLimited
            failed.push(...batch.map(issue => issue.url))
            continue
          }
          batch.forEach((issue, index) => {
            const node = read.success.data?.[`i${String(index)}`]?.issueOrPullRequest
            const state = node?.state
            if (state === 'OPEN' || state === 'CLOSED') issues.push({ url: issue.url, state, stateReason: node?.stateReason?.slice(0, 40) ?? null })
            else failed.push(issue.url)
          })
        }
        return { issues, failed, rateLimited }
      })

      type Indexed = { readonly index: number; readonly owner: string; readonly name: string; readonly number: number; readonly known: string | null }
      type BatchPass<Node> =
        | { readonly kind: 'ok'; readonly nodes: readonly (Node | undefined)[]; readonly rateLimit: GitHubRateLimit | null }
        | { readonly kind: 'failed'; readonly rateLimited: boolean; readonly error: 'gh-command-failed' | 'invalid-response' }

      const readPass = <Node>(input: {
        readonly targets: readonly Indexed[]
        readonly full: boolean
        readonly aliasSchema: Schema.Decoder<{ readonly pullRequest: Node | null }>
      }) => {
        const decodeAlias = Schema.decodeUnknownOption(input.aliasSchema)
        return provide(
          runGh({
            operation: 'pr-batch',
            args: ['api', 'graphql', '-f', `query=${pullRequestQueryOf(input)}`],
            span: 'pull request gh batch',
            attributes: { ...pluginAttributes, 'github.pull_requests': input.targets.length, 'github.read': input.full ? 'full' : 'fingerprint' },
            keepPartialOutput: true,
          }),
        ).pipe(
          Effect.flatMap(decodeGhJson('pr-batch', pullRequestBatchSchema)),
          Effect.map((response): BatchPass<Node> => {
            if (response.data === null)
              return { kind: 'failed', rateLimited: (response.errors ?? []).some(error => error.type === 'RATE_LIMITED'), error: 'gh-command-failed' }
            const data = response.data
            const rateLimit = Option.match(decodeRateLimit(data['rateLimit']), {
              onNone: () => null,
              onSome: (value): GitHubRateLimit | null => {
                const resetAt = Date.parse(value.resetAt)
                return Number.isFinite(resetAt) ? { cost: value.cost, remaining: value.remaining, resetAt } : null
              },
            })
            const nodes = input.targets.map((_, alias) => Option.getOrUndefined(decodeAlias(data[`p${String(alias)}`]))?.pullRequest ?? undefined)
            return { kind: 'ok', nodes, rateLimit }
          }),
          Effect.catch((error): Effect.Effect<BatchPass<Node>> =>
            Effect.succeed({
              kind: 'failed',
              rateLimited: error._tag === 'GhCommandFailed' && error.rateLimited,
              error: error._tag === 'GhResponseInvalid' ? 'invalid-response' : 'gh-command-failed',
            }),
          ),
        )
      }
      const pullRequests = Effect.fn('pull-requests gh pull requests')(function* (input: {
        readonly targets: readonly GitHubPullRequestTarget[]
        readonly minRemaining: number
      }) {
        const reads: PullRequestRead[] = input.targets.map(() => ({ kind: 'deferred' }))
        const indexed: Indexed[] = input.targets.flatMap((target, index) => {
          const match = GITHUB_REPOSITORY.exec(target.repo)
          if (match === null) {
            reads[index] = { kind: 'failed', error: 'invalid-response' }
            return []
          }
          return [{ index, owner: match[1] ?? '', name: match[2] ?? '', number: target.number, known: target.known }]
        })
        let rateLimit: GitHubRateLimit | null = null
        let rateLimited = false
        const fail = (targets: readonly Indexed[], read: PullRequestRead) => {
          for (const target of targets) reads[target.index] = read
        }
        // Batches run one at a time so a rate limit or a low budget stops the rest.
        for (let start = 0; start < indexed.length; start += PULL_REQUEST_BATCH) {
          if (rateLimited || (rateLimit !== null && rateLimit.remaining < input.minRemaining)) break
          const batch = indexed.slice(start, start + PULL_REQUEST_BATCH)
          const known = batch.filter(target => target.known !== null)
          const toRead = batch.filter(target => target.known === null)
          if (known.length > 0) {
            const cheap = yield* readPass({ targets: known, full: false, aliasSchema: fingerprintAliasSchema })
            if (cheap.kind === 'failed' && cheap.rateLimited) {
              rateLimited = true
              break
            }
            if (cheap.kind === 'failed') fail(known, { kind: 'failed', error: cheap.error })
            if (cheap.kind === 'ok') {
              rateLimit = cheap.rateLimit ?? rateLimit
              known.forEach((target, alias) => {
                const node = cheap.nodes[alias]
                if (node === undefined) reads[target.index] = { kind: 'failed', error: 'gh-command-failed' }
                if (node !== undefined && fingerprintOf(node) === target.known) reads[target.index] = { kind: 'unchanged' }
                if (node !== undefined && fingerprintOf(node) !== target.known) toRead.push(target)
              })
            }
          }
          if (toRead.length === 0) continue
          const full = yield* readPass({ targets: toRead, full: true, aliasSchema: fullAliasSchema })
          if (full.kind === 'failed' && full.rateLimited) {
            rateLimited = true
            break
          }
          if (full.kind === 'failed') {
            fail(toRead, { kind: 'failed', error: full.error })
            continue
          }
          rateLimit = full.rateLimit ?? rateLimit
          toRead.forEach((target, alias) => {
            const node = full.nodes[alias]
            reads[target.index] =
              node === undefined ? { kind: 'failed', error: 'gh-command-failed' } : { kind: 'read', view: viewOf(node), fingerprint: fingerprintOf(node) }
          })
        }
        if (rateLimited) for (const target of indexed) if (reads[target.index]?.kind === 'deferred') reads[target.index] = { kind: 'rate-limited' }
        return { reads, rateLimit, rateLimited }
      })

      return GitHubCli.of({
        repositoryName,
        pullRequests,
        authStatus,
        repositoryInfo,
        openPullRequestFor,
        searchIssues,
        issueStates,
        createPullRequest,
      })
    }),
  )
}
