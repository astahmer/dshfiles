import { Schema } from 'effect'
import { BacklogItems, type BacklogItem, type BacklogStatus } from './item.js'

/** The remote trackers a backlog item can mirror. */
const backends = ['linear', 'github'] as const
const syncStates = ['synced', 'pending', 'conflict', 'error'] as const
/** The item fields two-way sync owns; kind, project, attention and pins stay local. */
const syncedFields = ['title', 'body', 'status', 'tags'] as const

const MAX_CONFLICTS = 20
const MAX_COMMENT_PAIRS = 400

const backendSchema = Schema.Literals(backends)
const fieldSchema = Schema.Literals(syncedFields)
const timestamp = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

/** The synced fields as one side last saw them; a remote side may not express a status (null). */
const snapshotSchema = Schema.Struct({
  title: Schema.String.check(Schema.isMaxLength(BacklogItems.maxTitleChars * 2)),
  body: Schema.String.check(Schema.isMaxLength(BacklogItems.maxBodyChars * 4)),
  status: Schema.NullOr(BacklogItems.statusSchema),
  tags: Schema.Array(Schema.String.check(Schema.isMaxLength(60))).check(Schema.isMaxLength(50)),
})

/** One field both sides changed since the last sync, and which side's value was kept. */
const conflictSchema = Schema.Struct({
  field: fieldSchema,
  at: timestamp,
  kept: Schema.Literals(['local', 'remote']),
  local: Schema.String.check(Schema.isMaxLength(2_000)),
  remote: Schema.String.check(Schema.isMaxLength(2_000)),
})

const syncErrorSchema = Schema.Struct({
  code: Schema.String.check(Schema.isMaxLength(64)),
  message: Schema.String.check(Schema.isMaxLength(1_000)),
  at: timestamp,
})

/**
 * How one item is tied to one remote issue. `base` keeps both sides as the last sync left them, so a lossy mapping (a
 * GitHub issue has no "in progress") never reads as a change on the next pass.
 */
const mappingSchema = Schema.Struct({
  itemId: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  backend: backendSchema,
  remoteId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  remoteKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(BacklogItems.maxTargetChars)),
  linkedAt: timestamp,
  lastSyncedAt: Schema.NullOr(timestamp),
  /** Remote `updatedAt` seen at the last sync. */
  remoteUpdatedAt: Schema.NullOr(timestamp),
  /** Item revision (`lastActivityAt`) right after the last sync. */
  localSyncedAt: Schema.NullOr(timestamp),
  base: Schema.NullOr(Schema.Struct({ local: snapshotSchema, remote: snapshotSchema })),
  /** Local comment id ↔ remote comment id, for comments either side already carried over. */
  comments: Schema.Array(Schema.Struct({ local: Schema.String.check(Schema.isMaxLength(128)), remote: Schema.String.check(Schema.isMaxLength(200)) })).check(
    Schema.isMaxLength(MAX_COMMENT_PAIRS),
  ),
  /** Local comments older than the link are not pushed unless the item was created remotely from here. */
  pushCommentsSince: timestamp,
  state: Schema.Literals(syncStates),
  conflicts: Schema.Array(conflictSchema).check(Schema.isMaxLength(MAX_CONFLICTS)),
  lastError: Schema.NullOr(syncErrorSchema),
})

export type SyncBackendKind = (typeof backends)[number]
export type SyncState = (typeof syncStates)[number]
export type SyncField = (typeof syncedFields)[number]
export type SyncSnapshot = typeof snapshotSchema.Type
export type SyncConflict = typeof conflictSchema.Type
export type SyncMapping = typeof mappingSchema.Type
export type SyncErrorRecord = typeof syncErrorSchema.Type

/** A remote issue as a backend reports it, already normalized to backlog vocabulary. */
export interface RemoteComment {
  readonly id: string
  readonly body: string
  readonly author: string
  readonly createdAt: number
}

export interface RemoteIssue {
  readonly id: string
  readonly key: string
  readonly url: string
  readonly title: string
  readonly body: string
  readonly status: BacklogStatus | null
  readonly tags: readonly string[]
  readonly updatedAt: number
  readonly comments: readonly RemoteComment[]
}

/** What the merge decided for one item: fields to write locally, fields to write remotely, and conflicts it settled. */
export interface SyncFieldValues {
  title?: string
  body?: string
  status?: BacklogStatus
  tags?: readonly string[]
}

export interface SyncPlan {
  readonly pull: Readonly<SyncFieldValues>
  readonly push: Readonly<SyncFieldValues>
  readonly conflicts: readonly SyncConflict[]
}

/** Copies one field of a snapshot into a change; a status the side cannot express is left out. */
const take = (target: SyncFieldValues, field: SyncField, from: SyncSnapshot): void => {
  if (field === 'status') {
    if (from.status !== null) target.status = from.status
  } else if (field === 'tags') target.tags = from.tags
  else target[field] = from[field]
}

const sameValue = (left: SyncSnapshot[SyncField], right: SyncSnapshot[SyncField]): boolean =>
  Array.isArray(left) && Array.isArray(right) ? [...left].sort().join('\n') === [...right].sort().join('\n') : left === right

const display = (value: SyncSnapshot[SyncField]): string => (value === null ? '' : Array.isArray(value) ? value.join(', ') : String(value)).slice(0, 2_000)

const localSnapshot = (item: Pick<BacklogItem, 'title' | 'body' | 'status' | 'tags'>): SyncSnapshot => ({
  title: item.title,
  body: item.body,
  status: item.status,
  tags: [...item.tags],
})

const remoteSnapshot = (issue: Pick<RemoteIssue, 'title' | 'body' | 'status' | 'tags'>): SyncSnapshot => ({
  title: issue.title,
  body: issue.body,
  status: issue.status,
  tags: issue.tags.map(tag => tag.toLowerCase()),
})

/** When the item last changed one field, from its event history; an item without a recorded change uses its creation. */
const localChangedAt = (item: Pick<BacklogItem, 'events' | 'createdAt'>, field: SyncField): number =>
  // `api.ts` reaches this module from plugins that compile against ES2022, so no `findLast` here.
  [...item.events].reverse().find(event => event.fieldChanges?.some(change => change.field === field) === true)?.at ?? item.createdAt

/**
 * The conflict policy, field by field against the last synced base: a field only one side changed flows to the other;
 * a field both sides changed to different values goes to the side that changed last (last writer wins), and the loser's
 * value is kept in a conflict note. A first sync without a base takes the remote side for every field it can express.
 */
const plan = (input: {
  readonly item: Pick<BacklogItem, 'title' | 'body' | 'status' | 'tags' | 'events' | 'createdAt'>
  readonly remote: RemoteIssue
  readonly base: SyncMapping['base']
  readonly at: number
}): SyncPlan => {
  const local = localSnapshot(input.item)
  const remote = remoteSnapshot(input.remote)
  const pull: SyncFieldValues = {}
  const push: SyncFieldValues = {}
  const conflicts: SyncConflict[] = []
  for (const field of syncedFields) {
    const localValue = local[field]
    const remoteValue = remote[field]
    if (field === 'status' && remoteValue === null) continue
    if (input.base === null) {
      // Linking adopts the issue, except tags: neither side's labels are dropped, both end up with the union.
      if (field === 'tags') {
        const union = [...new Set([...local.tags, ...remote.tags])]
        if (!sameValue(union, local.tags)) pull.tags = union
        if (!sameValue(union, remote.tags)) push.tags = union
      } else if (!sameValue(localValue, remoteValue)) take(pull, field, remote)
      continue
    }
    const localChanged = !sameValue(localValue, input.base.local[field])
    const remoteChanged = !sameValue(remoteValue, input.base.remote[field])
    if (!localChanged && !remoteChanged) continue
    if (localChanged && !remoteChanged) {
      take(push, field, local)
      continue
    }
    if (!localChanged) {
      take(pull, field, remote)
      continue
    }
    if (sameValue(localValue, remoteValue)) continue
    const remoteWins = input.remote.updatedAt > localChangedAt(input.item, field)
    take(remoteWins ? pull : push, field, remoteWins ? remote : local)
    conflicts.push({ field, at: input.at, kept: remoteWins ? 'remote' : 'local', local: display(localValue), remote: display(remoteValue) })
  }
  return { pull, push, conflicts }
}

/** `synced` turns `pending` once the item changed a synced field after the last pass. */
const stateOf = (mapping: SyncMapping, item: Pick<BacklogItem, 'title' | 'body' | 'status' | 'tags'> | undefined): SyncState => {
  if (mapping.state !== 'synced') return mapping.state
  const base = mapping.base
  if (base === null || item === undefined) return 'pending'
  const local = localSnapshot(item)
  return syncedFields.some(field => !sameValue(local[field], base.local[field])) ? 'pending' : 'synced'
}

const conflictNote = (backend: SyncBackendKind, key: string, conflicts: readonly SyncConflict[]): string =>
  [
    `Sync conflict with ${backendLabel(backend)} ${key}: both sides changed ${conflicts.map(conflict => conflict.field).join(', ')} since the last sync.`,
    ...conflicts.map(conflict =>
      conflict.kept === 'remote'
        ? `- ${conflict.field}: kept the ${backendLabel(backend)} value (changed last). The local value was: ${conflict.local || '(empty)'}`
        : `- ${conflict.field}: kept the local value (changed last). The ${backendLabel(backend)} value was: ${conflict.remote || '(empty)'}`,
    ),
    'Edit the field again to choose the other value; the next sync carries it over.',
  ].join('\n')

const backendLabel = (backend: SyncBackendKind): string => (backend === 'linear' ? 'Linear' : 'GitHub')

/** A remote comment as it lands on the item, so the reader sees where it came from. */
const importedCommentText = (backend: SyncBackendKind, comment: RemoteComment): string =>
  `${backendLabel(backend)} · ${comment.author}: ${comment.body}`.slice(0, BacklogItems.maxBodyChars)

/** A local comment as it lands on the remote issue. */
const exportedCommentText = (itemId: number, actor: string, text: string): string =>
  `${text}\n\n— ${actor === 'user' ? 'you' : actor} on backlog b:${String(itemId)}`

export class BacklogSyncModel {
  static readonly backends = backends
  static readonly syncStates = syncStates
  static readonly syncedFields = syncedFields
  static readonly maxConflicts = MAX_CONFLICTS
  static readonly maxCommentPairs = MAX_COMMENT_PAIRS
  static readonly backendSchema = backendSchema
  static readonly mappingSchema = mappingSchema
  static readonly conflictSchema = conflictSchema
  static readonly syncErrorSchema = syncErrorSchema
  static readonly snapshotSchema = snapshotSchema
  static readonly localSnapshot = localSnapshot
  static readonly remoteSnapshot = remoteSnapshot
  static readonly localChangedAt = localChangedAt
  static readonly plan = plan
  static readonly stateOf = stateOf
  static readonly conflictNote = conflictNote
  static readonly backendLabel = backendLabel
  static readonly importedCommentText = importedCommentText
  static readonly exportedCommentText = exportedCommentText
}
