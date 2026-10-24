import { z } from 'zod'

const DAY_MS = 86_400_000
const MAX_TITLE_CHARS = 200
const MAX_BODY_CHARS = 20_000
const MAX_TARGET_CHARS = 500
const MAX_TAGS = 20
const MAX_LINKS = 100
const MAX_EVENTS = 200
const MAX_ATTACHMENTS = 8
const MAX_FILE_BYTES = 16 * 1024 * 1024
const attachmentKinds = ['image', 'file'] as const

const kinds = ['task', 'bug', 'idea', 'note', 'question'] as const
const statuses = ['inbox', 'todo', 'doing', 'done', 'dropped'] as const
const linkTypes = ['item', 'thread', 'revision', 'branch', 'workspace', 'url', 'secret'] as const
const relations = ['related', 'depends-on', 'blocks', 'duplicates', 'implements', 'fixes', 'discovered-from', 'discussed-in'] as const
const provenances = ['user', 'agent', 'extracted', 'inferred'] as const
const attentions = ['none', 'needs-input', 'blocked', 'waiting'] as const
const freshnessStates = ['fresh', 'stale', 'dormant', 'archived'] as const
const humanFieldNames = ['title', 'body', 'kind', 'status', 'project', 'tags', 'pinned', 'attention'] as const
const imageMediaTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

const kindSchema = z.enum(kinds)
const statusSchema = z.enum(statuses)
const relationSchema = z.enum(relations)
const provenanceSchema = z.enum(provenances)
const attentionSchema = z.enum(attentions)
/** `relation` and `provenance` came later: rows written before them decode as a plain related link. */
const linkSchema = z
  .object({
    type: z.enum(linkTypes),
    target: z.string().min(1).max(MAX_TARGET_CHARS),
    relation: relationSchema.optional(),
    provenance: provenanceSchema.optional(),
  })
  .strict()
/** `user`, `system`, or `agent:<sessionId>`. */
const actorIdSchema = z.string().regex(/^(user|system|agent:[\w.-]+)$/)
const fieldChangeSchema = z.object({ field: z.enum(humanFieldNames), before: z.string().max(MAX_BODY_CHARS), after: z.string().max(MAX_BODY_CHARS) }).strict()

/** One file kept with an item; the bytes live in their own table, keyed by item and attachment. */
const attachmentSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{8,64}$/i),
    kind: z.enum(attachmentKinds),
    name: z.string().min(1).max(200),
    mediaType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
    bytes: z.number().int().positive().max(MAX_FILE_BYTES),
    width: z.number().int().positive().max(20_000).optional(),
    height: z.number().int().positive().max(20_000).optional(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict()

/** `attachments` came later: events written before it decode without one, and a comment may carry images or files. */
const eventSchema = z
  .object({
    at: z.number().int().nonnegative(),
    actor: actorIdSchema,
    commentId: z.string().min(1).max(128).optional(),
    kind: z.enum(['created', 'edited', 'moved', 'linked', 'unlinked', 'commented', 'triaged']),
    detail: z.string().max(MAX_BODY_CHARS),
    threadId: z.string().min(1).max(MAX_TARGET_CHARS).optional(),
    attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional(),
    fieldChanges: z.array(fieldChangeSchema).max(humanFieldNames.length).optional(),
  })
  .strict()

/** What triage would change, with how sure it is; applied above the threshold, otherwise left for the user. */
const proposalSchema = z
  .object({
    kind: kindSchema.optional(),
    status: statusSchema.optional(),
    title: z.string().min(1).max(MAX_TITLE_CHARS).optional(),
    tags: z.array(z.string().max(60)).max(MAX_TAGS).optional(),
    duplicateOf: z.number().int().positive().optional(),
    confidence: z.number().min(0).max(1),
    reason: z.string().max(500),
    source: z.enum(['jev', 'model', 'jev+model']),
    /** `thread` when a finished thread's reply suggested it, absent for a capture-time triage suggestion. */
    origin: z.enum(['thread']).optional(),
    at: z.number().int().nonnegative(),
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
    attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).default([]),
    actors: z.array(z.object({ id: actorIdSchema, role: z.enum(['owner', 'contributor']) }).strict()).max(50),
    pinned: z.boolean(),
    humanFields: z.array(z.enum(humanFieldNames)),
    createdAt: z.number().int().nonnegative(),
    lastActivityAt: z.number().int().nonnegative(),
    events: z.array(eventSchema).max(MAX_EVENTS),
    proposal: proposalSchema.nullable().optional(),
    attention: attentionSchema.optional(),
    acknowledgedAt: z.number().int().nonnegative().nullable().optional(),
    snoozedUntil: z.number().int().nonnegative().nullable().optional(),
  })
  .strict()

export type BacklogProposal = z.infer<typeof proposalSchema>
export type BacklogKind = z.infer<typeof kindSchema>
export type BacklogStatus = z.infer<typeof statusSchema>
export type BacklogLink = z.infer<typeof linkSchema>
export type BacklogAttention = z.infer<typeof attentionSchema>
export type BacklogRelation = z.infer<typeof relationSchema>
export type BacklogEvent = z.infer<typeof eventSchema>
export type BacklogAttachment = z.infer<typeof attachmentSchema>
/** One file the API receives; the bytes are base64 without a data-URL prefix. */
export type BacklogFileInput = Omit<BacklogAttachment, 'createdAt'> & {
  readonly data: string
  readonly width?: number | undefined
  readonly height?: number | undefined
}
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
  { type: 'secret', pattern: /(?<![\w/])secret:([A-Za-z_][A-Za-z0-9_-]*(?:@[A-Za-z0-9_-]+)?)/g },
]

const tagPattern = /(?<![\w&#/])#([a-z][\w-]{0,59})/gi

const sameLink = (left: Pick<BacklogLink, 'type' | 'target'>, right: Pick<BacklogLink, 'type' | 'target'>): boolean =>
  left.type === right.type && left.target === right.target

const uniqueLinks = (links: readonly BacklogLink[]): BacklogLink[] =>
  links.filter((link, index) => links.findIndex(other => sameLink(other, link)) === index).slice(0, MAX_LINKS)

const extractLinks = (text: string): BacklogLink[] =>
  uniqueLinks(
    linkPatterns.flatMap(({ type, pattern }) =>
      [...text.matchAll(pattern)].flatMap(match =>
        match[1] === undefined ? [] : [{ type, target: match[1].slice(0, MAX_TARGET_CHARS), provenance: 'extracted' as const }],
      ),
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
  const titleWithoutTags = titleLine.replace(/(\s+#[a-z][\w-]{0,59})+$/i, '')
  const kind: BacklogKind = prefixKind ?? (titleLine.endsWith('?') ? 'question' : 'task')
  const bodyFromTitle = titleWithoutTags.slice(MAX_TITLE_CHARS)
  return {
    title: titleWithoutTags.slice(0, MAX_TITLE_CHARS) || 'Untitled',
    body: [bodyFromTitle, rest.join('\n')]
      .filter(part => part !== '')
      .join('\n')
      .trim()
      .slice(0, MAX_BODY_CHARS),
    kind,
    tags: extractTags(trimmed),
    links: extractLinks(trimmed),
  }
}

const defaultDormantDays = { note: 14, idea: 30, question: 30, task: 30, bug: 30 } satisfies Record<BacklogKind, number>
const STALE_DOING_DAYS = 14
const ARCHIVE_CLOSED_DAYS = 7

// jj-integration cuts a thread workspace at `<repository>-threads/<name>`; older ones are `<repository>-<hash>`.
const THREADS_DIRECTORY_SUFFIX = '-threads'

/**
 * The project an item belongs to: a capture made in a jj workspace is work on the project that workspace was cut
 * from, so the workspace path is folded to its repository and never listed as a project of its own.
 */
const projectPath = (path: string): string => {
  const normalized = path.replace(/\/+$/u, '')
  const separator = normalized.lastIndexOf('/')
  if (separator < 0) return normalized
  const parent = normalized.slice(0, separator)
  if (parent.length <= THREADS_DIRECTORY_SUFFIX.length || !parent.endsWith(THREADS_DIRECTORY_SUFFIX)) return normalized
  return parent.slice(0, -THREADS_DIRECTORY_SUFFIX.length)
}

const projectOf = (project: string | null): string | null => (project === null ? null : projectPath(project))

/**
 * Visibility, derived on read and never stored: any activity revives an item and nothing sweeps the store. An open item
 * asking for attention never sinks; closed items archive after a week unless pinned.
 */
const freshness = (
  item: Pick<BacklogItem, 'kind' | 'status' | 'pinned' | 'lastActivityAt'> & { readonly attention?: BacklogAttention | undefined },
  now: number,
  dormantDays: Readonly<Record<BacklogKind, number>> = defaultDormantDays,
): BacklogFreshness => {
  if (item.pinned) return 'fresh'
  const idleDays = (now - item.lastActivityAt) / DAY_MS
  if (item.status === 'done' || item.status === 'dropped') return idleDays >= ARCHIVE_CLOSED_DAYS ? 'archived' : 'fresh'
  if (item.attention !== undefined && item.attention !== 'none') return 'fresh'
  if (item.status === 'doing') return idleDays >= STALE_DOING_DAYS ? 'stale' : 'fresh'
  const limit = dormantDays[item.kind]
  return limit > 0 && idleDays >= limit ? 'dormant' : 'fresh'
}

const appendEvent = (events: readonly BacklogEvent[], event: BacklogEvent): BacklogEvent[] => [...events, event].slice(-MAX_EVENTS)

/** The marker a backfill leaves when triage looked at an item and found nothing to change; not activity of its own. */
const triageNoChange = 'found nothing to change'

export class BacklogItems {
  static readonly kinds = kinds
  static readonly statuses = statuses
  static readonly linkTypes = linkTypes
  static readonly relations = relations
  static readonly provenances = provenances
  static readonly attentions = attentions
  static readonly attentionSchema = attentionSchema
  static readonly relationSchema = relationSchema
  static readonly defaultDormantDays = defaultDormantDays
  static readonly freshnessStates = freshnessStates
  static readonly humanFieldNames = humanFieldNames
  static readonly maxTitleChars = MAX_TITLE_CHARS
  static readonly maxBodyChars = MAX_BODY_CHARS
  static readonly maxTargetChars = MAX_TARGET_CHARS
  static readonly maxAttachments = MAX_ATTACHMENTS
  static readonly maxFileBytes = MAX_FILE_BYTES
  static readonly attachmentKinds = attachmentKinds
  static readonly imageMediaTypes = imageMediaTypes
  static readonly attachmentSchema = attachmentSchema
  static readonly itemSchema = itemSchema
  static readonly proposalSchema = proposalSchema
  static readonly linkSchema = linkSchema
  static readonly kindSchema = kindSchema
  static readonly statusSchema = statusSchema
  static readonly actorIdSchema = actorIdSchema
  static readonly triage = triage
  static readonly triageNoChange = triageNoChange
  static readonly extractLinks = extractLinks
  static readonly extractTags = extractTags
  static readonly uniqueLinks = uniqueLinks
  static readonly sameLink = sameLink
  static readonly projectPath = projectPath
  static readonly projectOf = projectOf
  static readonly freshness = freshness
  static readonly appendEvent = appendEvent
}
