import { z } from 'zod'

const DAY_MS = 86_400_000
const MAX_TITLE_CHARS = 200
const MAX_BODY_CHARS = 20_000
const MAX_TARGET_CHARS = 500
const MAX_TAGS = 20
const MAX_LINKS = 100
const MAX_EVENTS = 200

const kinds = ['task', 'bug', 'idea', 'note', 'question'] as const
const statuses = ['inbox', 'todo', 'doing', 'done', 'dropped'] as const
const linkTypes = ['item', 'thread', 'revision', 'branch', 'workspace', 'url'] as const
const freshnessStates = ['fresh', 'stale', 'dormant', 'archived'] as const
const humanFieldNames = ['title', 'body', 'kind', 'status', 'project', 'tags', 'pinned'] as const

const kindSchema = z.enum(kinds)
const statusSchema = z.enum(statuses)
const linkSchema = z.object({ type: z.enum(linkTypes), target: z.string().min(1).max(MAX_TARGET_CHARS) }).strict()
/** `user`, `system`, or `agent:<sessionId>`. */
const actorIdSchema = z.string().regex(/^(user|system|agent:[\w.-]+)$/)

const eventSchema = z
  .object({
    at: z.number().int().nonnegative(),
    actor: actorIdSchema,
    kind: z.enum(['created', 'edited', 'moved', 'linked', 'unlinked', 'commented']),
    detail: z.string().max(MAX_BODY_CHARS),
  })
  .strict()

const itemSchema = z
  .object({
    id: z.number().int().positive(),
    title: z.string().min(1).max(MAX_TITLE_CHARS),
    body: z.string().max(MAX_BODY_CHARS),
    kind: kindSchema,
    status: statusSchema,
    project: z.string().max(MAX_TARGET_CHARS).nullable(),
    tags: z.array(z.string().max(60)).max(MAX_TAGS),
    links: z.array(linkSchema).max(MAX_LINKS),
    actors: z.array(z.object({ id: actorIdSchema, role: z.enum(['owner', 'contributor']) }).strict()).max(50),
    pinned: z.boolean(),
    humanFields: z.array(z.enum(humanFieldNames)),
    createdAt: z.number().int().nonnegative(),
    lastActivityAt: z.number().int().nonnegative(),
    events: z.array(eventSchema).max(MAX_EVENTS),
  })
  .strict()

export type BacklogKind = z.infer<typeof kindSchema>
export type BacklogStatus = z.infer<typeof statusSchema>
export type BacklogLink = z.infer<typeof linkSchema>
export type BacklogEvent = z.infer<typeof eventSchema>
export type BacklogItem = z.infer<typeof itemSchema>
export type BacklogFreshness = (typeof freshnessStates)[number]
export type BacklogHumanField = (typeof humanFieldNames)[number]

const kindPrefixes = new Map<string, BacklogKind>([
  ['task', 'task'],
  ['todo', 'task'],
  ['bug', 'bug'],
  ['fix', 'bug'],
  ['idea', 'idea'],
  ['note', 'note'],
  ['question', 'question'],
])

const linkPatterns: readonly { readonly type: BacklogLink['type']; readonly pattern: RegExp }[] = [
  { type: 'item', pattern: /(?<![\w/])b:(\d+)\b/g },
  { type: 'revision', pattern: /(?<![\w/])jj:([\w.@/-]+[\w])/g },
  { type: 'thread', pattern: /(?<![\w/-])(session-[\w-]{6,})/g },
  { type: 'branch', pattern: /(?<![\w/])branch:([\w./-]+[\w])/g },
  { type: 'workspace', pattern: /(?<![\w/])workspace:(\S+)/g },
  { type: 'url', pattern: /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g },
]

const tagPattern = /(?<![\w&#/])#([a-z][\w-]{0,59})/gi

const sameLink = (left: BacklogLink, right: BacklogLink): boolean => left.type === right.type && left.target === right.target

const uniqueLinks = (links: readonly BacklogLink[]): BacklogLink[] =>
  links.filter((link, index) => links.findIndex(other => sameLink(other, link)) === index).slice(0, MAX_LINKS)

const extractLinks = (text: string): BacklogLink[] =>
  uniqueLinks(
    linkPatterns.flatMap(({ type, pattern }) =>
      [...text.matchAll(pattern)].flatMap(match => (match[1] === undefined ? [] : [{ type, target: match[1].slice(0, MAX_TARGET_CHARS) }])),
    ),
  )

const extractTags = (text: string): string[] =>
  [...new Set([...text.matchAll(tagPattern)].flatMap(match => (match[1] === undefined ? [] : [match[1].toLowerCase()])))].slice(0, MAX_TAGS)

/**
 * Structure derived from free text, so capture never asks for fields: a `bug:`/`idea:`/… prefix names the
 * kind, a trailing `?` on the first line makes a question, the first line is the title and the rest the body.
 */
const triage = (text: string) => {
  const trimmed = text.trim()
  const prefix = /^(\w+)\s*[:!]\s*/.exec(trimmed)
  const prefixKind = prefix?.[1] === undefined ? undefined : kindPrefixes.get(prefix[1].toLowerCase())
  const content = prefixKind === undefined || prefix === null ? trimmed : trimmed.slice(prefix[0].length)
  const [firstLine = '', ...rest] = content.split('\n')
  const titleLine = firstLine.trim() === '' ? content.trim() : firstLine.trim()
  const kind: BacklogKind = prefixKind ?? (titleLine.endsWith('?') ? 'question' : 'task')
  return {
    title: titleLine.replace(/(\s+#[a-z][\w-]{0,59})+$/i, '').slice(0, MAX_TITLE_CHARS) || 'Untitled',
    body: rest.join('\n').trim().slice(0, MAX_BODY_CHARS),
    kind,
    tags: extractTags(trimmed),
    links: extractLinks(trimmed),
  }
}

const dormantAfterDays = { note: 14, idea: 30, question: 30, task: 30, bug: 30 } satisfies Record<BacklogKind, number>
const STALE_DOING_DAYS = 14
const ARCHIVE_CLOSED_DAYS = 7

/** Derived on read, never stored: any activity revives an item, and nothing has to sweep the store. */
const freshness = (item: Pick<BacklogItem, 'kind' | 'status' | 'pinned' | 'lastActivityAt'>, now: number): BacklogFreshness => {
  if (item.pinned) return 'fresh'
  const idleDays = (now - item.lastActivityAt) / DAY_MS
  if (item.status === 'done' || item.status === 'dropped') return idleDays >= ARCHIVE_CLOSED_DAYS ? 'archived' : 'fresh'
  if (item.status === 'doing') return idleDays >= STALE_DOING_DAYS ? 'stale' : 'fresh'
  return idleDays >= dormantAfterDays[item.kind] ? 'dormant' : 'fresh'
}

const searchText = (item: BacklogItem): string =>
  [`b:${item.id}`, item.title, item.body, item.project ?? '', ...item.tags.map(tag => `#${tag}`), ...item.links.map(link => link.target)]
    .join('\n')
    .toLowerCase()

/** Every whitespace-separated token must appear somewhere in the item; empty queries match all. */
const matches = (item: BacklogItem, query: string): boolean => {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const haystack = searchText(item)
  return tokens.every(token => haystack.includes(token))
}

const appendEvent = (events: readonly BacklogEvent[], event: BacklogEvent): BacklogEvent[] => [...events, event].slice(-MAX_EVENTS)

export class BacklogItems {
  static readonly kinds = kinds
  static readonly statuses = statuses
  static readonly linkTypes = linkTypes
  static readonly freshnessStates = freshnessStates
  static readonly humanFieldNames = humanFieldNames
  static readonly maxTitleChars = MAX_TITLE_CHARS
  static readonly maxBodyChars = MAX_BODY_CHARS
  static readonly maxTargetChars = MAX_TARGET_CHARS
  static readonly itemSchema = itemSchema
  static readonly linkSchema = linkSchema
  static readonly kindSchema = kindSchema
  static readonly statusSchema = statusSchema
  static readonly actorIdSchema = actorIdSchema
  static readonly triage = triage
  static readonly extractLinks = extractLinks
  static readonly extractTags = extractTags
  static readonly uniqueLinks = uniqueLinks
  static readonly sameLink = sameLink
  static readonly freshness = freshness
  static readonly matches = matches
  static readonly appendEvent = appendEvent
}
