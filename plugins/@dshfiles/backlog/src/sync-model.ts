import { Schema } from 'effect'
import { BacklogItems, type BacklogItem, type BacklogPriority, type BacklogStatus } from './item.js'
import { BacklogProviders, type ProviderCapabilities, type ProviderField, type RemoteCriterion, type RemoteRecord } from './provider-port.js'

const syncStates = ['synced', 'pending', 'conflict', 'error'] as const
/** The item fields sync may own; kind, project, attention and pins stay local. */
const syncedFields = BacklogProviders.fields
const directions = ['pull', 'push', 'two-way'] as const
const fieldDirections = ['two-way', 'pull', 'push', 'off'] as const
const conflictPolicies = ['lww', 'local-wins', 'remote-wins', 'flag'] as const

const MAX_CONFLICTS = 20
const MAX_COMMENT_PAIRS = 400
const MAX_POLL_SECONDS = 86_400

const slugSchema = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/))
const fieldSchema = Schema.Literals(syncedFields)
const timestamp = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const remoteKeySchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300))

/**
 * One side of an item as the last sync left it. `parent` and `links` hold remote keys on both sides (a local parent
 * ref reads as its item's key in the same binding), so the two sides compare. A field absent from a snapshot was not
 * synced then.
 */
const snapshotSchema = Schema.Struct({
  title: Schema.String.check(Schema.isMaxLength(BacklogItems.maxTitleChars * 5)),
  body: Schema.String.check(Schema.isMaxLength(BacklogItems.maxBodyChars * 4)),
  status: Schema.NullOr(BacklogItems.statusSchema),
  tags: Schema.Array(Schema.String.check(Schema.isMaxLength(120))).check(Schema.isMaxLength(100)),
  priority: Schema.optionalKey(BacklogItems.prioritySchema),
  parent: Schema.optionalKey(Schema.NullOr(remoteKeySchema)),
  links: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isMaxLength(340))).check(Schema.isMaxLength(200))),
  due: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(10)))),
  /** Each criterion as `[x] text` or `[ ] text`. */
  criteria: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isMaxLength(510))).check(Schema.isMaxLength(50))),
  summary: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(BacklogItems.maxBodyChars * 4))),
})

/** One field both sides changed since the last sync, and which side's value was kept (`none` when the policy flags it). */
const conflictSchema = Schema.Struct({
  field: fieldSchema,
  at: timestamp,
  kept: Schema.Literals(['local', 'remote', 'none']),
  local: Schema.String.check(Schema.isMaxLength(2_000)),
  remote: Schema.String.check(Schema.isMaxLength(2_000)),
})

const syncErrorSchema = Schema.Struct({
  code: Schema.String.check(Schema.isMaxLength(64)),
  message: Schema.String.check(Schema.isMaxLength(1_000)),
  at: timestamp,
})

/** An account: several per provider ("GitHub – work", "GitHub – perso"). The key is a reference, never a value. */
const connectionSchema = Schema.Struct({
  instanceId: slugSchema,
  kind: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{1,31}$/)),
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  credential: Schema.String.check(Schema.isMaxLength(400)),
  baseUrl: Schema.String.check(Schema.isMaxLength(500)),
  /** What the last Test connection saw; never the key. */
  identity: Schema.NullOr(
    Schema.Struct({
      account: Schema.String.check(Schema.isMaxLength(200)),
      checkedAt: timestamp,
      containers: Schema.Array(BacklogProviders.containerSchema).check(Schema.isMaxLength(500)),
    }),
  ),
})

const valueMapSchema = Schema.Array(
  Schema.Struct({
    local: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
    remote: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  }),
).check(Schema.isMaxLength(100))

/** One field's flow, and how its values translate (status → a remote state name, tag → a remote label). */
const fieldRuleSchema = Schema.Struct({ field: fieldSchema, direction: Schema.Literals(fieldDirections), values: valueMapSchema })

/** A sync flow: one container of one connection, serving every project or one project. */
const bindingSchema = Schema.Struct({
  id: slugSchema,
  connectionId: slugSchema,
  /** Team key, `owner/repo`, folder… Empty lets the provider derive it from the project (a git remote, `<project>/backlog`). */
  container: Schema.String.check(Schema.isMaxLength(500)),
  /** null serves every project that has no binding of its own on that connection kind. */
  scope: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(BacklogItems.maxTargetChars))),
  direction: Schema.Literals(directions),
  fieldMap: Schema.Array(fieldRuleSchema).check(Schema.isMaxLength(syncedFields.length)),
  conflictPolicy: Schema.Literals(conflictPolicies),
  /** 0 syncs only on Sync now. */
  pollEverySec: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(MAX_POLL_SECONDS)),
  pushAgentComments: Schema.Boolean,
  /** A pull also creates items for remote items no backlog item mirrors yet. */
  importNew: Schema.Boolean,
  enabled: Schema.Boolean,
  /** The Host that runs this binding's sync; other Hosts leave it alone. */
  ownerHostId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  /** Provider-specific settings the provider's descriptor names in `bindingOptions` (Notion's property names). */
  options: Schema.optionalKey(BacklogProviders.bindingOptionsSchema),
})

/** How one item is tied to one remote item through one binding. An item may have several, one per binding. */
const externalRefSchema = Schema.Struct({
  bindingId: slugSchema,
  key: remoteKeySchema,
  displayKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  url: Schema.String.check(Schema.isMaxLength(BacklogItems.maxTargetChars)),
  linkedAt: timestamp,
  lastSyncedAt: Schema.NullOr(timestamp),
  remoteUpdatedAt: Schema.NullOr(timestamp),
  lastRemoteVersion: Schema.NullOr(Schema.String.check(Schema.isMaxLength(200))),
  localSyncedAt: Schema.NullOr(timestamp),
  base: Schema.NullOr(Schema.Struct({ local: snapshotSchema, remote: snapshotSchema })),
  comments: Schema.Array(Schema.Struct({ local: Schema.String.check(Schema.isMaxLength(128)), remote: Schema.String.check(Schema.isMaxLength(300)) })).check(
    Schema.isMaxLength(MAX_COMMENT_PAIRS),
  ),
  /** Local comments older than the link are not pushed unless the item was created remotely from here. */
  pushCommentsSince: timestamp,
  state: Schema.Literals(syncStates),
  conflicts: Schema.Array(conflictSchema).check(Schema.isMaxLength(MAX_CONFLICTS)),
  lastError: Schema.NullOr(syncErrorSchema),
})

export type SyncState = (typeof syncStates)[number]
export type SyncField = ProviderField
export type SyncDirection = (typeof directions)[number]
export type SyncFieldDirection = (typeof fieldDirections)[number]
export type SyncConflictPolicy = (typeof conflictPolicies)[number]
export type SyncSnapshot = typeof snapshotSchema.Type
export type SyncConflict = typeof conflictSchema.Type
export type SyncErrorRecord = typeof syncErrorSchema.Type
export type SyncConnection = typeof connectionSchema.Type
export type SyncBinding = typeof bindingSchema.Type
export type SyncFieldRule = typeof fieldRuleSchema.Type
export type ExternalRef = typeof externalRefSchema.Type

/** What the merge wants written to one side; `parent` and `links` are in remote-key space. */
export interface SyncFieldValues {
  title?: string
  body?: string
  status?: BacklogStatus
  tags?: readonly string[]
  priority?: BacklogPriority
  parent?: string | null
  links?: readonly string[]
  due?: string | null
  criteria?: readonly string[]
  summary?: string
}

export interface SyncPlan {
  readonly pull: Readonly<SyncFieldValues>
  readonly push: Readonly<SyncFieldValues>
  readonly conflicts: readonly SyncConflict[]
  /** Fields the policy flagged: their base stays put, so the next pass sees the conflict until both sides agree. */
  readonly flagged: readonly SyncField[]
}

/** Every field two-way, title to links: the default of a new binding and of a migrated settings row. */
const defaultFieldMap = (fields: readonly SyncField[] = syncedFields): SyncFieldRule[] => fields.map(field => ({ field, direction: 'two-way', values: [] }))

/** Whether a direction lets a change flow one way. */
const allows = (direction: SyncDirection | SyncFieldDirection, way: 'pull' | 'push'): boolean => direction === 'two-way' || direction === way

/** What the provider can carry for one field. */
const supports = (capabilities: ProviderCapabilities, field: SyncField): boolean => {
  if (field === 'tags') return capabilities.labels
  if (field === 'priority') return capabilities.priority
  if (field === 'parent') return capabilities.parent
  if (field === 'links') return capabilities.relations.length > 0
  if (field === 'due' || field === 'criteria' || field === 'summary') return capabilities.extraFields?.includes(field) ?? false
  return true
}

/** Acceptance criteria as snapshot lines, `[x] text`, so two sides compare as plain strings. */
const criteriaLines = (criteria: readonly RemoteCriterion[]): string[] => criteria.map(criterion => `[${criterion.done ? 'x' : ' '}] ${criterion.text}`)

const criteriaOfLines = (lines: readonly string[]): RemoteCriterion[] =>
  lines.flatMap(line => {
    const text = line.slice(4).trim()
    return text === '' ? [] : [{ text, done: line.startsWith('[x]') }]
  })

/**
 * Each field's effective flow for a binding: the binding's direction, the field's own rule (an unlisted field is off),
 * and what the provider can do (a read-only provider never pushes).
 */
const fieldFlows = (input: { readonly binding: Pick<SyncBinding, 'direction' | 'fieldMap'>; readonly capabilities: ProviderCapabilities }) =>
  new Map(
    syncedFields.map(field => {
      const rule = input.binding.fieldMap.find(candidate => candidate.field === field)
      const supported = supports(input.capabilities, field) && input.capabilities.read
      const pull = supported && rule !== undefined && allows(input.binding.direction, 'pull') && allows(rule.direction, 'pull')
      const push = supported && rule !== undefined && input.capabilities.write && allows(input.binding.direction, 'push') && allows(rule.direction, 'push')
      return [field, { pull, push }] as const
    }),
  )

const sorted = (values: readonly string[]): string => [...values].sort().join('\n')

const sameValue = (left: SyncSnapshot[SyncField] | undefined, right: SyncSnapshot[SyncField] | undefined): boolean =>
  Array.isArray(left) && Array.isArray(right) ? sorted(left) === sorted(right) : (left ?? null) === (right ?? null)

const display = (value: SyncSnapshot[SyncField] | undefined): string =>
  (value === null || value === undefined ? '' : Array.isArray(value) ? value.join(', ') : String(value)).slice(0, 2_000)

/** The value one snapshot holds for a field, `undefined` when that side does not carry it. */
const valueOf = (snapshot: SyncSnapshot, field: SyncField): SyncSnapshot[SyncField] | undefined => snapshot[field]

const isStatus = (value: unknown): value is BacklogStatus => BacklogItems.statuses.some(status => status === value)
const isPriority = (value: unknown): value is BacklogPriority => BacklogItems.priorities.some(priority => priority === value)

const take = (target: SyncFieldValues, field: SyncField, value: SyncSnapshot[SyncField] | undefined): void => {
  if (value === undefined) return
  switch (field) {
    case 'title':
    case 'body':
    case 'summary':
      if (typeof value === 'string') target[field] = value
      return
    case 'due':
      if (value === null || typeof value === 'string') target.due = value
      return
    case 'status':
      if (isStatus(value)) target.status = value
      return
    case 'priority':
      if (isPriority(value)) target.priority = value
      return
    case 'parent':
      if (value === null || typeof value === 'string') target.parent = value
      return
    case 'tags':
    case 'links':
    case 'criteria':
      if (Array.isArray(value)) target[field] = value
  }
}

/** When the item last changed one field, from its history; an item without a recorded change uses its creation. */
const localChangedAt = (item: Pick<BacklogItem, 'events' | 'createdAt'>, field: SyncField): number =>
  // `api.ts` reaches this module from plugins that compile against ES2022, so no `findLast` here.
  [...item.events]
    .reverse()
    .find(event =>
      field === 'links' ? event.kind === 'linked' || event.kind === 'unlinked' : event.fieldChanges?.some(change => change.field === field) === true,
    )?.at ?? item.createdAt

/** Which side a two-sided change keeps under a policy; `none` writes neither. */
const keptSide = (input: { readonly policy: SyncConflictPolicy; readonly remoteNewer: boolean }): SyncConflict['kept'] => {
  switch (input.policy) {
    case 'flag':
      return 'none'
    case 'local-wins':
      return 'local'
    case 'remote-wins':
      return 'remote'
    case 'lww':
      return input.remoteNewer ? 'remote' : 'local'
  }
}

/**
 * The merge, field by field against the last synced base. A field only one side changed flows to the other, when the
 * field's flow allows it; a field both sides changed to different values is settled by the binding's policy: `lww`
 * keeps the side that changed last, `local-wins`/`remote-wins` keep that side, `flag` writes neither side and keeps the
 * conflict until both agree. A first sync (no base) adopts the remote side, except tags (their union) and a status the
 * remote's status already stands for (`doing` survives GitHub's open).
 */
const plan = (input: {
  readonly item: Pick<BacklogItem, 'events' | 'createdAt'>
  readonly local: SyncSnapshot
  readonly remote: SyncSnapshot
  /** The backlog statuses the remote status stands for; empty compares the category alone. */
  readonly remoteStatusEquivalents: readonly BacklogStatus[]
  readonly remoteUpdatedAt: number
  readonly base: { readonly local: SyncSnapshot; readonly remote: SyncSnapshot } | null
  readonly flows: ReadonlyMap<SyncField, { readonly pull: boolean; readonly push: boolean }>
  readonly policy: SyncConflictPolicy
  readonly at: number
}): SyncPlan => {
  const pull: SyncFieldValues = {}
  const push: SyncFieldValues = {}
  const conflicts: SyncConflict[] = []
  const flagged: SyncField[] = []
  const agrees = (field: SyncField, localValue: SyncSnapshot[SyncField] | undefined, remoteValue: SyncSnapshot[SyncField] | undefined): boolean =>
    field === 'status' && typeof localValue === 'string' && input.remoteStatusEquivalents.some(status => status === localValue)
      ? true
      : sameValue(localValue, remoteValue)
  for (const field of syncedFields) {
    const flow = input.flows.get(field) ?? { pull: false, push: false }
    if (!flow.pull && !flow.push) continue
    const localValue = valueOf(input.local, field)
    const remoteValue = valueOf(input.remote, field)
    if (localValue === undefined || remoteValue === undefined) continue
    if (field === 'status' && remoteValue === null) continue
    const baseLocal = input.base === null ? undefined : valueOf(input.base.local, field)
    const baseRemote = input.base === null ? undefined : valueOf(input.base.remote, field)
    if (baseLocal === undefined || baseRemote === undefined) {
      if (field === 'tags' && Array.isArray(localValue) && Array.isArray(remoteValue)) {
        const union = [...new Set([...localValue, ...remoteValue])]
        if (flow.pull && !sameValue(union, localValue)) pull.tags = union
        if (flow.push && !sameValue(union, remoteValue)) push.tags = union
        continue
      }
      if (agrees(field, localValue, remoteValue)) continue
      if (flow.pull) take(pull, field, remoteValue)
      else if (flow.push) take(push, field, localValue)
      continue
    }
    const localChanged = !sameValue(localValue, baseLocal)
    const remoteChanged = !sameValue(remoteValue, baseRemote)
    if (!localChanged && !remoteChanged) continue
    if (localChanged && !remoteChanged) {
      if (flow.push && !agrees(field, localValue, remoteValue)) take(push, field, localValue)
      continue
    }
    if (!localChanged) {
      if (flow.pull && !agrees(field, localValue, remoteValue)) take(pull, field, remoteValue)
      continue
    }
    if (agrees(field, localValue, remoteValue)) continue
    const keep = keptSide({ policy: input.policy, remoteNewer: input.remoteUpdatedAt > localChangedAt(input.item, field) })
    const kept = keep === 'remote' && !flow.pull ? 'local' : keep === 'local' && !flow.push ? 'remote' : keep
    if (kept === 'remote') take(pull, field, remoteValue)
    if (kept === 'local') take(push, field, localValue)
    if (kept === 'none') flagged.push(field)
    conflicts.push({ field, at: input.at, kept, local: display(localValue), remote: display(remoteValue) })
  }
  return { pull, push, conflicts, flagged }
}

/** A local status translated through a binding's value map: `doing` → `In Review` when the map says so. */
const remoteLabelOf = (rules: readonly SyncFieldRule[], field: 'status' | 'tags', local: string): string | undefined =>
  rules.find(rule => rule.field === field)?.values.find(pair => pair.local === local)?.remote

const localValueOf = (rules: readonly SyncFieldRule[], field: 'status' | 'tags', remote: string): string | undefined =>
  rules.find(rule => rule.field === field)?.values.find(pair => pair.remote.toLowerCase() === remote.toLowerCase())?.local

/** The remote side of a record as a snapshot, in local vocabulary: value maps applied, tags lowercased. */
const remoteSnapshot = (input: { readonly record: RemoteRecord; readonly rules: readonly SyncFieldRule[] }): SyncSnapshot => {
  const record = input.record
  const mappedStatus = record.status === null ? undefined : localValueOf(input.rules, 'status', record.status.label)
  const status = isStatus(mappedStatus) ? mappedStatus : record.status?.category
  return {
    title: record.title,
    body: record.body,
    status: status ?? null,
    tags: record.tags.map(tag => (localValueOf(input.rules, 'tags', tag) ?? tag).toLowerCase()),
    ...(record.priority !== undefined && { priority: record.priority }),
    ...(record.parentKey !== undefined && { parent: record.parentKey }),
    ...(record.relations !== undefined && { links: record.relations.map(relation => `${relation.relation}:${relation.key}`) }),
    ...(record.due !== undefined && { due: record.due }),
    ...(record.criteria !== undefined && { criteria: criteriaLines(record.criteria) }),
    ...(record.summary !== undefined && { summary: record.summary }),
  }
}

/** `synced` turns `pending` once the item changed a synced field after the last pass. */
const stateOf = (ref: Pick<ExternalRef, 'state' | 'base'>, local: SyncSnapshot | undefined): SyncState => {
  if (ref.state !== 'synced') return ref.state
  const base = ref.base
  if (base === null || local === undefined) return 'pending'
  return syncedFields.some(field => valueOf(base.local, field) !== undefined && !sameValue(valueOf(local, field), valueOf(base.local, field)))
    ? 'pending'
    : 'synced'
}

const conflictNote = (input: { readonly source: string; readonly key: string; readonly conflicts: readonly SyncConflict[] }): string =>
  [
    `Sync conflict with ${input.source} ${input.key}: both sides changed ${input.conflicts.map(conflict => conflict.field).join(', ')} since the last sync.`,
    ...input.conflicts.map(conflict =>
      conflict.kept === 'remote'
        ? `- ${conflict.field}: kept the ${input.source} value. The local value was: ${conflict.local || '(empty)'}`
        : conflict.kept === 'local'
          ? `- ${conflict.field}: kept the local value. The ${input.source} value is: ${conflict.remote || '(empty)'}`
          : `- ${conflict.field}: left both sides as they are. Local: ${conflict.local || '(empty)'} · ${input.source}: ${conflict.remote || '(empty)'}`,
    ),
    input.conflicts.some(conflict => conflict.kept === 'none')
      ? 'Make both sides agree (edit either one) to clear the conflict; the next sync carries the rest over.'
      : 'Edit the field again to choose the other value; the next sync carries it over.',
  ].join('\n')

/** A remote comment as it lands on the item, so the reader sees where it came from. */
const importedCommentText = (input: { readonly source: string; readonly author: string; readonly body: string }): string =>
  `${input.source} · ${input.author}: ${input.body}`.slice(0, BacklogItems.maxBodyChars)

/** A local comment as it lands on the remote item. */
const exportedCommentText = (itemLabel: string, actor: string, text: string): string =>
  `${text}\n\n— ${actor === 'user' ? 'you' : actor} on backlog ${itemLabel}`

/** A binding id from free text: lowercase, dashes, at most 64 characters. */
const slugOf = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48) || 'default'

/** A slug not in `taken`: `base`, then `base-2`, `base-3`… */
const uniqueSlug = (base: string, taken: ReadonlySet<string>): string => {
  if (!taken.has(base)) return base
  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${String(index)}`
    if (!taken.has(candidate)) return candidate
  }
}

export class BacklogSyncModel {
  static readonly syncStates = syncStates
  static readonly syncedFields = syncedFields
  static readonly directions = directions
  static readonly fieldDirections = fieldDirections
  static readonly conflictPolicies = conflictPolicies
  static readonly maxConflicts = MAX_CONFLICTS
  static readonly maxCommentPairs = MAX_COMMENT_PAIRS
  static readonly maxPollSeconds = MAX_POLL_SECONDS
  static readonly slugSchema = slugSchema
  static readonly fieldSchema = fieldSchema
  static readonly connectionSchema = connectionSchema
  static readonly bindingSchema = bindingSchema
  static readonly fieldRuleSchema = fieldRuleSchema
  static readonly externalRefSchema = externalRefSchema
  static readonly conflictSchema = conflictSchema
  static readonly syncErrorSchema = syncErrorSchema
  static readonly snapshotSchema = snapshotSchema
  static readonly defaultFieldMap = defaultFieldMap
  static readonly fieldFlows = fieldFlows
  static readonly supports = supports
  static readonly criteriaLines = criteriaLines
  static readonly criteriaOfLines = criteriaOfLines
  static readonly localChangedAt = localChangedAt
  static readonly plan = plan
  static readonly remoteSnapshot = remoteSnapshot
  static readonly remoteLabelOf = remoteLabelOf
  static readonly stateOf = stateOf
  static readonly conflictNote = conflictNote
  static readonly importedCommentText = importedCommentText
  static readonly exportedCommentText = exportedCommentText
  static readonly slugOf = slugOf
  static readonly uniqueSlug = uniqueSlug
  static readonly sameValue = sameValue
}
