import {
  BacklogProviderFailed,
  type BacklogProvider,
  type ProviderConnection,
  type ProviderDescriptor,
  type ProviderField,
  type ProviderScope,
  type PullInput,
  type RemotePatch,
  type RemoteRelation,
} from '@dshfiles/backlog/backlog-provider'
import { Effect, Option, Schema } from 'effect'
import { GiteaClient, type GiteaSite } from './gitea-client.js'
import { GiteaMapping, commentSchema, issueSchema, labelSchema, repositorySchema, type GiteaIssue, type GiteaLabel } from './gitea-mapping.js'

const LABEL = GiteaClient.label
/** Gitea's default `MAX_RESPONSE_ITEMS`: a larger `limit` is silently cut to it, so a short page would look like the last. */
const PAGE_SIZE = 50
const MAX_DISCOVERY_PAGES = 5
const MAX_LABEL_PAGES = 10
const MAX_COMMENT_PAGES = 10

const descriptor: ProviderDescriptor = {
  kind: 'gitea',
  label: LABEL,
  containerLabel: 'Repository',
  credential: 'required',
  environmentVariables: [...GiteaClient.tokenVariables],
  referencePatterns: [
    '^[A-Za-z0-9_][A-Za-z0-9_.-]*/[A-Za-z0-9_][A-Za-z0-9_.-]*#\\d+$',
    '^#?\\d+$',
    '^https?://[^/\\s]+(?:/[^\\s]*)?/[^/\\s]+/[^/\\s]+/issues/\\d+/?$',
  ],
  referenceExample: '42, owner/repo#42 or an issue URL on your instance',
  capabilities: {
    read: true,
    write: true,
    create: true,
    delete: 'close',
    statusModel: 'open-closed',
    bodyFormat: 'markdown',
    comments: 'read-write',
    labels: true,
    priority: false,
    parent: false,
    relations: ['depends-on', 'blocks'],
    changeFeed: 'since-cursor',
    rateLimit: null,
  },
  bindingOptions: [{ key: 'createLabels', label: 'Create missing labels', placeholder: 'yes (no to only use existing labels)' }],
  baseUrl: { label: 'Instance URL', placeholder: 'https://gitea.example.com', required: true },
}

const userSchema = Schema.Struct({ login: Schema.String })
const searchSchema = Schema.Struct({ data: Schema.Array(repositorySchema) })

/** The page token of a pull: the next page number and the newest `updated_at` seen so far, as epoch milliseconds. */
const pageTokenSchema = Schema.fromJsonString(Schema.Struct({ page: Schema.Number, newest: Schema.Number }))

type Scope = ProviderScope
interface Location {
  readonly repository: string
  readonly number: number
}

const failed = (code: BacklogProviderFailed['code'], detail = '', status?: number) =>
  new BacklogProviderFailed({ provider: LABEL, code, detail, ...(status !== undefined && { status }) })

/** A response decoder for one schema: a shape it refuses reads as `invalid-response`, naming the operation. */
const decode = <S extends Schema.Top>(schema: S, what: string) => {
  const decoder = Schema.decodeUnknownEffect(schema)
  return (response: Parameters<typeof decoder>[0]) => decoder(response).pipe(Effect.mapError(() => failed('invalid-response', what)))
}

/** `/repos/<owner>/<repo>` from a repository that passed the pattern, each segment encoded. */
const repoPath = (repository: string) => {
  const [owner = '', name = ''] = repository.split('/')
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
}
const issuePath = (at: Location) => `${repoPath(at.repository)}/issues/${String(at.number)}`

const allFields: readonly ProviderField[] = ['title', 'body', 'status', 'tags', 'links']

/**
 * Gitea and Forgejo repositories over REST v1: issues are items, the title and markdown body map as they are, open and
 * closed the status, labels the tags (created in the repository when missing, unless the binding says no), issue
 * dependencies the `depends-on`/`blocks` relations, and comments flow both ways. Pull requests are never items.
 */
export const makeGiteaProvider = Effect.fn('backlog gitea provider')(function* () {
  const client = yield* GiteaClient

  const call = <S extends Schema.Top>(
    connection: ProviderConnection,
    request: Omit<Parameters<typeof client.request>[0], 'connection'>,
    schema: S,
  ): Effect.Effect<S['Type'], BacklogProviderFailed, S['DecodingServices']> =>
    Effect.flatMap(client.request({ connection, ...request }), decode(schema, request.operation))

  /** The repositories with issues the token sees, through repository search (repository scope only). */
  const discover = (connection: ProviderConnection) =>
    Effect.gen(function* () {
      const containers: { key: string; name: string; url?: string }[] = []
      for (let page = 1; page <= MAX_DISCOVERY_PAGES; page += 1) {
        const found = yield* call(
          connection,
          {
            method: 'GET',
            path: '/repos/search',
            query: { page: String(page), limit: String(PAGE_SIZE), sort: 'updated', order: 'desc' },
            operation: 'search-repositories',
          },
          searchSchema,
        )
        for (const repository of found.data)
          if (repository.has_issues !== false && repository.archived !== true)
            containers.push({ key: repository.full_name, name: repository.full_name, ...(repository.html_url !== undefined && { url: repository.html_url }) })
        if (found.data.length < PAGE_SIZE) break
      }
      return containers
    })

  /** The binding's `owner/repo`, or the only repository with issues the token sees when it names none. */
  const repositoryOf = (scope: Scope) =>
    Effect.gen(function* () {
      const configured = scope.container.trim()
      if (configured !== '') {
        if (!GiteaMapping.repositoryPattern.test(configured)) return yield* failed('target-missing', `“${configured.slice(0, 80)}” is not owner/repo`)
        return configured
      }
      const found = yield* discover(scope.connection)
      const only = found.length === 1 ? found[0] : undefined
      if (only === undefined || !GiteaMapping.repositoryPattern.test(only.key))
        return yield* failed('target-missing', `the token sees ${String(found.length)} repositories with issues; set the binding’s repository to owner/repo`)
      return only.key
    })

  const located = (scope: Scope, reference: string) =>
    Effect.gen(function* () {
      const site = yield* client.siteOf(scope.connection)
      const container = /^#?\d+$/u.test(reference.trim()) ? yield* repositoryOf(scope) : undefined
      const at = GiteaMapping.locate(reference, container, site)
      if (at === undefined)
        return yield* failed('not-found', `“${reference.slice(0, 80)}” is not an issue number, owner/repo#number or issue URL on this instance`)
      return at
    })

  const getIssue = (connection: ProviderConnection, at: Location) =>
    Effect.flatMap(
      call(connection, { method: 'GET', path: issuePath(at), operation: 'get-issue', reference: GiteaMapping.keyOf(at.repository, at.number) }, issueSchema),
      issue =>
        issue.pull_request === undefined || issue.pull_request === null
          ? Effect.succeed(issue)
          : Effect.fail(failed('not-found', `${GiteaMapping.keyOf(at.repository, at.number)} is a pull request`)),
    )

  const commentsOf = (connection: ProviderConnection, at: Location) =>
    Effect.gen(function* () {
      const all: (typeof commentSchema.Type)[] = []
      for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
        const batch = yield* call(
          connection,
          {
            method: 'GET',
            path: `${issuePath(at)}/comments`,
            query: { page: String(page), limit: String(PAGE_SIZE) },
            operation: 'list-comments',
            reference: GiteaMapping.keyOf(at.repository, at.number),
          },
          Schema.Array(commentSchema),
        )
        all.push(...batch)
        if (batch.length < PAGE_SIZE) break
      }
      return all
    })

  /** One dependency list; a repository with dependencies turned off answers none. */
  const linked = (connection: ProviderConnection, at: Location, list: 'dependencies' | 'blocks') =>
    call(
      connection,
      { method: 'GET', path: `${issuePath(at)}/${list}`, query: { limit: String(PAGE_SIZE) }, operation: `list-${list}` },
      Schema.Array(issueSchema),
    ).pipe(
      Effect.catchIf(
        error => error.code === 'not-found' || (error.code === 'rejected' && error.status !== 401 && error.status !== 403),
        () => Effect.succeed([]),
      ),
    )

  /** Dependencies as backlog relations: what blocks the issue is `depends-on`, what it blocks is `blocks`. */
  const relationsOf = (connection: ProviderConnection, site: GiteaSite, at: Location) =>
    Effect.gen(function* () {
      const [dependsOn, blocks] = yield* Effect.all([linked(connection, at, 'dependencies'), linked(connection, at, 'blocks')])
      const asRelations = (issues: readonly GiteaIssue[], relation: RemoteRelation['relation']) =>
        issues.flatMap((issue): RemoteRelation[] => {
          const repository = GiteaMapping.repositoryOfIssue(issue, site)
          return repository === undefined ? [] : [{ relation, key: GiteaMapping.keyOf(repository, issue.number) }]
        })
      return [...asRelations(dependsOn, 'depends-on'), ...asRelations(blocks, 'blocks')]
    })

  const recordOf = (connection: ProviderConnection, repository: string, issue: GiteaIssue, fields: readonly ProviderField[]) =>
    Effect.gen(function* () {
      const at = { repository, number: issue.number }
      const comments = yield* commentsOf(connection, at)
      const relations = fields.includes('links') ? yield* relationsOf(connection, yield* client.siteOf(connection), at) : undefined
      return GiteaMapping.toCanonical({ repository, issue, comments, relations })
    })

  /** The repository's labels, by lower-case name. */
  const labelsOf = (connection: ProviderConnection, repository: string) =>
    Effect.gen(function* () {
      const byName = new Map<string, GiteaLabel>()
      for (let page = 1; page <= MAX_LABEL_PAGES; page += 1) {
        const batch = yield* call(
          connection,
          { method: 'GET', path: `${repoPath(repository)}/labels`, query: { page: String(page), limit: String(PAGE_SIZE) }, operation: 'list-labels' },
          Schema.Array(labelSchema),
        )
        for (const label of batch) if (!byName.has(label.name.toLowerCase())) byName.set(label.name.toLowerCase(), label)
        if (batch.length < PAGE_SIZE) break
      }
      return byName
    })

  /** Label ids for tag names: existing labels match case-insensitively; missing ones are created unless the binding says no. */
  const labelIds = (scope: Scope, repository: string, tags: readonly string[]) =>
    Effect.gen(function* () {
      const wanted = [...new Set(tags.map(tag => tag.trim()).filter(tag => tag !== ''))]
      if (wanted.length === 0) return []
      const existing = yield* labelsOf(scope.connection, repository)
      const create = !GiteaMapping.isOff(scope.options?.['createLabels'])
      const ids: number[] = []
      for (const name of wanted) {
        const found = existing.get(name.toLowerCase())
        if (found !== undefined) {
          ids.push(found.id)
          continue
        }
        if (!create) continue
        const created = yield* call(
          scope.connection,
          { method: 'POST', path: `${repoPath(repository)}/labels`, body: { name, color: GiteaMapping.labelColor(name) }, operation: 'create-label' },
          labelSchema,
        )
        existing.set(name.toLowerCase(), created)
        ids.push(created.id)
      }
      return ids
    })

  /** Adds and removes dependencies until the issue holds exactly the wanted `depends-on`/`blocks` set. */
  const setRelations = (connection: ProviderConnection, at: Location, wanted: readonly RemoteRelation[]) =>
    Effect.gen(function* () {
      const site = yield* client.siteOf(connection)
      const current = yield* relationsOf(connection, site, at)
      const supported = wanted.filter(relation => relation.relation === 'depends-on' || relation.relation === 'blocks')
      const same = (left: RemoteRelation, right: RemoteRelation) => left.relation === right.relation && left.key === right.key
      const adds = supported.filter(relation => !current.some(entry => same(entry, relation)))
      const removes = current.filter(relation => !supported.some(entry => same(entry, relation)))
      // Sequential on purpose: Gitea checks for dependency cycles against the state each write leaves.
      yield* Effect.forEach(
        [...adds.map(relation => ({ relation, add: true })), ...removes.map(relation => ({ relation, add: false }))],
        change =>
          Effect.gen(function* () {
            const other = GiteaMapping.parseKey(change.relation.key)
            if (other === undefined) return
            const [owner = '', repo = ''] = other.repository.split('/')
            const list = change.relation.relation === 'depends-on' ? 'dependencies' : 'blocks'
            yield* client.request({
              connection,
              method: change.add ? 'POST' : 'DELETE',
              path: `${issuePath(at)}/${list}`,
              body: { owner, repo, index: other.number },
              operation: change.add ? 'add-dependency' : 'remove-dependency',
              reference: change.relation.key,
            })
          }),
        { discard: true },
      )
      return adds.length > 0 || removes.length > 0
    })

  const fetchRecord = (scope: Scope & { readonly key: string; readonly fields: readonly ProviderField[] }) =>
    Effect.gen(function* () {
      const at = yield* located(scope, scope.key)
      return yield* recordOf(scope.connection, at.repository, yield* getIssue(scope.connection, at), scope.fields)
    })

  const resolve = (scope: Scope & { readonly reference: string }) =>
    Effect.gen(function* () {
      const at = yield* located(scope, scope.reference)
      return yield* recordOf(scope.connection, at.repository, yield* getIssue(scope.connection, at), ['title', 'links'])
    })

  const push = (scope: Scope & { readonly key: string; readonly patch: RemotePatch }) =>
    Effect.gen(function* () {
      const at = yield* located(scope, scope.key)
      const patch = scope.patch
      const body = {
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.body !== undefined && { body: patch.body }),
        ...(patch.status !== undefined && { state: GiteaMapping.stateOf(patch.status) }),
      }
      if (Object.keys(body).length > 0)
        yield* call(scope.connection, { method: 'PATCH', path: issuePath(at), body, operation: 'update-issue', reference: scope.key }, issueSchema)
      if (patch.tags !== undefined) {
        const labels = yield* labelIds(scope, at.repository, patch.tags)
        yield* client.request({
          connection: scope.connection,
          method: 'PUT',
          path: `${issuePath(at)}/labels`,
          body: { labels },
          operation: 'replace-labels',
          reference: scope.key,
        })
      }
      if (patch.relations !== undefined) yield* setRelations(scope.connection, at, patch.relations)
      const issue = yield* getIssue(scope.connection, at)
      return yield* recordOf(scope.connection, at.repository, issue, patch.relations === undefined ? ['title'] : ['links'])
    })

  const create = (scope: Scope & { readonly patch: RemotePatch }) =>
    Effect.gen(function* () {
      const repository = yield* repositoryOf(scope)
      const patch = scope.patch
      const kindLabel = patch.kind === undefined || patch.kind === 'task' ? [] : [patch.kind]
      const labels = yield* labelIds(scope, repository, [...(patch.tags ?? []), ...kindLabel])
      const closed = patch.status !== undefined && GiteaMapping.stateOf(patch.status) === 'closed'
      const created = yield* call(
        scope.connection,
        {
          method: 'POST',
          path: `${repoPath(repository)}/issues`,
          body: { title: patch.title ?? '', body: patch.body ?? '', labels, closed },
          operation: 'create-issue',
          reference: repository,
        },
        issueSchema,
      )
      const at = { repository, number: created.number }
      if ((patch.relations ?? []).length === 0) return GiteaMapping.toCanonical({ repository, issue: created, comments: [] })
      yield* setRelations(scope.connection, at, patch.relations ?? [])
      return yield* recordOf(scope.connection, repository, yield* getIssue(scope.connection, at), ['links'])
    })

  const pull = (input: PullInput) =>
    Effect.gen(function* () {
      const repository = yield* repositoryOf(input)
      const site = yield* client.siteOf(input.connection)
      const token = input.page === null ? Option.none() : Schema.decodeUnknownOption(pageTokenSchema)(input.page)
      const page = Option.match(token, { onNone: () => 1, onSome: value => value.page })
      const cursorMs = input.cursor === null ? 0 : Date.parse(input.cursor) || 0
      const newestSoFar = Option.match(token, { onNone: () => cursorMs, onSome: value => value.newest })
      const issues = yield* call(
        input.connection,
        {
          method: 'GET',
          path: `${repoPath(repository)}/issues`,
          query: {
            state: input.openOnly ? 'open' : 'all',
            type: 'issues',
            page: String(page),
            limit: String(PAGE_SIZE),
            ...(input.cursor !== null && cursorMs > 0 && { since: new Date(cursorMs).toISOString() }),
          },
          operation: 'list-issues',
          reference: repository,
        },
        Schema.Array(issueSchema),
      )
      const real = issues.filter(issue => issue.pull_request === undefined || issue.pull_request === null)
      const withLinks = input.fields.includes('links')
      const records = yield* Effect.forEach(
        real,
        issue =>
          withLinks
            ? Effect.map(relationsOf(input.connection, site, { repository, number: issue.number }), relations =>
                GiteaMapping.toCanonical({ repository, issue, relations }),
              )
            : Effect.succeed(GiteaMapping.toCanonical({ repository, issue })),
        { concurrency: 4 },
      )
      const newest = issues.reduce((latest, issue) => Math.max(latest, Date.parse(issue.updated_at) || 0), newestSoFar)
      const nextPage = issues.length >= PAGE_SIZE ? yield* Schema.encodeEffect(pageTokenSchema)({ page: page + 1, newest }).pipe(Effect.orDie) : null
      const checkpoint = nextPage !== null ? null : newest > 0 ? new Date(newest).toISOString() : input.cursor
      return { records, nextPage, checkpoint, complete: false }
    })

  const comment = (scope: Scope & { readonly key: string; readonly body: string }) =>
    Effect.gen(function* () {
      const at = yield* located(scope, scope.key)
      const created = yield* call(
        scope.connection,
        { method: 'POST', path: `${issuePath(at)}/comments`, body: { body: scope.body }, operation: 'create-comment', reference: scope.key },
        commentSchema,
      )
      return GiteaMapping.commentOf(created)
    })

  /**
   * The signed-in login and the repositories the token sees. A token without `read:user` still syncs: the account
   * then reads as a hint to grant it, and discovery goes through repository search, which needs only repository scope.
   */
  const identity = (connection: ProviderConnection) =>
    Effect.gen(function* () {
      const source = yield* client.credentialSource(connection)
      const user = yield* call(connection, { method: 'GET', path: '/user', operation: 'get-user' }, userSchema).pipe(
        Effect.map(found => found.login),
        Effect.catchIf(
          error => error.code === 'rejected' && error.status === 403,
          () => Effect.succeed('token without read:user scope'),
        ),
      )
      return { account: user, credentialSource: source, containers: yield* discover(connection) }
    })

  const provider: BacklogProvider = { descriptor, identity, pull, fetch: fetchRecord, resolve, push, create, comment }
  return provider
})

export class GiteaProvider {
  static readonly descriptor = descriptor
  static readonly allFields = allFields
  static readonly pageSize = PAGE_SIZE
}
