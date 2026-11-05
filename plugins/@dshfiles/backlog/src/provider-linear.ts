import { Clock, Effect, Redacted, Ref, Schema } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'
import type { BacklogKind, BacklogPriority, BacklogStatus } from './item.js'
import { ProviderCredentials } from './provider-credentials.js'
import {
  BacklogProviderFailed,
  BacklogProviders,
  type BacklogProvider,
  type ProviderConnection,
  type ProviderDescriptor,
  type ProviderField,
  type ProviderScope,
  type RemoteComment,
  type RemotePatch,
  type RemoteRecord,
  type RemoteRelation,
} from './provider-port.js'

const LINEAR_ENDPOINT = 'https://api.linear.app/graphql'
const TIMEOUT = '15 seconds'
const PAGE_SIZE = 50
const TEAM_CACHE_MS = 10 * 60_000
const LABEL = 'Linear'

const descriptor: ProviderDescriptor = {
  kind: 'linear',
  label: LABEL,
  containerLabel: 'Team',
  credential: 'required',
  environmentVariables: ['LINEAR_API_KEY'],
  referencePatterns: ['^[a-z][a-z0-9]{0,9}-\\d+$', '^https://linear\\.app/[^/]+/issue/'],
  referenceExample: 'ENG-12 or a linear.app issue URL',
  capabilities: {
    read: true,
    write: true,
    create: true,
    delete: 'none',
    statusModel: 'categories',
    bodyFormat: 'markdown',
    comments: 'read-write',
    labels: true,
    priority: true,
    parent: true,
    relations: ['related', 'depends-on', 'blocks', 'duplicates'],
    changeFeed: 'since-cursor',
    rateLimit: { requestsPerHour: 1_500 },
  },
}

const baseFields = `id identifier url title description updatedAt priority state { type name }
  parent { id }
  labels(first: 50) { nodes { name } }`
const relationFields = `relations(first: 50) { nodes { id type relatedIssue { id } } }
  inverseRelations(first: 50) { nodes { id type issue { id } } }`
const commentFields = `comments(first: 100) { nodes { id body createdAt user { name } } }`

const nodes = <S extends Schema.Top>(item: S) => Schema.Struct({ nodes: Schema.Array(item) })
const commentSchema = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
  createdAt: Schema.String,
  user: Schema.NullOr(Schema.Struct({ name: Schema.String })),
})
const relationSchema = Schema.Struct({ id: Schema.String, type: Schema.String, relatedIssue: Schema.NullOr(Schema.Struct({ id: Schema.String })) })
const inverseRelationSchema = Schema.Struct({ id: Schema.String, type: Schema.String, issue: Schema.NullOr(Schema.Struct({ id: Schema.String })) })

const issueSchema = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  url: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
  priority: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  state: Schema.NullOr(Schema.Struct({ type: Schema.String, name: Schema.optionalKey(Schema.String) })),
  parent: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Schema.String }))),
  labels: nodes(Schema.Struct({ name: Schema.String })),
  relations: Schema.optionalKey(nodes(relationSchema)),
  inverseRelations: Schema.optionalKey(nodes(inverseRelationSchema)),
  comments: Schema.optionalKey(nodes(commentSchema)),
})
type LinearIssue = typeof issueSchema.Type

const teamSchema = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  states: nodes(Schema.Struct({ id: Schema.String, type: Schema.String, name: Schema.optionalKey(Schema.String), position: Schema.Number })),
})
type LinearTeam = typeof teamSchema.Type
const labelSchema = Schema.Struct({ id: Schema.String, name: Schema.String })
const accountSchema = Schema.Struct({
  viewer: Schema.Struct({ name: Schema.String }),
  teams: nodes(Schema.Struct({ key: Schema.String, name: Schema.String })),
})
const graphqlErrorSchema = Schema.Struct({ message: Schema.String })
const envelope = <S extends Schema.Top>(data: S) =>
  Schema.Struct({ data: Schema.optionalKey(Schema.NullOr(data)), errors: Schema.optionalKey(Schema.Array(graphqlErrorSchema)) })

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

/** Linear priorities 0–4 in their order: no priority, urgent, high, medium, low — the backlog's own list. */
const priorityOf = (value: number | null | undefined): BacklogPriority => BacklogProviders.priorities[value ?? 0] ?? 'none'
const priorityNumber = (priority: BacklogPriority): number => BacklogProviders.priorities.indexOf(priority)

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
  return /\/issue\/([A-Za-z][A-Za-z0-9]{0,9}-\d+)(?:\/|$)/u.exec(url.pathname)?.[1]?.toUpperCase()
}

/**
 * Linear relations as backlog relations, from this issue's side: its own `blocks` reads as `blocks`, one pointing at it
 * as `depends-on`; `duplicate` reads as `duplicates`; `related` either way as `related`.
 */
const relationsOf = (issue: LinearIssue): RemoteRelation[] => [
  ...(issue.relations?.nodes ?? []).flatMap((relation): RemoteRelation[] => {
    const key = relation.relatedIssue?.id
    if (key === undefined) return []
    if (relation.type === 'blocks') return [{ relation: 'blocks', key }]
    if (relation.type === 'duplicate') return [{ relation: 'duplicates', key }]
    if (relation.type === 'related') return [{ relation: 'related', key }]
    return []
  }),
  ...(issue.inverseRelations?.nodes ?? []).flatMap((relation): RemoteRelation[] => {
    const key = relation.issue?.id
    if (key === undefined) return []
    if (relation.type === 'blocks') return [{ relation: 'depends-on', key }]
    if (relation.type === 'related') return [{ relation: 'related', key }]
    return []
  }),
]

/** The Linear record of one issue in backlog vocabulary: what the port calls `toCanonical`. */
const toCanonical = (issue: LinearIssue): RemoteRecord => {
  const category = statusOfType(issue.state?.type)
  return {
    key: issue.id,
    displayKey: issue.identifier,
    url: issue.url,
    title: issue.title,
    body: issue.description ?? '',
    status:
      category === null
        ? null
        : {
            category,
            label: issue.state?.name ?? issue.state?.type ?? category,
            equivalents: issue.state?.type === 'backlog' ? ['todo', 'inbox'] : [category],
          },
    tags: issue.labels.nodes.map(label => label.name.toLowerCase()),
    ...(issue.priority !== undefined && { priority: priorityOf(issue.priority) }),
    ...(issue.parent !== undefined && { parentKey: issue.parent?.id ?? null }),
    ...((issue.relations !== undefined || issue.inverseRelations !== undefined) && { relations: relationsOf(issue) }),
    ...(issue.comments !== undefined && {
      comments: issue.comments.nodes.map((comment): RemoteComment => ({
        id: comment.id,
        body: comment.body,
        author: comment.user?.name ?? LABEL,
        createdAt: Date.parse(comment.createdAt) || 0,
      })),
    }),
    updatedAt: Date.parse(issue.updatedAt) || 0,
    version: issue.updatedAt,
  }
}

/** The variables any of the provider's operations sends. */
interface LinearVariables {
  readonly id?: string
  readonly key?: string
  readonly input?: object
  readonly filter?: object
  readonly after?: string | null
}

/** The fields an `issueUpdate`/`issueCreate` writes; absent ones stay as they are. */
interface LinearIssueInput {
  title?: string
  description?: string
  stateId?: string
  labelIds?: string[]
  priority?: number
  parentId?: string | null
}

/** The page token of a pull: Linear's cursor and the newest `updatedAt` seen so far, so the last page knows the checkpoint. */
const pageTokenSchema = Schema.fromJsonString(Schema.Struct({ after: Schema.String, newest: Schema.String }))

/**
 * Linear over its GraphQL API with a personal API key, for any team the key sees: one GraphQL call is one
 * `linear request` span. Team workflow states and labels are cached per connection and team for ten minutes.
 */
export const makeLinearProvider = Effect.fn('backlog linear provider')(function* (input: { readonly endpoint?: string | undefined } = {}) {
  const http = yield* HttpClient.HttpClient
  const credentials = yield* ProviderCredentials
  const endpoint = input.endpoint ?? LINEAR_ENDPOINT
  const teamCache = yield* Ref.make(
    new Map<string, { readonly at: number; readonly team: LinearTeam; readonly labels: readonly (typeof labelSchema.Type)[] }>(),
  )

  const failed = (code: BacklogProviderFailed['code'], detail = '', status?: number, cause?: unknown) =>
    new BacklogProviderFailed({ provider: LABEL, code, detail, ...(status !== undefined && { status }), ...(cause !== undefined && { cause }) })

  const keyOf = (connection: ProviderConnection) =>
    Effect.map(credentials.resolve({ provider: LABEL, connection, environmentVariables: descriptor.environmentVariables }), resolved => resolved)

  const request = <S extends Schema.Top>(
    connection: ProviderConnection,
    operation: string,
    query: string,
    variables: LinearVariables,
    data: S,
    reference = '',
  ) =>
    Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan({
        'dshx.plugin.package': '@dshfiles/backlog',
        'dshx.backlog.sync.provider': 'linear',
        'graphql.operation.name': operation,
      })
      const credential = yield* keyOf(connection)
      const response = yield* http
        .execute(
          HttpClientRequest.post(connection.baseUrl.trim() === '' ? endpoint : connection.baseUrl.trim()).pipe(
            HttpClientRequest.setHeader('authorization', Redacted.value(credential.key)),
            HttpClientRequest.bodyJsonUnsafe({ query, variables }),
          ),
        )
        .pipe(
          Effect.timeoutOrElse({ duration: TIMEOUT, orElse: () => Effect.fail(failed('transport', 'timed out')) }),
          Effect.catchTag('HttpClientError', cause => Effect.fail(failed('transport', '', undefined, cause))),
        )
      yield* Effect.annotateCurrentSpan('http.response.status_code', response.status)
      const json = yield* response.json.pipe(Effect.mapError(cause => failed('invalid-response', '', undefined, cause)))
      const decoded = yield* Schema.decodeUnknownEffect(envelope(data))(json).pipe(
        Effect.mapError(cause => failed('invalid-response', operation, undefined, cause)),
      )
      const firstError = decoded.errors?.[0]?.message
      if (response.status < 200 || response.status >= 300) return yield* failed('rejected', firstError ?? '', response.status)
      if (firstError !== undefined) return yield* /not found/iu.test(firstError) ? failed('not-found', reference) : failed('rejected', firstError, 400)
      if (decoded.data === undefined || decoded.data === null) return yield* failed('invalid-response', operation)
      return decoded.data
    }).pipe(Effect.withSpan('linear request', { kind: 'client' }))

  const account = (connection: ProviderConnection) =>
    request(connection, 'BacklogAccount', 'query BacklogAccount { viewer { name } teams(first: 100) { nodes { key name } } }', {}, accountSchema)

  /** The binding's team key, or the only team the key can see. */
  const teamKey = (scope: ProviderScope) =>
    Effect.gen(function* () {
      const configured = scope.container.trim()
      if (configured !== '') return configured
      const teams = (yield* account(scope.connection)).teams.nodes
      const only = teams.length === 1 ? teams[0] : undefined
      if (only === undefined) return yield* failed('target-missing', 'the key sees several teams; pick one')
      return only.key
    })

  const team = (scope: ProviderScope) =>
    Effect.gen(function* () {
      const key = yield* teamKey(scope)
      const cacheKey = `${scope.connection.instanceId}\n${scope.connection.credential}\n${key}`
      const now = yield* Clock.currentTimeMillis
      const cached = (yield* Ref.get(teamCache)).get(cacheKey)
      if (cached !== undefined && now - cached.at < TEAM_CACHE_MS) return cached
      const data = yield* request(
        scope.connection,
        'BacklogTeam',
        `query BacklogTeam($key: String!) {
          teams(filter: { key: { eq: $key } }, first: 1) { nodes { id key states(first: 100) { nodes { id type name position } } } }
          issueLabels(first: 250, filter: { or: [{ team: { key: { eq: $key } } }, { team: { null: true } }] }) { nodes { id name } }
        }`,
        { key },
        Schema.Struct({ teams: nodes(teamSchema), issueLabels: nodes(labelSchema) }),
      )
      const found = data.teams.nodes[0]
      if (found === undefined) return yield* failed('target-missing', `no team with key ${key}`)
      const value = { at: now, team: found, labels: data.issueLabels.nodes }
      yield* Ref.update(teamCache, current => new Map(current).set(cacheKey, value))
      return value
    })

  const stateIdOf = (states: LinearTeam['states']['nodes'], status: BacklogStatus, label: string | undefined): string | undefined => {
    const named = label === undefined ? undefined : states.find(state => state.name?.toLowerCase() === label.toLowerCase())
    if (named !== undefined) return named.id
    for (const type of typesOfStatus[status]) {
      const state = [...states].filter(candidate => candidate.type === type).sort((left, right) => left.position - right.position)[0]
      if (state !== undefined) return state.id
    }
    return undefined
  }

  const labelIdsOf = (labels: readonly (typeof labelSchema.Type)[], names: readonly string[]): string[] => {
    const wanted = new Set(names.map(name => name.toLowerCase()))
    return labels.filter(label => wanted.has(label.name.toLowerCase())).map(label => label.id)
  }

  const fieldsFor = (fields: readonly ProviderField[], withComments: boolean) =>
    [baseFields, fields.includes('links') ? relationFields : '', withComments ? commentFields : ''].join('\n')

  const issueById = (connection: ProviderConnection, id: string, fields: readonly ProviderField[]) =>
    Effect.flatMap(
      request(
        connection,
        'BacklogIssue',
        `query BacklogIssue($id: String!) { issue(id: $id) { ${fieldsFor(fields, true)} } }`,
        { id },
        Schema.Struct({ issue: Schema.NullOr(issueSchema) }),
        id,
      ),
      data => (data.issue === null ? Effect.fail(failed('not-found', id)) : Effect.succeed(data.issue)),
    )

  const mutationResult = Schema.Struct({ success: Schema.Boolean, issue: Schema.NullOr(issueSchema) })
  const settled = (operation: string, result: typeof mutationResult.Type) =>
    !result.success || result.issue === null ? Effect.fail(failed('rejected', `${operation} did not succeed`, 400)) : Effect.succeed(result.issue)

  const allFields: readonly ProviderField[] = BacklogProviders.fields

  /** Creates and deletes relations until the issue holds exactly `wanted`. */
  const reconcileRelations = (connection: ProviderConnection, issue: LinearIssue, wanted: readonly RemoteRelation[]) =>
    Effect.gen(function* () {
      const current = relationsOf(issue)
      const has = (list: readonly RemoteRelation[], relation: RemoteRelation) =>
        list.some(entry => entry.relation === relation.relation && entry.key === relation.key)
      const toDelete = [
        ...(issue.relations?.nodes ?? []).flatMap(relation => {
          const mapped = relationsOf({ ...issue, relations: { nodes: [relation] }, inverseRelations: { nodes: [] } })[0]
          return mapped !== undefined && !has(wanted, mapped) ? [relation.id] : []
        }),
        ...(issue.inverseRelations?.nodes ?? []).flatMap(relation => {
          const mapped = relationsOf({ ...issue, relations: { nodes: [] }, inverseRelations: { nodes: [relation] } })[0]
          return mapped !== undefined && mapped.relation === 'depends-on' && !has(wanted, mapped) ? [relation.id] : []
        }),
      ]
      const toCreate = wanted.filter(relation => !has(current, relation))
      const ok = Schema.Struct({ success: Schema.Boolean })
      // Sequential on purpose: Linear rejects concurrent relation writes on one issue now and then.
      yield* Effect.forEach(
        toDelete,
        id =>
          request(
            connection,
            'BacklogRelationDelete',
            `mutation BacklogRelationDelete($id: String!) { issueRelationDelete(id: $id) { success } }`,
            { id },
            Schema.Struct({ issueRelationDelete: ok }),
          ),
        { discard: true },
      )
      yield* Effect.forEach(
        toCreate,
        relation => {
          const relationInput =
            relation.relation === 'depends-on'
              ? { issueId: relation.key, relatedIssueId: issue.id, type: 'blocks' }
              : { issueId: issue.id, relatedIssueId: relation.key, type: relation.relation === 'duplicates' ? 'duplicate' : relation.relation }
          return request(
            connection,
            'BacklogRelationCreate',
            `mutation BacklogRelationCreate($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success } }`,
            { input: relationInput },
            Schema.Struct({ issueRelationCreate: ok }),
          )
        },
        { discard: true },
      )
      return toDelete.length > 0 || toCreate.length > 0
    })

  /** A patch as a Linear `IssueUpdateInput`/`IssueCreateInput`: what the port calls `fromCanonical`. */
  const fromCanonical = (input: {
    readonly patch: RemotePatch
    readonly team: LinearTeam | undefined
    readonly labels: readonly (typeof labelSchema.Type)[]
  }) => {
    const issueInput: LinearIssueInput = {}
    if (input.patch.title !== undefined) issueInput.title = input.patch.title
    if (input.patch.body !== undefined) issueInput.description = input.patch.body
    if (input.patch.status !== undefined && input.team !== undefined) {
      const stateId = stateIdOf(input.team.states.nodes, input.patch.status, input.patch.statusLabel)
      if (stateId !== undefined) issueInput.stateId = stateId
    }
    if (input.patch.tags !== undefined && input.team !== undefined)
      issueInput.labelIds = labelIdsOf(input.labels, [...input.patch.tags, ...(input.patch.kind === undefined ? [] : kindLabels[input.patch.kind])])
    if (input.patch.priority !== undefined) issueInput.priority = priorityNumber(input.patch.priority)
    if (input.patch.parentKey !== undefined) issueInput.parentId = input.patch.parentKey
    return issueInput
  }

  const push = (scope: ProviderScope & { readonly key: string; readonly patch: RemotePatch }) =>
    Effect.gen(function* () {
      const needsTeam = scope.patch.status !== undefined || scope.patch.tags !== undefined
      const context = needsTeam ? yield* team(scope) : undefined
      const issueInput = fromCanonical({ patch: scope.patch, team: context?.team, labels: context?.labels ?? [] })
      const fields: readonly ProviderField[] = scope.patch.relations === undefined ? ['title'] : allFields
      let issue =
        Object.keys(issueInput).length === 0
          ? yield* issueById(scope.connection, scope.key, fields)
          : yield* Effect.flatMap(
              request(
                scope.connection,
                'BacklogUpdate',
                `mutation BacklogUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${fieldsFor(fields, true)} } } }`,
                { id: scope.key, input: issueInput },
                Schema.Struct({ issueUpdate: mutationResult }),
                scope.key,
              ),
              data => settled('issueUpdate', data.issueUpdate),
            )
      if (scope.patch.relations !== undefined && (yield* reconcileRelations(scope.connection, issue, scope.patch.relations)))
        issue = yield* issueById(scope.connection, scope.key, allFields)
      return toCanonical(issue)
    })

  const create = (scope: ProviderScope & { readonly patch: RemotePatch }) =>
    Effect.gen(function* () {
      const context = yield* team(scope)
      const issueInput = {
        teamId: context.team.id,
        ...fromCanonical({ patch: { ...scope.patch, tags: scope.patch.tags ?? [] }, team: context.team, labels: context.labels }),
      }
      const created = yield* Effect.flatMap(
        request(
          scope.connection,
          'BacklogCreate',
          `mutation BacklogCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${fieldsFor(allFields, true)} } } }`,
          { input: issueInput },
          Schema.Struct({ issueCreate: mutationResult }),
        ),
        data => settled('issueCreate', data.issueCreate),
      )
      if (scope.patch.relations === undefined || scope.patch.relations.length === 0) return toCanonical(created)
      yield* reconcileRelations(scope.connection, created, scope.patch.relations)
      return toCanonical(yield* issueById(scope.connection, created.id, allFields))
    })

  const pull = (pullInput: Parameters<BacklogProvider['pull']>[0]) =>
    Effect.gen(function* () {
      const key = yield* teamKey(pullInput)
      const page = pullInput.page === null ? undefined : Schema.decodeUnknownOption(pageTokenSchema)(pullInput.page)
      const after = page === undefined || page._tag === 'None' ? null : page.value.after
      const newestSoFar = page === undefined || page._tag === 'None' ? (pullInput.cursor ?? '') : page.value.newest
      const filter = {
        team: { key: { eq: key } },
        ...(pullInput.cursor !== null && { updatedAt: { gt: pullInput.cursor } }),
        ...(pullInput.openOnly && { state: { type: { nin: ['completed', 'canceled'] } } }),
      }
      const data = yield* request(
        pullInput.connection,
        'BacklogPull',
        `query BacklogPull($filter: IssueFilter, $after: String) {
          issues(filter: $filter, first: ${String(PAGE_SIZE)}, after: $after, orderBy: updatedAt) {
            nodes { ${fieldsFor(pullInput.fields, false)} }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { filter, after },
        Schema.Struct({
          issues: Schema.Struct({
            nodes: Schema.Array(issueSchema),
            pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean, endCursor: Schema.NullOr(Schema.String) }),
          }),
        }),
      )
      const newest = data.issues.nodes.reduce((latest, issue) => (issue.updatedAt > latest ? issue.updatedAt : latest), newestSoFar)
      const nextPage =
        data.issues.pageInfo.hasNextPage && data.issues.pageInfo.endCursor !== null
          ? yield* Schema.encodeEffect(pageTokenSchema)({ after: data.issues.pageInfo.endCursor, newest }).pipe(Effect.orDie)
          : null
      return {
        records: data.issues.nodes.map(toCanonical),
        nextPage,
        checkpoint: nextPage === null ? (newest === '' ? pullInput.cursor : newest) : null,
        complete: false,
      }
    })

  const comment = (scope: ProviderScope & { readonly key: string; readonly body: string }) =>
    Effect.flatMap(
      request(
        scope.connection,
        'BacklogComment',
        `mutation BacklogComment($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id body createdAt user { name } } } }`,
        { input: { issueId: scope.key, body: scope.body } },
        Schema.Struct({ commentCreate: Schema.Struct({ success: Schema.Boolean, comment: Schema.NullOr(commentSchema) }) }),
        scope.key,
      ),
      data =>
        data.commentCreate.comment === null || !data.commentCreate.success
          ? Effect.fail(failed('rejected', 'commentCreate did not succeed', 400))
          : Effect.succeed({
              id: data.commentCreate.comment.id,
              body: data.commentCreate.comment.body,
              author: data.commentCreate.comment.user?.name ?? LABEL,
              createdAt: Date.parse(data.commentCreate.comment.createdAt) || 0,
            } satisfies RemoteComment),
    )

  const identity = (connection: ProviderConnection) =>
    Effect.gen(function* () {
      const credential = yield* keyOf(connection)
      const data = yield* account(connection)
      return {
        account: data.viewer.name,
        credentialSource: credential.source,
        containers: data.teams.nodes.map(found => ({ key: found.key, name: found.name })),
      }
    })

  const provider: BacklogProvider = {
    descriptor,
    identity,
    pull,
    fetch: scope => Effect.map(issueById(scope.connection, scope.key, scope.fields), toCanonical),
    resolve: scope => {
      const identifier = identifierOf(scope.reference)
      return identifier === undefined
        ? Effect.fail(failed('not-found', scope.reference))
        : Effect.map(issueById(scope.connection, identifier, allFields), toCanonical)
    },
    push,
    create,
    comment,
  }
  return provider
})

export class LinearMapping {
  static readonly endpoint = LINEAR_ENDPOINT
  static readonly descriptor = descriptor
  static readonly statusOfType = statusOfType
  static readonly identifierOf = identifierOf
  static readonly priorityOf = priorityOf
  static readonly relationsOf = relationsOf
  static readonly toCanonical = toCanonical
}
