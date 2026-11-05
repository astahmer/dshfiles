import { Effect, Redacted, Schema } from 'effect'
import { HttpClient, HttpClientRequest, type HttpClientResponse } from 'effect/http'
import type { BacklogStatus } from './item.js'
import type { RemoteBackend, RemoteConnection, RemoteIssueDraft } from './sync-backend.js'
import { SyncRemoteNotFound, SyncRemoteRejected, SyncResponseInvalid, SyncTransportFailed } from './sync-errors.js'
import type { RemoteComment, RemoteIssue, SyncFieldValues } from './sync-model.js'

const GITHUB_API = 'https://api.github.com'
const TIMEOUT = '15 seconds'

const issueSchema = Schema.Struct({
  number: Schema.Number,
  html_url: Schema.String,
  title: Schema.String,
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  state: Schema.String,
  state_reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
  labels: Schema.Array(Schema.Union([Schema.String, Schema.Struct({ name: Schema.optionalKey(Schema.NullOr(Schema.String)) })])),
  updated_at: Schema.String,
  pull_request: Schema.optionalKey(Schema.Unknown),
})

const commentSchema = Schema.Struct({
  id: Schema.Number,
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  created_at: Schema.String,
  user: Schema.optionalKey(Schema.NullOr(Schema.Struct({ login: Schema.String }))),
})

const errorSchema = Schema.Struct({ message: Schema.optionalKey(Schema.String) })
const userSchema = Schema.Struct({ login: Schema.String })
const repositorySchema = Schema.Struct({ full_name: Schema.String })

/** The fields a PATCH writes; absent ones stay as they are. */
interface GithubIssueUpdate {
  title?: string
  body?: string
  state?: 'open' | 'closed'
  state_reason?: 'completed' | 'not_planned'
  labels?: readonly string[]
}

/** GitHub has only open and closed: an open issue reads as `todo`, and the close reason tells done from dropped. */
const statusOf = (state: string, reason: string | null | undefined): BacklogStatus =>
  state === 'closed' ? (reason === 'not_planned' ? 'dropped' : 'done') : 'todo'

const stateOf = (status: BacklogStatus): { readonly state: 'open' | 'closed'; readonly state_reason?: 'completed' | 'not_planned' } =>
  status === 'done'
    ? { state: 'closed', state_reason: 'completed' }
    : status === 'dropped'
      ? { state: 'closed', state_reason: 'not_planned' }
      : { state: 'open' }

const repositoryPattern = /^[\w.-]+\/[\w.-]+$/u

/** The `owner/repo` an `owner/repo#42` reference or a github.com issue URL names, if any. */
const repositoryOfReference = (reference: string): string | undefined => {
  const trimmed = reference.trim()
  const short = /^([\w.-]+\/[\w.-]+)#\d+$/u.exec(trimmed)
  if (short?.[1] !== undefined) return short[1]
  if (!URL.canParse(trimmed)) return undefined
  const url = new URL(trimmed)
  if (url.hostname !== 'github.com') return undefined
  return /^\/([\w.-]+\/[\w.-]+)\/issues\/\d+\/?$/u.exec(url.pathname)?.[1]
}

/** `42`, `#42`, `owner/repo#42`, or a `github.com/owner/repo/issues/42` URL, within the configured repository. */
const numberOf = (repository: string, reference: string): number | undefined => {
  const trimmed = reference.trim()
  const plain = /^#?(\d+)$/u.exec(trimmed) ?? new RegExp(`^${repository.replace(/[.]/gu, '\\.')}#(\\d+)$`, 'iu').exec(trimmed)
  if (plain?.[1] !== undefined) return Number(plain[1])
  if (!URL.canParse(trimmed)) return undefined
  const url = new URL(trimmed)
  if (url.hostname !== 'github.com') return undefined
  const match = /^\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?$/u.exec(url.pathname)
  if (match?.[1] === undefined || match[2] === undefined || match[1].toLowerCase() !== repository.toLowerCase()) return undefined
  return Number(match[2])
}

/**
 * GitHub Issues over the REST API with a token, for one `owner/repo`. Tags are labels (GitHub creates missing ones); one
 * REST call is one `github request` span.
 */
export const makeGithubBackend = Effect.fn('backlog github backend')(function* (input: {
  readonly repository: string
  readonly token: Redacted.Redacted
  readonly apiUrl?: string | undefined
}) {
  const http = yield* HttpClient.HttpClient
  const apiRoot = (input.apiUrl ?? GITHUB_API).replace(/\/+$/u, '')
  const base = `${apiRoot}/repos/${input.repository}`

  const send = <S extends Schema.Top>(operation: string, request: HttpClientRequest.HttpClientRequest, schema: S, reference: string) =>
    Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan({
        'dshx.plugin.package': '@dshfiles/backlog',
        'dshx.backlog.sync.backend': 'github',
        'dshx.backlog.sync.operation': operation,
      })
      const response: HttpClientResponse.HttpClientResponse = yield* http
        .execute(
          request.pipe(
            HttpClientRequest.bearerToken(Redacted.value(input.token)),
            HttpClientRequest.setHeader('accept', 'application/vnd.github+json'),
            HttpClientRequest.setHeader('x-github-api-version', '2022-11-28'),
          ),
        )
        .pipe(
          Effect.timeoutOrElse({ duration: TIMEOUT, orElse: () => Effect.fail(new SyncTransportFailed({ backend: 'github' })) }),
          Effect.catchTag('HttpClientError', cause => Effect.fail(new SyncTransportFailed({ backend: 'github', cause }))),
        )
      yield* Effect.annotateCurrentSpan('http.response.status_code', response.status)
      const json = yield* response.json.pipe(Effect.mapError(cause => new SyncResponseInvalid({ backend: 'github', cause })))
      if (response.status === 404) return yield* new SyncRemoteNotFound({ backend: 'github', reference })
      if (response.status < 200 || response.status >= 300) {
        const detail = Schema.decodeUnknownOption(errorSchema)(json)
        return yield* new SyncRemoteRejected({ backend: 'github', status: response.status, detail: detail._tag === 'Some' ? (detail.value.message ?? '') : '' })
      }
      return yield* Schema.decodeUnknownEffect(schema)(json).pipe(Effect.mapError(cause => new SyncResponseInvalid({ backend: 'github', cause })))
    }).pipe(Effect.withSpan('github request', { kind: 'client' }))

  const commentsOf = (number: number) =>
    send('list comments', HttpClientRequest.get(`${base}/issues/${String(number)}/comments?per_page=100`), Schema.Array(commentSchema), `#${String(number)}`)

  const issueOf = (issue: typeof issueSchema.Type, comments: readonly (typeof commentSchema.Type)[]): RemoteIssue => ({
    id: String(issue.number),
    key: `${input.repository}#${String(issue.number)}`,
    url: issue.html_url,
    title: issue.title,
    body: issue.body ?? '',
    status: statusOf(issue.state, issue.state_reason),
    tags: issue.labels.flatMap(label => {
      const name = typeof label === 'string' ? label : label.name
      return name === undefined || name === null ? [] : [name.toLowerCase()]
    }),
    updatedAt: Date.parse(issue.updated_at) || 0,
    comments: comments.map((comment): RemoteComment => ({
      id: String(comment.id),
      body: comment.body ?? '',
      author: comment.user?.login ?? 'GitHub',
      createdAt: Date.parse(comment.created_at) || 0,
    })),
  })

  const withComments = (issue: typeof issueSchema.Type) => Effect.map(commentsOf(issue.number), comments => issueOf(issue, comments))

  const fetchIssue = (remoteId: string) =>
    Effect.gen(function* () {
      const issue = yield* send('get issue', HttpClientRequest.get(`${base}/issues/${remoteId}`), issueSchema, `#${remoteId}`)
      if (issue.pull_request !== undefined) return yield* new SyncRemoteNotFound({ backend: 'github', reference: `#${remoteId}` })
      return yield* withComments(issue)
    })

  const resolve = (reference: string) => {
    const number = repositoryPattern.test(input.repository) ? numberOf(input.repository, reference) : undefined
    return number === undefined ? Effect.fail(new SyncRemoteNotFound({ backend: 'github', reference })) : fetchIssue(String(number))
  }

  const create = (draft: RemoteIssueDraft) =>
    Effect.gen(function* () {
      const labels = [...new Set([...draft.tags, ...(draft.kind === 'task' ? [] : [draft.kind])])]
      const created = yield* send(
        'create issue',
        HttpClientRequest.post(`${base}/issues`).pipe(HttpClientRequest.bodyJsonUnsafe({ title: draft.title, body: draft.body, labels })),
        issueSchema,
        input.repository,
      )
      const closed = stateOf(draft.status)
      if (closed.state === 'open') return issueOf(created, [])
      const updated = yield* send(
        'update issue',
        HttpClientRequest.patch(`${base}/issues/${String(created.number)}`).pipe(HttpClientRequest.bodyJsonUnsafe(closed)),
        issueSchema,
        `#${String(created.number)}`,
      )
      return issueOf(updated, [])
    })

  const update = (remoteId: string, change: Readonly<SyncFieldValues>) =>
    Effect.gen(function* () {
      const body: GithubIssueUpdate = {}
      if (change.title !== undefined) body.title = change.title
      if (change.body !== undefined) body.body = change.body
      if (change.status !== undefined) Object.assign(body, stateOf(change.status))
      if (change.tags !== undefined) body.labels = change.tags
      if (Object.keys(body).length === 0) return yield* fetchIssue(remoteId)
      const updated = yield* send(
        'update issue',
        HttpClientRequest.patch(`${base}/issues/${remoteId}`).pipe(HttpClientRequest.bodyJsonUnsafe(body)),
        issueSchema,
        `#${remoteId}`,
      )
      return yield* withComments(updated)
    })

  const comment = (remoteId: string, text: string) =>
    Effect.map(
      send(
        'create comment',
        HttpClientRequest.post(`${base}/issues/${remoteId}/comments`).pipe(HttpClientRequest.bodyJsonUnsafe({ body: text })),
        commentSchema,
        `#${remoteId}`,
      ),
      (created): RemoteComment => ({
        id: String(created.id),
        body: created.body ?? '',
        author: created.user?.login ?? 'GitHub',
        createdAt: Date.parse(created.created_at) || 0,
      }),
    )

  const connection = Effect.gen(function* () {
    const user = yield* send('get user', HttpClientRequest.get(`${apiRoot}/user`), userSchema, 'user')
    if (!repositoryPattern.test(input.repository)) return { account: user.login, target: null, teams: [] } satisfies RemoteConnection
    const repository = yield* send('get repository', HttpClientRequest.get(base), repositorySchema, input.repository).pipe(
      Effect.catchTag('SyncRemoteNotFound', () =>
        Effect.fail(new SyncRemoteRejected({ backend: 'github', status: 404, detail: `no repository ${input.repository} visible to ${user.login}` })),
      ),
    )
    return { account: user.login, target: { key: repository.full_name, name: repository.full_name }, teams: [] } satisfies RemoteConnection
  })

  const backend: RemoteBackend = { kind: 'github', target: input.repository, resolve, fetch: fetchIssue, create, update, comment, connection }
  return backend
})

export class GithubMapping {
  static readonly apiUrl = GITHUB_API
  static readonly statusOf = statusOf
  static readonly numberOf = numberOf
  static readonly repositoryOfReference = repositoryOfReference
  static readonly repositoryPattern = repositoryPattern
}
