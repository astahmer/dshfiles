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
} from '@dshfiles/backlog/backlog-provider'
import { Clock, Effect, Ref, Schema } from 'effect'
import { NotionClient } from './notion-client.js'
import { LayoutInvalid, NotionMapping, type NotionDataSource, type NotionLayout, type NotionPage } from './notion-mapping.js'

const LABEL = NotionClient.label
const PAGE_SIZE = 50
const MAX_DISCOVERY_PAGES = 5
const MAX_COMMENT_PAGES = 5
const SCHEMA_CACHE_MS = 10 * 60_000
const MAX_BODY_CHARS = 80_000
const MAX_COMMENT_CHARS = 40_000

const descriptor: ProviderDescriptor = {
  kind: 'notion',
  label: LABEL,
  containerLabel: 'Data source',
  credential: 'required',
  environmentVariables: [...NotionClient.environmentVariables],
  referencePatterns: ['^https://([a-z0-9-]+\\.)?notion\\.(so|site)/', '^[0-9a-f]{32}$', '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'],
  referenceExample: 'a notion.so page URL or page id',
  capabilities: {
    read: true,
    write: true,
    create: true,
    delete: 'archive',
    statusModel: 'free-select',
    bodyFormat: 'markdown',
    comments: 'read-write',
    labels: true,
    priority: true,
    parent: true,
    relations: [],
    changeFeed: 'since-cursor',
    rateLimit: { requestsPerHour: 10_000 },
  },
  bindingOptions: [
    { key: 'statusProperty', label: 'Status property', placeholder: 'Status' },
    { key: 'tagsProperty', label: 'Tags property', placeholder: 'Tags' },
    { key: 'priorityProperty', label: 'Priority property', placeholder: 'Priority' },
    { key: 'priorityValues', label: 'Priority names', placeholder: 'urgent=P0, high=P1' },
    { key: 'parentProperty', label: 'Parent property', placeholder: 'Parent item' },
  ],
}

const listSchema = Schema.Struct({ results: Schema.Array(Schema.Unknown), has_more: Schema.Boolean, next_cursor: Schema.NullOr(Schema.String) })
const markdownSchema = Schema.Struct({ markdown: Schema.String, truncated: Schema.optionalKey(Schema.Boolean) })
const userSchema = Schema.Struct({
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  bot: Schema.optionalKey(Schema.Struct({ workspace_name: Schema.optionalKey(Schema.NullOr(Schema.String)) })),
})
const databaseSchema = Schema.Struct({ data_sources: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.optionalKey(Schema.String) })) })
const commentSchema = Schema.Struct({
  id: Schema.String,
  created_time: Schema.String,
  rich_text: Schema.Array(NotionMapping.richTextSchema),
  display_name: Schema.optionalKey(Schema.Struct({ resolved_name: Schema.NullOr(Schema.String) })),
})
const searchResultSchema = Schema.Struct({
  object: Schema.Literal('data_source'),
  id: Schema.String,
  title: Schema.optionalKey(Schema.Array(NotionMapping.richTextSchema)),
})

/** The page token of a pull: Notion's cursor and the newest `last_edited_time` seen, so the last page knows the checkpoint. */
const pageTokenSchema = Schema.fromJsonString(Schema.Struct({ after: Schema.String, newest: Schema.String }))

type Scope = ProviderScope

const failed = (code: BacklogProviderFailed['code'], detail = '', status?: number) =>
  new BacklogProviderFailed({ provider: LABEL, code, detail, ...(status !== undefined && { status }) })

/** A response decoder for one schema: a shape it refuses reads as `invalid-response`, naming the operation. */
const decode = <S extends Schema.Top>(schema: S, what: string) => {
  const decoder = Schema.decodeUnknownEffect(schema)
  return (response: Parameters<typeof decoder>[0]) => decoder(response).pipe(Effect.mapError(() => failed('invalid-response', what)))
}

/** One property value as a page write sends it. */
type PropertyWrite =
  | { readonly title: readonly { readonly type: 'text'; readonly text: { readonly content: string } }[] }
  | { readonly status: { readonly name: string } }
  | { readonly select: { readonly name: string } | null }
  | { readonly multi_select: readonly { readonly name: string }[] }
  | { readonly relation: readonly { readonly id: string }[] }

/**
 * Notion data sources over the REST API (version {@link NotionClient.version}): pages are items, the title property
 * is the title, the page's markdown is the body, and status, tags, priority and parent come from properties the
 * binding names or conventions find. Data-source schemas are cached per connection for ten minutes.
 */
export const makeNotionProvider = Effect.fn('backlog notion provider')(function* () {
  const client = yield* NotionClient
  const schemaCache = yield* Ref.make(new Map<string, { readonly at: number; readonly dataSource: NotionDataSource }>())

  const dataSourceById = (connection: ProviderConnection, id: string) =>
    Effect.flatMap(
      client.request({ connection, method: 'GET', path: `/data_sources/${id}`, operation: 'retrieve-data-source', reference: id }),
      decode(NotionMapping.dataSourceSchema, 'retrieve-data-source'),
    )

  /** Every data source the integration can see, through search. */
  const discover = (connection: ProviderConnection) =>
    Effect.gen(function* () {
      const found: { key: string; name: string }[] = []
      let cursor: string | null = null
      for (let page = 0; page < MAX_DISCOVERY_PAGES; page += 1) {
        const list: typeof listSchema.Type = yield* Effect.flatMap(
          client.request({
            connection,
            method: 'POST',
            path: '/search',
            body: { filter: { property: 'object', value: 'data_source' }, page_size: 100, ...(cursor !== null && { start_cursor: cursor }) },
            operation: 'search-data-sources',
          }),
          decode(listSchema, 'search'),
        )
        for (const result of list.results) {
          const decoded = Schema.decodeUnknownOption(searchResultSchema)(result)
          if (decoded._tag === 'Some') found.push({ key: decoded.value.id, name: NotionMapping.plainText(decoded.value.title) || decoded.value.id })
        }
        if (!list.has_more || list.next_cursor === null) break
        cursor = list.next_cursor
      }
      return found
    })

  /**
   * The binding's data source: a data source id, a database id or URL (its only data source), or — with no container —
   * the only data source the integration sees.
   */
  const dataSourceOf = (scope: Scope) =>
    Effect.gen(function* () {
      const configured = scope.container.trim()
      if (configured === '') {
        const visible = yield* discover(scope.connection)
        const only = visible.length === 1 ? visible[0] : undefined
        if (only === undefined)
          return yield* failed(
            'target-missing',
            visible.length === 0 ? 'the integration sees no data source; share a database with it' : 'the key sees several data sources; pick one',
          )
        return only.key
      }
      const id = NotionMapping.idOf(configured)
      if (id === undefined) return yield* failed('target-missing', `“${configured.slice(0, 80)}” is not a Notion id or URL`)
      const cacheKey = `${scope.connection.instanceId}\n${id}`
      const cached = (yield* Ref.get(schemaCache)).get(cacheKey)
      if (cached !== undefined) return cached.dataSource.id
      const direct = yield* Effect.result(dataSourceById(scope.connection, id))
      if (direct._tag === 'Success') return direct.success.id
      if (direct.failure.code !== 'not-found') return yield* direct.failure
      const database = yield* Effect.flatMap(
        client.request({ connection: scope.connection, method: 'GET', path: `/databases/${id}`, operation: 'retrieve-database', reference: configured }),
        decode(databaseSchema, 'retrieve-database'),
      )
      const only = database.data_sources.length === 1 ? database.data_sources[0] : undefined
      if (only === undefined) return yield* failed('target-missing', 'the database has several data sources; bind one of them by its id')
      return only.id
    })

  const layoutOf = (scope: Scope) =>
    Effect.gen(function* () {
      const id = yield* dataSourceOf(scope)
      const cacheKey = `${scope.connection.instanceId}\n${id}`
      const now = yield* Clock.currentTimeMillis
      const cached = (yield* Ref.get(schemaCache)).get(cacheKey)
      const dataSource = cached !== undefined && now - cached.at < SCHEMA_CACHE_MS ? cached.dataSource : yield* dataSourceById(scope.connection, id)
      if (cached === undefined || cached.dataSource !== dataSource)
        yield* Ref.update(schemaCache, current => new Map(current).set(cacheKey, { at: now, dataSource }))
      const layout = NotionMapping.layoutOf(dataSource, scope.options)
      if (layout instanceof LayoutInvalid) return yield* failed('target-missing', layout.detail)
      return { dataSourceId: id, layout }
    })

  const pageById = (connection: ProviderConnection, id: string) =>
    Effect.flatMap(
      client.request({ connection, method: 'GET', path: `/pages/${id}`, operation: 'retrieve-page', reference: id }),
      decode(NotionMapping.pageSchema, 'retrieve-page'),
    )

  const markdownOf = (connection: ProviderConnection, id: string) =>
    Effect.flatMap(
      client.request({
        connection,
        method: 'GET',
        path: `/pages/${id}/markdown`,
        query: { markdown_version: 'v2' },
        operation: 'retrieve-page-markdown',
        reference: id,
      }),
      decode(markdownSchema, 'retrieve-page-markdown'),
    )

  const commentsOf = (connection: ProviderConnection, id: string) =>
    Effect.gen(function* () {
      const comments: RemoteComment[] = []
      let cursor: string | null = null
      for (let page = 0; page < MAX_COMMENT_PAGES; page += 1) {
        const list: typeof listSchema.Type = yield* Effect.flatMap(
          client.request({
            connection,
            method: 'GET',
            path: '/comments',
            query: { block_id: id, page_size: '100', ...(cursor !== null && { start_cursor: cursor }) },
            operation: 'list-comments',
            reference: id,
          }),
          decode(listSchema, 'list-comments'),
        )
        comments.push(...(yield* Effect.forEach(list.results, decode(commentSchema, 'list-comments'))).map(commentOf))
        if (!list.has_more || list.next_cursor === null) break
        cursor = list.next_cursor
      }
      return comments
    })

  const commentOf = (comment: typeof commentSchema.Type): RemoteComment => ({
    id: comment.id,
    body: NotionMapping.plainText(comment.rich_text).slice(0, MAX_COMMENT_CHARS),
    author: comment.display_name?.resolved_name ?? LABEL,
    createdAt: Date.parse(comment.created_time) || 0,
  })

  /** A page in backlog vocabulary: what the port calls `toCanonical`. */
  const toCanonical = (input: {
    readonly page: NotionPage
    readonly layout: NotionLayout
    readonly body: string
    readonly comments?: readonly RemoteComment[] | undefined
  }): RemoteRecord => {
    const properties = input.page.properties
    const layout = input.layout
    const status =
      layout.status === null
        ? null
        : NotionMapping.statusOfValue(layout, (properties[layout.status.name]?.status ?? properties[layout.status.name]?.select)?.name)
    const tags = layout.tags === null ? [] : (properties[layout.tags.name]?.multi_select ?? []).map(option => option.name)
    const canonical = {
      key: input.page.id,
      displayKey: NotionMapping.displayKeyOf(input.page),
      url: input.page.url,
      title: NotionMapping.plainText(properties[layout.title]?.title).slice(0, 1_000),
      body: input.body.slice(0, MAX_BODY_CHARS),
      status,
      tags,
      ...(layout.priority !== null && { priority: NotionMapping.priorityOfValue(layout, properties[layout.priority.name]?.select?.name) }),
      ...(layout.parent !== null && { parentKey: properties[layout.parent]?.relation?.[0]?.id ?? null }),
      updatedAt: Date.parse(input.page.last_edited_time) || 0,
    }
    return {
      ...canonical,
      ...(input.comments !== undefined && { comments: input.comments }),
      version: `${input.page.last_edited_time}#${NotionMapping.contentHash(JSON.stringify(canonical))}`,
      ...(input.page.in_trash === true && { deleted: true }),
    }
  }

  /** A patch as Notion page properties: what the port calls `fromCanonical`. Fields the layout lacks are left out. */
  const fromCanonical = (layout: NotionLayout, patch: RemotePatch) => {
    const properties: Record<string, PropertyWrite> = {}
    if (patch.title !== undefined) properties[layout.title] = { title: [{ type: 'text', text: { content: patch.title } }] }
    if (patch.status !== undefined && layout.status !== null) {
      const name = NotionMapping.statusNameFor(layout, patch.status, patch.statusLabel)
      if (name !== undefined) properties[layout.status.name] = layout.status.type === 'status' ? { status: { name } } : { select: { name } }
    }
    if (patch.tags !== undefined && layout.tags !== null) {
      const names = NotionMapping.tagNamesFor(layout, patch.tags) ?? []
      properties[layout.tags.name] = { multi_select: names.map(name => ({ name })) }
    }
    if (patch.priority !== undefined && layout.priority !== null) {
      const name = NotionMapping.priorityNameFor(layout, patch.priority)
      properties[layout.priority.name] = { select: name === null || name === undefined ? null : { name } }
    }
    if (patch.parentKey !== undefined && layout.parent !== null)
      properties[layout.parent] = { relation: patch.parentKey === null ? [] : [{ id: patch.parentKey }] }
    return properties
  }

  const recordOf = (input: {
    readonly scope: Scope
    readonly id: string
    readonly layout: NotionLayout
    readonly fields: readonly ProviderField[]
    readonly comments: boolean
  }) =>
    Effect.gen(function* () {
      const page = yield* pageById(input.scope.connection, input.id)
      const body = input.fields.includes('body') ? (yield* markdownOf(input.scope.connection, input.id)).markdown : ''
      const comments = input.comments ? yield* commentsOf(input.scope.connection, input.id) : undefined
      return toCanonical({ page, layout: input.layout, body, comments })
    })

  const writeBody = (scope: Scope, id: string, body: string) =>
    Effect.gen(function* () {
      const current = yield* markdownOf(scope.connection, id)
      const edit = NotionMapping.bodyEdit({ current: current.markdown, next: body, truncated: current.truncated === true })
      if (edit === 'unchanged') return
      if (edit === null)
        return yield* failed('unsupported', 'the page is too large to rewrite its body as markdown; edit it in Notion or turn off description sync')
      yield* client.request({
        connection: scope.connection,
        method: 'PATCH',
        path: `/pages/${id}/markdown`,
        body: { markdown_version: 'v2', ...edit },
        operation: 'update-page-markdown',
        reference: id,
      })
    })

  const allFields: readonly ProviderField[] = ['title', 'body', 'status', 'tags', 'priority', 'parent']

  const pull = (input: PullInput) =>
    Effect.gen(function* () {
      const { dataSourceId, layout } = yield* layoutOf(input)
      const token = input.page === null ? undefined : Schema.decodeUnknownOption(pageTokenSchema)(input.page)
      const after = token === undefined || token._tag === 'None' ? null : token.value.after
      const newestSoFar = token === undefined || token._tag === 'None' ? (input.cursor ?? '') : token.value.newest
      const list = yield* Effect.flatMap(
        client.request({
          connection: input.connection,
          method: 'POST',
          path: `/data_sources/${dataSourceId}/query`,
          body: {
            page_size: PAGE_SIZE,
            sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
            // `on_or_after`: Notion rounds `last_edited_time` to the minute, so the checkpoint's own minute is read again.
            ...(input.cursor !== null && { filter: { timestamp: 'last_edited_time', last_edited_time: { on_or_after: input.cursor } } }),
            ...(after !== null && { start_cursor: after }),
          },
          operation: 'query-data-source',
        }),
        decode(listSchema, 'query-data-source'),
      )
      const pages = list.results.flatMap(result => {
        const decoded = Schema.decodeUnknownOption(NotionMapping.pageSchema)(result)
        return decoded._tag === 'Some' ? [decoded.value] : []
      })
      const withBody = input.fields.includes('body')
      const records = yield* Effect.forEach(pages, page =>
        Effect.map(withBody ? markdownOf(input.connection, page.id) : Effect.succeed({ markdown: '' }), markdown =>
          toCanonical({ page, layout, body: markdown.markdown }),
        ),
      )
      const newest = pages.reduce((latest, page) => (page.last_edited_time > latest ? page.last_edited_time : latest), newestSoFar)
      const nextPage =
        list.has_more && list.next_cursor !== null ? yield* Schema.encodeEffect(pageTokenSchema)({ after: list.next_cursor, newest }).pipe(Effect.orDie) : null
      return {
        records: input.openOnly
          ? records.filter(record => record.deleted !== true && record.status?.category !== 'done' && record.status?.category !== 'dropped')
          : records,
        nextPage,
        checkpoint: nextPage === null ? (newest === '' ? input.cursor : newest) : null,
        complete: input.cursor === null && !input.openOnly,
      }
    })

  const push = (scope: Scope & { readonly key: string; readonly patch: RemotePatch }) =>
    Effect.gen(function* () {
      const { layout } = yield* layoutOf(scope)
      const properties = fromCanonical(layout, scope.patch)
      if (Object.keys(properties).length > 0)
        yield* client.request({
          connection: scope.connection,
          method: 'PATCH',
          path: `/pages/${scope.key}`,
          body: { properties },
          operation: 'update-page',
          reference: scope.key,
        })
      if (scope.patch.body !== undefined) yield* writeBody(scope, scope.key, scope.patch.body)
      return yield* recordOf({ scope, id: scope.key, layout, fields: allFields, comments: false })
    })

  const create = (scope: Scope & { readonly patch: RemotePatch }) =>
    Effect.gen(function* () {
      const { dataSourceId, layout } = yield* layoutOf(scope)
      const properties = fromCanonical(layout, { ...scope.patch, title: scope.patch.title ?? '' })
      const body = scope.patch.body ?? ''
      const created = yield* Effect.flatMap(
        client.request({
          connection: scope.connection,
          method: 'POST',
          path: '/pages',
          body: {
            parent: { type: 'data_source_id', data_source_id: dataSourceId },
            properties,
            ...(body.trim() !== '' && { markdown: body, markdown_version: 'v2' }),
          },
          operation: 'create-page',
        }),
        decode(NotionMapping.pageSchema, 'create-page'),
      )
      return yield* recordOf({ scope, id: created.id, layout, fields: allFields, comments: false })
    })

  const comment = (scope: Scope & { readonly key: string; readonly body: string }) =>
    Effect.flatMap(
      client.request({
        connection: scope.connection,
        method: 'POST',
        path: '/comments',
        body: { parent: { page_id: scope.key }, markdown: scope.body, markdown_version: 'v2' },
        operation: 'create-comment',
        reference: scope.key,
      }),
      result => Effect.map(decode(commentSchema, 'create-comment')(result), commentOf),
    )

  const remove = (scope: Scope & { readonly key: string }) =>
    Effect.asVoid(
      client.request({
        connection: scope.connection,
        method: 'PATCH',
        path: `/pages/${scope.key}`,
        body: { in_trash: true },
        operation: 'trash-page',
        reference: scope.key,
      }),
    )

  const identity = (connection: ProviderConnection) =>
    Effect.gen(function* () {
      const source = yield* client.credentialSource(connection)
      const user = yield* Effect.flatMap(
        client.request({ connection, method: 'GET', path: '/users/me', operation: 'retrieve-bot-user' }),
        decode(userSchema, 'users/me'),
      )
      const workspace = user.bot?.workspace_name ?? null
      const name = user.name ?? 'Notion integration'
      return { account: workspace === null ? name : `${name} (${workspace})`, credentialSource: source, containers: yield* discover(connection) }
    })

  const fetch = (scope: Scope & { readonly key: string; readonly fields: readonly ProviderField[] }) =>
    Effect.flatMap(layoutOf(scope), ({ layout }) => recordOf({ scope, id: scope.key, layout, fields: scope.fields, comments: true }))

  const resolve = (scope: Scope & { readonly reference: string }) => {
    const id = NotionMapping.idOf(scope.reference)
    return id === undefined ? Effect.fail(failed('not-found', scope.reference)) : fetch({ ...scope, key: id, fields: allFields })
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

export class NotionProvider {
  static readonly descriptor = descriptor
}
