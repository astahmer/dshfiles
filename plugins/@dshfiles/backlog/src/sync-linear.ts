import { Effect, Option, Redacted, Ref, Schema } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'
import type { BacklogKind, BacklogStatus } from './item.js'
import type { RemoteBackend, RemoteConnection, RemoteIssueDraft } from './sync-backend.js'
import { SyncRemoteNotFound, SyncRemoteRejected, SyncResponseInvalid, SyncTargetMissing, SyncTransportFailed } from './sync-errors.js'
import type { RemoteComment, RemoteIssue, SyncFieldValues } from './sync-model.js'

const LINEAR_ENDPOINT = 'https://api.linear.app/graphql'
const TIMEOUT = '15 seconds'

const issueFields = `id identifier url title description updatedAt state { type }
  labels(first: 50) { nodes { name } }
  comments(first: 100) { nodes { id body createdAt user { name } } }`

const nodes = <S extends Schema.Top>(item: S) => Schema.Struct({ nodes: Schema.Array(item) })

const issueSchema = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  url: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
  state: Schema.NullOr(Schema.Struct({ type: Schema.String })),
  labels: nodes(Schema.Struct({ name: Schema.String })),
  comments: nodes(
    Schema.Struct({ id: Schema.String, body: Schema.String, createdAt: Schema.String, user: Schema.NullOr(Schema.Struct({ name: Schema.String })) }),
  ),
})

const teamSchema = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  states: nodes(Schema.Struct({ id: Schema.String, type: Schema.String, position: Schema.Number })),
})

const labelSchema = Schema.Struct({ id: Schema.String, name: Schema.String })

const accountSchema = Schema.Struct({
  viewer: Schema.Struct({ name: Schema.String }),
  teams: nodes(Schema.Struct({ key: Schema.String, name: Schema.String })),
})

const graphqlErrorSchema = Schema.Struct({ message: Schema.String })
const envelope = <S extends Schema.Top>(data: S) =>
  Schema.Struct({ data: Schema.optionalKey(Schema.NullOr(data)), errors: Schema.optionalKey(Schema.Array(graphqlErrorSchema)) })

/** The variables any of the adapter's operations sends. */
interface LinearVariables {
  readonly id?: string
  readonly key?: string
  readonly input?: object
}

/** The fields an `issueUpdate` writes; absent ones stay as they are. */
interface LinearIssueUpdate {
  title?: string
  description?: string
  stateId?: string
  labelIds?: string[]
}

/** Linear workflow-state types, read as backlog statuses. */
const statusOfType = (type: string | undefined): BacklogStatus | null => {
  switch (type) {
    case 'triage':
      return 'inbox'
    case 'backlog':
    case 'unstarted':
      return 'todo'
    case 'started':
      return 'doing'
    case 'completed':
      return 'done'
    case 'canceled':
      return 'dropped'
    default:
      return null
  }
}

/** The state types that can hold a backlog status, most fitting first. */
const typesOfStatus = {
  inbox: ['triage', 'backlog'],
  todo: ['unstarted', 'backlog'],
  doing: ['started'],
  done: ['completed'],
  dropped: ['canceled'],
} as const satisfies Record<BacklogStatus, readonly string[]>

/** The label a kind becomes, when the team has one by that name. */
const kindLabels = {
  bug: ['bug'],
  idea: ['idea', 'feature'],
  task: ['task'],
  note: ['note'],
  question: ['question'],
} as const satisfies Record<BacklogKind, readonly string[]>

const identifierPattern = /^[A-Za-z][A-Za-z0-9]{0,9}-\d+$/u

/** `ENG-12`, or the identifier inside a `linear.app/<workspace>/issue/ENG-12/slug` URL. */
const identifierOf = (reference: string): string | undefined => {
  const trimmed = reference.trim()
  if (identifierPattern.test(trimmed)) return trimmed.toUpperCase()
  if (!URL.canParse(trimmed)) return undefined
  const url = new URL(trimmed)
  if (url.hostname !== 'linear.app') return undefined
  const match = /\/issue\/([A-Za-z][A-Za-z0-9]{0,9}-\d+)(?:\/|$)/u.exec(url.pathname)
  return match?.[1]?.toUpperCase()
}

const issueOf = (issue: typeof issueSchema.Type): RemoteIssue => ({
  id: issue.id,
  key: issue.identifier,
  url: issue.url,
  title: issue.title,
  body: issue.description ?? '',
  status: statusOfType(issue.state?.type),
  tags: issue.labels.nodes.map(label => label.name.toLowerCase()),
  updatedAt: Date.parse(issue.updatedAt) || 0,
  comments: issue.comments.nodes.map((comment): RemoteComment => ({
    id: comment.id,
    body: comment.body,
    author: comment.user?.name ?? 'Linear',
    createdAt: Date.parse(comment.createdAt) || 0,
  })),
})

/**
 * Linear over its GraphQL API with a personal API key. The team named by its key decides which workflow states and
 * labels the issues use; one GraphQL call is one `linear request` span.
 */
export const makeLinearBackend = Effect.fn('backlog linear backend')(function* (input: {
  readonly teamKey: string
  readonly apiKey: Redacted.Redacted
  readonly endpoint?: string | undefined
}) {
  const http = yield* HttpClient.HttpClient
  const endpoint = input.endpoint ?? LINEAR_ENDPOINT
  const teamCache = yield* Ref.make(Option.none<{ readonly team: typeof teamSchema.Type; readonly labels: readonly (typeof labelSchema.Type)[] }>())

  /** One GraphQL call; `reference` names the issue a not-found answer is about. */
  const request = <S extends Schema.Top>(operation: string, query: string, variables: LinearVariables, data: S, reference = '') =>
    Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan({
        'dshx.plugin.package': '@dshfiles/backlog',
        'dshx.backlog.sync.backend': 'linear',
        'graphql.operation.name': operation,
      })
      const response = yield* http
        .execute(
          HttpClientRequest.post(endpoint).pipe(
            HttpClientRequest.setHeader('authorization', Redacted.value(input.apiKey)),
            HttpClientRequest.bodyJsonUnsafe({ query, variables }),
          ),
        )
        .pipe(
          Effect.timeoutOrElse({ duration: TIMEOUT, orElse: () => Effect.fail(new SyncTransportFailed({ backend: 'linear' })) }),
          Effect.catchTag('HttpClientError', cause => Effect.fail(new SyncTransportFailed({ backend: 'linear', cause }))),
        )
      yield* Effect.annotateCurrentSpan('http.response.status_code', response.status)
      const json = yield* response.json.pipe(Effect.mapError(cause => new SyncResponseInvalid({ backend: 'linear', cause })))
      const decoded = yield* Schema.decodeUnknownEffect(envelope(data))(json).pipe(
        Effect.mapError(cause => new SyncResponseInvalid({ backend: 'linear', cause })),
      )
      const firstError = decoded.errors?.[0]?.message
      if (response.status < 200 || response.status >= 300)
        return yield* new SyncRemoteRejected({ backend: 'linear', status: response.status, detail: firstError ?? '' })
      if (firstError !== undefined) {
        if (/not found/iu.test(firstError)) return yield* new SyncRemoteNotFound({ backend: 'linear', reference })
        return yield* new SyncRemoteRejected({ backend: 'linear', status: 400, detail: firstError })
      }
      if (decoded.data === undefined || decoded.data === null) return yield* new SyncResponseInvalid({ backend: 'linear' })
      return decoded.data
    }).pipe(Effect.withSpan('linear request', { kind: 'client' }))

  const account = request('BacklogAccount', 'query BacklogAccount { viewer { name } teams(first: 100) { nodes { key name } } }', {}, accountSchema)

  /** The configured team key, or the only team the key can see. */
  const teamKey = Effect.gen(function* () {
    const configured = input.teamKey.trim()
    if (configured !== '') return configured
    const teams = (yield* account).teams.nodes
    const only = teams.length === 1 ? teams[0] : undefined
    if (only === undefined) return yield* new SyncTargetMissing({ backend: 'linear', project: null })
    return only.key
  })

  const connection = Effect.map(account, (data): RemoteConnection => {
    const configured = input.teamKey.trim().toUpperCase()
    const teams = data.teams.nodes.map(team => ({ key: team.key, name: team.name }))
    const target = configured === '' ? (teams.length === 1 ? teams[0] : undefined) : teams.find(team => team.key.toUpperCase() === configured)
    return { account: data.viewer.name, target: target ?? null, teams }
  })

  const team = Effect.gen(function* () {
    const cached = yield* Ref.get(teamCache)
    if (Option.isSome(cached)) return cached.value
    const key = yield* teamKey
    const data = yield* request(
      'BacklogTeam',
      `query BacklogTeam($key: String!) {
        teams(filter: { key: { eq: $key } }, first: 1) { nodes { id key states(first: 100) { nodes { id type position } } } }
        issueLabels(first: 250, filter: { or: [{ team: { key: { eq: $key } } }, { team: { null: true } }] }) { nodes { id name } }
      }`,
      { key },
      Schema.Struct({ teams: nodes(teamSchema), issueLabels: nodes(labelSchema) }),
    )
    const found = data.teams.nodes[0]
    if (found === undefined) return yield* new SyncRemoteRejected({ backend: 'linear', status: 404, detail: `no team with key ${key}` })
    const value = { team: found, labels: data.issueLabels.nodes }
    yield* Ref.set(teamCache, Option.some(value))
    return value
  })

  const stateIdOf = (states: (typeof teamSchema.Type)['states']['nodes'], status: BacklogStatus): string | undefined => {
    for (const type of typesOfStatus[status]) {
      const state = states.filter(candidate => candidate.type === type).sort((left, right) => left.position - right.position)[0]
      if (state !== undefined) return state.id
    }
    return undefined
  }

  const labelIdsOf = (labels: readonly (typeof labelSchema.Type)[], names: readonly string[]): string[] => {
    const wanted = new Set(names.map(name => name.toLowerCase()))
    return labels.filter(label => wanted.has(label.name.toLowerCase())).map(label => label.id)
  }

  const issueById = (id: string) =>
    Effect.flatMap(
      request(
        'BacklogIssue',
        `query BacklogIssue($id: String!) { issue(id: $id) { ${issueFields} } }`,
        { id },
        Schema.Struct({ issue: Schema.NullOr(issueSchema) }),
        id,
      ),
      data => (data.issue === null ? Effect.fail(new SyncRemoteNotFound({ backend: 'linear', reference: id })) : Effect.succeed(issueOf(data.issue))),
    )

  const mutationResult = Schema.Struct({ success: Schema.Boolean, issue: Schema.NullOr(issueSchema) })
  const settled = (operation: string, result: typeof mutationResult.Type) =>
    !result.success || result.issue === null
      ? Effect.fail(new SyncRemoteRejected({ backend: 'linear', status: 400, detail: `${operation} did not succeed` }))
      : Effect.succeed(issueOf(result.issue))

  const resolve = (reference: string) => {
    const identifier = identifierOf(reference)
    return identifier === undefined ? Effect.fail(new SyncRemoteNotFound({ backend: 'linear', reference })) : issueById(identifier)
  }

  const create = (draft: RemoteIssueDraft) =>
    Effect.gen(function* () {
      const { team: found, labels } = yield* team
      const stateId = stateIdOf(found.states.nodes, draft.status)
      const labelIds = labelIdsOf(labels, [...draft.tags, ...kindLabels[draft.kind]])
      const issueInput = { teamId: found.id, title: draft.title, description: draft.body, ...(stateId !== undefined && { stateId }), labelIds }
      const data = yield* request(
        'BacklogCreate',
        `mutation BacklogCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${issueFields} } } }`,
        { input: issueInput },
        Schema.Struct({ issueCreate: mutationResult }),
      )
      return yield* settled('issueCreate', data.issueCreate)
    })

  const update = (remoteId: string, change: Readonly<SyncFieldValues>) =>
    Effect.gen(function* () {
      const needsTeam = change.status !== undefined || change.tags !== undefined
      const context = needsTeam ? yield* team : undefined
      const issueInput: LinearIssueUpdate = {}
      if (change.title !== undefined) issueInput.title = change.title
      if (change.body !== undefined) issueInput.description = change.body
      if (change.status !== undefined && context !== undefined) {
        const stateId = stateIdOf(context.team.states.nodes, change.status)
        if (stateId !== undefined) issueInput.stateId = stateId
      }
      if (change.tags !== undefined && context !== undefined) issueInput.labelIds = labelIdsOf(context.labels, change.tags)
      if (Object.keys(issueInput).length === 0) return yield* issueById(remoteId)
      const data = yield* request(
        'BacklogUpdate',
        `mutation BacklogUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${issueFields} } } }`,
        { id: remoteId, input: issueInput },
        Schema.Struct({ issueUpdate: mutationResult }),
      )
      return yield* settled('issueUpdate', data.issueUpdate)
    })

  const comment = (remoteId: string, body: string) =>
    Effect.flatMap(
      request(
        'BacklogComment',
        `mutation BacklogComment($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id body createdAt user { name } } } }`,
        { input: { issueId: remoteId, body } },
        Schema.Struct({
          commentCreate: Schema.Struct({
            success: Schema.Boolean,
            comment: Schema.NullOr(
              Schema.Struct({ id: Schema.String, body: Schema.String, createdAt: Schema.String, user: Schema.NullOr(Schema.Struct({ name: Schema.String })) }),
            ),
          }),
        }),
      ),
      data =>
        data.commentCreate.comment === null || !data.commentCreate.success
          ? Effect.fail(new SyncRemoteRejected({ backend: 'linear', status: 400, detail: 'commentCreate did not succeed' }))
          : Effect.succeed({
              id: data.commentCreate.comment.id,
              body: data.commentCreate.comment.body,
              author: data.commentCreate.comment.user?.name ?? 'Linear',
              createdAt: Date.parse(data.commentCreate.comment.createdAt) || 0,
            }),
    )

  const backend: RemoteBackend = { kind: 'linear', target: input.teamKey, resolve, fetch: issueById, create, update, comment, connection }
  return backend
})

export class LinearMapping {
  static readonly endpoint = LINEAR_ENDPOINT
  static readonly statusOfType = statusOfType
  static readonly identifierOf = identifierOf
}
