import { Schema, Struct } from 'effect'
import { BacklogItems, type BacklogEvent, type BacklogItem } from './item.js'

/**
 * The backlog's source of truth: every change to an item is one or more ops appended to a log, and an item is the fold
 * of its ops. The folded item is a cache the store keeps in memory and in the `items` table.
 */

/** A hybrid logical clock stamp: wall milliseconds, a counter for stamps within one millisecond, and the host that took it. */
export interface Hlc {
  readonly wall: number
  readonly counter: number
  readonly host: string
}

/** The stamp after `previous`: the wall clock when it moved forward, else the same wall with the next counter. */
const nextHlc = (input: { readonly previous: Hlc | null; readonly now: number; readonly host: string }): Hlc => {
  const previous = input.previous
  if (previous === null || input.now > previous.wall) return { wall: input.now, counter: 0, host: input.host }
  return { wall: previous.wall, counter: previous.counter + 1, host: input.host }
}

const compareHlc = (left: Hlc, right: Hlc): number =>
  left.wall - right.wall || left.counter - right.counter || (left.host < right.host ? -1 : left.host > right.host ? 1 : 0)

const eventSchema = BacklogItems.eventSchema
const createFieldsSchema = BacklogItems.itemSchema.mapFields(Struct.omit(['id', 'events']))
const nullableTime = Schema.NullOr(Schema.Number)

const setOf = <const Field extends string, Value extends Schema.Top>(field: Field, value: Value) =>
  Schema.Struct({ kind: Schema.Literal('set'), field: Schema.Literal(field), value })

/** Last-writer-wins registers: one `set` replaces the field. Collections take `set` only when add/remove cannot express a change. */
const setOpSchema = Schema.Union([
  setOf('title', Schema.String),
  setOf('body', Schema.String),
  setOf('kind', BacklogItems.kindSchema),
  setOf('status', BacklogItems.statusSchema),
  setOf('project', Schema.NullOr(Schema.String)),
  setOf('pinned', Schema.Boolean),
  setOf('humanFields', Schema.Array(BacklogItems.humanFieldSchema)),
  setOf('createdAt', Schema.Number),
  setOf('lastActivityAt', Schema.Number),
  setOf('proposal', Schema.NullOr(BacklogItems.proposalSchema)),
  setOf('attention', BacklogItems.attentionSchema),
  setOf('acknowledgedAt', nullableTime),
  setOf('snoozedUntil', nullableTime),
  setOf('tweetContextUrls', Schema.Array(BacklogItems.tweetContextUrlSchema)),
  setOf('tags', Schema.Array(BacklogItems.tagSchema)),
  setOf('links', Schema.Array(BacklogItems.linkSchema)),
  setOf('actors', Schema.Array(BacklogItems.actorSchema)),
  setOf('attachments', Schema.Array(BacklogItems.attachmentSchema)),
  setOf('events', Schema.Array(eventSchema)),
  setOf('priority', BacklogItems.prioritySchema),
  setOf('parent', BacklogItems.itemRefSchema),
  setOf('delegate', BacklogItems.delegateSchema),
  setOf('criteria', BacklogItems.criteriaSchema),
  setOf('plan', Schema.String),
  setOf('planApproval', BacklogItems.planApprovalSchema),
  setOf('summary', Schema.String),
  setOf('due', Schema.String),
  setOf('recurrence', Schema.String),
])

const optionalFields = [
  'proposal',
  'attention',
  'acknowledgedAt',
  'snoozedUntil',
  'tweetContextUrls',
  'priority',
  'parent',
  'delegate',
  'criteria',
  'plan',
  'planApproval',
  'summary',
  'due',
  'recurrence',
] as const
type OptionalField = (typeof optionalFields)[number]

const memberOf = <const Kind extends 'add' | 'remove'>(kind: Kind) =>
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal(kind), field: Schema.Literal('tags'), value: BacklogItems.tagSchema }),
    Schema.Struct({ kind: Schema.Literal(kind), field: Schema.Literal('links'), value: BacklogItems.linkSchema }),
    Schema.Struct({ kind: Schema.Literal(kind), field: Schema.Literal('actors'), value: BacklogItems.actorSchema }),
  ])

/** A comment is found by its id, or, for one written before comment ids existed, by when and by whom. */
const commentTargetSchema = Schema.Union([Schema.Struct({ commentId: Schema.String }), Schema.Struct({ at: Schema.Number, actor: BacklogItems.actorIdSchema })])

const opSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('create'), item: createFieldsSchema, event: Schema.optionalKey(eventSchema) }),
  setOpSchema,
  Schema.Struct({ kind: Schema.Literal('unset'), field: Schema.Literals(optionalFields) }),
  memberOf('add'),
  memberOf('remove'),
  Schema.Struct({ kind: Schema.Literal('attach'), attachment: BacklogItems.attachmentSchema }),
  Schema.Struct({ kind: Schema.Literal('detach'), attachmentId: Schema.String }),
  /** An activity entry: moved, linked, triaged, edited and the rest of the timeline. */
  Schema.Struct({ kind: Schema.Literal('event'), event: eventSchema }),
  Schema.Struct({ kind: Schema.Literal('comment'), event: eventSchema }),
  Schema.Struct({ kind: Schema.Literal('comment-edit'), target: commentTargetSchema, event: eventSchema }),
  Schema.Struct({ kind: Schema.Literal('comment-delete'), target: commentTargetSchema }),
  Schema.Struct({ kind: Schema.Literal('delete') }),
])

export type BacklogOp = typeof opSchema.Type
type CommentTarget = typeof commentTargetSchema.Type
type MutableItem = { -readonly [Key in keyof BacklogItem]: BacklogItem[Key] }

/** One stored op: its ULID, the item it changes, its stamp and the actor whose change it is. */
export interface BacklogOpRecord {
  readonly opId: string
  readonly itemId: string
  readonly hlc: Hlc
  readonly origin: string
  readonly op: BacklogOp
}

/** Order-insensitive for object keys and blind to keys holding `undefined`, the way the stored JSON round-trips. */
const sameValue = (left: unknown, right: unknown): boolean => {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => sameValue(value, right[index]))
  }
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  const leftEntries = Object.entries(left).filter(([, value]) => value !== undefined)
  const rightEntries = new Map(Object.entries(right).filter(([, value]) => value !== undefined))
  return leftEntries.length === rightEntries.size && leftEntries.every(([key, value]) => rightEntries.has(key) && sameValue(value, rightEntries.get(key)))
}

const isComment = (event: BacklogEvent): boolean => event.kind === 'commented'

const targetOf = (event: BacklogEvent): CommentTarget => (event.commentId === undefined ? { at: event.at, actor: event.actor } : { commentId: event.commentId })

const commentIndex = (events: readonly BacklogEvent[], target: CommentTarget): number =>
  events.findIndex(event =>
    isComment(event) && 'commentId' in target
      ? event.commentId === target.commentId
      : event.commentId === undefined && 'at' in target && event.at === target.at && event.actor === target.actor,
  )

const withMember = <Value>(values: readonly Value[], value: Value): Value[] =>
  values.some(existing => sameValue(existing, value)) ? [...values] : [...values, value]
const withoutMember = <Value>(values: readonly Value[], value: Value): Value[] => values.filter(existing => !sameValue(existing, value))

const applySet = (item: MutableItem, op: typeof setOpSchema.Type): void => {
  switch (op.field) {
    case 'title':
      item.title = op.value
      return
    case 'body':
      item.body = op.value
      return
    case 'kind':
      item.kind = op.value
      return
    case 'status':
      item.status = op.value
      return
    case 'project':
      item.project = op.value
      return
    case 'pinned':
      item.pinned = op.value
      return
    case 'humanFields':
      item.humanFields = op.value
      return
    case 'createdAt':
      item.createdAt = op.value
      return
    case 'lastActivityAt':
      item.lastActivityAt = op.value
      return
    case 'proposal':
      item.proposal = op.value
      return
    case 'attention':
      item.attention = op.value
      return
    case 'acknowledgedAt':
      item.acknowledgedAt = op.value
      return
    case 'snoozedUntil':
      item.snoozedUntil = op.value
      return
    case 'tweetContextUrls':
      item.tweetContextUrls = op.value
      return
    case 'tags':
      item.tags = op.value
      return
    case 'links':
      item.links = op.value
      return
    case 'actors':
      item.actors = op.value
      return
    case 'attachments':
      item.attachments = op.value
      return
    case 'events':
      item.events = op.value
      return
    case 'priority':
      item.priority = op.value
      return
    case 'parent':
      item.parent = op.value
      return
    case 'delegate':
      item.delegate = op.value
      return
    case 'criteria':
      item.criteria = op.value
      return
    case 'plan':
      item.plan = op.value
      return
    case 'planApproval':
      item.planApproval = op.value
      return
    case 'summary':
      item.summary = op.value
      return
    case 'due':
      item.due = op.value
      return
    case 'recurrence':
      item.recurrence = op.value
  }
}

const unsetField = (item: MutableItem, field: OptionalField): void => {
  switch (field) {
    case 'proposal':
      delete item.proposal
      return
    case 'attention':
      delete item.attention
      return
    case 'acknowledgedAt':
      delete item.acknowledgedAt
      return
    case 'snoozedUntil':
      delete item.snoozedUntil
      return
    case 'tweetContextUrls':
      delete item.tweetContextUrls
      return
    case 'priority':
      delete item.priority
      return
    case 'parent':
      delete item.parent
      return
    case 'delegate':
      delete item.delegate
      return
    case 'criteria':
      delete item.criteria
      return
    case 'plan':
      delete item.plan
      return
    case 'planApproval':
      delete item.planApproval
      return
    case 'summary':
      delete item.summary
      return
    case 'due':
      delete item.due
      return
    case 'recurrence':
      delete item.recurrence
  }
}

/** One op applied to the item it changes; `null` is no item yet, or a deleted one. Ops before a `create` change nothing. */
const applyOp = (input: { readonly id: number; readonly item: BacklogItem | null; readonly op: BacklogOp }): BacklogItem | null => {
  const op = input.op
  if (op.kind === 'create') return { id: input.id, ...op.item, events: op.event === undefined ? [] : [op.event] }
  if (op.kind === 'delete' || input.item === null) return null
  const item: MutableItem = { ...input.item }
  switch (op.kind) {
    case 'set':
      applySet(item, op)
      break
    case 'unset':
      unsetField(item, op.field)
      break
    case 'add':
      if (op.field === 'tags') item.tags = withMember(item.tags, op.value)
      if (op.field === 'links') item.links = withMember(item.links, op.value)
      if (op.field === 'actors') item.actors = withMember(item.actors, op.value)
      break
    case 'remove':
      if (op.field === 'tags') item.tags = withoutMember(item.tags, op.value)
      if (op.field === 'links') item.links = withoutMember(item.links, op.value)
      if (op.field === 'actors') item.actors = withoutMember(item.actors, op.value)
      break
    case 'attach':
      item.attachments = [...item.attachments.filter(attachment => attachment.id !== op.attachment.id), op.attachment]
      break
    case 'detach':
      item.attachments = item.attachments.filter(attachment => attachment.id !== op.attachmentId)
      break
    case 'event':
    case 'comment':
      item.events = [...item.events, op.event]
      break
    case 'comment-edit': {
      const index = commentIndex(item.events, op.target)
      if (index >= 0) item.events = item.events.map((event, position) => (position === index ? op.event : event))
      break
    }
    case 'comment-delete': {
      const index = commentIndex(item.events, op.target)
      if (index >= 0) item.events = item.events.filter((_event, position) => position !== index)
      break
    }
  }
  return item
}

const applyOps = (input: { readonly id: number; readonly item: BacklogItem | null; readonly ops: readonly BacklogOp[] }): BacklogItem | null =>
  input.ops.reduce<BacklogItem | null>((item, op) => applyOp({ id: input.id, item, op }), input.item)

const scalarFields = ['title', 'body', 'kind', 'status', 'project', 'pinned', 'humanFields', 'createdAt', 'lastActivityAt'] as const

/** One `set` per field that differs, for the fields a store write replaces whole. */
const setOpFor = (
  next: BacklogItem,
  field: (typeof scalarFields)[number] | OptionalField | 'tags' | 'links' | 'actors' | 'attachments' | 'events',
): BacklogOp | null => {
  switch (field) {
    case 'title':
      return { kind: 'set', field, value: next.title }
    case 'body':
      return { kind: 'set', field, value: next.body }
    case 'kind':
      return { kind: 'set', field, value: next.kind }
    case 'status':
      return { kind: 'set', field, value: next.status }
    case 'project':
      return { kind: 'set', field, value: next.project }
    case 'pinned':
      return { kind: 'set', field, value: next.pinned }
    case 'humanFields':
      return { kind: 'set', field, value: next.humanFields }
    case 'createdAt':
      return { kind: 'set', field, value: next.createdAt }
    case 'lastActivityAt':
      return { kind: 'set', field, value: next.lastActivityAt }
    case 'tags':
      return { kind: 'set', field, value: next.tags }
    case 'links':
      return { kind: 'set', field, value: next.links }
    case 'actors':
      return { kind: 'set', field, value: next.actors }
    case 'attachments':
      return { kind: 'set', field, value: next.attachments }
    case 'events':
      return { kind: 'set', field, value: next.events }
    case 'proposal':
      return next.proposal === undefined ? { kind: 'unset', field } : { kind: 'set', field, value: next.proposal }
    case 'attention':
      return next.attention === undefined ? { kind: 'unset', field } : { kind: 'set', field, value: next.attention }
    case 'acknowledgedAt':
      return next.acknowledgedAt === undefined ? { kind: 'unset', field } : { kind: 'set', field, value: next.acknowledgedAt }
    case 'snoozedUntil':
      return next.snoozedUntil === undefined ? { kind: 'unset', field } : { kind: 'set', field, value: next.snoozedUntil }
    case 'tweetContextUrls':
      return next.tweetContextUrls === undefined ? { kind: 'unset', field } : { kind: 'set', field, value: next.tweetContextUrls }
    case 'priority':
      return next.priority === undefined ? { kind: 'unset', field } : { kind: 'set', field, value: next.priority }
    case 'parent':
      return next.parent === undefined ? { kind: 'unset', field } : { kind: 'set', field, value: next.parent }
    case 'delegate':
      return next.delegate === undefined ? { kind: 'unset', field } : { kind: 'set', field, value: next.delegate }
    case 'criteria':
      return next.criteria === undefined ? { kind: 'unset', field } : { kind: 'set', field, value: next.criteria }
    case 'plan':
      return next.plan === undefined ? { kind: 'unset', field } : { kind: 'set', field, value: next.plan }
    case 'planApproval':
      return next.planApproval === undefined ? { kind: 'unset', field } : { kind: 'set', field, value: next.planApproval }
    case 'summary':
      return next.summary === undefined ? { kind: 'unset', field } : { kind: 'set', field, value: next.summary }
    case 'due':
      return next.due === undefined ? { kind: 'unset', field } : { kind: 'set', field, value: next.due }
    case 'recurrence':
      return next.recurrence === undefined ? { kind: 'unset', field } : { kind: 'set', field, value: next.recurrence }
  }
}

const replaceFields = [...scalarFields, ...optionalFields, 'tags', 'links', 'actors', 'attachments', 'events'] as const

/** `set`/`unset` for every field whose value differs: always exact, used when a finer diff would not reproduce `next`. */
const replacementOps = (prev: BacklogItem, next: BacklogItem): BacklogOp[] =>
  replaceFields.flatMap(field => (sameValue(prev[field], next[field]) ? [] : (setOpFor(next, field) ?? [])))

const memberOps = <Value>(input: {
  readonly prev: readonly Value[]
  readonly next: readonly Value[]
  readonly op: (kind: 'add' | 'remove', value: Value) => BacklogOp
}): BacklogOp[] => [
  ...input.prev.filter(value => !input.next.some(candidate => sameValue(candidate, value))).map(value => input.op('remove', value)),
  ...input.next.filter(value => !input.prev.some(candidate => sameValue(candidate, value))).map(value => input.op('add', value)),
]

const attachmentOps = (prev: BacklogItem, next: BacklogItem): BacklogOp[] => [
  ...prev.attachments
    .filter(attachment => !next.attachments.some(candidate => candidate.id === attachment.id))
    .map(attachment => ({ kind: 'detach' as const, attachmentId: attachment.id })),
  ...next.attachments
    .filter(attachment => !prev.attachments.some(candidate => sameValue(candidate, attachment)))
    .map(attachment => ({ kind: 'attach' as const, attachment })),
]

const eventOf = (event: BacklogEvent): BacklogOp => (isComment(event) ? { kind: 'comment', event } : { kind: 'event', event })

/** Appended events, and comments edited or deleted in place; `null` when the change is anything else. */
const eventOps = (prev: readonly BacklogEvent[], next: readonly BacklogEvent[]): BacklogOp[] | null => {
  const ops: BacklogOp[] = []
  let prevIndex = 0
  let nextIndex = 0
  while (prevIndex < prev.length) {
    const before = prev[prevIndex]
    const after = next[nextIndex]
    if (before === undefined) break
    if (after !== undefined && sameValue(before, after)) {
      prevIndex += 1
      nextIndex += 1
      continue
    }
    if (!isComment(before)) return null
    if (after !== undefined && isComment(after) && after.at === before.at && after.actor === before.actor) {
      ops.push({ kind: 'comment-edit', target: targetOf(before), event: after })
      prevIndex += 1
      nextIndex += 1
      continue
    }
    ops.push({ kind: 'comment-delete', target: targetOf(before) })
    prevIndex += 1
  }
  return [...ops, ...next.slice(nextIndex).map(eventOf)]
}

/**
 * The ops that turn `prev` into `next`: typed `set`s, add/remove for the sets, attach/detach, and one op per event. The
 * result is folded back and compared, so a change the fine diff cannot express falls back to whole-field `set`s and the
 * log always reproduces the store's item exactly.
 */
const diff = (prev: BacklogItem, next: BacklogItem): BacklogOp[] => {
  const fieldOps = [...scalarFields, ...optionalFields].flatMap(field => (sameValue(prev[field], next[field]) ? [] : (setOpFor(next, field) ?? [])))
  const events = eventOps(prev.events, next.events)
  const fine = [
    ...fieldOps,
    ...memberOps({ prev: prev.tags, next: next.tags, op: (kind, value) => ({ kind, field: 'tags', value }) }),
    ...memberOps({ prev: prev.links, next: next.links, op: (kind, value) => ({ kind, field: 'links', value }) }),
    ...memberOps({ prev: prev.actors, next: next.actors, op: (kind, value) => ({ kind, field: 'actors', value }) }),
    ...attachmentOps(prev, next),
    ...(events ?? [{ kind: 'set' as const, field: 'events' as const, value: next.events }]),
  ]
  return sameValue(applyOps({ id: next.id, item: prev, ops: fine }), next) ? fine : replacementOps(prev, next)
}

/** The ops of a new item: `create` with its first event, then one op per later event. */
const createOps = (item: BacklogItem): BacklogOp[] => {
  const fields = Struct.omit(item, ['id', 'events'])
  const [first, ...rest] = item.events
  const create: BacklogOp = first === undefined ? { kind: 'create', item: fields } : { kind: 'create', item: fields, event: first }
  return [create, ...rest.map(eventOf)]
}

/** Folds stored ops (any order) into the item, or `null` when it was deleted or never created. */
const fold = (input: { readonly id: number; readonly records: readonly BacklogOpRecord[] }): BacklogItem | null =>
  applyOps({
    id: input.id,
    item: null,
    ops: [...input.records].sort((left, right) => compareHlc(left.hlc, right.hlc) || (left.opId < right.opId ? -1 : 1)).map(record => record.op),
  })

const opJson = Schema.fromJsonString(opSchema)

export class BacklogOps {
  static readonly schema = opSchema
  static readonly json = opJson
  static readonly nextHlc = nextHlc
  static readonly compareHlc = compareHlc
  static readonly diff = diff
  static readonly createOps = createOps
  static readonly apply = applyOps
  static readonly fold = fold
  static readonly sameValue = sameValue
}
