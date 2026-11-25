import { Effect, Schema } from 'effect'
import { HttpClient, HttpClientResponse, type HttpClientRequest } from 'effect/http'

/** A request the fake saw: never a real network call. */
export interface FakeGiteaRequest {
  readonly method: string
  readonly path: string
  readonly query: Readonly<Record<string, string>>
  readonly authorized: boolean
  /** The body decoded as JSON, for assertions; null when there is none. */
  readonly json: unknown
}

interface FakeLabel {
  readonly id: number
  readonly name: string
  readonly color: string
}

interface FakeIssue {
  readonly id: number
  readonly number: number
  readonly repository: string
  title: string
  body: string
  state: 'open' | 'closed'
  labels: number[]
  updated: number
  isPull: boolean
  comments: { id: number; body: string; author: string; created: number }[]
  /** Numbers (same repository) of the issues this one depends on. */
  dependsOn: Set<number>
}

const TOKEN = 'gitea_fake_token'
const DEFAULT_SITE = 'https://git.example.com'
const REPOSITORY = 'acme/app'
const LOGIN = 'ada'
const EPOCH = Date.UTC(2026, 0, 1)
/** Gitea's default `MAX_RESPONSE_ITEMS`: a larger `limit` is cut to it. */
const MAX_ITEMS = 50

const jsonSchema = Schema.fromJsonString(Schema.Unknown)
const bodySchema = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  body: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(Schema.Literals(['open', 'closed'])),
  closed: Schema.optionalKey(Schema.Boolean),
  labels: Schema.optionalKey(Schema.Array(Schema.Number)),
  name: Schema.optionalKey(Schema.String),
  color: Schema.optionalKey(Schema.String),
  owner: Schema.optionalKey(Schema.String),
  repo: Schema.optionalKey(Schema.String),
  index: Schema.optionalKey(Schema.Number),
})

const textOf = (request: HttpClientRequest.HttpClientRequest): string => (request.body._tag === 'Uint8Array' ? new TextDecoder().decode(request.body.body) : '')

const respond = <T>(request: HttpClientRequest.HttpClientRequest, status: number, value: T, headers: Record<string, string> = {}) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } }),
  )

/** Gitea's timestamp shape: RFC 3339 with a zone offset, here +01:00, so a string comparison would mislead. */
const giteaTime = (instant: number): string => {
  const shifted = new Date(instant + 60 * 60_000).toISOString().replace(/\.\d{3}Z$/u, '')
  return `${shifted}+01:00`
}

/**
 * An in-memory Gitea instance at https://git.example.com: repository acme/app with issues, a pull request, labels,
 * comments and issue dependencies, `since=` filtering on `updated_unix >=`, `limit` capped at 50, a token check, the
 * `read:user` scope on demand, and 429s on demand.
 */
export const fakeGitea = () => {
  const issues = new Map<number, FakeIssue>()
  const labels = new Map<number, FakeLabel>()
  const requests: FakeGiteaRequest[] = []
  /** `site` is the web root issue URLs use: a loopback journey sets it to the server it serves the fake on. */
  const state = { rateLimitNext: 0, retryAfter: '1', minute: 0, userScope: true, dependenciesEnabled: true, secondRepository: false, site: DEFAULT_SITE }
  let nextId = 1
  let nextNumber = 1
  let nextLabel = 1
  let nextComment = 1

  const tick = (): number => {
    state.minute += 1
    return EPOCH + state.minute * 60_000
  }

  const label = (name: string): FakeLabel => {
    const created = { id: nextLabel++, name, color: '#000000' }
    labels.set(created.id, created)
    return created
  }

  const add = (input: {
    readonly title: string
    readonly body?: string
    readonly state?: 'open' | 'closed'
    readonly labels?: readonly string[]
    readonly isPull?: boolean
  }): FakeIssue => {
    const ids = (input.labels ?? []).map(name => ([...labels.values()].find(existing => existing.name === name) ?? label(name)).id)
    const issue: FakeIssue = {
      id: nextId++,
      number: nextNumber++,
      repository: REPOSITORY,
      title: input.title,
      body: input.body ?? '',
      state: input.state ?? 'open',
      labels: ids,
      updated: tick(),
      isPull: input.isPull ?? false,
      comments: [],
      dependsOn: new Set(),
    }
    issues.set(issue.number, issue)
    return issue
  }

  const touch = (issue: FakeIssue) => {
    issue.updated = tick()
  }

  const issueJson = (issue: FakeIssue) => ({
    id: issue.id,
    number: issue.number,
    html_url: `${state.site}/${issue.repository}/${issue.isPull ? 'pulls' : 'issues'}/${String(issue.number)}`,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    labels: issue.labels.flatMap(id => {
      const found = labels.get(id)
      return found === undefined ? [] : [{ id: found.id, name: found.name, color: found.color }]
    }),
    updated_at: giteaTime(issue.updated),
    pull_request: issue.isPull ? { merged: false } : null,
    repository: { id: 1, name: 'app', owner: 'acme', full_name: issue.repository },
  })

  const commentJson = (comment: FakeIssue['comments'][number]) => ({
    id: comment.id,
    body: comment.body,
    user: { login: comment.author },
    created_at: giteaTime(comment.created),
  })

  const handle = (request: HttpClientRequest.HttpClientRequest) => {
    const url = new URL(request.url)
    const path = url.pathname.replace(/^\/api\/v1/u, '')
    const query = Object.fromEntries(request.urlParams.params.map(([name, value]) => [name, typeof value === 'string' ? value : ''] as const))
    const text = textOf(request)
    const SITE = state.site
    const authorized = request.headers['authorization'] === `token ${TOKEN}`
    requests.push({ method: request.method, path, query, authorized, json: text === '' ? null : Schema.decodeUnknownSync(jsonSchema)(text) })
    if (!authorized) return respond(request, 401, { message: 'token is required', url: `${SITE}/api/swagger` })
    if (state.rateLimitNext > 0) {
      state.rateLimitNext -= 1
      return respond(request, 429, { message: 'rate limited' }, { 'retry-after': state.retryAfter })
    }
    const body = text === '' ? {} : Schema.decodeUnknownSync(Schema.fromJsonString(bodySchema))(text)
    const notFound = () => respond(request, 404, { message: 'The target couldn’t be found.', errors: [] })
    const page = Math.max(1, Number(query['page'] ?? '1'))
    const limit = Math.min(MAX_ITEMS, Number(query['limit'] ?? '30'))
    const paged = <T>(items: readonly T[]) => items.slice((page - 1) * limit, page * limit)

    if (path === '/user') {
      if (!state.userScope)
        return respond(request, 403, { message: 'token does not have at least one of required scope(s), required=[read:user]', url: `${SITE}/api/swagger` })
      return respond(request, 200, { id: 1, login: LOGIN })
    }
    if (path === '/repos/search')
      return respond(request, 200, {
        ok: true,
        data: paged([
          { full_name: REPOSITORY, html_url: `${SITE}/${REPOSITORY}`, has_issues: true, archived: false },
          { full_name: 'acme/old', html_url: `${SITE}/acme/old`, has_issues: true, archived: true },
          { full_name: 'acme/wiki', html_url: `${SITE}/acme/wiki`, has_issues: false, archived: false },
          ...(state.secondRepository ? [{ full_name: 'acme/lib', html_url: `${SITE}/acme/lib`, has_issues: true, archived: false }] : []),
        ]),
      })
    const repo = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/u.exec(path)
    if (repo === null || `${decodeURIComponent(repo[1] ?? '')}/${decodeURIComponent(repo[2] ?? '')}` !== REPOSITORY) return notFound()
    const rest = repo[3] ?? ''

    if (rest === '/labels') {
      if (request.method === 'POST') {
        if (body.name === undefined || body.color === undefined) return respond(request, 422, { message: 'name and color are required' })
        const created = label(body.name)
        return respond(request, 201, created)
      }
      return respond(request, 200, paged([...labels.values()]))
    }
    if (rest === '/issues' && request.method === 'GET') {
      const since = query['since'] === undefined ? 0 : Date.parse(query['since'])
      const wanted = query['state'] ?? 'open'
      const found = [...issues.values()]
        .filter(issue => (query['type'] === 'issues' ? !issue.isPull : true))
        .filter(issue => wanted === 'all' || issue.state === wanted)
        .filter(issue => Math.floor(issue.updated / 1000) >= Math.floor(since / 1000))
        // Gitea lists newest first: the provider must not rely on an order.
        .sort((left, right) => right.updated - left.updated)
      return respond(request, 200, paged(found).map(issueJson))
    }
    if (rest === '/issues' && request.method === 'POST') {
      const created = add({ title: body.title ?? '', body: body.body ?? '', state: body.closed === true ? 'closed' : 'open' })
      created.labels = [...(body.labels ?? [])]
      return respond(request, 201, issueJson(created))
    }
    const match = /^\/issues\/(\d+)(\/comments|\/labels|\/dependencies|\/blocks)?$/u.exec(rest)
    const issue = match?.[1] === undefined ? undefined : issues.get(Number(match[1]))
    if (match === null || issue === undefined) return notFound()
    const section = match[2]
    if (section === '/comments') {
      if (request.method === 'GET') return respond(request, 200, paged(issue.comments).map(commentJson))
      const comment = { id: nextComment++, body: body.body ?? '', author: LOGIN, created: tick() }
      issue.comments.push(comment)
      return respond(request, 201, commentJson(comment))
    }
    if (section === '/labels' && request.method === 'PUT') {
      if ((body.labels ?? []).some(id => !labels.has(id))) return respond(request, 422, { message: 'label does not exist' })
      issue.labels = [...(body.labels ?? [])]
      touch(issue)
      return respond(request, 200, issueJson(issue).labels)
    }
    if (section === '/dependencies' || section === '/blocks') {
      if (!state.dependenciesEnabled) return respond(request, 404, { message: 'Issue dependencies are disabled' })
      if (request.method === 'GET') {
        const list =
          section === '/dependencies'
            ? [...issue.dependsOn].flatMap(number => issues.get(number) ?? [])
            : [...issues.values()].filter(other => other.dependsOn.has(issue.number))
        return respond(request, 200, list.map(issueJson))
      }
      const other = body.index === undefined ? undefined : issues.get(body.index)
      if (other === undefined || `${body.owner ?? ''}/${body.repo ?? ''}` !== REPOSITORY) return notFound()
      const [blocked, blocker] = section === '/dependencies' ? [issue, other] : [other, issue]
      if (request.method === 'POST') blocked.dependsOn.add(blocker.number)
      else blocked.dependsOn.delete(blocker.number)
      touch(blocked)
      return respond(request, 201, issueJson(blocked))
    }
    if (request.method === 'PATCH') {
      if (body.title !== undefined) issue.title = body.title
      if (body.body !== undefined) issue.body = body.body
      if (body.state !== undefined) issue.state = body.state
      touch(issue)
      return respond(request, 201, issueJson(issue))
    }
    return respond(request, 200, issueJson(issue))
  }

  const client = HttpClient.make(request => Effect.sync(() => handle(request)))

  return {
    client,
    issues,
    labels,
    requests,
    state,
    add,
    label,
    token: TOKEN,
    site: DEFAULT_SITE,
    repository: REPOSITORY,
    login: LOGIN,
    /** The instant of the fake's n-th minute. */
    minute: (minute: number) => EPOCH + minute * 60_000,
  }
}
