import { Effect, Schema } from 'effect'
import { HttpClient, HttpClientResponse, type HttpClientRequest } from 'effect/http'

/** Requests a fake server saw, for assertions; never a real network call. */
export interface FakeRequest {
  readonly method: string
  readonly url: string
  readonly authorization: string | undefined
  readonly body: string
}

const textOf = (request: HttpClientRequest.HttpClientRequest): string => (request.body._tag === 'Uint8Array' ? new TextDecoder().decode(request.body.body) : '')

const json = <T>(request: HttpClientRequest.HttpClientRequest, status: number, value: T) =>
  HttpClientResponse.fromWeb(request, new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }))

const optionalString = Schema.optionalKey(Schema.String)
/** Every GraphQL body the Linear adapter sends, parsed the way a server would. */
const linearBody = Schema.fromJsonString(
  Schema.Struct({
    query: Schema.String,
    variables: Schema.Struct({
      id: optionalString,
      key: optionalString,
      input: Schema.optionalKey(
        Schema.Struct({
          teamId: optionalString,
          issueId: optionalString,
          title: optionalString,
          description: optionalString,
          body: optionalString,
          stateId: optionalString,
          labelIds: Schema.optionalKey(Schema.Array(Schema.String)),
        }),
      ),
    }),
  }),
)
/** Every REST body the GitHub adapter sends. */
const githubBody = Schema.fromJsonString(
  Schema.Struct({
    title: optionalString,
    body: optionalString,
    state: Schema.optionalKey(Schema.Literals(['open', 'closed'])),
    state_reason: Schema.optionalKey(Schema.String),
    labels: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
)

interface FakeLinearIssue {
  id: string
  identifier: string
  title: string
  description: string | null
  stateId: string
  labelIds: string[]
  updatedAt: number
  comments: { id: string; body: string; createdAt: number; user: { name: string } | null }[]
}

/**
 * An in-memory Linear GraphQL endpoint for one team `ENG`: the operations the adapter sends, answered from plain
 * objects. `now` stamps every write, so a test decides which side changed last.
 */
export const fakeLinear = () => {
  const states = [
    { id: 's-triage', type: 'triage', position: 0 },
    { id: 's-backlog', type: 'backlog', position: 1 },
    { id: 's-todo', type: 'unstarted', position: 2 },
    { id: 's-doing', type: 'started', position: 3 },
    { id: 's-done', type: 'completed', position: 4 },
    { id: 's-canceled', type: 'canceled', position: 5 },
  ]
  const labels = [
    { id: 'l-bug', name: 'Bug' },
    { id: 'l-ui', name: 'ui' },
    { id: 'l-sync', name: 'sync' },
  ]
  const requests: FakeRequest[] = []
  const state = { now: 1_000, status: 200, issues: new Map<string, FakeLinearIssue>(), requests, nextNumber: 1, nextComment: 1 }
  const typeOf = (stateId: string) => states.find(candidate => candidate.id === stateId)?.type ?? 'backlog'
  const view = (issue: FakeLinearIssue) => ({
    id: issue.id,
    identifier: issue.identifier,
    url: `https://linear.app/acme/issue/${issue.identifier}/slug`,
    title: issue.title,
    description: issue.description,
    updatedAt: new Date(issue.updatedAt).toISOString(),
    state: { type: typeOf(issue.stateId) },
    labels: { nodes: labels.filter(label => issue.labelIds.includes(label.id)).map(label => ({ name: label.name })) },
    comments: { nodes: issue.comments.map(comment => ({ ...comment, createdAt: new Date(comment.createdAt).toISOString() })) },
  })
  const find = (id: string) => [...state.issues.values()].find(issue => issue.id === id || issue.identifier === id)

  /** Adds an issue as if someone created it in Linear. */
  const seed = (input: { readonly title: string; readonly description?: string; readonly type?: string; readonly labels?: readonly string[] }) => {
    const number = state.nextNumber++
    const issue: FakeLinearIssue = {
      id: `issue-${String(number)}`,
      identifier: `ENG-${String(number)}`,
      title: input.title,
      description: input.description ?? null,
      stateId: states.find(candidate => candidate.type === (input.type ?? 'unstarted'))?.id ?? 's-todo',
      labelIds: labels.filter(label => input.labels?.includes(label.name) === true).map(label => label.id),
      updatedAt: state.now,
      comments: [],
    }
    state.issues.set(issue.id, issue)
    return issue
  }

  const remoteComment = (issue: FakeLinearIssue, body: string, author = 'Ada') => {
    issue.comments.push({ id: `comment-${String(state.nextComment++)}`, body, createdAt: state.now, user: { name: author } })
    issue.updatedAt = state.now
  }

  const answer = (query: string, variables: (typeof linearBody.Type)['variables']) => {
    if (query.includes('query BacklogTeam'))
      return { data: { teams: { nodes: [{ id: 'team-1', key: 'ENG', states: { nodes: states } }] }, issueLabels: { nodes: labels } } }
    if (query.includes('query BacklogIssue')) {
      const issue = find(variables.id ?? '')
      return issue === undefined ? { data: null, errors: [{ message: 'Entity not found: Issue' }] } : { data: { issue: view(issue) } }
    }
    if (query.includes('mutation BacklogCreate')) {
      const input = variables.input ?? {}
      const issue = seed({ title: input.title ?? '', description: input.description ?? '' })
      issue.stateId = input.stateId ?? issue.stateId
      issue.labelIds = [...(input.labelIds ?? [])]
      return { data: { issueCreate: { success: true, issue: view(issue) } } }
    }
    if (query.includes('mutation BacklogUpdate')) {
      const issue = find(variables.id ?? '')
      if (issue === undefined) return { data: null, errors: [{ message: 'Entity not found: Issue' }] }
      const input = variables.input ?? {}
      if (input.title !== undefined) issue.title = input.title
      if (input.description !== undefined) issue.description = input.description
      if (input.stateId !== undefined) issue.stateId = input.stateId
      if (input.labelIds !== undefined) issue.labelIds = [...input.labelIds]
      issue.updatedAt = state.now
      return { data: { issueUpdate: { success: true, issue: view(issue) } } }
    }
    if (query.includes('mutation BacklogComment')) {
      const input = variables.input ?? {}
      const issue = find(input.issueId ?? '')
      if (issue === undefined) return { data: null, errors: [{ message: 'Entity not found: Issue' }] }
      remoteComment(issue, input.body ?? '', 'Backlog bot')
      const created = issue.comments.at(-1)
      return {
        data: {
          commentCreate: { success: true, comment: created === undefined ? null : { ...created, createdAt: new Date(created.createdAt).toISOString() } },
        },
      }
    }
    return { errors: [{ message: 'unknown operation' }] }
  }

  const client = HttpClient.make(request =>
    Effect.sync(() => {
      const text = textOf(request)
      requests.push({ method: request.method, url: request.url, authorization: request.headers['authorization'], body: text })
      if (state.status !== 200) return json(request, state.status, { errors: [{ message: 'Authentication required' }] })
      const body = Schema.decodeUnknownSync(linearBody)(text)
      return json(request, 200, answer(body.query, body.variables))
    }),
  )

  const typeOfIssue = (id: string) => {
    const issue = find(id)
    return issue === undefined ? undefined : typeOf(issue.stateId)
  }

  const setType = (issue: FakeLinearIssue, type: string) => {
    issue.stateId = states.find(candidate => candidate.type === type)?.id ?? issue.stateId
    issue.updatedAt = state.now
  }

  return { state, client, seed, remoteComment, find, typeOfIssue, setType, labels }
}

interface FakeGithubIssue {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  state_reason: string | null
  labels: string[]
  updated_at: number
  comments: { id: number; body: string; created_at: number; user: { login: string } }[]
}

/** An in-memory GitHub REST API for one repository `acme/app`. */
export const fakeGithub = () => {
  const requests: FakeRequest[] = []
  const state = { now: 1_000, issues: new Map<number, FakeGithubIssue>(), requests, nextNumber: 1, nextComment: 100 }
  const view = (issue: FakeGithubIssue) => ({
    number: issue.number,
    html_url: `https://github.com/acme/app/issues/${String(issue.number)}`,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    state_reason: issue.state_reason,
    labels: issue.labels.map(name => ({ name })),
    updated_at: new Date(issue.updated_at).toISOString(),
  })
  const commentView = (comment: FakeGithubIssue['comments'][number]) => ({ ...comment, created_at: new Date(comment.created_at).toISOString() })
  const seed = (input: { readonly title: string; readonly body?: string; readonly labels?: readonly string[] }) => {
    const issue: FakeGithubIssue = {
      number: state.nextNumber++,
      title: input.title,
      body: input.body ?? null,
      state: 'open',
      state_reason: null,
      labels: [...(input.labels ?? [])],
      updated_at: state.now,
      comments: [],
    }
    state.issues.set(issue.number, issue)
    return issue
  }

  const client = HttpClient.make(request =>
    Effect.sync(() => {
      const text = textOf(request)
      requests.push({ method: request.method, url: request.url, authorization: request.headers['authorization'], body: text })
      const body = text === '' ? {} : Schema.decodeUnknownSync(githubBody)(text)
      const path = new URL(request.url).pathname
      const match = /^\/repos\/acme\/app\/issues(?:\/(\d+))?(\/comments)?$/u.exec(path)
      if (match === null) return json(request, 404, { message: 'Not Found' })
      const number = match[1] === undefined ? undefined : Number(match[1])
      const issue = number === undefined ? undefined : state.issues.get(number)
      if (number !== undefined && issue === undefined) return json(request, 404, { message: 'Not Found' })
      if (match[2] !== undefined && issue !== undefined) {
        if (request.method === 'GET') return json(request, 200, issue.comments.map(commentView))
        const comment = { id: state.nextComment++, body: body.body ?? '', created_at: state.now, user: { login: 'backlog-bot' } }
        issue.comments.push(comment)
        return json(request, 201, commentView(comment))
      }
      if (issue === undefined && request.method === 'POST') {
        const created = seed({ title: body.title ?? '', body: body.body ?? '' })
        created.labels = [...(body.labels ?? [])]
        return json(request, 201, view(created))
      }
      if (issue !== undefined && request.method === 'PATCH') {
        if (body.title !== undefined) issue.title = body.title
        if (body.body !== undefined) issue.body = body.body
        if (body.state !== undefined) issue.state = body.state
        if (body.state_reason !== undefined) issue.state_reason = body.state_reason
        if (body.state === 'open') issue.state_reason = null
        if (body.labels !== undefined) issue.labels = [...body.labels]
        issue.updated_at = state.now
        return json(request, 200, view(issue))
      }
      if (issue !== undefined) return json(request, 200, view(issue))
      return json(request, 404, { message: 'Not Found' })
    }),
  )
  return { state, client, seed }
}
