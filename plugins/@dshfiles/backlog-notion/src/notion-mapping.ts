import { BacklogProviders, type ProviderBindingOptions, type RemoteStatus } from '@dshfiles/backlog/backlog-provider'
import { Schema } from 'effect'

type Status = (typeof BacklogProviders.statuses)[number]
type Priority = (typeof BacklogProviders.priorities)[number]

const richTextSchema = Schema.Struct({ plain_text: Schema.String })
const namedSchema = Schema.Struct({ name: Schema.String })
const optionSchema = Schema.Struct({ id: Schema.String, name: Schema.String })

/** One property value of a page, as far as the provider reads it; other types decode and are ignored. */
const propertyValueSchema = Schema.Struct({
  type: Schema.String,
  title: Schema.optionalKey(Schema.Array(richTextSchema)),
  status: Schema.optionalKey(Schema.NullOr(namedSchema)),
  select: Schema.optionalKey(Schema.NullOr(namedSchema)),
  multi_select: Schema.optionalKey(Schema.Array(namedSchema)),
  relation: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String }))),
  unique_id: Schema.optionalKey(Schema.Struct({ prefix: Schema.NullOr(Schema.String), number: Schema.NullOr(Schema.Number) })),
})

const pageSchema = Schema.Struct({
  object: Schema.Literal('page'),
  id: Schema.String,
  url: Schema.String,
  last_edited_time: Schema.String,
  in_trash: Schema.optionalKey(Schema.Boolean),
  properties: Schema.Record(Schema.String, propertyValueSchema),
})

/** One property of a data source's schema: its type and, for status and selects, its options. */
const propertySchemaSchema = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  status: Schema.optionalKey(
    Schema.Struct({
      options: Schema.Array(optionSchema),
      groups: Schema.Array(Schema.Struct({ name: Schema.String, option_ids: Schema.Array(Schema.String) })),
    }),
  ),
  select: Schema.optionalKey(Schema.Struct({ options: Schema.Array(optionSchema) })),
  multi_select: Schema.optionalKey(Schema.Struct({ options: Schema.Array(optionSchema) })),
})

const dataSourceSchema = Schema.Struct({
  object: Schema.Literal('data_source'),
  id: Schema.String,
  title: Schema.optionalKey(Schema.Array(richTextSchema)),
  properties: Schema.Record(Schema.String, propertySchemaSchema),
})

export type NotionPage = typeof pageSchema.Type
export type NotionDataSource = typeof dataSourceSchema.Type
type PropertySchema = typeof propertySchemaSchema.Type

/** Where each backlog field lives on a data source: property names, and the status options with their categories. */
export interface NotionLayout {
  readonly title: string
  readonly status: { readonly name: string; readonly type: 'status' | 'select'; readonly options: readonly StatusOption[] } | null
  readonly tags: { readonly name: string; readonly options: readonly string[] } | null
  readonly priority: { readonly name: string; readonly options: readonly string[]; readonly values: ReadonlyMap<Priority, string> } | null
  readonly parent: string | null
}

interface StatusOption {
  readonly name: string
  readonly status: RemoteStatus
}

/** Why a data source cannot be used as the binding describes it. */
export class LayoutInvalid {
  readonly _tag = 'LayoutInvalid'
  constructor(readonly detail: string) {}
}

const normalized = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, ' ')

const statusAliases = {
  inbox: ['inbox', 'triage', 'new'],
  todo: ['to do', 'todo', 'not started', 'backlog', 'planned'],
  doing: ['in progress', 'doing', 'started', 'in review', 'review'],
  done: ['done', 'complete', 'completed', 'shipped'],
  dropped: ['dropped', 'canceled', 'cancelled', 'won t do', 'wont do', 'abandoned', 'archived'],
} as const satisfies Record<Status, readonly string[]>

const defaultStatusNames = { inbox: 'Inbox', todo: 'To do', doing: 'In progress', done: 'Done', dropped: 'Dropped' } as const satisfies Record<Status, string>

const priorityAliases = {
  urgent: ['urgent', 'p0', 'critical', 'highest'],
  high: ['high', 'p1'],
  medium: ['medium', 'p2', 'normal'],
  low: ['low', 'p3', 'lowest'],
} as const satisfies Record<Exclude<Priority, 'none'>, readonly string[]>

const statusByAlias = (name: string): Status | undefined => {
  const key = normalized(name).replace(/'/gu, ' ')
  return BacklogProviders.statuses.find(status => statusAliases[status].some(alias => alias === key))
}

/** A Notion status group (To-do, In progress, Complete) as a backlog category; a named option refines it. */
const statusOfGroup = (group: string, option: string): RemoteStatus => {
  const named = statusByAlias(option)
  const groupKey = normalized(group)
  if (groupKey === 'complete' || groupKey === 'completed' || groupKey === 'done')
    return BacklogProviders.exactStatus(named === 'dropped' ? 'dropped' : 'done', option)
  if (groupKey === 'in progress') return BacklogProviders.exactStatus('doing', option)
  if (named === 'inbox') return BacklogProviders.exactStatus('inbox', option)
  return { category: 'todo', label: option, equivalents: ['todo', 'inbox'] }
}

/** A select option read as a status by its name; an unknown name reads as `todo` and compares by category alone. */
const statusOfSelect = (option: string): RemoteStatus => {
  const named = statusByAlias(option)
  if (named === undefined) return { category: 'todo', label: option, equivalents: [] }
  return named === 'todo' ? { category: 'todo', label: option, equivalents: ['todo', 'inbox'] } : BacklogProviders.exactStatus(named, option)
}

/** `urgent=P0, high=P1`: the binding's priority value map. */
const priorityValuesOf = (text: string | undefined): ReadonlyMap<Priority, string> =>
  new Map(
    (text ?? '').split(',').flatMap(pair => {
      const [local, remote] = pair.split('=').map(part => part.trim())
      const priority = BacklogProviders.priorities.find(candidate => candidate === local?.toLowerCase())
      return priority === undefined || remote === undefined || remote === '' ? [] : [[priority, remote] as const]
    }),
  )

const optionNames = (property: PropertySchema): readonly string[] =>
  (property.status?.options ?? property.select?.options ?? property.multi_select?.options ?? []).map(option => option.name)

/** The property a binding option names, or the one a convention finds; a named property of the wrong type is an error. */
const pick = (input: {
  readonly properties: readonly PropertySchema[]
  readonly configured: string | undefined
  readonly types: readonly string[]
  readonly conventional: readonly string[]
  readonly onlyOfType: boolean
  readonly option: string
}): PropertySchema | null | LayoutInvalid => {
  const configured = input.configured?.trim() ?? ''
  if (configured !== '') {
    const found =
      input.properties.find(property => property.name === configured) ?? input.properties.find(property => normalized(property.name) === normalized(configured))
    if (found === undefined) return new LayoutInvalid(`the data source has no property named “${configured}” (binding option ${input.option})`)
    if (!input.types.includes(found.type))
      return new LayoutInvalid(`property “${configured}” is a ${found.type}; ${input.option} needs a ${input.types.join(' or ')} property`)
    return found
  }
  const typed = input.properties.filter(property => input.types.includes(property.type))
  const named = typed.find(property => input.conventional.includes(normalized(property.name)))
  if (named !== undefined) return named
  return input.onlyOfType && typed.length === 1 ? (typed[0] ?? null) : null
}

/**
 * Where each field lives on a data source: the title property, the status property (a `status` property, or a select
 * named Status), tags (a multi-select named Tags or Labels, or the only one), priority (a select named Priority) and
 * parent (a relation named Parent item or Parent). Binding options name them explicitly.
 */
const layoutOf = (dataSource: NotionDataSource, options: ProviderBindingOptions | undefined): NotionLayout | LayoutInvalid => {
  const properties = Object.entries(dataSource.properties).map(([name, property]) => ({ ...property, name }))
  const title = properties.find(property => property.type === 'title')
  if (title === undefined) return new LayoutInvalid('the data source has no title property')
  const status = pick({
    properties,
    configured: options?.statusProperty,
    types: ['status', 'select'],
    conventional: ['status', 'state', 'stage'],
    onlyOfType: false,
    option: 'statusProperty',
  })
  const statusProperty = status instanceof LayoutInvalid ? status : (status ?? properties.find(property => property.type === 'status') ?? null)
  if (statusProperty instanceof LayoutInvalid) return statusProperty
  const tags = pick({
    properties,
    configured: options?.tagsProperty,
    types: ['multi_select'],
    conventional: ['tags', 'labels'],
    onlyOfType: true,
    option: 'tagsProperty',
  })
  if (tags instanceof LayoutInvalid) return tags
  const priority = pick({
    properties,
    configured: options?.priorityProperty,
    types: ['select'],
    conventional: ['priority'],
    onlyOfType: false,
    option: 'priorityProperty',
  })
  if (priority instanceof LayoutInvalid) return priority
  const parent = pick({
    properties,
    configured: options?.parentProperty,
    types: ['relation'],
    conventional: ['parent item', 'parent'],
    onlyOfType: false,
    option: 'parentProperty',
  })
  if (parent instanceof LayoutInvalid) return parent
  return {
    title: title.name,
    status:
      statusProperty === null
        ? null
        : {
            name: statusProperty.name,
            type: statusProperty.type === 'status' ? 'status' : 'select',
            options:
              statusProperty.status === undefined
                ? optionNames(statusProperty).map(name => ({ name, status: statusOfSelect(name) }))
                : statusProperty.status.options.map(option => {
                    const group = statusProperty.status?.groups.find(candidate => candidate.option_ids.includes(option.id))
                    return { name: option.name, status: group === undefined ? statusOfSelect(option.name) : statusOfGroup(group.name, option.name) }
                  }),
          },
    tags: tags === null ? null : { name: tags.name, options: optionNames(tags) },
    priority: priority === null ? null : { name: priority.name, options: optionNames(priority), values: priorityValuesOf(options?.priorityValues) },
    parent: parent?.name ?? null,
  }
}

const plainText = (parts: readonly { readonly plain_text: string }[] | undefined): string => (parts ?? []).map(part => part.plain_text).join('')

const sameName = (left: string, right: string): boolean => normalized(left) === normalized(right)

/** The status a page's status value reads as, through the layout's options (an option added since reads by name). */
const statusOfValue = (layout: NotionLayout, name: string | undefined): RemoteStatus | null => {
  if (layout.status === null || name === undefined) return null
  return layout.status.options.find(option => option.name === name)?.status ?? statusOfSelect(name)
}

const priorityOfValue = (layout: NotionLayout, name: string | undefined): Priority => {
  if (layout.priority === null || name === undefined) return 'none'
  const mapped = [...layout.priority.values].find(([, remote]) => sameName(remote, name))?.[0]
  if (mapped !== undefined) return mapped
  const key = normalized(name)
  return BacklogProviders.priorities.find(priority => priority !== 'none' && priorityAliases[priority].some(alias => alias === key)) ?? 'none'
}

/** The status option to write for a backlog status: the value map's name, then an option of that category, then a default name. */
const statusNameFor = (layout: NotionLayout, status: Status, label: string | undefined): string | undefined => {
  const property = layout.status
  if (property === null) return undefined
  if (label !== undefined) {
    const named = property.options.find(option => sameName(option.name, label))
    if (named !== undefined || property.type === 'select') return named?.name ?? label
  }
  const exact = property.options.find(option => option.status.category === status && statusByAlias(option.name) === status)
  const sameCategory = property.options.find(option => option.status.category === status)
  const fallback =
    status === 'inbox'
      ? property.options.find(option => option.status.category === 'todo')
      : status === 'dropped'
        ? property.options.find(option => option.status.category === 'done')
        : undefined
  const found = exact ?? sameCategory ?? fallback
  if (found !== undefined) return found.name
  return property.type === 'select' ? defaultStatusNames[status] : undefined
}

const priorityNameFor = (layout: NotionLayout, priority: Priority): string | null | undefined => {
  if (layout.priority === null) return undefined
  if (priority === 'none') return null
  const configured = layout.priority.values.get(priority)
  if (configured !== undefined) return configured
  const existing = layout.priority.options.find(option => priorityAliases[priority].some(alias => alias === normalized(option)))
  return existing ?? `${priority.slice(0, 1).toUpperCase()}${priority.slice(1)}`
}

/** Tags as multi-select names: an existing option of the same name keeps its case; commas are not allowed in a name. */
const tagNamesFor = (layout: NotionLayout, tags: readonly string[]): string[] | undefined => {
  if (layout.tags === null) return undefined
  const options = layout.tags.options
  return [...new Set(tags.map(tag => options.find(option => sameName(option, tag)) ?? tag.replace(/,/gu, ' ').trim()).filter(tag => tag !== ''))]
}

const dashed = (hex: string): string => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`

/**
 * The page or data source id in a reference: a bare id (with or without dashes) or the last 32-hex id of a
 * notion.so / notion.site URL path.
 */
const idOf = (reference: string): string | undefined => {
  const trimmed = reference.trim()
  const bare = trimmed.replace(/-/gu, '')
  if (/^[0-9a-f]{32}$/iu.test(bare)) return dashed(bare.toLowerCase())
  if (!URL.canParse(trimmed)) return undefined
  const url = new URL(trimmed)
  if (!/(^|\.)notion\.(so|site)$/iu.test(url.hostname)) return undefined
  const match = /([0-9a-f]{32})(?:[^0-9a-f]*)$/iu.exec(url.pathname.replace(/-/gu, ''))
  return match?.[1] === undefined ? undefined : dashed(match[1].toLowerCase())
}

/** The short key a chip shows: the page's unique ID property (`TASK-12`), else the start of its id. */
const displayKeyOf = (page: NotionPage): string => {
  const unique = Object.values(page.properties).find(property => property.type === 'unique_id')?.unique_id
  if (unique?.number !== undefined && unique.number !== null) return `${unique.prefix === null ? '' : `${unique.prefix}-`}${String(unique.number)}`
  return page.id.replace(/-/gu, '').slice(0, 8)
}

/** FNV-1a over the canonical fields, so two edits within Notion's minute-granular `last_edited_time` still differ. */
const contentHash = (text: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

type BodyEdit =
  | { readonly type: 'replace_content'; readonly replace_content: { readonly new_str: string } }
  | {
      readonly type: 'update_content'
      readonly update_content: { readonly content_updates: readonly { readonly old_str: string; readonly new_str: string }[] }
    }

const UNKNOWN_BLOCK = '<unknown'

const occurrences = (text: string, part: string): number => {
  let count = 0
  for (let index = text.indexOf(part); index !== -1; index = text.indexOf(part, index + 1)) count += 1
  return count
}

/**
 * The smallest markdown edit from `current` to `next`: one `update_content` search-and-replace over the changed lines,
 * widened a line at a time until its `old_str` is unique. An edit never covers an `<unknown …/>` placeholder (a block
 * the read truncated or cannot see), so `null` refuses it; a page without placeholders falls back to `replace_content`.
 */
const bodyEdit = (input: { readonly current: string; readonly next: string; readonly truncated: boolean }): BodyEdit | 'unchanged' | null => {
  const { current, next } = input
  if (current === next) return 'unchanged'
  const replace: BodyEdit = { type: 'replace_content', replace_content: { new_str: next } }
  const hidden = (text: string): boolean => text.includes(UNKNOWN_BLOCK)
  if (current.trim() === '') return input.truncated ? null : replace
  let prefix = 0
  while (prefix < current.length && prefix < next.length && current[prefix] === next[prefix]) prefix += 1
  let suffix = 0
  while (suffix < current.length - prefix && suffix < next.length - prefix && current[current.length - 1 - suffix] === next[next.length - 1 - suffix])
    suffix += 1
  let start = current.lastIndexOf('\n', prefix - 1) + 1
  const endOf = (from: number) => {
    const newline = current.indexOf('\n', from)
    return newline === -1 ? current.length : newline
  }
  let end = endOf(current.length - suffix)
  for (;;) {
    const oldText = current.slice(start, end)
    if (hidden(oldText)) return null
    if (oldText.trim() !== '' && occurrences(current, oldText) === 1) {
      const newText = next.slice(start, next.length - (current.length - end))
      return { type: 'update_content', update_content: { content_updates: [{ old_str: oldText, new_str: newText }] } }
    }
    if (start === 0 && end === current.length) return input.truncated || hidden(current) ? null : replace
    if (end < current.length) end = endOf(end + 1)
    else start = current.lastIndexOf('\n', start - 2) + 1
  }
}

export class NotionMapping {
  static readonly pageSchema = pageSchema
  static readonly dataSourceSchema = dataSourceSchema
  static readonly richTextSchema = richTextSchema
  static readonly layoutOf = layoutOf
  static readonly plainText = plainText
  static readonly statusOfValue = statusOfValue
  static readonly priorityOfValue = priorityOfValue
  static readonly statusNameFor = statusNameFor
  static readonly priorityNameFor = priorityNameFor
  static readonly tagNamesFor = tagNamesFor
  static readonly idOf = idOf
  static readonly displayKeyOf = displayKeyOf
  static readonly contentHash = contentHash
  static readonly bodyEdit = bodyEdit
}
