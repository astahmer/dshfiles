import { Effect, Option, Schema } from 'effect'
import { HttpClient, HttpClientResponse, type HttpClientRequest } from 'effect/http'
import { JiraAdf, type AdfNode } from './jira-adf.js'

/** A request the fake saw: never a real network call. */
export interface FakeJiraRequest {
  readonly method: string
  readonly path: string
  readonly query: Readonly<Record<string, string>>
  readonly authorized: boolean
  /** The body decoded as JSON, for assertions; null when there is none. */
  readonly json: unknown
}

interface FakeStatus {
  readonly id: string
  readonly name: string
  readonly category: 'new' | 'indeterminate' | 'done'
}

/** A custom field's value: ADF for a paragraph field, a string for a text field. */
type FakeCustomValue = AdfNode | string | null

interface FakeIssue {
  readonly id: string
  readonly key: string
  summary: string
  description: AdfNode | null
  status: FakeStatus
  labels: string[]
  priority: string | null
  parent: string | null
  duedate: string | null
  issuetype: string
  custom: Record<string, FakeCustomValue>
  updated: number
  comments: { id: string; body: AdfNode; author: string; created: number }[]
}

interface FakeLink {
  readonly id: string
  readonly type: string
  /** The link's source: "source blocks destination". */
  readonly source: string
  readonly destination: string
}

const EMAIL = 'ada@example.com'
const TOKEN = 'jira_fake_token'
const PROJECT = { id: '10000', key: 'ENG', name: 'Engineering' }
/** The fake account's profile time zone, +05:30 without daylight saving: JQL dates are read in it. */
const TIME_ZONE = 'Asia/Kolkata'
const ZONE_OFFSET_MINUTES = 330
const EPOCH = Date.UTC(2026, 0, 1)

const statuses = {
  backlog: { id: '10', name: 'Backlog', category: 'new' },
  progress: { id: '20', name: 'In Progress', category: 'indeterminate' },
  review: { id: '21', name: 'In Review', category: 'indeterminate' },
  done: { id: '30', name: 'Done', category: 'done' },
  wontDo: { id: '31', name: "Won't Do", category: 'done' },
  archived: { id: '32', name: 'Archived', category: 'done' },
} as const satisfies Record<string, FakeStatus>

/** The workflow: Backlog has no direct Done (two hops through In Progress), Archived is a dead end. */
const workflow = new Map<string, readonly { readonly id: string; readonly name: string; readonly to: FakeStatus }[]>([
  [
    statuses.backlog.id,
    [
      { id: '11', name: 'Start', to: statuses.progress },
      { id: '12', name: "Won't do", to: statuses.wontDo },
    ],
  ],
  [
    statuses.progress.id,
    [
      { id: '21', name: 'Review', to: statuses.review },
      { id: '22', name: 'Finish', to: statuses.done },
      { id: '23', name: 'Stop', to: statuses.backlog },
    ],
  ],
  [
    statuses.review.id,
    [
      { id: '31', name: 'Approve', to: statuses.done },
      { id: '32', name: 'Rework', to: statuses.progress },
    ],
  ],
  [statuses.done.id, [{ id: '41', name: 'Reopen', to: statuses.backlog }]],
  [statuses.wontDo.id, [{ id: '51', name: 'Reopen', to: statuses.backlog }]],
  [statuses.archived.id, []],
])

const linkTypes = new Map([
  ['Blocks', { inward: 'is blocked by', outward: 'blocks' }],
  ['Relates', { inward: 'relates to', outward: 'relates to' }],
  ['Duplicate', { inward: 'is duplicated by', outward: 'duplicates' }],
])

const issueRefSchema = Schema.Struct({ id: Schema.optionalKey(Schema.String), key: Schema.optionalKey(Schema.String) })
const bodySchema = Schema.Struct({
  jql: Schema.optionalKey(Schema.String),
  maxResults: Schema.optionalKey(Schema.Number),
  nextPageToken: Schema.optionalKey(Schema.String),
  fields: Schema.optionalKey(Schema.Union([Schema.Record(Schema.String, Schema.Unknown), Schema.Array(Schema.String)])),
  update: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  transition: Schema.optionalKey(Schema.Struct({ id: Schema.String })),
  body: Schema.optionalKey(Schema.Unknown),
  type: Schema.optionalKey(Schema.Struct({ name: Schema.String })),
  inwardIssue: Schema.optionalKey(issueRefSchema),
  outwardIssue: Schema.optionalKey(issueRefSchema),
})
const fieldsSchema = Schema.Struct({
  summary: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.NullOr(Schema.Unknown)),
  labels: Schema.optionalKey(Schema.Array(Schema.String)),
  priority: Schema.optionalKey(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
  parent: Schema.optionalKey(Schema.NullOr(issueRefSchema)),
  duedate: Schema.optionalKey(Schema.NullOr(Schema.String)),
  issuetype: Schema.optionalKey(Schema.Struct({ name: Schema.String })),
  project: Schema.optionalKey(Schema.Struct({ key: Schema.String })),
})
const jsonSchema = Schema.fromJsonString(Schema.Unknown)
const decodeAdf = Schema.decodeUnknownOption(JiraAdf.nodeSchema)

const textOf = (request: HttpClientRequest.HttpClientRequest): string => (request.body._tag === 'Uint8Array' ? new TextDecoder().decode(request.body.body) : '')

const respond = <T>(request: HttpClientRequest.HttpClientRequest, status: number, value: T, headers: Record<string, string> = {}) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } }),
  )

const jiraTime = (instant: number): string => new Date(instant).toISOString().replace('Z', '+0000')

const paragraphDoc = (text: string): AdfNode => ({
  version: 1,
  type: 'doc',
  content: text === '' ? [] : [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/**
 * An in-memory Jira Cloud site: project ENG, a workflow with categories and a two-hop path, issues with ADF
 * descriptions, labels, priorities, parents, Blocks/Relates/Duplicate links, due dates, comments and custom fields,
 * `POST /search/jql` paging with `nextPageToken`, JQL `updated >=` read in the account's time zone, and 429s on demand.
 */
export const fakeJira = () => {
  const issues = new Map<string, FakeIssue>()
  const links = new Map<string, FakeLink>()
  const requests: FakeJiraRequest[] = []
  const state = { rateLimitNext: 0, retryAfter: '1', sameMinute: false, minute: 0, second: 0 }
  let nextIssue = 1
  let nextLink = 1
  let nextComment = 1

  const tick = (): number => {
    if (state.sameMinute) state.second += 1
    else {
      state.minute += 1
      state.second = 0
    }
    return EPOCH + state.minute * 60_000 + state.second * 1_000
  }

  const byRef = (ref: string | undefined): FakeIssue | undefined =>
    ref === undefined ? undefined : (issues.get(ref) ?? [...issues.values()].find(issue => issue.key === ref.toUpperCase()))

  const add = (input: {
    readonly summary: string
    readonly status?: keyof typeof statuses
    readonly description?: AdfNode | string | null
    readonly labels?: readonly string[]
    readonly priority?: string | null
    readonly parent?: string
    readonly duedate?: string | null
    readonly issuetype?: string
    readonly custom?: Readonly<Record<string, FakeCustomValue>>
  }): FakeIssue => {
    const number = nextIssue++
    const issue: FakeIssue = {
      id: String(10_000 + number),
      key: `${PROJECT.key}-${String(number)}`,
      summary: input.summary,
      description: typeof input.description === 'string' ? paragraphDoc(input.description) : (input.description ?? null),
      status: statuses[input.status ?? 'backlog'],
      labels: [...(input.labels ?? [])],
      priority: input.priority === undefined ? 'Medium' : input.priority,
      parent: input.parent ?? null,
      duedate: input.duedate ?? null,
      issuetype: input.issuetype ?? 'Task',
      custom: { ...input.custom },
      updated: tick(),
      comments: [],
    }
    issues.set(issue.id, issue)
    return issue
  }

  const touch = (issue: FakeIssue) => {
    issue.updated = tick()
  }

  const link = (input: { readonly type: string; readonly source: string; readonly destination: string }): FakeLink => {
    const created = { id: String(nextLink++), ...input }
    links.set(created.id, created)
    return created
  }

  const issueJson = (issue: FakeIssue) => {
    const brief = (id: string) => {
      const other = issues.get(id)
      return other === undefined ? undefined : { id: other.id, key: other.key }
    }
    const parent = issue.parent === null ? null : (brief(issue.parent) ?? null)
    return {
      id: issue.id,
      key: issue.key,
      self: `https://acme.atlassian.net/rest/api/3/issue/${issue.id}`,
      fields: {
        summary: issue.summary,
        description: issue.description,
        status: { id: issue.status.id, name: issue.status.name, statusCategory: { key: issue.status.category } },
        labels: issue.labels,
        priority: issue.priority === null ? null : { name: issue.priority },
        parent,
        issuelinks: [...links.values()].flatMap((entry): object[] => {
          const type = { name: entry.type, ...linkTypes.get(entry.type) }
          if (entry.source === issue.id) return [{ id: entry.id, type, outwardIssue: brief(entry.destination) }]
          if (entry.destination === issue.id) return [{ id: entry.id, type, inwardIssue: brief(entry.source) }]
          return []
        }),
        duedate: issue.duedate,
        issuetype: { name: issue.issuetype },
        updated: jiraTime(issue.updated),
        ...issue.custom,
      },
    }
  }

  const commentJson = (comment: FakeIssue['comments'][number]) => ({
    id: comment.id,
    body: comment.body,
    author: { accountId: 'acc-1', displayName: comment.author },
    created: jiraTime(comment.created),
  })

  /** `yyyy-MM-dd HH:mm` in the account's time zone, as an instant. */
  const jqlInstant = (text: string): number => {
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/u.exec(text)
    if (match === null) throw new Error(`The fake Jira cannot read the JQL date ${text}.`)
    const [, year, month, day, hour, minute] = match.map(Number)
    return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0) - ZONE_OFFSET_MINUTES * 60_000
  }

  /** The JQL the provider writes: project, an optional `(labels = x)`, `updated >= "…"`, `statusCategory != Done`. */
  const search = (jql: string): FakeIssue[] => {
    const project = /project = "([A-Z0-9_]+)"/u.exec(jql)?.[1]
    const since = /updated >= "([^"]+)"/u.exec(jql)?.[1]
    const label = /\(labels = ([\w-]+)\)/u.exec(jql)?.[1]
    const openOnly = jql.includes('statusCategory != Done')
    return [...issues.values()]
      .filter(
        issue =>
          issue.key.startsWith(`${project ?? ''}-`) &&
          (since === undefined || issue.updated >= jqlInstant(since)) &&
          (label === undefined || issue.labels.includes(label)) &&
          (!openOnly || issue.status.category !== 'done'),
      )
      .sort((left, right) => left.updated - right.updated || left.id.localeCompare(right.id))
  }

  const applyFields = (issue: FakeIssue, fields: NonNullable<(typeof bodySchema.Type)['fields']>) => {
    if (Array.isArray(fields)) return
    const known = Schema.decodeUnknownSync(fieldsSchema)(fields)
    if (known.summary !== undefined) issue.summary = known.summary
    if (known.description !== undefined) issue.description = Option.getOrNull(decodeAdf(known.description))
    if (known.labels !== undefined) issue.labels = [...known.labels]
    if (known.priority !== undefined) issue.priority = known.priority?.name ?? null
    if (known.parent !== undefined) issue.parent = byRef(known.parent?.id ?? known.parent?.key)?.id ?? null
    if (known.duedate !== undefined) issue.duedate = known.duedate
    if (known.issuetype !== undefined) issue.issuetype = known.issuetype.name
    for (const [field, value] of Object.entries(fields))
      if (field.startsWith('customfield_')) issue.custom[field] = typeof value === 'string' || value === null ? value : Option.getOrNull(decodeAdf(value))
  }

  const handle = (request: HttpClientRequest.HttpClientRequest) => {
    const url = new URL(request.url)
    const path = url.pathname.replace(/^\/rest\/api\/3/u, '')
    const query = Object.fromEntries(request.urlParams.params.map(([name, value]) => [name, typeof value === 'string' ? value : ''] as const))
    const text = textOf(request)
    const authorized = request.headers['authorization'] === `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`
    requests.push({ method: request.method, path, query, authorized, json: text === '' ? null : Schema.decodeUnknownSync(jsonSchema)(text) })
    if (!authorized) return respond(request, 401, { errorMessages: ['Client must be authenticated to access this resource.'], errors: {} })
    if (state.rateLimitNext > 0) {
      state.rateLimitNext -= 1
      return respond(request, 429, { errorMessages: ['Rate limit exceeded.'] }, { 'retry-after': state.retryAfter })
    }
    const body = text === '' ? {} : Schema.decodeUnknownSync(Schema.fromJsonString(bodySchema))(text)
    const notFound = () => respond(request, 404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'], errors: {} })

    if (path === '/myself') return respond(request, 200, { accountId: 'acc-1', displayName: 'Ada Lovelace', emailAddress: EMAIL, timeZone: TIME_ZONE })
    if (path === '/project/search') return respond(request, 200, { startAt: 0, maxResults: 50, total: 1, isLast: true, values: [PROJECT] })
    if (path === '/search/jql' && request.method === 'POST') {
      const found = search(body.jql ?? '')
      const start = Number((body.nextPageToken ?? 'p:0').slice(2))
      const size = body.maxResults ?? 50
      const page = found.slice(start, start + size)
      const more = start + size < found.length
      return respond(request, 200, { issues: page.map(issueJson), isLast: !more, ...(more && { nextPageToken: `p:${String(start + size)}` }) })
    }
    if (path === '/issue' && request.method === 'POST') {
      const fields = body.fields ?? {}
      const project = Schema.decodeUnknownSync(fieldsSchema)(fields).project?.key
      if (project !== PROJECT.key) return respond(request, 400, { errorMessages: [], errors: { project: 'valid project is required' } })
      const issue = add({ summary: '' })
      applyFields(issue, fields)
      return respond(request, 201, { id: issue.id, key: issue.key, self: `https://acme.atlassian.net/rest/api/3/issue/${issue.id}` })
    }
    if (path === '/issueLink' && request.method === 'POST') {
      const source = byRef(body.inwardIssue?.id ?? body.inwardIssue?.key)
      const destination = byRef(body.outwardIssue?.id ?? body.outwardIssue?.key)
      if (source === undefined || destination === undefined || body.type === undefined || !linkTypes.has(body.type.name)) return notFound()
      link({ type: body.type.name, source: source.id, destination: destination.id })
      touch(source)
      touch(destination)
      return respond(request, 201, {})
    }
    const linkMatch = /^\/issueLink\/(\d+)$/u.exec(path)
    if (linkMatch?.[1] !== undefined && request.method === 'DELETE') {
      if (!links.delete(linkMatch[1])) return notFound()
      return respond(request, 204, null)
    }
    const match = /^\/issue\/([^/]+)(\/transitions|\/comment)?$/u.exec(path)
    const issue = byRef(match?.[1] === undefined ? undefined : decodeURIComponent(match[1]))
    if (match === null || issue === undefined) return notFound()
    if (match[2] === '/transitions') {
      if (request.method === 'GET')
        return respond(request, 200, {
          transitions: (workflow.get(issue.status.id) ?? []).map(transition => ({
            id: transition.id,
            name: transition.name,
            to: { id: transition.to.id, name: transition.to.name, statusCategory: { key: transition.to.category } },
          })),
        })
      const chosen = (workflow.get(issue.status.id) ?? []).find(transition => transition.id === body.transition?.id)
      if (chosen === undefined) return respond(request, 400, { errorMessages: ['Transition id is not valid for this issue.'], errors: {} })
      issue.status = chosen.to
      touch(issue)
      return respond(request, 204, null)
    }
    if (match[2] === '/comment') {
      if (request.method === 'GET')
        return respond(request, 200, { startAt: 0, maxResults: 100, total: issue.comments.length, comments: issue.comments.map(commentJson) })
      const comment = {
        id: String(nextComment++),
        body: Option.getOrElse(decodeAdf(body.body), () => paragraphDoc('')),
        author: 'Ada Lovelace',
        created: tick(),
      }
      issue.comments.push(comment)
      return respond(request, 201, commentJson(comment))
    }
    if (request.method === 'PUT') {
      applyFields(issue, body.fields ?? {})
      const parentUpdate = Schema.decodeUnknownOption(Schema.Array(Schema.Struct({ set: Schema.Struct({ none: Schema.Boolean }) })))(body.update?.['parent'])
      if (Option.isSome(parentUpdate) && parentUpdate.value[0]?.set.none === true) issue.parent = null
      touch(issue)
      return respond(request, 204, null)
    }
    return respond(request, 200, issueJson(issue))
  }

  const client = HttpClient.make(request => Effect.sync(() => handle(request)))

  return {
    client,
    issues,
    links,
    requests,
    state,
    statuses,
    add,
    link,
    email: EMAIL,
    token: TOKEN,
    project: PROJECT,
    timeZone: TIME_ZONE,
    /** The instant of the fake's n-th minute. */
    minute: (minute: number) => EPOCH + minute * 60_000,
  }
}
