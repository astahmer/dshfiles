import {
  BacklogProviderFailed,
  type BacklogProviders,
  type BacklogProvider,
  type ProviderConnection,
  type ProviderDescriptor,
  type ProviderField,
  type ProviderScope,
  type PullInput,
  type RemoteComment,
  type RemotePatch,
  type RemoteRecord,
} from '@dshfiles/backlog/backlog-provider'
import { Clock, Effect, Option, Ref, Schema } from 'effect'
import { JiraAdf, type AdfNode } from './jira-adf.js'
import { JiraClient } from './jira-client.js'
import { JiraMapping, type JiraIssue, type JiraStatus } from './jira-mapping.js'

const LABEL = JiraClient.label
const PAGE_SIZE = 50
const MAX_DISCOVERY_PAGES = 5
const MAX_COMMENT_PAGES = 5
const MAX_TRANSITION_HOPS = 3
const MYSELF_CACHE_MS = 10 * 60_000
const MAX_BODY_CHARS = 80_000
const MAX_COMMENT_CHARS = 40_000
const DEFAULT_ISSUE_TYPE = 'Task'

const descriptor: ProviderDescriptor = {
  kind: 'jira',
  label: LABEL,
  containerLabel: 'Project',
  credential: 'required',
  environmentVariables: [...JiraClient.tokenVariables],
  referencePatterns: [
    '^https?://[a-z0-9-]+\\.atlassian\\.net/browse/[a-z][a-z0-9_]*-\\d+/?$',
    '^https?://[a-z0-9-]+\\.atlassian\\.net/.*[?&]selectedIssue=[a-z][a-z0-9_]*-\\d+',
    '^[a-z][a-z0-9_]*-\\d+$',
  ],
  referenceExample: 'an issue key like ENG-12 or a <site>.atlassian.net/browse/ENG-12 URL',
  capabilities: {
    read: true,
    write: true,
    create: true,
    delete: 'archive',
    statusModel: 'workflow-transitions',
    bodyFormat: 'rich',
    comments: 'read-write',
    labels: true,
    priority: true,
    parent: true,
    relations: ['blocks', 'depends-on', 'related', 'duplicates'],
    changeFeed: 'since-cursor',
    rateLimit: null,
    extraFields: ['due', 'criteria', 'summary'],
  },
  connectionOptions: [{ key: 'email', label: 'Account email', placeholder: 'you@example.com' }],
  bindingOptions: [
    { key: 'jql', label: 'Extra JQL', placeholder: 'labels = backlog' },
    { key: 'issueType', label: 'Issue type for new items', placeholder: DEFAULT_ISSUE_TYPE },
    { key: 'priorityValues', label: 'Priority names', placeholder: 'urgent=Highest, high=High' },
    { key: 'archiveStatus', label: 'Status for deleted items', placeholder: "Won't Do" },
    { key: 'criteriaField', label: 'Acceptance criteria field', placeholder: 'customfield_10050' },
    { key: 'summaryField', label: 'Summary field', placeholder: 'customfield_10051' },
  ],
}

const myselfSchema = Schema.Struct({
  accountId: Schema.String,
  displayName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  timeZone: Schema.optionalKey(Schema.NullOr(Schema.String)),
})
const projectPageSchema = Schema.Struct({
  values: Schema.Array(Schema.Struct({ key: Schema.String, name: Schema.String })),
  isLast: Schema.optionalKey(Schema.Boolean),
})
const searchSchema = Schema.Struct({
  issues: Schema.Array(Schema.Unknown),
  nextPageToken: Schema.optionalKey(Schema.NullOr(Schema.String)),
  isLast: Schema.optionalKey(Schema.Boolean),
})
const commentSchema = Schema.Struct({
  id: Schema.String,
  body: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, JiraAdf.nodeSchema]))),
  author: Schema.optionalKey(Schema.NullOr(Schema.Struct({ displayName: Schema.optionalKey(Schema.String) }))),
  created: Schema.String,
})
const commentPageSchema = Schema.Struct({ comments: Schema.Array(commentSchema), total: Schema.optionalKey(Schema.Number) })
const transitionsSchema = Schema.Struct({ transitions: Schema.Array(JiraMapping.transitionSchema) })
const createdSchema = Schema.Struct({ id: Schema.String, key: Schema.String })

/** The page token of a pull: Jira's `nextPageToken` and the newest `updated` seen, so the last page knows the checkpoint. */
const pageTokenSchema = Schema.fromJsonString(Schema.Struct({ token: Schema.String, newest: Schema.Number }))

type Scope = ProviderScope
/** A value an issue edit or create sends for one field. */
type IssueFieldValue = string | null | AdfNode | readonly string[] | { readonly name: string } | { readonly id: string } | { readonly key: string }
/** The `update` operations an issue edit sends: only clearing the parent, which `fields` cannot express. */
interface IssueUpdate {
  parent?: readonly { readonly set: { readonly none: true } }[]
}
type Status = (typeof BacklogProviders.statuses)[number]

const failed = (code: BacklogProviderFailed['code'], detail = '', status?: number) =>
  new BacklogProviderFailed({ provider: LABEL, code, detail, ...(status !== undefined && { status }) })

/** A response decoder for one schema: a shape it refuses reads as `invalid-response`, naming the operation. */
const decode = <S extends Schema.Top>(schema: S, what: string) => {
  const decoder = Schema.decodeUnknownEffect(schema)
  return (response: Parameters<typeof decoder>[0]) => decoder(response).pipe(Effect.mapError(() => failed('invalid-response', what)))
}

/** A path segment from a key or id that passed validation; anything else fails before a request is built. */
const issuePath = (key: string) => {
  const ref = JiraMapping.issueRef(key)
  return ref === undefined ? Effect.fail(failed('not-found', `“${key.slice(0, 80)}” is not a Jira issue key or id`)) : Effect.succeed(encodeURIComponent(ref))
}

const allFields: readonly ProviderField[] = ['title', 'body', 'status', 'tags', 'priority', 'parent', 'links', 'due', 'criteria', 'summary']

/**
 * Jira Cloud projects over REST v3: issues are items, the summary the title, the ADF description the body (as
 * markdown), the status category the status (written through workflow transitions), labels the tags, the priority
 * name the priority, `parent` the parent, Blocks/Relates/Duplicate links the relations, the due date the due date, and
 * custom fields the binding names the acceptance criteria and summary.
 */
export const makeJiraProvider = Effect.fn('backlog jira provider')(function* () {
  const client = yield* JiraClient
  const myselfCache = yield* Ref.make(new Map<string, { readonly at: number; readonly timeZone: string }>())

  const myself = (connection: ProviderConnection) =>
    Effect.flatMap(client.request({ connection, method: 'GET', path: '/myself', operation: 'get-myself' }), decode(myselfSchema, 'myself'))

  /** The user's profile time zone, cached ten minutes: JQL reads dates in it. */
  const timeZoneOf = (connection: ProviderConnection) =>
    Effect.gen(function* () {
      const cacheKey = `${connection.instanceId}\n${connection.baseUrl}`
      const now = yield* Clock.currentTimeMillis
      const cached = (yield* Ref.get(myselfCache)).get(cacheKey)
      if (cached !== undefined && now - cached.at < MYSELF_CACHE_MS) return cached.timeZone
      const timeZone = (yield* myself(connection)).timeZone ?? 'UTC'
      yield* Ref.update(myselfCache, current => new Map(current).set(cacheKey, { at: now, timeZone }))
      return timeZone
    })

  /** Every project the account can browse. */
  const discover = (connection: ProviderConnection) =>
    Effect.gen(function* () {
      const site = yield* client.siteOf(connection)
      const found: { key: string; name: string; url: string }[] = []
      for (let page = 0; page < MAX_DISCOVERY_PAGES; page += 1) {
        const listed: typeof projectPageSchema.Type = yield* Effect.flatMap(
          client.request({
            connection,
            method: 'GET',
            path: '/project/search',
            query: { startAt: String(page * 50), maxResults: '50', orderBy: 'key' },
            operation: 'search-projects',
          }),
          decode(projectPageSchema, 'project/search'),
        )
        found.push(...listed.values.map(project => ({ key: project.key, name: project.name, url: `${site}/browse/${project.key}` })))
        if (listed.isLast !== false || listed.values.length === 0) break
      }
      return found
    })

  /** The binding's project key: the container, or the only project the account sees. */
  const projectOf = (scope: Scope) =>
    Effect.gen(function* () {
      const configured = scope.container.trim()
      if (configured === '') {
        const visible = yield* discover(scope.connection)
        const only = visible.length === 1 ? visible[0] : undefined
        if (only === undefined)
          return yield* failed(
            'target-missing',
            visible.length === 0 ? 'the account can browse no project' : 'the account sees several projects; pick one for the binding',
          )
        return only.key
      }
      const key = JiraMapping.projectKeyOf(configured)
      if (key === undefined) return yield* failed('target-missing', `“${configured.slice(0, 80)}” is not a Jira project key (ENG)`)
      return key
    })

  const customFields = (options: Scope['options']) => {
    const criteria = JiraMapping.customFieldOf(options?.['criteriaField'])
    const summary = JiraMapping.customFieldOf(options?.['summaryField'])
    return { criteria, summary }
  }

  const invalidOption = (options: Scope['options']) => {
    for (const option of ['criteriaField', 'summaryField'] as const) {
      const value = options?.[option]?.trim() ?? ''
      if (value !== '' && JiraMapping.customFieldOf(value) === undefined)
        return Option.some(failed('target-missing', `binding option ${option} must be a custom field id like customfield_10050, not “${value.slice(0, 60)}”`))
    }
    return Option.none<BacklogProviderFailed>()
  }

  const fieldsFor = (options: Scope['options']): string[] => {
    const custom = customFields(options)
    return [
      'summary',
      'description',
      'status',
      'labels',
      'priority',
      'parent',
      'issuelinks',
      'duedate',
      'issuetype',
      'updated',
      ...(custom.criteria === undefined ? [] : [custom.criteria]),
      ...(custom.summary === undefined ? [] : [custom.summary]),
    ]
  }

  const customValue = (issue: JiraIssue, field: string | undefined) => {
    if (field === undefined) return undefined
    const decoded = Schema.decodeUnknownOption(Schema.NullOr(Schema.Union([Schema.String, JiraAdf.nodeSchema])))(issue.fields[field] ?? null)
    return Option.getOrNull(decoded)
  }

  /** An issue in backlog vocabulary: what the port calls `toCanonical`. */
  const toCanonical = (input: {
    readonly issue: JiraIssue
    readonly site: string
    readonly options: Scope['options']
    readonly comments?: readonly RemoteComment[] | undefined
  }): RemoteRecord => {
    const fields = input.issue.fields
    const custom = customFields(input.options)
    const canonical = {
      key: input.issue.id,
      displayKey: input.issue.key,
      url: `${input.site}/browse/${input.issue.key}`,
      title: (fields.summary ?? '').slice(0, 1_000),
      body: JiraMapping.markdownOf(fields.description).markdown.slice(0, MAX_BODY_CHARS),
      status: fields.status === undefined || fields.status === null ? null : JiraMapping.statusOf(fields.status),
      tags: [...(fields.labels ?? [])],
      ...(fields.issuetype?.name !== undefined && { kind: fields.issuetype.name.toLowerCase() === 'bug' ? ('bug' as const) : ('task' as const) }),
      priority: JiraMapping.priorityOf(fields.priority?.name, input.options),
      parentKey: fields.parent?.id ?? null,
      relations: (fields.issuelinks ?? []).flatMap(link => {
        const relation = JiraMapping.relationOf(link)
        return relation === undefined ? [] : [relation]
      }),
      due: fields.duedate !== undefined && fields.duedate !== null && /^\d{4}-\d{2}-\d{2}$/u.test(fields.duedate) ? fields.duedate : null,
      ...(custom.criteria !== undefined && { criteria: JiraMapping.criteriaOf(customValue(input.issue, custom.criteria)).slice(0, 50) }),
      ...(custom.summary !== undefined && { summary: JiraMapping.markdownOf(customValue(input.issue, custom.summary)).markdown.slice(0, MAX_BODY_CHARS) }),
      updatedAt: JiraMapping.instantOf(fields.updated),
    }
    return {
      ...canonical,
      ...(input.comments !== undefined && { comments: input.comments }),
      version: `${fields.updated}#${JiraMapping.contentHash(JSON.stringify(canonical))}`,
    }
  }

  const issueOf = (scope: Scope, key: string) =>
    Effect.gen(function* () {
      const path = yield* issuePath(key)
      return yield* Effect.flatMap(
        client.request({
          connection: scope.connection,
          method: 'GET',
          path: `/issue/${path}`,
          query: { fields: fieldsFor(scope.options).join(',') },
          operation: 'get-issue',
          reference: key,
        }),
        decode(JiraMapping.issueSchema, 'get-issue'),
      )
    })

  const commentOf = (comment: typeof commentSchema.Type): RemoteComment => ({
    id: comment.id,
    body: JiraMapping.markdownOf(comment.body).markdown.slice(0, MAX_COMMENT_CHARS),
    author: comment.author?.displayName ?? LABEL,
    createdAt: JiraMapping.instantOf(comment.created),
  })

  const commentsOf = (scope: Scope, key: string) =>
    Effect.gen(function* () {
      const path = yield* issuePath(key)
      const comments: RemoteComment[] = []
      for (let page = 0; page < MAX_COMMENT_PAGES; page += 1) {
        const listed: typeof commentPageSchema.Type = yield* Effect.flatMap(
          client.request({
            connection: scope.connection,
            method: 'GET',
            path: `/issue/${path}/comment`,
            query: { startAt: String(page * 100), maxResults: '100', orderBy: 'created' },
            operation: 'list-comments',
            reference: key,
          }),
          decode(commentPageSchema, 'list-comments'),
        )
        comments.push(...listed.comments.map(commentOf))
        if (listed.comments.length < 100 || (listed.total !== undefined && comments.length >= listed.total)) break
      }
      return comments
    })

  const recordOf = (scope: Scope, key: string, withComments: boolean) =>
    Effect.gen(function* () {
      const failure = invalidOption(scope.options)
      if (Option.isSome(failure)) return yield* failure.value
      const site = yield* client.siteOf(scope.connection)
      const issue = yield* issueOf(scope, key)
      const comments = withComments ? yield* commentsOf(scope, issue.id) : undefined
      return toCanonical({ issue, site, options: scope.options, comments })
    })

  /**
   * Moves an issue towards a backlog status (or the status name the binding chose) through its workflow: a direct
   * transition when one exists, else up to three hops through the categories in between, else a refusal naming the
   * statuses reachable from where it is.
   */
  const transitionTo = (scope: Scope, key: string, from: JiraStatus, target: { readonly status: Status; readonly label?: string | undefined }) =>
    Effect.gen(function* () {
      const path = yield* issuePath(key)
      let current = from
      const visited = [from.name]
      for (let hop = 0; hop < MAX_TRANSITION_HOPS; hop += 1) {
        const listed = yield* Effect.flatMap(
          client.request({ connection: scope.connection, method: 'GET', path: `/issue/${path}/transitions`, operation: 'get-transitions', reference: key }),
          decode(transitionsSchema, 'get-transitions'),
        )
        const step = JiraMapping.nextTransition({ current, transitions: listed.transitions, target, visited })
        if (step.kind === 'already') return
        if (step.kind === 'unreachable')
          return yield* failed(
            'unsupported',
            `no transition from “${current.name}” reaches ${target.label === undefined ? `a ${target.status} status` : `“${target.label}”`} (reachable: ${step.available.join(', ') || 'none'}). Set the binding's remote status name for ${target.status} to a reachable status, or add the transition to the Jira workflow`,
          )
        yield* client.request({
          connection: scope.connection,
          method: 'POST',
          path: `/issue/${path}/transitions`,
          body: { transition: { id: step.transition.id } },
          operation: 'transition-issue',
          reference: key,
        })
        if (step.kind === 'direct') return
        current = step.transition.to
        visited.push(current.name)
      }
      return yield* failed(
        'unsupported',
        `${target.status} is more than ${String(MAX_TRANSITION_HOPS)} transitions away from “${from.name}”; move it in Jira once`,
      )
    })

  /** A patch as issue fields and update operations: what the port calls `fromCanonical`. Unchanged text is never re-sent. */
  const fromCanonical = (input: { readonly patch: RemotePatch; readonly options: Scope['options']; readonly current: JiraIssue | undefined }) => {
    const patch = input.patch
    const custom = customFields(input.options)
    const fields: Record<string, IssueFieldValue> = {}
    const update: IssueUpdate = {}
    if (patch.title !== undefined) fields['summary'] = patch.title.replace(/\s+/gu, ' ').trim().slice(0, 255)
    if (patch.body !== undefined) {
      const document = JiraAdf.fromMarkdown(patch.body)
      const currentBody = JiraMapping.markdownOf(input.current?.fields.description).markdown
      if (input.current === undefined || JiraAdf.toMarkdown(document).markdown !== JiraAdf.normalise(currentBody)) fields['description'] = document
    }
    if (patch.tags !== undefined) fields['labels'] = JiraMapping.labelsFor(patch.tags)
    if (patch.priority !== undefined) {
      const name = JiraMapping.priorityNameFor(patch.priority, input.options)
      if (name !== undefined) fields['priority'] = { name }
    }
    if (patch.parentKey !== undefined) {
      if (patch.parentKey === null) {
        if (input.current?.fields.parent !== undefined && input.current.fields.parent !== null) update.parent = [{ set: { none: true } }]
      } else {
        const parent = JiraMapping.issueRef(patch.parentKey)
        if (parent !== undefined) fields['parent'] = /^\d+$/u.test(parent) ? { id: parent } : { key: parent }
      }
    }
    if (patch.due !== undefined) fields['duedate'] = patch.due
    if (patch.criteria !== undefined && custom.criteria !== undefined) {
      const asText = typeof input.current?.fields[custom.criteria] === 'string'
      fields[custom.criteria] = JiraMapping.criteriaValue(patch.criteria, asText)
    }
    if (patch.summary !== undefined && custom.summary !== undefined) {
      const asText = typeof input.current?.fields[custom.summary] === 'string'
      fields[custom.summary] = patch.summary === '' ? null : asText ? patch.summary : JiraAdf.fromMarkdown(patch.summary)
    }
    return { fields, update }
  }

  const writeLinks = (scope: Scope, issue: JiraIssue, relations: NonNullable<RemotePatch['relations']>) =>
    Effect.gen(function* () {
      const wanted = relations.flatMap(relation => {
        const ref = JiraMapping.issueRef(relation.key)
        return ref === undefined ? [] : [{ relation: relation.relation, key: ref }]
      })
      const changes = JiraMapping.linkChanges({ self: issue.id, current: issue.fields.issuelinks ?? [], wanted })
      for (const body of changes.create)
        yield* client.request({ connection: scope.connection, method: 'POST', path: '/issueLink', body, operation: 'create-issue-link', reference: issue.key })
      for (const id of changes.remove)
        if (/^\d+$/u.test(id))
          yield* client.request({
            connection: scope.connection,
            method: 'DELETE',
            path: `/issueLink/${id}`,
            operation: 'delete-issue-link',
            reference: issue.key,
          })
    })

  const statusTarget = (patch: RemotePatch) =>
    patch.status === undefined ? undefined : { status: patch.status, ...(patch.statusLabel !== undefined && { label: patch.statusLabel }) }

  const push = (scope: Scope & { readonly key: string; readonly patch: RemotePatch }) =>
    Effect.gen(function* () {
      const failure = invalidOption(scope.options)
      if (Option.isSome(failure)) return yield* failure.value
      const current = yield* issueOf(scope, scope.key)
      const path = yield* issuePath(current.id)
      const { fields, update } = fromCanonical({ patch: scope.patch, options: scope.options, current })
      if (Object.keys(fields).length > 0 || Object.keys(update).length > 0)
        yield* client.request({
          connection: scope.connection,
          method: 'PUT',
          path: `/issue/${path}`,
          query: { notifyUsers: 'false' },
          body: { ...(Object.keys(fields).length > 0 && { fields }), ...(Object.keys(update).length > 0 && { update }) },
          operation: 'edit-issue',
          reference: current.key,
        })
      const target = statusTarget(scope.patch)
      if (target !== undefined && current.fields.status !== undefined && current.fields.status !== null)
        yield* transitionTo(scope, current.id, current.fields.status, target)
      if (scope.patch.relations !== undefined) yield* writeLinks(scope, current, scope.patch.relations)
      return yield* recordOf(scope, current.id, false)
    })

  const create = (scope: Scope & { readonly patch: RemotePatch }) =>
    Effect.gen(function* () {
      const failure = invalidOption(scope.options)
      if (Option.isSome(failure)) return yield* failure.value
      const project = yield* projectOf(scope)
      const { fields } = fromCanonical({ patch: { ...scope.patch, title: scope.patch.title ?? '' }, options: scope.options, current: undefined })
      const issueType = scope.options?.['issueType']?.trim() || DEFAULT_ISSUE_TYPE
      const created = yield* Effect.flatMap(
        client.request({
          connection: scope.connection,
          method: 'POST',
          path: '/issue',
          body: { fields: { ...fields, summary: fields['summary'] || 'Untitled', project: { key: project }, issuetype: { name: issueType } } },
          operation: 'create-issue',
        }),
        decode(createdSchema, 'create-issue'),
      )
      const issue = yield* issueOf(scope, created.id)
      const target = statusTarget(scope.patch)
      if (target !== undefined && issue.fields.status !== undefined && issue.fields.status !== null)
        yield* transitionTo(scope, issue.id, issue.fields.status, target)
      if (scope.patch.relations !== undefined && scope.patch.relations.length > 0) yield* writeLinks(scope, issue, scope.patch.relations)
      return yield* recordOf(scope, issue.id, false)
    })

  const comment = (scope: Scope & { readonly key: string; readonly body: string }) =>
    Effect.gen(function* () {
      const path = yield* issuePath(scope.key)
      return yield* Effect.flatMap(
        client.request({
          connection: scope.connection,
          method: 'POST',
          path: `/issue/${path}/comment`,
          body: { body: JiraAdf.fromMarkdown(scope.body) },
          operation: 'add-comment',
          reference: scope.key,
        }),
        result => Effect.map(decode(commentSchema, 'add-comment')(result), commentOf),
      )
    })

  /** Deleting a linked item archives its issue: a transition to the binding's archive status, a Won't Do-like one, else Done. */
  const remove = (scope: Scope & { readonly key: string }) =>
    Effect.gen(function* () {
      const current = yield* issueOf(scope, scope.key)
      if (current.fields.status === undefined || current.fields.status === null) return
      const label = scope.options?.['archiveStatus']?.trim()
      yield* transitionTo(scope, current.id, current.fields.status, { status: 'dropped', ...(label !== undefined && label !== '' && { label }) })
    })

  const pull = (input: PullInput) =>
    Effect.gen(function* () {
      const failure = invalidOption(input.options)
      if (Option.isSome(failure)) return yield* failure.value
      const project = yield* projectOf(input)
      const site = yield* client.siteOf(input.connection)
      const token = input.page === null ? Option.none() : Schema.decodeUnknownOption(pageTokenSchema)(input.page)
      const cursorInstant = input.cursor === null ? undefined : Number(input.cursor)
      const since =
        cursorInstant === undefined || !Number.isFinite(cursorInstant) ? undefined : JiraMapping.jqlDate(cursorInstant, yield* timeZoneOf(input.connection))
      const jql = JiraMapping.searchJql({ project, extra: input.options?.['jql'], since, openOnly: input.openOnly })
      const listed = yield* Effect.flatMap(
        client.request({
          connection: input.connection,
          method: 'POST',
          path: '/search/jql',
          body: {
            jql,
            fields: fieldsFor(input.options),
            maxResults: PAGE_SIZE,
            ...(Option.isSome(token) && { nextPageToken: token.value.token }),
          },
          operation: 'search-issues',
        }),
        decode(searchSchema, 'search/jql'),
      )
      const issues = listed.issues.flatMap(result => Option.toArray(Schema.decodeUnknownOption(JiraMapping.issueSchema)(result)))
      const records = issues.map(issue => toCanonical({ issue, site, options: input.options }))
      const newestSoFar = Option.isSome(token) ? token.value.newest : (cursorInstant ?? 0)
      const newest = records.reduce((latest, record) => Math.max(latest, record.updatedAt), newestSoFar)
      const more = listed.isLast !== true && listed.nextPageToken !== undefined && listed.nextPageToken !== null && listed.nextPageToken !== ''
      const nextPage = more ? yield* Schema.encodeEffect(pageTokenSchema)({ token: listed.nextPageToken ?? '', newest }).pipe(Effect.orDie) : null
      return {
        records: input.fields.includes('body') ? records : records.map(record => ({ ...record, body: '' })),
        nextPage,
        checkpoint: nextPage === null ? (newest === 0 ? input.cursor : String(newest)) : null,
        complete: input.cursor === null && !input.openOnly,
      }
    })

  const identity = (connection: ProviderConnection) =>
    Effect.gen(function* () {
      const source = yield* client.credentialSource(connection)
      const me = yield* myself(connection)
      return { account: me.displayName ?? 'Jira account', credentialSource: source, containers: yield* discover(connection) }
    })

  const fetch = (scope: Scope & { readonly key: string; readonly fields: readonly ProviderField[] }) => recordOf(scope, scope.key, true)

  const resolve = (scope: Scope & { readonly reference: string }) => {
    const key = JiraMapping.keyOfReference(scope.reference)
    return key === undefined ? Effect.fail(failed('not-found', scope.reference.slice(0, 200))) : recordOf(scope, key, true)
  }

  const provider: BacklogProvider & { readonly remove: NonNullable<BacklogProvider['remove']> } = {
    descriptor,
    identity,
    pull,
    fetch,
    resolve,
    push,
    create,
    comment,
    remove,
  }
  return provider
})

export class JiraProvider {
  static readonly descriptor = descriptor
  static readonly allFields = allFields
}
