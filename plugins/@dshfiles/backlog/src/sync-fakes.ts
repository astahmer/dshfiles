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

const json = <T>(request: HttpClientRequest.HttpClientRequest, status: number, value: T, headers: Record<string, string> = {}) =>
  HttpClientResponse.fromWeb(
    request,
    status === 304 || status === 204
      ? new Response(null, { status, headers })
      : new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } }),
  )

const optionalString = Schema.optionalKey(Schema.String)
/** Every GraphQL body the Linear provider sends, parsed the way a server would. */
const linearBody = Schema.fromJsonString(
  Schema.Struct({
    query: Schema.String,
    variables: Schema.Struct({
      id: optionalString,
      key: optionalString,
      after: Schema.optionalKey(Schema.NullOr(Schema.String)),
      filter: Schema.optionalKey(
        Schema.Struct({
          updatedAt: Schema.optionalKey(Schema.Struct({ gt: Schema.String })),
          state: Schema.optionalKey(Schema.Struct({ type: Schema.Struct({ nin: Schema.Array(Schema.String) }) })),
        }),
      ),
      input: Schema.optionalKey(
        Schema.Struct({
          teamId: optionalString,
          issueId: optionalString,
          relatedIssueId: optionalString,
          type: optionalString,
          title: optionalString,
          description: optionalString,
          body: optionalString,
          stateId: optionalString,
          labelIds: Schema.optionalKey(Schema.Array(Schema.String)),
          priority: Schema.optionalKey(Schema.Number),
          parentId: Schema.optionalKey(Schema.NullOr(Schema.String)),
        }),
      ),
    }),
  }),
)
/** Every REST body the GitHub provider sends. */
const githubBody = Schema.fromJsonString(
  Schema.Struct({
    title: optionalString,
    body: optionalString,
    state: Schema.optionalKey(Schema.Literals(['open', 'closed'])),
    state_reason: Schema.optionalKey(Schema.String),
    labels: Schema.optionalKey(Schema.Array(Schema.String)),
    sub_issue_id: Schema.optionalKey(Schema.Number),
    replace_parent: Schema.optionalKey(Schema.Boolean),
    issue_id: Schema.optionalKey(Schema.Number),
  }),
)

interface FakeLinearIssue {
  id: string
  identifier: string
  title: string
  description: string | null
  stateId: string
  labelIds: string[]
  priority: number
  parentId: string | null
  updatedAt: number
  comments: { id: string; body: string; createdAt: number; user: { name: string } | null }[]
}

/**
 * An in-memory Linear GraphQL endpoint for one team `ENG`: the operations the provider sends, answered from plain
 * objects. `now` stamps every write, so a test decides which side changed last.
 */
export const fakeLinear = () => {
  const states = [
    { id: 's-triage', type: 'triage', name: 'Triage', position: 0 },
    { id: 's-backlog', type: 'backlog', name: 'Backlog', position: 1 },
    { id: 's-todo', type: 'unstarted', name: 'Todo', position: 2 },
    { id: 's-doing', type: 'started', name: 'In Progress', position: 3 },
    { id: 's-review', type: 'started', name: 'In Review', position: 4 },
    { id: 's-done', type: 'completed', name: 'Done', position: 5 },
    { id: 's-canceled', type: 'canceled', name: 'Canceled', position: 6 },
  ]
  const labels = [
    { id: 'l-bug', name: 'Bug' },
    { id: 'l-ui', name: 'ui' },
    { id: 'l-sync', name: 'sync' },
  ]
  const requests: FakeRequest[] = []
  const relations: { id: string; type: string; from: string; to: string }[] = []
  const state = {
    now: 1_000,
    status: 200,
    issues: new Map<string, FakeLinearIssue>(),
    requests,
    nextNumber: 1,
    nextComment: 1,
    nextRelation: 1,
    teams: [{ key: 'ENG', name: 'Engineering' }],
  }
  const stateOfId = (stateId: string) => states.find(candidate => candidate.id === stateId) ?? states[1]
  const view = (issue: FakeLinearIssue) => ({
    id: issue.id,
    identifier: issue.identifier,
    url: `https://linear.app/acme/issue/${issue.identifier}/slug`,
    title: issue.title,
    description: issue.description,
    updatedAt: new Date(issue.updatedAt).toISOString(),
    priority: issue.priority,
    state: { type: stateOfId(issue.stateId)?.type ?? 'backlog', name: stateOfId(issue.stateId)?.name ?? 'Backlog' },
    parent: issue.parentId === null ? null : { id: issue.parentId },
    labels: { nodes: labels.filter(label => issue.labelIds.includes(label.id)).map(label => ({ name: label.name })) },
    relations: {
      nodes: relations
        .filter(relation => relation.from === issue.id)
        .map(relation => ({ id: relation.id, type: relation.type, relatedIssue: { id: relation.to } })),
    },
    inverseRelations: {
      nodes: relations.filter(relation => relation.to === issue.id).map(relation => ({ id: relation.id, type: relation.type, issue: { id: relation.from } })),
    },
    comments: { nodes: issue.comments.map(comment => ({ ...comment, createdAt: new Date(comment.createdAt).toISOString() })) },
  })
  const find = (id: string) => [...state.issues.values()].find(issue => issue.id === id || issue.identifier === id)

  /** Adds an issue as if someone created it in Linear. */
  const seed = (input: {
    readonly title: string
    readonly description?: string
    readonly type?: string
    readonly labels?: readonly string[]
    readonly priority?: number
    readonly parentId?: string
  }) => {
    const number = state.nextNumber++
    const issue: FakeLinearIssue = {
      id: `issue-${String(number)}`,
      identifier: `ENG-${String(number)}`,
      title: input.title,
      description: input.description ?? null,
      stateId: states.find(candidate => candidate.type === (input.type ?? 'unstarted'))?.id ?? 's-todo',
      labelIds: labels.filter(label => input.labels?.includes(label.name) === true).map(label => label.id),
      priority: input.priority ?? 0,
      parentId: input.parentId ?? null,
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

  const relate = (input: { readonly from: FakeLinearIssue; readonly to: FakeLinearIssue; readonly type: string }) => {
    relations.push({ id: `relation-${String(state.nextRelation++)}`, type: input.type, from: input.from.id, to: input.to.id })
    input.from.updatedAt = state.now
  }

  const answer = (query: string, variables: (typeof linearBody.Type)['variables']) => {
    if (query.includes('query BacklogAccount')) return { data: { viewer: { name: 'Ada' }, teams: { nodes: state.teams } } }
    if (query.includes('query BacklogTeam'))
      return { data: { teams: { nodes: [{ id: 'team-1', key: 'ENG', states: { nodes: states } }] }, issueLabels: { nodes: labels } } }
    if (query.includes('query BacklogPull')) {
      const since = variables.filter?.updatedAt?.gt
      const excluded = variables.filter?.state?.type.nin ?? []
      const nodes = [...state.issues.values()]
        .filter(issue => (since === undefined || issue.updatedAt > Date.parse(since)) && !excluded.includes(stateOfId(issue.stateId)?.type ?? ''))
        .map(view)
      return { data: { issues: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } }
    }
    if (query.includes('query BacklogIssue')) {
      const issue = find(variables.id ?? '')
      return issue === undefined ? { data: null, errors: [{ message: 'Entity not found: Issue' }] } : { data: { issue: view(issue) } }
    }
    if (query.includes('mutation BacklogCreate')) {
      const input = variables.input ?? {}
      const issue = seed({ title: input.title ?? '', description: input.description ?? '' })
      issue.stateId = input.stateId ?? issue.stateId
      issue.labelIds = [...(input.labelIds ?? [])]
      issue.priority = input.priority ?? 0
      issue.parentId = input.parentId ?? null
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
      if (input.priority !== undefined) issue.priority = input.priority
      if (input.parentId !== undefined) issue.parentId = input.parentId
      issue.updatedAt = state.now
      return { data: { issueUpdate: { success: true, issue: view(issue) } } }
    }
    if (query.includes('mutation BacklogRelationCreate')) {
      const input = variables.input ?? {}
      const from = find(input.issueId ?? '')
      const to = find(input.relatedIssueId ?? '')
      if (from === undefined || to === undefined) return { data: null, errors: [{ message: 'Entity not found: Issue' }] }
      relate({ from, to, type: input.type ?? 'related' })
      return { data: { issueRelationCreate: { success: true } } }
    }
    if (query.includes('mutation BacklogRelationDelete')) {
      const index = relations.findIndex(relation => relation.id === variables.id)
      if (index >= 0) relations.splice(index, 1)
      return { data: { issueRelationDelete: { success: index >= 0 } } }
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
    return issue === undefined ? undefined : stateOfId(issue.stateId)?.type
  }
  const stateNameOf = (id: string) => {
    const issue = find(id)
    return issue === undefined ? undefined : stateOfId(issue.stateId)?.name
  }

  const setType = (issue: FakeLinearIssue, type: string) => {
    issue.stateId = states.find(candidate => candidate.type === type)?.id ?? issue.stateId
    issue.updatedAt = state.now
  }

  return { state, client, seed, remoteComment, relate, relations, find, typeOfIssue, stateNameOf, setType, labels }
}

interface FakeGithubIssue {
  id: number
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  state_reason: string | null
  labels: string[]
  parent: number | null
  blockedBy: number[]
  updated_at: number
  comments: { id: number; body: string; created_at: number; user: { login: string } }[]
}

/** An in-memory GitHub REST API for one repository `acme/app`, with sub-issues, dependencies and ETags on the issue list. */
export const fakeGithub = () => {
  const requests: FakeRequest[] = []
  const state = { now: 1_000, issues: new Map<number, FakeGithubIssue>(), requests, nextNumber: 1, nextComment: 100, version: 0 }
  const htmlUrl = (number: number) => `https://github.com/acme/app/issues/${String(number)}`
  const byId = (id: number) => [...state.issues.values()].find(issue => issue.id === id)
  const blocking = (issue: FakeGithubIssue) => [...state.issues.values()].filter(other => other.blockedBy.includes(issue.number))
  const view = (issue: FakeGithubIssue) => ({
    id: issue.id,
    number: issue.number,
    html_url: htmlUrl(issue.number),
    title: issue.title,
    body: issue.body,
    state: issue.state,
    state_reason: issue.state_reason,
    labels: issue.labels.map(name => ({ name })),
    updated_at: new Date(issue.updated_at).toISOString(),
    parent_issue_url: issue.parent === null ? null : `https://api.github.com/repos/acme/app/issues/${String(issue.parent)}`,
    issue_dependencies_summary: { blocked_by: issue.blockedBy.length, blocking: blocking(issue).length },
  })
  const linkedView = (issue: FakeGithubIssue) => ({ id: issue.id, number: issue.number, html_url: htmlUrl(issue.number) })
  const commentView = (comment: FakeGithubIssue['comments'][number]) => ({ ...comment, created_at: new Date(comment.created_at).toISOString() })
  const touch = (issue: FakeGithubIssue) => {
    issue.updated_at = state.now
    state.version += 1
  }
  const seed = (input: { readonly title: string; readonly body?: string; readonly labels?: readonly string[]; readonly closed?: boolean }) => {
    const number = state.nextNumber++
    const issue: FakeGithubIssue = {
      id: 5_000 + number,
      number,
      title: input.title,
      body: input.body ?? null,
      state: input.closed === true ? 'closed' : 'open',
      state_reason: input.closed === true ? 'completed' : null,
      labels: [...(input.labels ?? [])],
      parent: null,
      blockedBy: [],
      updated_at: state.now,
      comments: [],
    }
    state.issues.set(issue.number, issue)
    state.version += 1
    return issue
  }

  const client = HttpClient.make(request =>
    Effect.sync(() => {
      const text = textOf(request)
      requests.push({ method: request.method, url: request.url, authorization: request.headers['authorization'], body: text })
      const body = text === '' ? {} : Schema.decodeUnknownSync(githubBody)(text)
      const url = new URL(request.url)
      const path = url.pathname
      if (path === '/user') return json(request, 200, { login: request.headers['authorization'] === 'Bearer perso_token' ? 'octo-perso' : 'octocat' })
      if (path === '/user/repos') return json(request, 200, [{ full_name: 'acme/app', html_url: 'https://github.com/acme/app' }])
      if (path === '/repos/acme/app') return json(request, 200, { full_name: 'acme/app' })
      if (path === '/repos/acme/app/issues' && request.method === 'GET') {
        const etag = `W/"${String(state.version)}-${url.search}"`
        if (request.headers['if-none-match'] === etag) return json(request, 304, null, { etag })
        const since = url.searchParams.get('since')
        const openOnly = url.searchParams.get('state') === 'open'
        const listed = [...state.issues.values()]
          .filter(issue => (since === null || issue.updated_at >= Date.parse(since)) && (!openOnly || issue.state === 'open'))
          .sort((left, right) => left.updated_at - right.updated_at)
          .map(view)
        return json(request, 200, listed, { etag })
      }
      const match =
        /^\/repos\/acme\/app\/issues(?:\/(\d+))?(\/comments|\/sub_issues|\/sub_issue|\/dependencies\/blocked_by|\/dependencies\/blocking)?(?:\/(\d+))?$/u.exec(
          path,
        )
      if (match === null) return json(request, 404, { message: 'Not Found' })
      const number = match[1] === undefined ? undefined : Number(match[1])
      const issue = number === undefined ? undefined : state.issues.get(number)
      if (number !== undefined && issue === undefined) return json(request, 404, { message: 'Not Found' })
      const suffix = match[2]
      if (suffix === '/comments' && issue !== undefined) {
        if (request.method === 'GET') return json(request, 200, issue.comments.map(commentView))
        const comment = { id: state.nextComment++, body: body.body ?? '', created_at: state.now, user: { login: 'backlog-bot' } }
        issue.comments.push(comment)
        touch(issue)
        return json(request, 201, commentView(comment))
      }
      if (suffix === '/sub_issues' && issue !== undefined && request.method === 'POST') {
        const child = byId(body.sub_issue_id ?? -1)
        if (child === undefined) return json(request, 422, { message: 'no such sub-issue' })
        child.parent = issue.number
        touch(child)
        return json(request, 201, view(issue))
      }
      if (suffix === '/sub_issue' && issue !== undefined && request.method === 'DELETE') {
        const child = byId(body.sub_issue_id ?? -1)
        if (child !== undefined) {
          child.parent = null
          touch(child)
        }
        return json(request, 200, view(issue))
      }
      if (suffix === '/dependencies/blocked_by' && issue !== undefined) {
        if (request.method === 'GET')
          return json(
            request,
            200,
            issue.blockedBy.flatMap(blocker => {
              const found = state.issues.get(blocker)
              return found === undefined ? [] : [linkedView(found)]
            }),
          )
        if (request.method === 'POST') {
          const blocker = byId(body.issue_id ?? -1)
          if (blocker === undefined) return json(request, 422, { message: 'no such issue' })
          if (!issue.blockedBy.includes(blocker.number)) issue.blockedBy.push(blocker.number)
          touch(issue)
          return json(request, 201, view(issue))
        }
        if (request.method === 'DELETE') {
          const blocker = byId(Number(match[3]))
          issue.blockedBy = issue.blockedBy.filter(candidate => candidate !== blocker?.number)
          touch(issue)
          return json(request, 200, view(issue))
        }
      }
      if (suffix === '/dependencies/blocking' && issue !== undefined) return json(request, 200, blocking(issue).map(linkedView))
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
        touch(issue)
        return json(request, 200, view(issue))
      }
      if (issue !== undefined) return json(request, 200, view(issue))
      return json(request, 404, { message: 'Not Found' })
    }),
  )
  return { state, client, seed, touch }
}
