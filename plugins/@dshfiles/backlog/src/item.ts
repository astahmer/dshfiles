import { Effect, Schema } from 'effect'

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

const kindSchema = Schema.Literals(kinds)
const statusSchema = Schema.Literals(statuses)
const relationSchema = Schema.Literals(relations)
const provenanceSchema = Schema.Literals(provenances)
const attentionSchema = Schema.Literals(attentions)
/** `relation` and `provenance` came later: rows written before them decode as a plain related link. */
const linkSchema = Schema.Struct({
  type: Schema.Literals(linkTypes),
  target: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_TARGET_CHARS)),
  relation: Schema.optionalKey(relationSchema),
  provenance: Schema.optionalKey(provenanceSchema),
})
/** `user`, `system`, or `agent:<sessionId>`. */
const actorIdSchema = Schema.String.check(Schema.isPattern(/^(user|system|agent:[\w.-]+)$/))
const fieldChangeSchema = Schema.Struct({
  field: Schema.Literals(humanFieldNames),
  before: Schema.String.check(Schema.isMaxLength(MAX_BODY_CHARS)),
  after: Schema.String.check(Schema.isMaxLength(MAX_BODY_CHARS)),
})

/** The fields a caller supplies; `createdAt` is the Host's to stamp, so the API input shares these and not the stored shape. */
const attachmentPayloadFields = {
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9-]{8,64}$/i)),
  kind: Schema.Literals(attachmentKinds),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  mediaType: Schema.String.check(Schema.isPattern(/^[\w.+-]+\/[\w.+-]+$/)),
  bytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(MAX_FILE_BYTES)),
  width: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(20_000))),
  height: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(20_000))),
} satisfies Schema.Struct.Fields

/** One file kept with an item; the bytes live in their own table, keyed by item and attachment. */
const attachmentFields = {
  ...attachmentPayloadFields,
  createdAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
} satisfies Schema.Struct.Fields
const attachmentSchema = Schema.Struct(attachmentFields)

/** `attachments` came later: events written before it decode without one, and a comment may carry images or files. */
const eventSchema = Schema.Struct({
  at: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  actor: actorIdSchema,
  commentId: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
  kind: Schema.Literals(['created', 'edited', 'moved', 'linked', 'unlinked', 'commented', 'triaged']),
  detail: Schema.String.check(Schema.isMaxLength(MAX_BODY_CHARS)),
  threadId: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_TARGET_CHARS))),
  attachments: Schema.optionalKey(Schema.Array(attachmentSchema).check(Schema.isMaxLength(MAX_ATTACHMENTS))),
  fieldChanges: Schema.optionalKey(Schema.Array(fieldChangeSchema).check(Schema.isMaxLength(humanFieldNames.length))),
})

/** What triage would change, with how sure it is; applied above the threshold, otherwise left for the user. */
const proposalSchema = Schema.Struct({
  kind: Schema.optionalKey(kindSchema),
  status: Schema.optionalKey(statusSchema),
  title: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_TITLE_CHARS))),
  tags: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isMaxLength(60))).check(Schema.isMaxLength(MAX_TAGS))),
  duplicateOf: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
  confidence: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
  reason: Schema.String.check(Schema.isMaxLength(500)),
  source: Schema.Literals(['jev', 'model', 'jev+model']),
  /** `thread` when a finished thread's reply suggested it, absent for a capture-time triage suggestion. */
  origin: Schema.optionalKey(Schema.Literal('thread')),
  at: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})

/** `URL.canParse` keeps the absolute-URL check the previous string rule applied while the value stays a string. */
const absoluteUrl = Schema.makeFilter((value: string) => (URL.canParse(value) ? undefined : 'Expected an absolute URL.'))
const tweetContextUrlSchema = Schema.String.check(Schema.isMaxLength(2_048), absoluteUrl)

const actorSchema = Schema.Struct({ id: actorIdSchema, role: Schema.Literals(['owner', 'contributor']) })

const itemSchema = Schema.Struct({
  id: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_TITLE_CHARS)),
  body: Schema.String.check(Schema.isMaxLength(MAX_BODY_CHARS)),
  kind: kindSchema,
  status: statusSchema,
  project: Schema.NullOr(Schema.String.check(Schema.isMaxLength(MAX_TARGET_CHARS))),
  tags: Schema.Array(Schema.String.check(Schema.isMaxLength(60))).check(Schema.isMaxLength(MAX_TAGS)),
  links: Schema.Array(linkSchema).check(Schema.isMaxLength(MAX_LINKS)),
  tweetContextUrls: Schema.optionalKey(Schema.Array(tweetContextUrlSchema).check(Schema.isMaxLength(20))),
  /** Items persisted before attachments existed decode without the field, so its absence still fills an empty list. */
  attachments: Schema.Array(attachmentSchema)
    .check(Schema.isMaxLength(MAX_ATTACHMENTS))
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  actors: Schema.Array(actorSchema).check(Schema.isMaxLength(50)),
  pinned: Schema.Boolean,
  humanFields: Schema.Array(Schema.Literals(humanFieldNames)),
  createdAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  lastActivityAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  events: Schema.Array(eventSchema).check(Schema.isMaxLength(MAX_EVENTS)),
  proposal: Schema.optionalKey(Schema.NullOr(proposalSchema)),
  attention: Schema.optionalKey(attentionSchema),
  acknowledgedAt: Schema.optionalKey(Schema.NullOr(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)))),
  snoozedUntil: Schema.optionalKey(Schema.NullOr(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)))),
})

export type BacklogProposal = typeof proposalSchema.Type
export type BacklogKind = typeof kindSchema.Type
export type BacklogStatus = typeof statusSchema.Type
export type BacklogLink = typeof linkSchema.Type
export type BacklogAttention = typeof attentionSchema.Type
export type BacklogRelation = typeof relationSchema.Type
export type BacklogEvent = typeof eventSchema.Type
export type BacklogAttachment = typeof attachmentSchema.Type
/** One file the API receives; the bytes are base64 without a data-URL prefix. */
export type BacklogFileInput = Omit<BacklogAttachment, 'createdAt'> & {
  readonly data: string
  readonly width?: number | undefined
  readonly height?: number | undefined
}
export type BacklogItem = typeof itemSchema.Type
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
  { type: 'workspace', pattern: /(?<![\w/])workspace:([^\s)]+)/g },
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

/** The `created` event names the item's author, so trimming the oldest events always keeps it. */
const appendEvent = (events: readonly BacklogEvent[], event: BacklogEvent): BacklogEvent[] => {
  const appended = [...events, event]
  if (appended.length <= MAX_EVENTS) return appended
  const [first] = appended
  if (first?.kind !== 'created') return appended.slice(-MAX_EVENTS)
  return [first, ...appended.slice(-(MAX_EVENTS - 1))]
}

/** The actor who captured the item: its owner, or the `created` event of a row that lost its owner entry. */
const creatorOf = (item: Pick<BacklogItem, 'actors' | 'events'>): string | undefined =>
  item.actors.find(actor => actor.role === 'owner')?.id ?? item.events.find(event => event.kind === 'created')?.actor

/**
 * An item an agent captured that nobody has claimed yet: the user never touched it (any edit, comment, move or pin
 * adds them as an actor), and it neither asks for attention nor waits on a suggestion. "Hide agent items" hides these.
 */
const isUnclaimedAgentItem = (item: Pick<BacklogItem, 'actors' | 'events' | 'attention' | 'proposal'>): boolean =>
  (creatorOf(item)?.startsWith('agent:') ?? false) &&
  !item.actors.some(actor => actor.id === 'user') &&
  (item.attention ?? 'none') === 'none' &&
  (item.proposal ?? null) === null

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
  static readonly attachmentPayloadFields = attachmentPayloadFields
  static readonly attachmentFields = attachmentFields
  static readonly actorSchema = actorSchema
  static readonly attachmentSchema = attachmentSchema
  static readonly tweetContextUrlSchema = tweetContextUrlSchema
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
  static readonly creatorOf = creatorOf
  static readonly isUnclaimedAgentItem = isUnclaimedAgentItem
}
