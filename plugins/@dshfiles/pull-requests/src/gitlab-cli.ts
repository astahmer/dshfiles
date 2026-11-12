import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { Context, Duration, Effect, Layer, Schema, Stream } from 'effect'
import { withGitHubCommandSpan } from './github-cli.js'
import { githubPullRequestViewSchema, type GitHubPullRequestView } from './pull-request-model.js'

const collectText = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => '',
      (text, chunk) => text + chunk,
    ),
  )

const glabOperations = ['mr-view', 'auth-status', 'mr-list', 'mr-create'] as const
type GlabOperation = (typeof glabOperations)[number]

const operationSpan = {
  'mr-view': 'pull request gh view',
  'auth-status': 'pull request gh auth',
  'mr-list': 'pull request gh list',
  'mr-create': 'pull request gh create',
} as const satisfies Record<GlabOperation, string>

const operationFailure = {
  'mr-view': 'could not read the merge request',
  'auth-status': 'is not signed in to this GitLab host',
  'mr-list': 'could not list merge requests for the branch',
  'mr-create': 'could not create the merge request',
} satisfies Record<GlabOperation, string>

export class GlabCommandFailed extends Schema.TaggedError<GlabCommandFailed>()('GlabCommandFailed', {
  operation: Schema.Literals(glabOperations),
  rateLimited: Schema.Boolean,
  exitCode: Schema.optional(Schema.Number),
  /** The glab executable could not be found or started. */
  missing: Schema.optional(Schema.Boolean),
  /** Bounded, single-line stderr summary for recovery hints; never contains tokens (glab does not print them). */
  detail: Schema.optional(Schema.String),
}) {
  override get message(): string {
    if (this.missing === true)
      return 'The GitLab CLI (glab) is not installed or not on PATH. Install it from https://gitlab.com/gitlab-org/cli, run `glab auth login`, then retry.'
    return this.rateLimited
      ? 'GitLab CLI reported rate limiting; the merge-request watcher will back off.'
      : `GitLab CLI ${operationFailure[this.operation]}${this.detail === undefined || this.detail.length === 0 ? '' : `: ${this.detail}`}.`
  }
}

export class GlabResponseInvalid extends Schema.TaggedError<GlabResponseInvalid>()('GlabResponseInvalid', {
  operation: Schema.Literals(glabOperations),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `GitLab CLI returned an invalid ${this.operation === 'mr-view' ? 'merge-request' : 'merge-request list'} response.`
  }
}

const isRateLimitMessage = (text: string): boolean => {
  const normalized = text.toLowerCase()
  return normalized.includes('rate limit') || normalized.includes('429 too many')
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
    .replace(/glpat-[A-Za-z0-9_-]{10,}/gu, '<redacted>')
    .slice(0, 300)

const runGlab = Effect.fnUntraced(function* (input: {
  readonly operation: GlabOperation
  readonly args: readonly string[]
  readonly cwd?: string
  readonly attributes: Record<string, string | number | boolean>
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const commandOptions: ChildProcess.CommandOptions =
    input.cwd === undefined || input.cwd.length === 0
      ? { stdin: 'ignore', forceKillAfter: Duration.seconds(1) }
      : { stdin: 'ignore', forceKillAfter: Duration.seconds(1), cwd: input.cwd }
  const command = ChildProcess.make('glab', input.args, commandOptions)
  return yield* withGitHubCommandSpan({
    name: operationSpan[input.operation],
    attributes: { ...input.attributes, 'dshfiles.forge': 'gitlab' },
    effect: Effect.scoped(
      Effect.gen(function* () {
        const process = yield* spawner.spawn(command)
        const [stdout, stderr, exitCode] = yield* Effect.all([collectText(process.stdout), collectText(process.stderr), process.exitCode], {
          concurrency: 'unbounded',
        })
        if (exitCode !== 0)
          return yield* new GlabCommandFailed({
            operation: input.operation,
            rateLimited: isRateLimitMessage(stderr),
            exitCode,
            detail: summarizeStderr(stderr),
          })
        return stdout
      }).pipe(
        Effect.timeout(Duration.seconds(input.operation === 'mr-create' ? 90 : 30)),
        Effect.mapError(error =>
          error._tag === 'GlabCommandFailed'
            ? error
            : new GlabCommandFailed({ operation: input.operation, rateLimited: false, ...(isMissingExecutable(error) && { missing: true }) }),
        ),
      ),
    ),
  })
})

/** The fields of one `glab mr view --output json` answer this watcher reads; every field is validated or ignored. */
export const glabMergeRequestSchema = Schema.Struct({
  iid: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  state: Schema.String,
  detailed_merge_status: Schema.optional(Schema.String),
  merge_status: Schema.optional(Schema.String),
  blocking_discussions_resolved: Schema.optional(Schema.Boolean),
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  web_url: Schema.optional(Schema.String),
  head_pipeline: Schema.optional(Schema.NullOr(Schema.Struct({ status: Schema.optional(Schema.String) }))),
  approvals_required: Schema.optional(Schema.Number),
  user_notes_count: Schema.optional(Schema.Number),
  notes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        body: Schema.optional(Schema.String),
        created_at: Schema.optional(Schema.String),
        author: Schema.optional(Schema.NullOr(Schema.Struct({ username: Schema.optional(Schema.String) }))),
      }),
    ),
  ),
})
export type GlabMergeRequest = typeof glabMergeRequestSchema.Type

const MERGED = new Set(['merged'])
const CLOSED = new Set(['closed'])
const OPEN = new Set(['opened', 'locked'])

const stateOf = (mr: GlabMergeRequest): GitHubPullRequestView['state'] => {
  const state = mr.state.toLowerCase()
  if (MERGED.has(state)) return 'MERGED'
  if (CLOSED.has(state)) return 'CLOSED'
  return OPEN.has(state) ? 'OPEN' : 'OPEN'
}

const CONFLICT_STATUSES = new Set(['conflict', 'cannot_be_merged'])

const mergeFields = (mr: GlabMergeRequest): Pick<GitHubPullRequestView, 'mergeable' | 'mergeStateStatus' | 'reviewDecision'> => {
  const detailed = (mr.detailed_merge_status ?? mr.merge_status ?? '').toLowerCase()
  const mergeable: GitHubPullRequestView['mergeable'] = CONFLICT_STATUSES.has(detailed) ? 'CONFLICTING' : detailed === '' ? 'UNKNOWN' : 'MERGEABLE'
  const drafting = detailed === 'draft' || detailed === 'draft_status'
  const blocked = mr.blocking_discussions_resolved === false || mergeable === 'CONFLICTING'
  const unstable = detailed === 'ci_still_running' || detailed === 'ci_must_pass' || detailed === 'checking'
  const mergeStateStatus = (): GitHubPullRequestView['mergeStateStatus'] => {
    if (drafting) return 'DRAFT'
    if (blocked) return 'BLOCKED'
    if (unstable) return 'UNSTABLE'
    if (mergeable === 'MERGEABLE') return 'CLEAN'
    return 'UNKNOWN'
  }
  const reviewDecision: GitHubPullRequestView['reviewDecision'] =
    mr.approvals_required === undefined ? null : mr.approvals_required > 0 ? 'REVIEW_REQUIRED' : 'APPROVED'
  return { mergeable, mergeStateStatus: mergeStateStatus(), reviewDecision }
}

/** GitLab pipeline statuses mapped to the GitHub check states the watcher stores; others are upper-cased as they are. */
const PIPELINE_STATES = new Map<string, string>([
  ['success', 'SUCCESS'],
  ['failed', 'FAILURE'],
  ['canceled', 'CANCELLED'],
  ['skipped', 'SKIPPED'],
  ['running', 'IN_PROGRESS'],
  ['pending', 'PENDING'],
  ['created', 'QUEUED'],
  ['manual', 'ACTION_REQUIRED'],
])

/** Map one decoded merge request onto the same normalized view the GitHub watcher stores. */
export const normalizeMergeRequest = (mr: GlabMergeRequest): GitHubPullRequestView => {
  const status = mr.head_pipeline?.status?.toLowerCase()
  const pipeline =
    status === undefined ? null : [{ __typename: 'StatusContext' as const, context: 'pipeline', state: PIPELINE_STATES.get(status) ?? status.toUpperCase() }]
  const notes = (mr.notes ?? []).flatMap(note => {
    const createdAt = note.created_at
    if (createdAt === undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(createdAt)) return []
    return [{ author: note.author?.username === undefined ? null : { login: note.author.username }, createdAt }]
  })
  return {
    state: stateOf(mr),
    ...mergeFields(mr),
    statusCheckRollup: pipeline,
    comments: notes,
    reviews: [],
    body: mr.description ?? '',
  }
}

const mergeRequestListSchema = Schema.Array(Schema.Struct({ web_url: Schema.String, state: Schema.optional(Schema.String) }))
const MERGE_REQUEST_URL = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/.+\/-\/merge_requests\/[1-9]\d*$/u
const repositoryInfoSchema = Schema.Struct({
  path_with_namespace: Schema.String.check(Schema.isPattern(/^(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+$/u)),
  default_branch: Schema.optional(Schema.NullOr(Schema.String)),
  web_url: Schema.optional(Schema.String),
})

export interface GitLabMergeRequestCreate {
  readonly project: string
  readonly cwd: string
  readonly head: string
  readonly base: string
  readonly title: string
  readonly body: string
  readonly draft: boolean
}

export interface GitLabRepositoryInfo {
  readonly host: string
  readonly project: string
  readonly defaultBranch: string | null
}

const decodeGlabJson =
  <S extends Schema.Decoder<unknown>>(operation: GlabOperation, schema: S) =>
  (output: string): Effect.Effect<S['Type'], GlabResponseInvalid, S['DecodingServices']> =>
    Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(output).pipe(Effect.mapError(cause => new GlabResponseInvalid({ operation, cause })))

/**
 * GitLab through `glab`, the same lifecycle as the GitHub adapter: auth status, one merge request read for the
 * watcher, an open merge request for a branch, and create. One span per process, identities and counts only.
 */
export class GitLabCli extends Context.Service<
  GitLabCli,
  {
    readonly authStatus: Effect.Effect<void, GlabCommandFailed>
    readonly repositoryInfo: (input: { readonly cwd: string }) => Effect.Effect<GitLabRepositoryInfo, GlabCommandFailed | GlabResponseInvalid>
    readonly mergeRequest: (input: {
      readonly project: string
      readonly number: number
      readonly cwd: string
    }) => Effect.Effect<GitHubPullRequestView, GlabCommandFailed | GlabResponseInvalid>
    readonly openMergeRequestFor: (input: {
      readonly project: string
      readonly cwd: string
      readonly head: string
    }) => Effect.Effect<string | null, GlabCommandFailed | GlabResponseInvalid>
    readonly createMergeRequest: (input: GitLabMergeRequestCreate) => Effect.Effect<string, GlabCommandFailed | GlabResponseInvalid>
  }
>()('@dshfiles/pull-requests/GitLabCli') {
  static readonly layer = Layer.effect(
    GitLabCli,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const pluginAttributes = { 'dshx.plugin.package': '@dshfiles/pull-requests' }
      const provide = <A, E>(effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>) =>
        effect.pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))

      const authStatus = provide(runGlab({ operation: 'auth-status', args: ['auth', 'status'], attributes: pluginAttributes })).pipe(
        Effect.asVoid,
        Effect.withSpan('pull-requests glab auth status'),
      )

      const repositoryInfo = Effect.fn('pull-requests glab repo')(function* (input: { readonly cwd: string }) {
        const output = yield* provide(
          runGlab({ operation: 'mr-view', args: ['repo', 'view', '--output', 'json'], cwd: input.cwd, attributes: pluginAttributes }),
        )
        const decoded = yield* decodeGlabJson('mr-view', repositoryInfoSchema)(output)
        const defaultBranch = decoded.default_branch ?? ''
        const host = /^https:\/\/([A-Za-z0-9.-]+(?::\d{1,5})?)\//u.exec(decoded.web_url ?? '')?.[1] ?? 'gitlab.com'
        return { host, project: decoded.path_with_namespace, defaultBranch: defaultBranch.length > 0 ? defaultBranch : null }
      })

      const mergeRequest = Effect.fn('pull-requests glab view')(function* (input: { readonly project: string; readonly number: number; readonly cwd: string }) {
        const output = yield* provide(
          runGlab({
            operation: 'mr-view',
            args: ['mr', 'view', String(input.number), '--repo', input.project, '--output', 'json'],
            cwd: input.cwd,
            attributes: { ...pluginAttributes, 'gitlab.project': input.project, 'gitlab.merge_request.number': input.number },
          }),
        )
        return normalizeMergeRequest(yield* decodeGlabJson('mr-view', glabMergeRequestSchema)(output))
      })

      const openMergeRequestFor = Effect.fn('pull-requests glab list')(function* (input: {
        readonly project: string
        readonly cwd: string
        readonly head: string
      }) {
        const output = yield* provide(
          runGlab({
            operation: 'mr-list',
            args: ['mr', 'list', '--repo', input.project, '--source-branch', input.head, '--output', 'json', '--per-page', '1'],
            cwd: input.cwd,
            attributes: { ...pluginAttributes, 'gitlab.project': input.project },
          }),
        )
        const listed = yield* decodeGlabJson('mr-list', mergeRequestListSchema)(output)
        const url = listed[0]?.web_url
        return url !== undefined && MERGE_REQUEST_URL.test(url) ? url : null
      })

      const createMergeRequest = Effect.fn('pull-requests glab create')(function* (input: GitLabMergeRequestCreate) {
        const output = yield* provide(
          runGlab({
            operation: 'mr-create',
            args: [
              'mr',
              'create',
              '--repo',
              input.project,
              '--source-branch',
              input.head,
              '--target-branch',
              input.base,
              '--title',
              input.title,
              '--description',
              input.body,
              '--yes',
              ...(input.draft ? ['--draft'] : []),
            ],
            cwd: input.cwd,
            attributes: { ...pluginAttributes, 'gitlab.project': input.project, 'gitlab.merge_request.draft': input.draft },
          }),
        )
        const url = output
          .split('\n')
          .map(line => line.trim())
          .find(line => MERGE_REQUEST_URL.test(line))
        if (url === undefined) return yield* new GlabResponseInvalid({ operation: 'mr-create' })
        return url
      })

      return GitLabCli.of({ authStatus, repositoryInfo, mergeRequest, openMergeRequestFor, createMergeRequest })
    }),
  )
}

export { githubPullRequestViewSchema }
