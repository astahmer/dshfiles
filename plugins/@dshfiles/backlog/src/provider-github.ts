import { Effect, Option, Redacted, Ref, Schema } from 'effect'
import { HttpClient, HttpClientRequest, type HttpClientResponse } from 'effect/http'
import type { BacklogStatus } from './item.js'
import { ProviderCredentials } from './provider-credentials.js'
import {
  BacklogProviderFailed,
  type BacklogProvider,
  type ProviderConnection,
  type ProviderDescriptor,
  type ProviderField,
  type ProviderScope,
  type PullInput,
  type RemoteComment,
  type RemotePatch,
  type RemoteRecord,
  type RemoteRelation,
  type RemoteStatus,
} from './provider-port.js'
import { SyncLocalProbes } from './sync-local-probes.js'

const GITHUB_API = 'https://api.github.com'
const TIMEOUT = '15 seconds'
const PAGE_SIZE = 100
const LABEL = 'GitHub'

const descriptor: ProviderDescriptor = {
  kind: 'github',
  label: LABEL,
  containerLabel: 'Repository',
  credential: 'optional',
  environmentVariables: ['GITHUB_TOKEN', 'GH_TOKEN'],
  referencePatterns: ['^(?:[\\w.-]+/[\\w.-]+)?#?\\d+$', '^https://github\\.com/[\\w.-]+/[\\w.-]+/issues/\\d+'],
  referenceExample: '42, owner/repo#42 or a github.com issue URL',
  capabilities: {
    read: true,
    write: true,
    create: true,
    delete: 'none',
    statusModel: 'open-closed',
    bodyFormat: 'markdown',
    comments: 'read-write',
    labels: true,
    priority: false,
    parent: true,
    relations: ['depends-on', 'blocks'],
    changeFeed: 'etag-poll',
    rateLimit: { requestsPerHour: 5_000 },
  },
}

const issueSchema = Schema.Struct({
  id: Schema.Number,
  number: Schema.Number,
  html_url: Schema.String,
  title: Schema.String,
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  state: Schema.String,
  state_reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
  labels: Schema.Array(Schema.Union([Schema.String, Schema.Struct({ name: Schema.optionalKey(Schema.NullOr(Schema.String)) })])),
  updated_at: Schema.String,
  pull_request: Schema.optionalKey(Schema.Unknown),
  parent_issue_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
  issue_dependencies_summary: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ blocked_by: Schema.optionalKey(Schema.Number), blocking: Schema.optionalKey(Schema.Number) })),
  ),
  repository_url: Schema.optionalKey(Schema.String),
})
type GithubIssue = typeof issueSchema.Type

const linkedIssueSchema = Schema.Struct({ id: Schema.Number, number: Schema.Number, html_url: Schema.String })
const commentSchema = Schema.Struct({
  id: Schema.Number,
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  created_at: Schema.String,
  user: Schema.optionalKey(Schema.NullOr(Schema.Struct({ login: Schema.String }))),
})
const errorSchema = Schema.Struct({ message: Schema.optionalKey(Schema.String) })
const userSchema = Schema.Struct({ login: Schema.String })
const repositorySchema = Schema.Struct({ full_name: Schema.String, html_url: Schema.optionalKey(Schema.String) })

/** GitHub has only open and closed: open stands for inbox, todo and doing, and the close reason tells done from dropped. */
const statusOf = (state: string, reason: string | null | undefined): RemoteStatus =>
  state === 'closed'
    ? reason === 'not_planned'
      ? { category: 'dropped', label: 'closed (not planned)', equivalents: ['dropped'] }
      : { category: 'done', label: 'closed', equivalents: ['done'] }
    : { category: 'todo', label: 'open', equivalents: ['inbox', 'todo', 'doing'] }

const stateOf = (status: BacklogStatus): { readonly state: 'open' | 'closed'; readonly state_reason?: 'completed' | 'not_planned' } =>
  status === 'done'
    ? { state: 'closed', state_reason: 'completed' }
    : status === 'dropped'
      ? { state: 'closed', state_reason: 'not_planned' }
      : { state: 'open' }

const repositoryPattern = /^[\w.-]+\/[\w.-]+$/u

/** The `owner/repo` an `owner/repo#42` reference, a key or a github.com issue URL names, if any. */
const repositoryOfReference = (reference: string): string | undefined => {
  const trimmed = reference.trim()
  const short = /^([\w.-]+\/[\w.-]+)#\d+$/u.exec(trimmed)
  if (short?.[1] !== undefined) return short[1]
  if (!URL.canParse(trimmed)) return undefined
  const url = new URL(trimmed)
  if (url.hostname !== 'github.com' && url.hostname !== 'api.github.com') return undefined
  return /^\/(?:repos\/)?([\w.-]+\/[\w.-]+)\/issues\/\d+\/?$/u.exec(url.pathname)?.[1]
}

/** `42`, `#42`, `owner/repo#42`, or a `github.com/owner/repo/issues/42` URL, within `repository`. */
const numberOf = (repository: string, reference: string): number | undefined => {
  const trimmed = reference.trim()
  const plain = /^#?(\d+)$/u.exec(trimmed) ?? new RegExp(`^${repository.replace(/[.]/gu, '\\.')}#(\\d+)$`, 'iu').exec(trimmed)
  if (plain?.[1] !== undefined) return Number(plain[1])
  if (!URL.canParse(trimmed)) return undefined
  const url = new URL(trimmed)
  if (url.hostname !== 'github.com' && url.hostname !== 'api.github.com') return undefined
  const match = /^\/(?:repos\/)?([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?$/u.exec(url.pathname)
  if (match?.[1] === undefined || match[2] === undefined || match[1].toLowerCase() !== repository.toLowerCase()) return undefined
  return Number(match[2])
}

/** An issue's key: `owner/repo#42`, unique across the repositories one binding may reach through git remotes. */
const keyOf = (repository: string, number: number): string => `${repository}#${String(number)}`

const parseKey = (key: string): { readonly repository: string; readonly number: number } | undefined => {
  const match = /^([\w.-]+\/[\w.-]+)#(\d+)$/u.exec(key.trim())
  return match?.[1] === undefined || match[2] === undefined ? undefined : { repository: match[1], number: Number(match[2]) }
}

/** The GitHub issue in backlog vocabulary: what the port calls `toCanonical`. */
const toCanonical = (input: {
  readonly repository: string
  readonly issue: GithubIssue
  readonly comments?: readonly (typeof commentSchema.Type)[] | undefined
  readonly relations?: readonly RemoteRelation[] | undefined
}): RemoteRecord => {
  const issue = input.issue
  const parentRepository = issue.parent_issue_url === undefined || issue.parent_issue_url === null ? undefined : repositoryOfReference(issue.parent_issue_url)
  const parentNumber =
    parentRepository === undefined || issue.parent_issue_url === undefined || issue.parent_issue_url === null
      ? undefined
      : numberOf(parentRepository, issue.parent_issue_url)
  return {
    key: keyOf(input.repository, issue.number),
    displayKey: keyOf(input.repository, issue.number),
    url: issue.html_url,
    title: issue.title,
    body: issue.body ?? '',
    status: statusOf(issue.state, issue.state_reason),
    tags: issue.labels.flatMap(label => {
      const name = typeof label === 'string' ? label : label.name
      return name === undefined || name === null ? [] : [name.toLowerCase()]
    }),
    ...(issue.parent_issue_url !== undefined && {
      parentKey: parentRepository === undefined || parentNumber === undefined ? null : keyOf(parentRepository, parentNumber),
    }),
    ...(input.relations !== undefined && { relations: input.relations }),
    ...(input.comments !== undefined && {
      comments: input.comments.map((comment): RemoteComment => ({
        id: String(comment.id),
        body: comment.body ?? '',
        author: comment.user?.login ?? LABEL,
        createdAt: Date.parse(comment.created_at) || 0,
      })),
    }),
    updatedAt: Date.parse(issue.updated_at) || 0,
    version: issue.updated_at,
  }
}

const pageTokenSchema = Schema.fromJsonString(Schema.Struct({ page: Schema.Number, newest: Schema.String }))

/**
 * GitHub Issues over the REST API with a token, for any repository the token reaches: a binding's container, or the
 * project's github.com git remote. Pulls use `since=` and remember each list's ETag, so an unchanged repository costs a
 * 304; one REST call is one `github request` span.
 */
export const makeGithubProvider = Effect.fn('backlog github provider')(function* (input: { readonly apiUrl?: string | undefined } = {}) {
  const http = yield* HttpClient.HttpClient
  const credentials = yield* ProviderCredentials
  const probes = yield* SyncLocalProbes
  const etags = yield* Ref.make(new Map<string, string>())

  const failed = (code: BacklogProviderFailed['code'], detail = '', status?: number, cause?: unknown) =>
    new BacklogProviderFailed({ provider: LABEL, code, detail, ...(status !== undefined && { status }), ...(cause !== undefined && { cause }) })

  const apiRootOf = (connection: ProviderConnection) =>
    (connection.baseUrl.trim() === '' ? (input.apiUrl ?? GITHUB_API) : connection.baseUrl.trim()).replace(/\/+$/u, '')

  const tokenOf = (connection: ProviderConnection) =>
    credentials.resolve({
      provider: LABEL,
      connection,
      environmentVariables: descriptor.environmentVariables,
      fallback: probes.githubCliToken,
      fallbackHint: 'the `gh` CLI login',
    })

  /** One REST call; `notModified` answers a 304 for a conditional GET. */
  const exchange = (connection: ProviderConnection, operation: string, request: HttpClientRequest.HttpClientRequest, reference: string) =>
    Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan({
        'dshx.plugin.package': '@dshfiles/backlog',
        'dshx.backlog.sync.provider': 'github',
        'dshx.backlog.sync.operation': operation,
      })
      const token = yield* tokenOf(connection)
      const response: HttpClientResponse.HttpClientResponse = yield* http
        .execute(
          request.pipe(
            HttpClientRequest.bearerToken(Redacted.value(token.key)),
            HttpClientRequest.setHeader('accept', 'application/vnd.github+json'),
            HttpClientRequest.setHeader('x-github-api-version', '2022-11-28'),
          ),
        )
        .pipe(
          Effect.timeoutOrElse({ duration: TIMEOUT, orElse: () => Effect.fail(failed('transport', 'timed out')) }),
          Effect.catchTag('HttpClientError', cause => Effect.fail(failed('transport', '', undefined, cause))),
        )
      yield* Effect.annotateCurrentSpan('http.response.status_code', response.status)
      if (response.status === 304) return { notModified: true as const, response }
      if (response.status === 204) return { notModified: false as const, response, json: null }
      const json = yield* response.json.pipe(Effect.mapError(cause => failed('invalid-response', operation, undefined, cause)))
      if (response.status === 404) return yield* failed('not-found', reference)
      if (response.status < 200 || response.status >= 300) {
        const detail = Schema.decodeUnknownOption(errorSchema)(json)
        return yield* failed('rejected', Option.isSome(detail) ? (detail.value.message ?? '') : '', response.status)
      }
      return { notModified: false as const, response, json }
    }).pipe(Effect.withSpan('github request', { kind: 'client' }))

  const send = <S extends Schema.Top>(
    connection: ProviderConnection,
    operation: string,
    request: HttpClientRequest.HttpClientRequest,
    schema: S,
    reference: string,
  ) =>
    Effect.flatMap(exchange(connection, operation, request, reference), outcome =>
      outcome.notModified
        ? Effect.fail(failed('invalid-response', `${operation} answered 304`))
        : Schema.decodeUnknownEffect(schema)(outcome.json).pipe(Effect.mapError(cause => failed('invalid-response', operation, undefined, cause))),
    )

  const repositoryFor = (scope: ProviderScope, hint?: string) =>
    Effect.gen(function* () {
      const configured = scope.container.trim()
      if (configured !== '') return configured
      if (hint !== undefined) return hint
      if (scope.project === null) return yield* failed('target-missing', 'set owner/repo on the binding, or scope it to a project with a github.com git remote')
      const detected = yield* probes.githubRepository(scope.project)
      if (Option.isNone(detected)) return yield* failed('target-missing', `${scope.project} has no github.com git remote; set owner/repo on the binding`)
      return detected.value
    })

  const issueUrl = (connection: ProviderConnection, repository: string, number: number) =>
    `${apiRootOf(connection)}/repos/${repository}/issues/${String(number)}`

  const getIssue = (connection: ProviderConnection, repository: string, number: number) =>
    Effect.flatMap(
      send(connection, 'get issue', HttpClientRequest.get(issueUrl(connection, repository, number)), issueSchema, keyOf(repository, number)),
      issue => (issue.pull_request === undefined ? Effect.succeed(issue) : Effect.fail(failed('not-found', `${keyOf(repository, number)} is a pull request`))),
    )

  const commentsOf = (connection: ProviderConnection, repository: string, number: number) =>
    send(
      connection,
      'list comments',
      HttpClientRequest.get(`${issueUrl(connection, repository, number)}/comments?per_page=100`),
      Schema.Array(commentSchema),
      keyOf(repository, number),
    )

  const linkedIssues = (connection: ProviderConnection, repository: string, number: number, list: 'blocked_by' | 'blocking') =>
    send(
      connection,
      `list ${list}`,
      HttpClientRequest.get(`${issueUrl(connection, repository, number)}/dependencies/${list}?per_page=100`),
      Schema.Array(linkedIssueSchema),
      keyOf(repository, number),
    ).pipe(
      Effect.catchIf(
        error => error.code === 'not-found',
        () => Effect.succeed([]),
      ),
    )

  const keyOfLinked = (linked: typeof linkedIssueSchema.Type): string | undefined => {
    const repository = repositoryOfReference(linked.html_url)
    return repository === undefined ? undefined : keyOf(repository, linked.number)
  }

  /** Dependencies as backlog relations: what blocks the issue is `depends-on`, what it blocks is `blocks`. */
  const relationsOf = (connection: ProviderConnection, repository: string, issue: GithubIssue) =>
    Effect.gen(function* () {
      const summary = issue.issue_dependencies_summary
      const blockedBy =
        summary === undefined || summary === null || (summary.blocked_by ?? 1) > 0
          ? yield* linkedIssues(connection, repository, issue.number, 'blocked_by')
          : []
      const blocking =
        summary === undefined || summary === null || (summary.blocking ?? 1) > 0 ? yield* linkedIssues(connection, repository, issue.number, 'blocking') : []
      return [
        ...blockedBy.flatMap((linked): RemoteRelation[] => {
          const key = keyOfLinked(linked)
          return key === undefined ? [] : [{ relation: 'depends-on', key }]
        }),
        ...blocking.flatMap((linked): RemoteRelation[] => {
          const key = keyOfLinked(linked)
          return key === undefined ? [] : [{ relation: 'blocks', key }]
        }),
      ]
    })

  const recordOf = (connection: ProviderConnection, repository: string, issue: GithubIssue, fields: readonly ProviderField[]) =>
    Effect.gen(function* () {
      const comments = yield* commentsOf(connection, repository, issue.number)
      const relations = fields.includes('links') ? yield* relationsOf(connection, repository, issue) : undefined
      return toCanonical({ repository, issue, comments, relations })
    })

  const located = (scope: ProviderScope, key: string) =>
    Effect.gen(function* () {
      const parsed = parseKey(key)
      if (parsed !== undefined) return parsed
      const repository = yield* repositoryFor(scope)
      const number = numberOf(repository, key)
      if (number === undefined) return yield* failed('not-found', key)
      return { repository, number }
    })

  const fetchRecord = (scope: ProviderScope & { readonly key: string; readonly fields: readonly ProviderField[] }) =>
    Effect.gen(function* () {
      const at = yield* located(scope, scope.key)
      return yield* recordOf(scope.connection, at.repository, yield* getIssue(scope.connection, at.repository, at.number), scope.fields)
    })

  const resolve = (scope: ProviderScope & { readonly reference: string }) =>
    Effect.gen(function* () {
      const repository = yield* repositoryFor(scope, repositoryOfReference(scope.reference))
      const number = repositoryPattern.test(repository) ? numberOf(repository, scope.reference) : undefined
      if (number === undefined) return yield* failed('not-found', scope.reference)
      return yield* recordOf(scope.connection, repository, yield* getIssue(scope.connection, repository, number), ['title', 'links'])
    })

  /** Moves the issue under `parentKey`, or out of any parent for null, through the sub-issues API. */
  const setParent = (connection: ProviderConnection, issue: GithubIssue, repository: string, parentKey: string | null) =>
    Effect.gen(function* () {
      const current = toCanonical({ repository, issue }).parentKey ?? null
      if (current === parentKey) return false
      if (parentKey === null) {
        const old = current === null ? undefined : parseKey(current)
        if (old === undefined) return false
        yield* exchange(
          connection,
          'remove sub-issue',
          HttpClientRequest.delete(`${issueUrl(connection, old.repository, old.number)}/sub_issue`).pipe(
            HttpClientRequest.bodyJsonUnsafe({ sub_issue_id: issue.id }),
          ),
          current ?? '',
        )
        return true
      }
      const parent = parseKey(parentKey)
      if (parent === undefined) return yield* failed('not-found', parentKey)
      yield* exchange(
        connection,
        'add sub-issue',
        HttpClientRequest.post(`${issueUrl(connection, parent.repository, parent.number)}/sub_issues`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ sub_issue_id: issue.id, replace_parent: true }),
        ),
        parentKey,
      )
      return true
    })

  /** Adds and removes `blocked_by` dependencies until the issue holds exactly the wanted `depends-on`/`blocks` set. */
  const setRelations = (connection: ProviderConnection, issue: GithubIssue, repository: string, wanted: readonly RemoteRelation[]) =>
    Effect.gen(function* () {
      const current = yield* relationsOf(connection, repository, { ...issue, issue_dependencies_summary: null })
      const supported = wanted.filter(relation => relation.relation === 'depends-on' || relation.relation === 'blocks')
      const same = (left: RemoteRelation, right: RemoteRelation) => left.relation === right.relation && left.key === right.key
      const adds = supported.filter(relation => !current.some(entry => same(entry, relation)))
      const removes = current.filter(relation => !supported.some(entry => same(entry, relation)))
      const thisKey = keyOf(repository, issue.number)
      // Sequential on purpose: each change reads the other issue's id first, and GitHub serializes dependency writes.
      yield* Effect.forEach(
        [...adds.map(relation => ({ relation, add: true })), ...removes.map(relation => ({ relation, add: false }))],
        change =>
          Effect.gen(function* () {
            const other = parseKey(change.relation.key)
            if (other === undefined) return
            const otherIssue = yield* getIssue(connection, other.repository, other.number)
            const blocked = change.relation.relation === 'depends-on' ? { repository, number: issue.number } : other
            const blockerId = change.relation.relation === 'depends-on' ? otherIssue.id : issue.id
            const base = `${issueUrl(connection, blocked.repository, blocked.number)}/dependencies/blocked_by`
            yield* exchange(
              connection,
              change.add ? 'add dependency' : 'remove dependency',
              change.add
                ? HttpClientRequest.post(base).pipe(HttpClientRequest.bodyJsonUnsafe({ issue_id: blockerId }))
                : HttpClientRequest.delete(`${base}/${String(blockerId)}`),
              thisKey,
            )
          }),
        { discard: true },
      )
      return adds.length > 0 || removes.length > 0
    })

  /** A patch as a REST PATCH body: what the port calls `fromCanonical`. */
  const fromCanonical = (patch: RemotePatch) => ({
    ...(patch.title !== undefined && { title: patch.title }),
    ...(patch.body !== undefined && { body: patch.body }),
    ...(patch.status !== undefined && stateOf(patch.status)),
    ...(patch.tags !== undefined && { labels: [...patch.tags] }),
  })

  const push = (scope: ProviderScope & { readonly key: string; readonly patch: RemotePatch }) =>
    Effect.gen(function* () {
      const at = yield* located(scope, scope.key)
      const body = fromCanonical(scope.patch)
      const issue =
        Object.keys(body).length === 0
          ? yield* getIssue(scope.connection, at.repository, at.number)
          : yield* send(
              scope.connection,
              'update issue',
              HttpClientRequest.patch(issueUrl(scope.connection, at.repository, at.number)).pipe(HttpClientRequest.bodyJsonUnsafe(body)),
              issueSchema,
              scope.key,
            )
      const parentMoved = scope.patch.parentKey === undefined ? false : yield* setParent(scope.connection, issue, at.repository, scope.patch.parentKey)
      const relationsMoved = scope.patch.relations === undefined ? false : yield* setRelations(scope.connection, issue, at.repository, scope.patch.relations)
      const final = parentMoved || relationsMoved ? yield* getIssue(scope.connection, at.repository, at.number) : issue
      return yield* recordOf(scope.connection, at.repository, final, scope.patch.relations === undefined ? ['title'] : ['links'])
    })

  const create = (scope: ProviderScope & { readonly patch: RemotePatch }) =>
    Effect.gen(function* () {
      const repository = yield* repositoryFor(scope)
      const kindLabel = scope.patch.kind === undefined || scope.patch.kind === 'task' ? [] : [scope.patch.kind]
      const labels = [...new Set([...(scope.patch.tags ?? []), ...kindLabel])]
      const created = yield* send(
        scope.connection,
        'create issue',
        HttpClientRequest.post(`${apiRootOf(scope.connection)}/repos/${repository}/issues`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ title: scope.patch.title ?? '', body: scope.patch.body ?? '', labels }),
        ),
        issueSchema,
        repository,
      )
      const key = keyOf(repository, created.number)
      const closed = scope.patch.status === undefined ? { state: 'open' as const } : stateOf(scope.patch.status)
      const needsMore = closed.state === 'closed' || (scope.patch.parentKey ?? null) !== null || (scope.patch.relations ?? []).length > 0
      if (!needsMore) return toCanonical({ repository, issue: created, comments: [] })
      return yield* push({
        ...scope,
        key,
        patch: {
          ...(closed.state === 'closed' && scope.patch.status !== undefined && { status: scope.patch.status }),
          ...(scope.patch.parentKey !== undefined && { parentKey: scope.patch.parentKey }),
          ...(scope.patch.relations !== undefined && { relations: scope.patch.relations }),
        },
      })
    })

  const pull = (pullInput: PullInput) =>
    Effect.gen(function* () {
      const repository = yield* repositoryFor(pullInput)
      const token = pullInput.page === null ? Option.none() : Schema.decodeUnknownOption(pageTokenSchema)(pullInput.page)
      const page = Option.match(token, { onNone: () => 1, onSome: value => value.page })
      const newestSoFar = Option.match(token, { onNone: () => pullInput.cursor ?? '', onSome: value => value.newest })
      const query = new URLSearchParams({
        state: pullInput.openOnly ? 'open' : 'all',
        sort: 'updated',
        direction: 'asc',
        per_page: String(PAGE_SIZE),
        page: String(page),
        ...(pullInput.cursor !== null && { since: pullInput.cursor }),
      })
      const url = `${apiRootOf(pullInput.connection)}/repos/${repository}/issues?${query.toString()}`
      const etagKey = `${pullInput.connection.instanceId}\n${url}`
      const etag = (yield* Ref.get(etags)).get(etagKey)
      const outcome = yield* exchange(
        pullInput.connection,
        'list issues',
        etag === undefined ? HttpClientRequest.get(url) : HttpClientRequest.get(url).pipe(HttpClientRequest.setHeader('if-none-match', etag)),
        repository,
      )
      if (outcome.notModified) return { records: [], nextPage: null, checkpoint: pullInput.cursor, complete: false }
      const fresh = outcome.response.headers['etag']
      if (fresh !== undefined) yield* Ref.update(etags, current => new Map(current).set(etagKey, fresh))
      const issues = yield* Schema.decodeUnknownEffect(Schema.Array(issueSchema))(outcome.json).pipe(
        Effect.mapError(cause => failed('invalid-response', 'list issues', undefined, cause)),
      )
      const real = issues.filter(issue => issue.pull_request === undefined)
      const records = yield* Effect.forEach(
        real,
        issue =>
          pullInput.fields.includes('links') && (issue.issue_dependencies_summary?.blocked_by ?? 0) + (issue.issue_dependencies_summary?.blocking ?? 0) > 0
            ? Effect.map(relationsOf(pullInput.connection, repository, issue), relations => toCanonical({ repository, issue, relations }))
            : Effect.succeed(toCanonical({ repository, issue, ...(pullInput.fields.includes('links') && { relations: [] }) })),
        { concurrency: 4 },
      )
      const newest = issues.reduce((latest, issue) => (issue.updated_at > latest ? issue.updated_at : latest), newestSoFar)
      const nextPage = issues.length === PAGE_SIZE ? yield* Schema.encodeEffect(pageTokenSchema)({ page: page + 1, newest }).pipe(Effect.orDie) : null
      return { records, nextPage, checkpoint: nextPage === null ? (newest === '' ? pullInput.cursor : newest) : null, complete: false }
    })

  const comment = (scope: ProviderScope & { readonly key: string; readonly body: string }) =>
    Effect.gen(function* () {
      const at = yield* located(scope, scope.key)
      const created = yield* send(
        scope.connection,
        'create comment',
        HttpClientRequest.post(`${issueUrl(scope.connection, at.repository, at.number)}/comments`).pipe(HttpClientRequest.bodyJsonUnsafe({ body: scope.body })),
        commentSchema,
        scope.key,
      )
      return {
        id: String(created.id),
        body: created.body ?? '',
        author: created.user?.login ?? LABEL,
        createdAt: Date.parse(created.created_at) || 0,
      } satisfies RemoteComment
    })

  const identity = (connection: ProviderConnection) =>
    Effect.gen(function* () {
      const token = yield* tokenOf(connection)
      const user = yield* send(connection, 'get user', HttpClientRequest.get(`${apiRootOf(connection)}/user`), userSchema, 'user')
      const repositories = yield* send(
        connection,
        'list repositories',
        HttpClientRequest.get(`${apiRootOf(connection)}/user/repos?per_page=100&sort=pushed`),
        Schema.Array(repositorySchema),
        'repositories',
      ).pipe(Effect.orElseSucceed(() => []))
      return {
        account: user.login,
        credentialSource: token.source,
        containers: repositories.map(repository => ({
          key: repository.full_name,
          name: repository.full_name,
          ...(repository.html_url !== undefined && { url: repository.html_url }),
        })),
      }
    })

  const provider: BacklogProvider = { descriptor, identity, pull, fetch: fetchRecord, resolve, push, create, comment }
  return provider
})

export class GithubMapping {
  static readonly apiUrl = GITHUB_API
  static readonly descriptor = descriptor
  static readonly statusOf = statusOf
  static readonly numberOf = numberOf
  static readonly keyOf = keyOf
  static readonly parseKey = parseKey
  static readonly repositoryOfReference = repositoryOfReference
  static readonly repositoryPattern = repositoryPattern
  static readonly toCanonical = toCanonical
}
