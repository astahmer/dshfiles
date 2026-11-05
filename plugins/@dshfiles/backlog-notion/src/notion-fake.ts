import { Effect, Option, Schema } from 'effect'
import { HttpClient, HttpClientResponse, UrlParams, type HttpClientRequest } from 'effect/http'

/** A request the fake saw: never a real network call. */
export interface FakeNotionRequest {
  readonly method: string
  readonly path: string
  readonly version: string | undefined
  readonly authorized: boolean
  readonly body: string
  /** The body decoded as JSON, for assertions; null when there is none. */
  readonly json: typeof jsonSchema.Type
}

/** A stored property value: its type tag and the value under that type's key, the way Notion answers it. */
type FakeProperty = typeof propertyWriteSchema.Type & {
  readonly id?: string
  readonly type?: string
  readonly title?: readonly { readonly plain_text: string }[]
  readonly unique_id?: { readonly prefix: string; readonly number: number }
  readonly has_more?: boolean
}

interface FakePage {
  id: string
  properties: Record<string, FakeProperty>
  markdown: string
  truncated: boolean
  inTrash: boolean
  edited: number
  comments: { id: string; text: string; created: number; author: string }[]
}

const DATA_SOURCE_ID = '11111111-2222-3333-4444-555555555555'
const DATABASE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const KEY = 'ntn_fake_key'

const iso = (minute: number): string => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString()

const statusOptions = [
  { id: 's-inbox', name: 'Inbox' },
  { id: 's-todo', name: 'Not started' },
  { id: 's-doing', name: 'In progress' },
  { id: 's-done', name: 'Done' },
  { id: 's-cancel', name: 'Canceled' },
]

const dataSource = {
  object: 'data_source',
  id: DATA_SOURCE_ID,
  title: [{ plain_text: 'Roadmap' }],
  properties: {
    Name: { id: 'title', name: 'Name', type: 'title', title: {} },
    Status: {
      id: 'st',
      name: 'Status',
      type: 'status',
      status: {
        options: statusOptions,
        groups: [
          { name: 'To-do', option_ids: ['s-inbox', 's-todo'] },
          { name: 'In progress', option_ids: ['s-doing'] },
          { name: 'Complete', option_ids: ['s-done', 's-cancel'] },
        ],
      },
    },
    Tags: { id: 'tg', name: 'Tags', type: 'multi_select', multi_select: { options: [{ id: 't-bug', name: 'Bug' }] } },
    Priority: {
      id: 'pr',
      name: 'Priority',
      type: 'select',
      select: {
        options: [
          { id: 'p0', name: 'P0' },
          { id: 'p1', name: 'P1' },
          { id: 'p2', name: 'P2' },
        ],
      },
    },
    'Parent item': { id: 'pa', name: 'Parent item', type: 'relation', relation: { data_source_id: DATA_SOURCE_ID } },
    Stage: { id: 'sg', name: 'Stage', type: 'select', select: { options: [{ id: 'g1', name: 'Doing' }] } },
  },
}

const namedSchema = Schema.Struct({ name: Schema.String })
const propertyWriteSchema = Schema.Struct({
  status: Schema.optionalKey(Schema.NullOr(namedSchema)),
  select: Schema.optionalKey(Schema.NullOr(namedSchema)),
  multi_select: Schema.optionalKey(Schema.Array(namedSchema)),
  relation: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String }))),
})
const titleWriteSchema = Schema.Struct({ title: Schema.Array(Schema.Struct({ text: Schema.Struct({ content: Schema.String }) })) })

const bodySchema = Schema.fromJsonString(
  Schema.Struct({
    filter: Schema.optionalKey(Schema.Struct({ last_edited_time: Schema.optionalKey(Schema.Struct({ on_or_after: Schema.String })) })),
    start_cursor: Schema.optionalKey(Schema.String),
    page_size: Schema.optionalKey(Schema.Number),
    properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Union([titleWriteSchema, propertyWriteSchema]))),
    in_trash: Schema.optionalKey(Schema.Boolean),
    markdown: Schema.optionalKey(Schema.String),
    markdown_version: Schema.optionalKey(Schema.String),
    type: Schema.optionalKey(Schema.String),
    replace_content: Schema.optionalKey(Schema.Struct({ new_str: Schema.String })),
    update_content: Schema.optionalKey(Schema.Struct({ content_updates: Schema.Array(Schema.Struct({ old_str: Schema.String, new_str: Schema.String })) })),
    parent: Schema.optionalKey(Schema.Struct({ page_id: Schema.optionalKey(Schema.String), data_source_id: Schema.optionalKey(Schema.String) })),
  }),
)

const jsonSchema = Schema.NullOr(Schema.fromJsonString(Schema.Unknown))

const textOf = (request: HttpClientRequest.HttpClientRequest): string => (request.body._tag === 'Uint8Array' ? new TextDecoder().decode(request.body.body) : '')

const respond = <T>(request: HttpClientRequest.HttpClientRequest, status: number, value: T, headers: Record<string, string> = {}) =>
  HttpClientResponse.fromWeb(request, new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } }))

/**
 * An in-memory Notion: one data source with Status (status groups), Tags, Priority and Parent item properties, pages
 * with markdown bodies and comments, minute-granular `last_edited_time`, and 429s on demand.
 */
export const fakeNotion = () => {
  const pages = new Map<string, FakePage>()
  const requests: FakeNotionRequest[] = []
  let clock = 0
  let nextId = 1
  const state = { rateLimitNext: 0, retryAfter: '1', sameMinute: false }

  const pageId = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`
  const touch = (page: FakePage) => {
    if (!state.sameMinute) clock += 1
    page.edited = clock
  }

  const pageJson = (page: FakePage) => ({
    object: 'page',
    id: page.id,
    url: `https://www.notion.so/Item-${page.id.replace(/-/gu, '')}`,
    last_edited_time: iso(page.edited),
    in_trash: page.inTrash,
    is_archived: false,
    parent: { type: 'data_source_id', data_source_id: DATA_SOURCE_ID, database_id: DATABASE_ID },
    properties: page.properties,
  })

  const commentJson = (comment: FakePage['comments'][number]) => ({
    object: 'comment',
    id: comment.id,
    discussion_id: 'd-1',
    created_time: iso(comment.created),
    last_edited_time: iso(comment.created),
    rich_text: [{ type: 'text', plain_text: comment.text }],
    display_name: { type: 'user', resolved_name: comment.author },
  })

  const add = (input: {
    title: string
    status?: string
    tags?: string[]
    priority?: string | null
    parent?: string
    markdown?: string
    truncated?: boolean
  }) => {
    clock += 1
    const page: FakePage = {
      id: pageId(),
      properties: {
        Name: { id: 'title', type: 'title', title: [{ plain_text: input.title }] },
        Status: { id: 'st', type: 'status', status: input.status === undefined ? null : { name: input.status } },
        Tags: { id: 'tg', type: 'multi_select', multi_select: (input.tags ?? []).map(name => ({ name })) },
        Priority: { id: 'pr', type: 'select', select: input.priority === undefined || input.priority === null ? null : { name: input.priority } },
        'Parent item': { id: 'pa', type: 'relation', relation: input.parent === undefined ? [] : [{ id: input.parent }], has_more: false },
        Stage: { id: 'sg', type: 'select', select: null },
        ID: { id: 'id', type: 'unique_id', unique_id: { prefix: 'TASK', number: nextId - 1 } },
      },
      markdown: input.markdown ?? '',
      truncated: input.truncated ?? false,
      inTrash: false,
      edited: clock,
      comments: [],
    }
    pages.set(page.id, page)
    return page
  }

  /** Writes property values the way Notion does: text becomes rich text with plain_text, names stay names. */
  const applyProperties = (page: FakePage, properties: Readonly<Record<string, typeof titleWriteSchema.Type | typeof propertyWriteSchema.Type>>) => {
    for (const [name, value] of Object.entries(properties)) {
      const written = 'title' in value ? { title: value.title.map(part => ({ plain_text: part.text.content })) } : value
      page.properties[name] = { ...page.properties[name], ...written }
    }
  }

  const handle = (request: HttpClientRequest.HttpClientRequest) => {
    const url = new URL(request.url)
    const path = url.pathname.replace(/^\/v1/u, '')
    const text = textOf(request)
    requests.push({
      method: request.method,
      path,
      version: request.headers['notion-version'],
      authorized: request.headers['authorization'] === `Bearer ${KEY}`,
      body: text,
      json: text === '' ? null : Schema.decodeUnknownSync(jsonSchema)(text),
    })
    if (request.headers['authorization'] !== `Bearer ${KEY}`)
      return respond(request, 401, { object: 'error', code: 'unauthorized', message: 'API token is invalid.' })
    if (state.rateLimitNext > 0) {
      state.rateLimitNext -= 1
      return respond(request, 429, { object: 'error', code: 'rate_limited', message: 'Rate limited' }, { 'retry-after': state.retryAfter })
    }
    const body = text === '' ? {} : Schema.decodeUnknownSync(bodySchema)(text)
    const notFound = () => respond(request, 404, { object: 'error', code: 'object_not_found', message: 'Could not find object.' })

    if (path === '/users/me') return respond(request, 200, { object: 'user', id: 'bot-1', type: 'bot', name: 'Backlog sync', bot: { workspace_name: 'Acme' } })
    if (path === '/search')
      return respond(request, 200, {
        object: 'list',
        results: [{ object: 'data_source', id: DATA_SOURCE_ID, title: [{ plain_text: 'Roadmap' }] }],
        has_more: false,
        next_cursor: null,
      })
    if (path === `/data_sources/${DATA_SOURCE_ID}`) return respond(request, 200, dataSource)
    if (path === `/databases/${DATABASE_ID}`)
      return respond(request, 200, { object: 'database', id: DATABASE_ID, data_sources: [{ id: DATA_SOURCE_ID, name: 'Roadmap' }] })
    if (path === `/data_sources/${DATA_SOURCE_ID}/query`) {
      const since = body.filter?.last_edited_time?.on_or_after
      const visible = [...pages.values()]
        .filter(page => !page.inTrash && (since === undefined || iso(page.edited) >= since))
        .sort((left, right) => left.edited - right.edited)
      const start = Number(body.start_cursor ?? '0')
      const size = body.page_size ?? 100
      const slice = visible.slice(start, start + size)
      const more = start + size < visible.length
      return respond(request, 200, { object: 'list', results: slice.map(pageJson), has_more: more, next_cursor: more ? String(start + size) : null })
    }
    if (path.startsWith('/data_sources/') || path.startsWith('/databases/')) return notFound()
    if (path === '/pages' && request.method === 'POST') {
      const page = add({ title: '' })
      applyProperties(page, body.properties ?? {})
      page.markdown = body.markdown ?? ''
      return respond(request, 200, pageJson(page))
    }
    if (path === '/comments') {
      const id = request.method === 'POST' ? body.parent?.page_id : Option.getOrUndefined(UrlParams.getFirst(request.urlParams, 'block_id'))
      const page = id === undefined ? undefined : pages.get(id)
      if (page === undefined) return notFound()
      if (request.method === 'POST') {
        const comment = { id: `c-${String(page.comments.length + 1)}`, text: body.markdown ?? '', created: clock, author: 'Backlog sync' }
        page.comments.push(comment)
        return respond(request, 200, commentJson(comment))
      }
      return respond(request, 200, { object: 'list', results: page.comments.map(commentJson), has_more: false, next_cursor: null })
    }
    const markdownMatch = /^\/pages\/([^/]+)\/markdown$/u.exec(path)
    if (markdownMatch?.[1] !== undefined) {
      const page = pages.get(markdownMatch[1])
      if (page === undefined) return notFound()
      if (request.method === 'GET')
        return respond(request, 200, { object: 'page_markdown', id: page.id, markdown: page.markdown, truncated: page.truncated, unknown_block_ids: [] })
      if (body.type === 'replace_content' && body.replace_content !== undefined) page.markdown = body.replace_content.new_str
      for (const update of body.update_content?.content_updates ?? []) {
        if (page.markdown.split(update.old_str).length !== 2)
          return respond(request, 400, { object: 'error', code: 'validation_error', message: 'old_str must match exactly once' })
        page.markdown = page.markdown.replace(update.old_str, update.new_str)
      }
      touch(page)
      return respond(request, 200, { object: 'page_markdown', id: page.id, markdown: page.markdown, truncated: page.truncated, unknown_block_ids: [] })
    }
    const pageMatch = /^\/pages\/([^/]+)$/u.exec(path)
    if (pageMatch?.[1] !== undefined) {
      const page = pages.get(pageMatch[1])
      if (page === undefined) return notFound()
      if (request.method === 'PATCH') {
        applyProperties(page, body.properties ?? {})
        if (body.in_trash !== undefined) page.inTrash = body.in_trash
        touch(page)
      }
      return respond(request, 200, pageJson(page))
    }
    return notFound()
  }

  const client = HttpClient.make(request => Effect.sync(() => handle(request)))

  return { client, pages, requests, state, add, key: KEY, dataSourceId: DATA_SOURCE_ID, databaseId: DATABASE_ID, iso }
}
