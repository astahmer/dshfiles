import { Clock, Context, Effect, Layer, Option, PubSub, Ref, Semaphore, Stream } from 'effect'
import type { BacklogDetailView, BacklogSummaryView } from './api.js'
import { BacklogBackfill, type BackfillScope, type BackfillSelection } from './backfill.js'
import { BacklogSettingsTag } from './backlog-settings.js'
import { BacklogReference } from './backlog-reference.js'
import { BacklogRepo } from './backlog-repo.js'
import { BacklogClaimRefused, BacklogItemClaimed, BacklogParentInvalid, BacklogWriteFailed } from './errors.js'
import { BacklogOrigins } from './event-origin.js'
import {
  BacklogItems,
  type BacklogAttachment,
  type BacklogFileInput,
  type BacklogAttention,
  type BacklogEvent,
  type BacklogFreshness,
  type BacklogHumanField,
  type BacklogItem,
  type BacklogKind,
  type BacklogCriterion,
  type BacklogLink,
  type BacklogPlanApproval,
  type BacklogPriority,
  type BacklogProposal,
  type BacklogStatus,
} from './item.js'
import { ItemRelations, type BacklogLease, type ItemRelationIndex } from './item-relations.js'
import type { LeaseWrite } from './backlog-repo.js'
import { FieldRevert } from './field-revert.js'
import { BacklogOps } from './op-log.js'
import { BacklogShipped, type ShippedDigest, type ShippedQuery } from './shipped.js'
import { BacklogSearch, type SearchMatch } from './search.js'
import { BacklogSearchIndex } from './search-index.js'
import { ThreadLifecycle } from './thread-lifecycle.js'
import { BacklogTriage } from './triage.js'

/** Optional fields an edit may remove: null clears them, undefined leaves them as they are. */
const clearableFields = ['parent', 'delegate', 'criteria', 'plan', 'planApproval', 'summary'] as const
type ClearableField = (typeof clearableFields)[number]
type ClearableChange = { -readonly [K in ClearableField]?: NonNullable<BacklogItem[K]> | null | undefined }

/** The fields one edit replaces, mutable because a handler assembles them before the record is rewritten. */
type BacklogChange = { -readonly [K in Exclude<keyof BacklogItem, ClearableField>]?: BacklogItem[K] } & ClearableChange
/** The optional dimensions an upload carries; mutable while the attachment is assembled. */
type AttachmentDimensions = { -readonly [K in 'width' | 'height']?: BacklogAttachment[K] }
type ProposalDraft = { -readonly [K in keyof BacklogProposal]?: BacklogProposal[K] }

export type BacklogActor =
  | { readonly kind: 'user' }
  | { readonly kind: 'system' }
  | { readonly kind: 'agent'; readonly sessionId?: string | undefined; readonly cwd?: string | undefined }

export interface BacklogListQuery {
  readonly query?: string | undefined
  readonly statuses?: readonly BacklogStatus[] | undefined
  readonly kinds?: readonly BacklogKind[] | undefined
  readonly project?: string | null | undefined
  readonly projects?: readonly (string | null)[] | undefined
  readonly tag?: string | undefined
  readonly actor?: string | undefined
  /** `active` (fresh + stale, the feed), `all`, or one freshness state. */
  readonly freshness?: 'active' | 'all' | BacklogFreshness | undefined
  /** Only open items that want the user: attention set, or a triage suggestion waiting. Snoozed items are left out. */
  readonly inbox?: boolean | undefined
  /** Leaves out items an agent captured that the user never touched, unless they ask for attention or wait on a suggestion. */
  readonly hideAgentItems?: boolean | undefined
  /** Only ready items (open, unblocked, no open sub-issue, unclaimed), urgent first then oldest. */
  readonly ready?: boolean | undefined
  readonly limit?: number | undefined
}

type BacklogSummary = BacklogSummaryView
type BacklogDetail = BacklogDetailView

export interface BacklogUpdate {
  readonly id: number
  readonly title?: string | undefined
  readonly body?: string | undefined
  readonly kind?: BacklogKind | undefined
  readonly status?: BacklogStatus | undefined
  readonly project?: string | null | undefined
  readonly tags?: readonly string[] | undefined
  readonly pinned?: boolean | undefined
  readonly attention?: BacklogAttention | undefined
  /** A time to hide the item until, or null to wake it now. */
  readonly snoozedUntil?: number | null | undefined
  readonly priority?: BacklogPriority | undefined
  /** The ref of the item to nest this one under, or null to make it top-level again. */
  readonly parent?: string | null | undefined
  /** Every acceptance criterion, replacing the list; null removes them. A criterion without id keeps the id of one with the same text. */
  readonly criteria?: readonly CriterionInput[] | null | undefined
  /** Checks or unchecks criteria by id without rewriting the list. */
  readonly criteriaChecks?: readonly { readonly id: string; readonly done: boolean }[] | undefined
  readonly plan?: string | null | undefined
  /** `pending` asks the user to approve the plan (attention needs-input); only the user sets `approved`. */
  readonly planApproval?: BacklogPlanApproval | null | undefined
  readonly summary?: string | null | undefined
}

export interface CriterionInput {
  readonly id?: string | undefined
  readonly text: string
  readonly done?: boolean | undefined
}

export type BacklogResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: 'not-found' }

/** A revert the log refuses: the field changed again after the change asked for, so its earlier value would undo that too. */
export interface BacklogRevertStale {
  readonly ok: false
  readonly reason: 'stale'
  readonly message: string
}

const DEFAULT_LIST_LIMIT = 100
const MAX_LIST_LIMIT = 2_000

const actorIdOf = (actor: BacklogActor): string => {
  if (actor.kind !== 'agent') return actor.kind
  return actor.sessionId === undefined || actor.sessionId === '' ? 'agent:unknown' : `agent:${actor.sessionId}`
}

const callerLinks = (actor: BacklogActor): BacklogLink[] =>
  actor.kind === 'agent' && actor.sessionId !== undefined && actor.sessionId !== '' ? [{ type: 'thread', target: actor.sessionId }] : []

const withActor = (actors: BacklogItem['actors'], id: string, role: 'owner' | 'contributor'): BacklogItem['actors'] =>
  actors.some(actor => actor.id === id) ? actors : [...actors, { id, role }]

/**
 * One line of what happened since the item was created, so a feed shows each item once however many times agents
 * touched it: the latest event, how many followed the capture, and how many distinct agents took part.
 */
const activityOf = (item: BacklogItem): BacklogSummary['activity'] => {
  // A backfill that found nothing to change is not activity: it must not make an old item look touched.
  const after = item.events.slice(1).filter(event => !(event.kind === 'triaged' && event.actor === 'system' && event.detail === BacklogItems.triageNoChange))
  const last = after.at(-1)
  return {
    count: after.length,
    agents: new Set(item.events.filter(event => event.actor.startsWith('agent:')).map(event => event.actor)).size,
    comments: after.filter(event => event.kind === 'commented').length,
    last: last === undefined ? null : { at: last.at, actor: last.actor, kind: last.kind, detail: last.detail.slice(0, 200) },
  }
}

const wantsUser = (item: BacklogItem, now: number): boolean =>
  item.status !== 'done' &&
  item.status !== 'dropped' &&
  (item.snoozedUntil ?? 0) <= now &&
  ((item.attention ?? 'none') !== 'none' || (item.proposal !== undefined && item.proposal !== null))

const closedStateChange = (input: {
  readonly item: BacklogItem
  readonly status: BacklogItem['status']
  readonly attention?: BacklogItem['attention'] | undefined
}): BacklogChange => {
  if (input.status !== 'done' && input.status !== 'dropped') return {}
  const attention = input.attention ?? input.item.attention ?? 'none'
  const clearAttention = attention !== 'none' && !input.item.humanFields.includes('attention')
  const clearProposal = input.item.proposal !== undefined && input.item.proposal !== null
  if (!clearAttention && !clearProposal) return {}
  const change: BacklogChange = {}
  if (clearAttention) change.attention = 'none'
  if (clearProposal) change.proposal = null
  return change
}

type Relations = ItemRelationIndex<BacklogItem>

const leaseView = (lease: BacklogLease | null) => (lease === null ? null : { holder: lease.holder, acquiredAt: lease.acquiredAt, expiresAt: lease.expiresAt })

const summarize = (
  item: BacklogItem,
  now: number,
  relations: Relations,
  match: SearchMatch | null = null,
  dormantDays = BacklogItems.defaultDormantDays,
): BacklogSummary => ({
  id: item.id,
  ref: BacklogReference.refOf(item),
  title: item.title,
  kind: item.kind,
  status: item.status,
  project: item.project,
  tags: item.tags,
  links: item.links,
  tweetContextUrls: item.tweetContextUrls ?? [],
  attachments: item.attachments,
  actors: item.actors,
  pinned: item.pinned,
  freshness: BacklogItems.freshness(item, now, dormantDays),
  createdAt: item.createdAt,
  lastActivityAt: item.lastActivityAt,
  preview: item.body.slice(0, 280),
  proposal: item.proposal ?? null,
  attention: item.attention ?? 'none',
  acknowledgedAt: item.acknowledgedAt ?? null,
  snoozedUntil: item.snoozedUntil ?? null,
  activity: activityOf(item),
  match: match === null || match.fields.length === 0 ? null : { fields: [...match.fields], snippet: match.snippet },
  priority: item.priority ?? 'none',
  parent: item.parent ?? null,
  owner: BacklogItems.creatorOf(item) ?? 'user',
  delegate: item.delegate ?? null,
  children: relations.rollup(item),
  ready: relations.isReady(item),
  blockedBy: relations.openBlockersOf(item).map(blocker => BacklogReference.refOf(blocker)),
  lease: leaseView(relations.leaseOf(item)),
  criteriaProgress: BacklogItems.criteriaRollup(item.criteria),
  planApproval: item.planApproval ?? null,
})

/** Pinned first, then newest activity: the Discord order, where idle things sink on their own. */
const byActivity = (left: BacklogItem, right: BacklogItem): number =>
  Number(right.pinned) - Number(left.pinned) || right.lastActivityAt - left.lastActivityAt || right.id - left.id

const notFound = { ok: false, reason: 'not-found' } as const

const found = <T>(value: T): BacklogResult<T> => ({ ok: true, value })

type EventDraft = Pick<BacklogEvent, 'kind' | 'detail' | 'threadId' | 'attachments' | 'commentId' | 'origin'>

/** One stored event of one item, as the Activity timeline hears about it. */
export interface BacklogChangeNotice {
  readonly item: BacklogItem
  readonly event: BacklogEvent
}

interface StoreState {
  readonly records: ReadonlyMap<number, BacklogItem>
  readonly leases: ReadonlyMap<number, BacklogLease>
  readonly nextId: number
  readonly revision: number
}

/** What a read sees: the records, the time it reads at, the dormancy thresholds of that moment and how items relate. */
interface StoreView {
  readonly records: ReadonlyMap<number, BacklogItem>
  readonly revision: number
  readonly at: number
  readonly dormantDays: Readonly<Record<BacklogKind, number>>
  readonly relations: Relations
}

const searchContextOf = (relations: Relations) => ({
  isReady: relations.isReady,
  isBlockedByDeps: relations.isBlockedByDeps,
  hasChildren: (item: BacklogItem) => relations.childrenOf(item).length > 0,
  isClaimed: (item: BacklogItem) => relations.leaseOf(item) !== null,
})

/** A project is where the work happens, so one recorded in a jj workspace reads as the checkout it was cut from. */
const withProject = (item: BacklogItem): BacklogItem => {
  const project = BacklogItems.projectOf(item.project)
  return project === item.project ? item : { ...item, project }
}

const referencingIn = (view: StoreView, link: BacklogLink): BacklogSummary[] =>
  [...view.records.values()]
    .filter(item => item.links.some(candidate => BacklogItems.sameLink(candidate, link)))
    .sort(byActivity)
    .map(item => summarize(item, view.at, view.relations, null, view.dormantDays))

const parentSummaryIn = (view: StoreView, item: BacklogItem): BacklogSummary | null => {
  const parent = item.parent === undefined ? undefined : view.relations.byRef(item.parent)
  return parent === undefined ? null : summarize(parent, view.at, view.relations, null, view.dormantDays)
}

const detailIn = (view: StoreView, item: BacklogItem): BacklogDetail => ({
  item: {
    ...item,
    events: item.events.map((event, index) =>
      BacklogOrigins.stamped(
        event.kind === 'commented' && event.commentId === undefined ? { ...event, commentId: `legacy-${String(event.at)}-${String(index)}` } : event,
      ),
    ),
    freshness: BacklogItems.freshness(item, view.at, view.dormantDays),
  },
  backlinks: referencingIn(view, { type: 'item', target: BacklogReference.refOf(item) }),
  parentItem: parentSummaryIn(view, item),
  children: view.relations
    .childrenOf(item)
    .sort(ItemRelations.byReadiness)
    .map(child => summarize(child, view.at, view.relations, null, view.dormantDays)),
  blockedBy: view.relations.openBlockersOf(item).map(blocker => summarize(blocker, view.at, view.relations, null, view.dormantDays)),
  lease: leaseView(view.relations.leaseOf(item)),
})

const listIn = (view: StoreView, query: BacklogListQuery, index?: BacklogSearchIndex) => {
  const at = view.at
  const search = BacklogSearch.parse(query.query ?? '')
  // The index only narrows which items get scored; the scorer below still ranks them, so results match a full scan.
  index?.sync(view.records)
  const candidates = index?.candidates(search.terms) ?? null
  const pool = candidates === null ? [...view.records.values()] : [...candidates].flatMap(id => view.records.get(id) ?? [])
  const freshnessFilter = query.freshness ?? 'active'
  // A caller may still ask for the workspace an item was captured in; the item is filed under its project.
  const project = query.project === undefined ? undefined : BacklogItems.projectOf(query.project)
  const projects = query.projects?.map(candidate => (candidate === null ? null : BacklogItems.projectOf(candidate)))
  const matching = pool
    .filter(item => query.statuses === undefined || query.statuses.length === 0 || query.statuses.includes(item.status))
    .filter(item => query.kinds === undefined || query.kinds.length === 0 || query.kinds.includes(item.kind))
    .filter(item => project === undefined || item.project === project)
    .filter(item => projects === undefined || projects.length === 0 || projects.includes(item.project))
    .filter(item => query.tag === undefined || item.tags.includes(query.tag.toLowerCase().replace(/^#/, '')))
    .filter(item => query.actor === undefined || item.actors.some(actor => actor.id === query.actor))
    .filter(item => query.inbox !== true || wantsUser(item, at))
    .filter(item => query.ready !== true || view.relations.isReady(item))
    .filter(item => query.inbox === true || freshnessFilter === 'all' || (item.snoozedUntil ?? 0) <= at)
    .filter(item => {
      if (freshnessFilter === 'all') return true
      const state = BacklogItems.freshness(item, at, view.dormantDays)
      return freshnessFilter === 'active' ? state === 'fresh' || state === 'stale' : state === freshnessFilter
    })
  const context = searchContextOf(view.relations)
  const matched = matching.flatMap(item => {
    const match = BacklogSearch.score(item, search, at, context)
    return match === null ? [] : [{ item, match }]
  })
  const scored = query.hideAgentItems === true ? matched.filter(entry => !BacklogItems.isUnclaimedAgentItem(entry.item)) : matched
  // A text search ranks by relevance, then activity; browsing keeps the activity order, and the ready queue its own.
  scored.sort(
    (left, right) =>
      right.match.score - left.match.score || (query.ready === true ? ItemRelations.byReadiness(left.item, right.item) : byActivity(left.item, right.item)),
  )
  const limit = Math.min(query.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  return {
    revision: view.revision,
    total: scored.length,
    hiddenAgentItems: matched.length - scored.length,
    items: scored.slice(0, limit).map(entry => summarize(entry.item, at, view.relations, entry.match, view.dormantDays)),
  }
}

const projectsIn = (view: StoreView, query: { readonly hideAgentItems?: boolean | undefined }) => {
  const byProject = new Map<string | null, BacklogItem[]>()
  for (const item of view.records.values()) {
    if (query.hideAgentItems === true && BacklogItems.isUnclaimedAgentItem(item)) continue
    byProject.set(item.project, [...(byProject.get(item.project) ?? []), item])
  }
  return [...byProject].map(([project, group]) => ({
    project,
    counts: {
      inbox: group.filter(item => item.status === 'inbox').length,
      todo: group.filter(item => item.status === 'todo').length,
      doing: group.filter(item => item.status === 'doing').length,
      done: group.filter(item => item.status === 'done').length,
      dropped: group.filter(item => item.status === 'dropped').length,
    },
    needsYou: group.filter(item => (item.attention ?? 'none') !== 'none' || (item.proposal !== undefined && item.proposal !== null)).length,
    actors: [...new Set(group.flatMap(item => item.actors.map(actor => actor.id)))],
    lastActivityAt: Math.max(...group.map(item => item.lastActivityAt)),
  }))
}

const attachmentOf = (file: BacklogFileInput, at: number): BacklogAttachment => {
  const dimensions: AttachmentDimensions = {}
  if (file.width !== undefined) dimensions.width = file.width
  if (file.height !== undefined) dimensions.height = file.height
  return { id: file.id, kind: file.kind, name: file.name, mediaType: file.mediaType, bytes: file.bytes, ...dimensions, createdAt: at }
}

/** An attachment kept on the item or inside one of its events, such as an image a comment carried. */
const attachmentOfItem = (item: BacklogItem, attachmentId: string): BacklogAttachment | undefined =>
  item.attachments.find(attachment => attachment.id === attachmentId) ??
  item.events.flatMap(event => event.attachments ?? []).find(attachment => attachment.id === attachmentId)

const userCommentIndex = (item: BacklogItem, commentId: string): number =>
  item.events.findIndex(
    (event, index) =>
      event.kind === 'commented' &&
      event.actor === 'user' &&
      (event.commentId === commentId || (event.commentId === undefined && commentId === `legacy-${String(event.at)}-${String(index)}`)),
  )

/** A criteria list from a caller: trimmed, unique ids, and each criterion keeps the id and check of the one it names. */
const criteriaOf = (input: readonly CriterionInput[], known: readonly BacklogCriterion[]): BacklogCriterion[] => {
  const used = new Set<string>()
  return input.slice(0, BacklogItems.maxCriteria).flatMap((criterion, index) => {
    const text = criterion.text.trim().slice(0, BacklogItems.maxCriterionChars)
    if (text === '') return []
    const candidate = criterion.id ?? known.find(own => own.text === text && !used.has(own.id))?.id ?? BacklogItems.criterionId(text, index)
    const id = used.has(candidate) ? BacklogItems.criterionId(text, index + used.size) : candidate
    used.add(id)
    return [{ id, text, done: criterion.done ?? known.find(own => own.id === id)?.done ?? false }]
  })
}

const sameText = (left: string | undefined, right: string | null | undefined): boolean => (left ?? '') === (right ?? '')

/** What one `update` call changes, the fields it records, and the fields that become the user's. */
const updateChange = (item: BacklogItem, fields: Omit<BacklogUpdate, 'id'>, actor: BacklogActor) => {
  const change: BacklogChange = {}
  const changed: BacklogHumanField[] = []
  const userChanged = new Set<BacklogHumanField>()
  const recordChange = (field: BacklogHumanField): void => {
    changed.push(field)
    userChanged.add(field)
  }
  if (fields.title !== undefined && fields.title.trim() !== '' && fields.title !== item.title) {
    change.title = fields.title.trim().slice(0, BacklogItems.maxTitleChars)
    recordChange('title')
  }
  if (fields.body !== undefined && fields.body !== item.body) {
    change.body = fields.body.slice(0, BacklogItems.maxBodyChars)
    recordChange('body')
  }
  if (change.title !== undefined || change.body !== undefined) {
    const title = change.title ?? item.title
    const body = change.body ?? item.body
    change.links = BacklogItems.uniqueLinks([...item.links, ...BacklogItems.extractLinks(`${title}\n${body}`)])
  }
  if (fields.kind !== undefined && fields.kind !== item.kind) {
    change.kind = fields.kind
    recordChange('kind')
  }
  if (fields.status !== undefined && fields.status !== item.status) {
    change.status = fields.status
    recordChange('status')
  }
  if (fields.project !== undefined) {
    const project = BacklogItems.projectOf(fields.project)
    if (project !== item.project) {
      change.project = project
      recordChange('project')
    }
  }
  if (fields.tags !== undefined) {
    const tags = [...new Set(fields.tags.map(tag => tag.toLowerCase().replace(/^#/, '')).filter(Boolean))]
    if (tags.join('\n') !== item.tags.join('\n')) {
      change.tags = tags
      recordChange('tags')
    }
  }
  if (fields.pinned !== undefined && fields.pinned !== item.pinned) {
    change.pinned = fields.pinned
    recordChange('pinned')
  }
  if (fields.attention !== undefined && fields.attention !== (item.attention ?? 'none')) {
    change.attention = fields.attention
    // A new request for attention is unread again, even if an older one was acknowledged.
    change.acknowledgedAt = null
    recordChange('attention')
  }
  if (fields.priority !== undefined && fields.priority !== (item.priority ?? 'none')) {
    change.priority = fields.priority
    recordChange('priority')
  }
  if (fields.parent !== undefined && fields.parent !== (item.parent ?? null)) {
    change.parent = fields.parent
    recordChange('parent')
  }
  if (fields.snoozedUntil !== undefined && fields.snoozedUntil !== (item.snoozedUntil ?? null)) change.snoozedUntil = fields.snoozedUntil
  const knownCriteria = item.criteria ?? []
  const replacedCriteria = fields.criteria === undefined ? undefined : fields.criteria === null ? null : criteriaOf(fields.criteria, knownCriteria)
  const checked = (replacedCriteria ?? knownCriteria).map(criterion => {
    const check = fields.criteriaChecks?.find(candidate => candidate.id === criterion.id)
    return check === undefined || check.done === criterion.done ? criterion : { ...criterion, done: check.done }
  })
  const nextCriteria = replacedCriteria === null ? null : replacedCriteria !== undefined || fields.criteriaChecks !== undefined ? checked : undefined
  if (nextCriteria === null && item.criteria !== undefined) {
    change.criteria = null
    recordChange('criteria')
  }
  if (nextCriteria !== null && nextCriteria !== undefined && !BacklogOps.sameValue(nextCriteria, knownCriteria)) {
    change.criteria = nextCriteria.length === 0 ? null : nextCriteria
    recordChange('criteria')
  }
  if (fields.plan !== undefined && !sameText(item.plan, fields.plan)) {
    change.plan = fields.plan === null || fields.plan.trim() === '' ? null : fields.plan.slice(0, BacklogItems.maxBodyChars)
    recordChange('plan')
  }
  // Only the user approves a plan; an agent asks for approval.
  const approval = fields.planApproval === 'approved' && actor.kind !== 'user' ? undefined : fields.planApproval
  if (approval !== undefined && approval !== (item.planApproval ?? null)) {
    change.planApproval = approval
    recordChange('planApproval')
    if (approval === 'pending' && fields.attention === undefined && (item.attention ?? 'none') === 'none') {
      change.attention = 'needs-input'
      change.acknowledgedAt = null
      changed.push('attention')
    }
    if (approval === 'approved' && fields.attention === undefined && item.attention === 'needs-input') {
      change.attention = 'none'
      changed.push('attention')
    }
  }
  if (fields.summary !== undefined && !sameText(item.summary, fields.summary)) {
    change.summary = fields.summary === null || fields.summary.trim() === '' ? null : fields.summary.slice(0, BacklogItems.maxBodyChars)
    recordChange('summary')
  }
  const closedChange = closedStateChange({ item, status: change.status ?? item.status, attention: change.attention })
  if (closedChange.attention !== undefined) {
    if (change.attention === undefined) changed.push('attention')
    if (change.attention !== undefined && change.attention !== closedChange.attention) userChanged.delete('attention')
  }
  Object.assign(change, closedChange)
  return { change, changed, userChanged }
}

/** The fields an accepted proposal sets; `system` (automatic triage) leaves the fields the user set by hand alone. */
const proposalChange = (input: {
  readonly item: BacklogItem
  readonly chosen: BacklogProposal
  readonly actor: BacklogActor
  /** The ref of a live item, or undefined when no item has that id. */
  readonly refOfId: (id: number) => string | undefined
}) => {
  const { item, chosen, actor } = input
  const locked = actor.kind === 'system' ? new Set(item.humanFields) : new Set<BacklogHumanField>()
  const change: BacklogChange = { proposal: null }
  const applied: ProposalDraft = {}
  if (chosen.kind !== undefined && !locked.has('kind')) {
    change.kind = chosen.kind
    applied.kind = chosen.kind
  }
  if (chosen.status !== undefined && !locked.has('status')) {
    change.status = chosen.status
    applied.status = chosen.status
  }
  if (chosen.title !== undefined && !locked.has('title')) {
    change.title = chosen.title.slice(0, BacklogItems.maxTitleChars)
    applied.title = change.title
  }
  if (chosen.tags !== undefined && !locked.has('tags')) {
    change.tags = chosen.tags
    applied.tags = chosen.tags
  }
  const duplicateTarget = chosen.duplicateOf === undefined ? undefined : input.refOfId(chosen.duplicateOf)
  if (chosen.duplicateOf !== undefined && duplicateTarget !== undefined) {
    const existingLinks = item.links.filter(link => link.type !== 'item' || link.target !== duplicateTarget)
    change.links = BacklogItems.uniqueLinks([...existingLinks, { type: 'item', target: duplicateTarget, relation: 'duplicates' }])
    applied.duplicateOf = chosen.duplicateOf
  }
  Object.assign(change, closedStateChange({ item, status: change.status ?? item.status }))
  // Accepting is a person or an agent choosing those values, so they become theirs.
  if (actor.kind !== 'system') {
    const owned = (['kind', 'status', 'title', 'tags'] as const).filter(field => applied[field] !== undefined)
    change.humanFields = [...new Set([...item.humanFields, ...owned])]
  }
  return { change, applied }
}

/** The id of the item a `b:<ref>` names: a legacy number only names an item created before short aliases. */
const idOfRef = (records: ReadonlyMap<number, BacklogItem>, ref: string): number | undefined => {
  if (BacklogReference.isLegacy(ref)) {
    const item = records.get(Number(ref))
    return item !== undefined && item.ref === undefined ? item.id : undefined
  }
  for (const item of records.values()) if (item.ref === ref) return item.id
  return undefined
}

/** An item id from a caller: a number is the item's own id, a string a `b:<ref>` with or without its prefix. */
const resolveIn = (records: ReadonlyMap<number, BacklogItem>, key: number | string): number | undefined => {
  if (typeof key === 'number') return records.has(key) ? key : undefined
  const ref = BacklogReference.parse(key)
  return ref === undefined ? undefined : idOfRef(records, ref)
}

/** Removes an optional field for null, or sets it; undefined leaves it as it is. */
const clearOrSet = <Value>(input: {
  readonly item: BacklogItem
  readonly value: Value | null | undefined
  readonly set: (base: BacklogItem, value: Value) => BacklogItem
  readonly remove: (base: BacklogItem) => BacklogItem
}): BacklogItem => {
  if (input.value === undefined) return input.item
  return input.value === null ? input.remove(input.item) : input.set(input.item, input.value)
}

const withClearable = (item: BacklogItem, change: ClearableChange): BacklogItem =>
  [
    (base: BacklogItem) =>
      clearOrSet({ item: base, value: change.parent, set: (next, parent) => ({ ...next, parent }), remove: ({ parent: _parent, ...rest }) => rest }),
    (base: BacklogItem) =>
      clearOrSet({
        item: base,
        value: change.delegate,
        set: (next, delegate) => ({ ...next, delegate }),
        remove: ({ delegate: _delegate, ...rest }) => rest,
      }),
    (base: BacklogItem) =>
      clearOrSet({
        item: base,
        value: change.criteria,
        set: (next, criteria) => ({ ...next, criteria }),
        remove: ({ criteria: _criteria, ...rest }) => rest,
      }),
    (base: BacklogItem) => clearOrSet({ item: base, value: change.plan, set: (next, plan) => ({ ...next, plan }), remove: ({ plan: _plan, ...rest }) => rest }),
    (base: BacklogItem) =>
      clearOrSet({
        item: base,
        value: change.planApproval,
        set: (next, planApproval) => ({ ...next, planApproval }),
        remove: ({ planApproval: _planApproval, ...rest }) => rest,
      }),
    (base: BacklogItem) =>
      clearOrSet({ item: base, value: change.summary, set: (next, summary) => ({ ...next, summary }), remove: ({ summary: _summary, ...rest }) => rest }),
  ].reduce((next, apply) => apply(next), item)

const isClearable = (field: string): field is ClearableField => clearableFields.some(candidate => candidate === field)

/** What a revert writes for an optional field that had no value before the change. */
const clearedValue = (field: BacklogHumanField): string | null | undefined => {
  if (isClearable(field)) return null
  return field === 'attention' || field === 'priority' ? 'none' : undefined
}

const isIdleNudge = (event: BacklogEvent): boolean => event.kind === 'commented' && event.detail.startsWith('Thread idle nudge:')

type Detailed = Effect.Effect<BacklogResult<BacklogDetail>, BacklogWriteFailed>

/**
 * Every backlog item, mirrored in memory and written through to the SQLite op log: each write appends the ops that turn
 * the stored item into the new one. Writes run one at a time, so a read-modify-write never interleaves with another
 * and ids are never allocated twice.
 */
export class BacklogStore extends Context.Service<
  BacklogStore,
  {
    readonly revision: Effect.Effect<number>
    /** Every stored event, after it is durable, for the Activity timeline. */
    readonly changes: Stream.Stream<BacklogChangeNotice>
    readonly capture: (input: {
      readonly text: string
      readonly project?: string | null | undefined
      readonly status?: BacklogStatus | undefined
      readonly kind?: BacklogKind | undefined
      readonly priority?: BacklogPriority | undefined
      /** The ref of the item this one is a sub-issue of. */
      readonly parent?: string | undefined
      readonly files?: readonly BacklogFileInput[] | undefined
      /** Fields a remote source already knows, used as they are instead of being read from `text`. */
      readonly fields?: { readonly body?: string | undefined; readonly tags?: readonly string[] | undefined } | undefined
      readonly actor: BacklogActor
      /** Who wrote it when that is not the actor, such as `remote:<bindingId>` for an item a sync imported. */
      readonly origin?: string | undefined
    }) => Effect.Effect<BacklogDetail, BacklogWriteFailed | BacklogParentInvalid>
    readonly attachFile: (input: { readonly id: number; readonly file: BacklogFileInput; readonly actor: BacklogActor }) => Detailed
    readonly importTweetContext: (input: {
      readonly id: number
      readonly url: string
      readonly bodySection: string
      readonly files: readonly BacklogFileInput[]
      readonly actor: BacklogActor
    }) => Detailed
    readonly readFile: (input: { readonly id: number; readonly attachmentId: string }) => Effect.Effect<BacklogResult<{ readonly dataUrl: string }>>
    readonly removeFile: (input: { readonly id: number; readonly attachmentId: string; readonly actor: BacklogActor }) => Detailed
    readonly delete: (input: { readonly id: number }) => Effect.Effect<BacklogResult<void>, BacklogWriteFailed>
    readonly update: (
      input: BacklogUpdate & { readonly actor: BacklogActor; readonly origin?: string | undefined },
    ) => Effect.Effect<BacklogResult<BacklogDetail>, BacklogWriteFailed | BacklogParentInvalid>
    readonly link: (input: {
      readonly id: number
      readonly link: BacklogLink
      readonly remove?: boolean | undefined
      readonly actor: BacklogActor
      readonly origin?: string | undefined
    }) => Detailed
    readonly comment: (input: {
      readonly id: number
      readonly text: string
      readonly files?: readonly BacklogFileInput[] | undefined
      readonly actor: BacklogActor
      /** Who wrote it when that is not the actor, such as `remote:linear` for a comment sync carried over. */
      readonly origin?: string | undefined
    }) => Detailed
    readonly editComment: (input: {
      readonly id: number
      readonly commentId: string
      readonly text: string
      readonly files?: readonly BacklogFileInput[] | undefined
      readonly actor: BacklogActor
    }) => Detailed
    readonly deleteComment: (input: { readonly id: number; readonly commentId: string; readonly actor: BacklogActor }) => Detailed
    /**
     * Puts one recorded field change back: a new `set` of the typed value the field held before it, read from the op log.
     * Refused as `stale` when the field changed again since, and `not-found` when no event at `at` changed `field`.
     */
    readonly revert: (input: {
      readonly id: number
      readonly at: number
      readonly field: BacklogHumanField
      readonly actor: BacklogActor
    }) => Effect.Effect<BacklogResult<BacklogDetail> | BacklogRevertStale, BacklogWriteFailed | BacklogParentInvalid>
    /** The item and every other item, for a triage pass to read. */
    readonly triageInput: (id: number) => Effect.Effect<Option.Option<{ readonly item: BacklogItem; readonly others: readonly BacklogItem[] }>>
    /** What one backfill run should triage, oldest first, and how many eligible items it leaves for a later run. */
    readonly triageCandidates: (scope: BackfillScope) => Effect.Effect<BackfillSelection>
    /** Records that triage looked at an item and found nothing to change, without making the item look recently active. */
    readonly markTriaged: (id: number) => Effect.Effect<void, BacklogWriteFailed>
    readonly propose: (input: { readonly id: number; readonly proposal: BacklogProposal }) => Detailed
    /**
     * Applies a proposal. For `system` (automatic triage) fields the user set by hand are left alone; for a person or an
     * agent accepting it, every field applies. Completing a confirmed duplicate also resolves its canonical item unless
     * its status was set by hand.
     */
    readonly applyProposal: (input: { readonly id: number; readonly proposal?: BacklogProposal | undefined; readonly actor: BacklogActor }) => Detailed
    /**
     * A lifecycle signal from outside the panel (a thread mentioning the item, a revision closing it): the link is always
     * recorded; the status moves only forward and never over a status the user set by hand.
     */
    readonly applySignal: (input: { readonly id: number; readonly status: 'doing' | 'done'; readonly link: BacklogLink; readonly reason: string }) => Detailed
    /**
     * A thread signal about one item: a thread that stopped flags its open items so they reach the Inbox, and a later
     * finished turn clears only that same flag. A status or attention you set by hand always wins.
     */
    readonly applyThreadAttention: (input: {
      readonly id: number
      readonly threadId: string
      readonly attention: 'blocked' | 'waiting' | 'none'
      readonly reason: string
    }) => Detailed
    /**
     * A thread's question was answered, so the `needs-input` request that thread made is settled: the user decided. An
     * attention set by hand, or raised by another thread, waits for its own owner.
     */
    readonly settleAnsweredQuestion: (input: { readonly id: number; readonly threadId: string; readonly reason: string }) => Detailed
    /**
     * Claims an item for the calling agent thread in one write: it becomes the delegate, the item moves to `doing`, the
     * thread is linked and a lease starts. Refused while another agent holds a live claim, and for closed items.
     */
    readonly claim: (input: {
      readonly id: number
      readonly actor: BacklogActor
    }) => Effect.Effect<BacklogResult<BacklogDetail>, BacklogWriteFailed | BacklogItemClaimed | BacklogClaimRefused>
    /**
     * Ends a claim: the lease goes, the delegate is cleared and an item still `doing` returns to `todo` so it is ready
     * again. The holder, the user and the system may release; another agent only once the lease lapsed.
     */
    readonly release: (input: {
      readonly id: number
      readonly actor: BacklogActor
      readonly reason?: string | undefined
    }) => Effect.Effect<BacklogResult<BacklogDetail>, BacklogWriteFailed | BacklogItemClaimed>
    /** Every stored claim, live or lapsed, with the item it holds: what the lease sweep reads. */
    readonly leases: Effect.Effect<readonly { readonly id: number; readonly lease: BacklogLease }[]>
    /** Hands an item to the agent of a thread started for it, without a lease: it shows who works on it. */
    readonly delegateTo: (input: { readonly id: number; readonly sessionId: string; readonly actor: BacklogActor }) => Detailed
    /** Marks an item's request as seen; it stays in the Inbox until its attention is cleared. Not an activity. */
    readonly acknowledge: (input: { readonly ids: readonly number[] }) => Effect.Effect<void, BacklogWriteFailed>
    readonly dismissProposal: (input: { readonly id: number; readonly actor: BacklogActor }) => Detailed
    /** Per-project counts over every item, so project progress never depends on how many rows a list returned. */
    readonly projects: (query: { readonly hideAgentItems?: boolean | undefined }) => Effect.Effect<ReturnType<typeof projectsIn>>
    /** What reached `done` per period, read from the items' events as of now. */
    readonly shipped: (query: ShippedQuery) => Effect.Effect<ShippedDigest>
    readonly list: (query: BacklogListQuery) => Effect.Effect<ReturnType<typeof listIn>>
    readonly get: (id: number) => Effect.Effect<BacklogResult<BacklogDetail>>
    /** How a log line or an error names an item: `b:<ref>`, or `b:<id>` once the item is gone. */
    readonly labelOf: (id: number) => Effect.Effect<string>
    /** The id of the item a caller names: its number, or a `b:<ref>` (`k3f9`, `b:k3f9`, a legacy `12`). */
    readonly resolve: (key: number | string) => Effect.Effect<number | undefined>
    /** Several items in one call, in the order asked, with the ids that do not exist kept separate. */
    readonly getMany: (ids: readonly number[]) => Effect.Effect<{ readonly items: BacklogDetail[]; readonly missing: number[] }>
    readonly referencing: (link: BacklogLink) => Effect.Effect<BacklogSummary[]>
  }
>()('@dshfiles/backlog/BacklogStore') {
  static readonly layer = Layer.effect(
    BacklogStore,
    Effect.gen(function* () {
      const repo = yield* BacklogRepo
      const settings = yield* BacklogSettingsTag
      const loaded = yield* repo.loadItems.pipe(Effect.orDie)
      const records = new Map(loaded.map(item => [item.id, withProject(item)]))
      const storedNextId = yield* repo.nextId.pipe(Effect.orDie)
      const leases = yield* repo.loadLeases.pipe(Effect.orDie)
      const state = yield* Ref.make<StoreState>({
        records,
        leases,
        nextId: Math.max(storedNextId, Math.max(0, ...records.keys()) + 1),
        revision: yield* Clock.currentTimeMillis,
      })
      const writes = yield* Semaphore.make(1)
      const searchIndex = new BacklogSearchIndex()
      const notices = yield* PubSub.unbounded<BacklogChangeNotice>()

      const view = Effect.gen(function* () {
        const current = yield* Ref.get(state)
        const at = yield* Clock.currentTimeMillis
        const dormantDays = (yield* settings.get).dormantAfterDays
        const relations = ItemRelations.build({ items: current.records.values(), leases: current.leases, now: at })
        return { records: current.records, revision: current.revision, at, dormantDays, relations } satisfies StoreView
      })
      const find = (id: number) => Effect.map(Ref.get(state), current => current.records.get(id))
      /** Names an item id by its ref, for event wording that mentions another item. */
      const refLookup = Effect.map(Ref.get(state), current => (id: number) => {
        const target = current.records.get(id)
        return target === undefined ? undefined : BacklogReference.refOf(target)
      })
      const detailOf = (item: BacklogItem) => Effect.map(view, current => detailIn(current, item))
      const unchanged = (item: BacklogItem) => Effect.map(detailOf(item), found)
      const serialized = <A, E, R>(effect: Effect.Effect<A, E, R>) => writes.withPermit(effect)

      const writeFailed = (item: Pick<BacklogItem, 'id' | 'ref'>, operation: BacklogWriteFailed['operation']) => (cause: unknown) =>
        new BacklogWriteFailed({ itemId: item.id, ref: BacklogReference.refOf(item), operation, cause })

      /**
       * What a write does to the item's claim when the caller says nothing: closing the item ends it, and any write by the
       * holder renews it for another idle period.
       */
      const leaseAfter = Effect.fnUntraced(function* (item: BacklogItem, origin: string) {
        const lease = (yield* Ref.get(state)).leases.get(item.id)
        if (lease === undefined) return undefined
        if (!ItemRelations.isOpen(item)) return { kind: 'clear' } satisfies LeaseWrite
        if (lease.holder !== origin) return undefined
        const at = yield* Clock.currentTimeMillis
        const idleMs = (yield* settings.get).leaseIdleMinutes * 60_000
        return { kind: 'set', lease: { ...lease, heartbeat: at, expiresAt: at + idleMs } } satisfies LeaseWrite
      })

      /** Appends the ops from the stored item to `item`, by `origin`, with its claim change, then serves the new item. */
      const persist = Effect.fnUntraced(function* (item: BacklogItem, origin: string, leaseWrite?: LeaseWrite) {
        const prev = (yield* Ref.get(state)).records.get(item.id)
        const lease = leaseWrite ?? (yield* leaseAfter(item, origin))
        if (prev !== undefined) yield* repo.append({ prev, next: item, origin, lease }).pipe(Effect.mapError(writeFailed(item, 'put')))
        const at = yield* Clock.currentTimeMillis
        yield* Ref.update(state, current => {
          const leases = new Map(current.leases)
          if (lease?.kind === 'clear') leases.delete(item.id)
          if (lease?.kind === 'set') leases.set(item.id, lease.lease)
          return { ...current, records: new Map(current.records).set(item.id, item), leases, revision: Math.max(current.revision + 1, at) }
        })
      })

      const putFile = (item: BacklogItem, file: { readonly attachment: BacklogAttachment; readonly data: string }) =>
        repo.putFile({ itemId: item.id, attachment: file.attachment, data: file.data }).pipe(Effect.mapError(writeFailed(item, 'put')))

      const deleteFile = (item: BacklogItem, attachmentId: string) =>
        repo.deleteFile({ itemId: item.id, attachmentId }).pipe(Effect.mapError(writeFailed(item, 'delete')))

      const filesOf = (input: readonly BacklogFileInput[], at: number) =>
        input.slice(0, BacklogItems.maxAttachments).map(file => ({ attachment: attachmentOf(file, at), data: file.data }))

      const storeFiles = Effect.fnUntraced(function* (item: BacklogItem, input: readonly BacklogFileInput[], at: number) {
        const kept = filesOf(input, at)
        yield* Effect.forEach(kept, file => putFile(item, file), { discard: true })
        return kept.map(file => file.attachment)
      })

      /** Applies a change and its event; touching an item is what keeps it fresh. */
      const touch = Effect.fnUntraced(function* (item: BacklogItem, actor: BacklogActor, event: EventDraft, change: BacklogChange, leaseWrite?: LeaseWrite) {
        const at = yield* Clock.currentTimeMillis
        const actorId = actorIdOf(actor)
        const fieldChanges = BacklogItems.humanFieldNames.flatMap(field => {
          const after = change[field]
          if (
            after === undefined ||
            (field === 'attention' && after === 'none' && item.attention === undefined) ||
            (field === 'priority' && after === 'none' && item.priority === undefined)
          )
            return []
          const beforeText = BacklogItems.displayValue(item[field]).slice(0, BacklogItems.maxBodyChars)
          const afterText = BacklogItems.displayValue(after).slice(0, BacklogItems.maxBodyChars)
          return beforeText === afterText ? [] : [{ field, before: beforeText, after: afterText }]
        })
        const { parent, delegate, criteria, plan, planApproval, summary, ...fields } = change
        const merged: BacklogItem = {
          ...item,
          ...fields,
          actors: withActor(change.actors ?? item.actors, actorId, 'contributor'),
          lastActivityAt: at,
          events: [...item.events, { at, actor: actorId, origin: actorId, ...event, ...(fieldChanges.length !== 0 && { fieldChanges }) }],
        }
        const next = withClearable(merged, { parent, delegate, criteria, plan, planApproval, summary })
        yield* persist(next, event.origin ?? actorId, leaseWrite)
        const stored = next.events.at(-1)
        if (stored !== undefined) yield* PubSub.publish(notices, { item: next, event: stored })
        return yield* detailOf(next)
      })

      const closeDuplicateTargets = Effect.fnUntraced(function* (source: BacklogItem) {
        for (const link of source.links) {
          if (link.type !== 'item' || link.relation !== 'duplicates') continue
          const targetId = idOfRef((yield* Ref.get(state)).records, link.target)
          if (targetId === undefined) continue
          const target = yield* find(targetId)
          if (target === undefined || target.status === 'done' || target.status === 'dropped' || target.humanFields.includes('status')) continue
          const change = { status: 'done' as const, ...closedStateChange({ item: target, status: 'done' }) }
          yield* touch(
            target,
            { kind: 'system' },
            { kind: 'moved', detail: `${target.status} → done (duplicate ${BacklogReference.labelOf(source)} resolved)` },
            change,
          )
        }
      })

      const touchAndCloseDuplicates = Effect.fnUntraced(function* (item: BacklogItem, actor: BacklogActor, event: EventDraft, change: BacklogChange) {
        const detail = yield* touch(item, actor, event, change)
        if (change.status === 'done' && item.status !== 'done') {
          const resolved = yield* find(item.id)
          if (resolved !== undefined) yield* closeDuplicateTargets(resolved)
        }
        return detail
      })

      /** One write against an item that must exist: runs alone, and answers `not-found` without writing when it does not. */
      const withItem = <E>(
        id: number,
        body: (item: BacklogItem) => Effect.Effect<BacklogResult<BacklogDetail>, E>,
      ): Effect.Effect<BacklogResult<BacklogDetail>, E> =>
        serialized(Effect.flatMap(find(id), item => (item === undefined ? Effect.succeed(notFound) : body(item))))

      /** The ref `parentRef` names, once it can hold `item`: refused when it is the item, under it, or too deep. */
      const checkedParent = Effect.fnUntraced(function* (input: { readonly item: Pick<BacklogItem, 'id' | 'ref'>; readonly parentRef: string }) {
        const current = yield* view
        const ref = BacklogReference.parse(input.parentRef)
        const target = ref === undefined ? undefined : idOfRef(current.records, ref)
        const parent = target === undefined ? undefined : current.records.get(target)
        const parentRef = parent === undefined ? (ref ?? input.parentRef) : BacklogReference.refOf(parent)
        const problem = ItemRelations.parentProblem({
          item: input.item.id === 0 ? { id: 0, ref: '' } : input.item,
          parentRef,
          byRef: candidate => current.relations.byRef(candidate),
          childrenOf: candidate => {
            const owner = current.relations.byRef(candidate)
            return owner === undefined ? [] : current.relations.childrenOf(owner)
          },
        })
        if (problem !== null) return yield* new BacklogParentInvalid({ reason: problem })
        return parentRef
      })

      const capture = Effect.fn('backlog store capture')(function* (input: {
        readonly text: string
        readonly project?: string | null | undefined
        readonly status?: BacklogStatus | undefined
        readonly kind?: BacklogKind | undefined
        readonly priority?: BacklogPriority | undefined
        readonly parent?: string | undefined
        readonly files?: readonly BacklogFileInput[] | undefined
        readonly fields?: { readonly body?: string | undefined; readonly tags?: readonly string[] | undefined } | undefined
        readonly actor: BacklogActor
        readonly origin?: string | undefined
      }) {
        const { text, project, status, kind, actor } = input
        const parent = input.parent === undefined ? undefined : yield* checkedParent({ item: { id: 0 }, parentRef: input.parent })
        const at = yield* Clock.currentTimeMillis
        const id = (yield* Ref.get(state)).nextId
        const ref = yield* repo.mintRef
        const triaged = BacklogItems.triage(text)
        const priority = input.priority ?? triaged.priority
        const actorId = actorIdOf(actor)
        const files = filesOf(input.files ?? [], at)
        const attachments = files.map(file => file.attachment)
        const startedInThread = actor.kind === 'agent' && actor.sessionId !== undefined && actor.sessionId !== '' ? actor.sessionId : null
        const origin = input.origin ?? actorId
        const createdEvent: BacklogEvent =
          startedInThread === null
            ? { at, actor: actorId, origin, kind: 'created', detail: text.slice(0, BacklogItems.maxBodyChars) }
            : { at, actor: actorId, origin, kind: 'created', detail: text.slice(0, BacklogItems.maxBodyChars), threadId: startedInThread }
        const item: BacklogItem = {
          id,
          ref,
          title: triaged.title,
          body: input.fields?.body?.slice(0, BacklogItems.maxBodyChars) ?? triaged.body,
          kind: kind ?? triaged.kind,
          status: status ?? 'inbox',
          project: BacklogItems.projectOf(project ?? (actor.kind === 'agent' ? (actor.cwd ?? null) : null)),
          tags: input.fields?.tags === undefined ? triaged.tags : [...new Set(input.fields.tags)].slice(0, 20),
          links: BacklogItems.uniqueLinks([...triaged.links, ...callerLinks(actor)]),
          attachments,
          actors: [{ id: actorId, role: 'owner' }],
          pinned: false,
          humanFields: [
            ...(kind === undefined ? [] : (['kind'] as const)),
            ...(status === undefined ? [] : (['status'] as const)),
            ...(project === undefined ? [] : (['project'] as const)),
            ...(input.priority === undefined ? [] : (['priority'] as const)),
          ],
          createdAt: at,
          lastActivityAt: at,
          events: [createdEvent],
          ...(priority !== undefined && priority !== 'none' && { priority }),
          ...(parent !== undefined && { parent }),
        }
        yield* repo.create({ item, origin, nextId: id + 1, files }).pipe(Effect.mapError(writeFailed(item, 'put')))
        yield* Ref.update(state, current => ({ ...current, nextId: id + 1 }))
        yield* persist(item, origin)
        yield* PubSub.publish(notices, { item, event: createdEvent })
        return yield* detailOf(item)
      }, serialized)

      const attachFile = Effect.fn('backlog store attach file')(function* (input: {
        readonly id: number
        readonly file: BacklogFileInput
        readonly actor: BacklogActor
      }) {
        return yield* withItem(input.id, item =>
          Effect.gen(function* () {
            if (item.attachments.length >= BacklogItems.maxAttachments) return yield* unchanged(item)
            const attachment = attachmentOf(input.file, yield* Clock.currentTimeMillis)
            yield* putFile(item, { attachment, data: input.file.data })
            return found(
              yield* touch(item, input.actor, { kind: 'edited', detail: `attached ${attachment.name}` }, { attachments: [...item.attachments, attachment] }),
            )
          }),
        )
      })

      const importTweetContext = Effect.fn('backlog store import tweet context')(function* (input: {
        readonly id: number
        readonly url: string
        readonly bodySection: string
        readonly files: readonly BacklogFileInput[]
        readonly actor: BacklogActor
      }) {
        return yield* withItem(input.id, item =>
          Effect.gen(function* () {
            const imported = item.tweetContextUrls ?? []
            if (imported.includes(input.url) || imported.length >= 20) return yield* unchanged(item)
            const additions = yield* storeFiles(
              item,
              input.files.slice(0, BacklogItems.maxAttachments - item.attachments.length),
              yield* Clock.currentTimeMillis,
            )
            const separator = item.body === '' || input.bodySection === '' ? '' : '\n\n'
            const bodyRoom = Math.max(0, BacklogItems.maxBodyChars - item.body.length - separator.length)
            const bodyAddition = input.bodySection.slice(0, bodyRoom)
            const nextBody = bodyAddition === '' ? item.body : `${item.body}${separator}${bodyAddition}`
            const change: BacklogChange = { tweetContextUrls: [...imported, input.url], attachments: [...item.attachments, ...additions] }
            if (nextBody !== item.body) change.body = nextBody
            const detail = `retrieved tweet context from ${input.url}`
            const event = additions.length === 0 ? { kind: 'edited' as const, detail } : { kind: 'edited' as const, detail, attachments: additions }
            return found(yield* touch(item, input.actor, event, change))
          }),
        )
      })

      const readFile = Effect.fn('backlog store read file')(function* (input: { readonly id: number; readonly attachmentId: string }) {
        const item = yield* find(input.id)
        if (item === undefined || attachmentOfItem(item, input.attachmentId) === undefined) return notFound
        const stored = yield* repo.readFile({ itemId: input.id, attachmentId: input.attachmentId }).pipe(Effect.orDie)
        if (Option.isNone(stored)) return notFound
        return found({ dataUrl: `data:${stored.value.mediaType};base64,${stored.value.data}` })
      })

      const removeFile = Effect.fn('backlog store remove file')(function* (input: {
        readonly id: number
        readonly attachmentId: string
        readonly actor: BacklogActor
      }) {
        return yield* withItem(input.id, item =>
          Effect.gen(function* () {
            const attachment = item.attachments.find(candidate => candidate.id === input.attachmentId)
            if (attachment === undefined) return yield* unchanged(item)
            yield* deleteFile(item, input.attachmentId)
            const attachments = item.attachments.filter(candidate => candidate.id !== input.attachmentId)
            return found(yield* touch(item, input.actor, { kind: 'edited', detail: `removed ${attachment.name}` }, { attachments }))
          }),
        )
      })

      const remove = Effect.fn('backlog store delete')(function* (input: { readonly id: number }) {
        const item = yield* find(input.id)
        if (item === undefined) return notFound
        yield* repo.remove({ item, origin: 'user' }).pipe(Effect.mapError(writeFailed(item, 'delete')))
        const at = yield* Clock.currentTimeMillis
        yield* Ref.update(state, current => {
          const next = new Map(current.records)
          next.delete(input.id)
          return { ...current, records: next, revision: Math.max(current.revision + 1, at) }
        })
        return found(undefined)
      }, serialized)

      const update = Effect.fn('backlog store update')(function* (
        input: BacklogUpdate & { readonly actor: BacklogActor; readonly origin?: string | undefined },
      ) {
        const { id, actor, origin, ...requested } = input
        const by = origin === undefined ? {} : { origin }
        return yield* withItem(id, item =>
          Effect.gen(function* () {
            const parent =
              requested.parent === undefined || requested.parent === null ? requested.parent : yield* checkedParent({ item, parentRef: requested.parent })
            const fields = { ...requested, parent }
            const { change, changed, userChanged } = updateChange(item, fields, actor)
            const clearedSuggestion = change.proposal === null
            if (changed.length === 0 && change.snoozedUntil === undefined && !clearedSuggestion) return yield* unchanged(item)
            if (changed.length === 0) {
              const details = [
                ...(change.snoozedUntil === undefined ? [] : [change.snoozedUntil === null ? 'woke it' : 'snoozed it']),
                ...(clearedSuggestion ? ['cleared closed-item suggestion'] : []),
              ]
              return found(yield* touchAndCloseDuplicates(item, actor, { kind: 'edited', detail: details.join('; '), ...by }, change))
            }
            if (actor.kind === 'user') change.humanFields = [...new Set([...item.humanFields, ...userChanged])]
            const detail =
              change.status === undefined
                ? `${changed.join(', ')}`
                : `${item.status} → ${change.status}${changed.length > 1 ? `; ${changed.filter(field => field !== 'status').join(', ')}` : ''}`
            return found(yield* touchAndCloseDuplicates(item, actor, { kind: change.status === undefined ? 'edited' : 'moved', detail, ...by }, change))
          }),
        )
      })

      const link = Effect.fn('backlog store link')(function* (input: {
        readonly id: number
        readonly link: BacklogLink
        readonly remove?: boolean | undefined
        readonly actor: BacklogActor
        readonly origin?: string | undefined
      }) {
        return yield* withItem(input.id, item =>
          Effect.gen(function* () {
            const removing = input.remove === true
            const present = item.links.some(candidate => BacklogItems.sameLink(candidate, input.link))
            if (removing ? !present : present) return yield* unchanged(item)
            const provenance = input.link.provenance ?? (input.actor.kind === 'agent' ? 'agent' : input.actor.kind === 'user' ? 'user' : 'inferred')
            const links = removing
              ? item.links.filter(candidate => !BacklogItems.sameLink(candidate, input.link))
              : BacklogItems.uniqueLinks([...item.links, { ...input.link, provenance }])
            const label = `${input.link.relation === undefined || input.link.relation === 'related' ? '' : `${input.link.relation} `}${input.link.type}:${input.link.target}`
            const sourceThread = input.link.type === 'thread' ? { threadId: input.link.target } : {}
            const by = input.origin === undefined ? {} : { origin: input.origin }
            return found(yield* touch(item, input.actor, { kind: removing ? 'unlinked' : 'linked', detail: label, ...sourceThread, ...by }, { links }))
          }),
        )
      })

      const comment = Effect.fn('backlog store comment')(function* (input: {
        readonly id: number
        readonly text: string
        readonly files?: readonly BacklogFileInput[] | undefined
        readonly actor: BacklogActor
        readonly origin?: string | undefined
      }) {
        return yield* withItem(input.id, item =>
          Effect.gen(function* () {
            const commentFiles = input.files ?? []
            const attachments = commentFiles.length === 0 ? [] : yield* storeFiles(item, commentFiles, yield* Clock.currentTimeMillis)
            const links = BacklogItems.uniqueLinks([...item.links, ...BacklogItems.extractLinks(input.text), ...callerLinks(input.actor)])
            const actor = input.actor
            const sourceThread = actor.kind === 'agent' && actor.sessionId !== undefined && actor.sessionId !== '' ? { threadId: actor.sessionId } : {}
            const commentId = globalThis.crypto.randomUUID()
            const event = {
              kind: 'commented' as const,
              detail: input.text.slice(0, BacklogItems.maxBodyChars),
              ...sourceThread,
              commentId,
              ...(input.origin !== undefined && { origin: input.origin }),
            }
            return found(yield* touch(item, actor, attachments.length > 0 ? { ...event, attachments } : event, { links }))
          }),
        )
      })

      const editComment = Effect.fn('backlog store edit comment')(function* (input: {
        readonly id: number
        readonly commentId: string
        readonly text: string
        readonly files?: readonly BacklogFileInput[] | undefined
        readonly actor: BacklogActor
      }) {
        return yield* withItem(input.id, item =>
          Effect.gen(function* () {
            if (input.actor.kind !== 'user') return notFound
            const commentIndex = userCommentIndex(item, input.commentId)
            const existing = item.events[commentIndex]
            if (existing === undefined) return notFound
            const replacements = input.files
            const attachments = replacements === undefined ? existing.attachments : yield* storeFiles(item, replacements, yield* Clock.currentTimeMillis)
            if (replacements !== undefined) {
              const dropped = (existing.attachments ?? []).filter(attachment => !replacements.some(file => file.id === attachment.id))
              yield* Effect.forEach(dropped, attachment => deleteFile(item, attachment.id), { discard: true })
            }
            const events = item.events.map((event, index) =>
              index === commentIndex
                ? {
                    ...event,
                    commentId: input.commentId,
                    detail: input.text.slice(0, BacklogItems.maxBodyChars),
                    ...(attachments !== undefined && { attachments }),
                  }
                : event,
            )
            return found(yield* touch({ ...item, events }, input.actor, { kind: 'edited', detail: 'edited a reply' }, {}))
          }),
        )
      })

      const deleteComment = Effect.fn('backlog store delete comment')(function* (input: {
        readonly id: number
        readonly commentId: string
        readonly actor: BacklogActor
      }) {
        return yield* withItem(input.id, item =>
          Effect.gen(function* () {
            if (input.actor.kind !== 'user') return notFound
            const commentIndex = userCommentIndex(item, input.commentId)
            const existing = item.events[commentIndex]
            if (existing === undefined) return notFound
            yield* Effect.forEach(existing.attachments ?? [], attachment => deleteFile(item, attachment.id), { discard: true })
            const events = item.events.filter((_event, index) => index !== commentIndex)
            return found(yield* touch({ ...item, events }, input.actor, { kind: 'edited', detail: 'deleted a reply' }, {}))
          }),
        )
      })

      const revert = Effect.fn('backlog store revert')(function* (input: {
        readonly id: number
        readonly at: number
        readonly field: BacklogHumanField
        readonly actor: BacklogActor
      }) {
        const item = yield* find(input.id)
        if (item === undefined) return notFound
        const records = yield* repo.opsOf(input.id).pipe(Effect.mapError(writeFailed(item, 'put')))
        const planned = FieldRevert.plan({ records, id: input.id, at: input.at, field: input.field })
        if (planned.kind === 'missing') return notFound
        if (planned.kind === 'stale') {
          const by = planned.by === 'user' ? 'you' : planned.by
          return {
            ok: false,
            reason: 'stale',
            message: `The ${input.field} of ${BacklogReference.labelOf(item)} changed again since (by ${by} at ${new Date(planned.changedAt).toISOString()}). Revert that later change first, or edit the ${input.field} directly.`,
          } satisfies BacklogRevertStale
        }
        const before = planned.before
        const change: BacklogChange = {}
        const restored = before === undefined ? clearedValue(input.field) : before
        if (input.field === 'parent' && typeof restored === 'string') yield* checkedParent({ item, parentRef: restored })
        Object.assign(change, { [input.field]: restored })
        if (input.actor.kind === 'user') change.humanFields = [...new Set([...item.humanFields, input.field])]
        const kind = input.field === 'status' ? 'moved' : 'edited'
        return found(yield* touch(item, input.actor, { kind, detail: `reverted ${input.field}` }, change))
      }, serialized)

      const claim = Effect.fn('backlog store claim')(function* (input: { readonly id: number; readonly actor: BacklogActor }) {
        const item = yield* find(input.id)
        if (item === undefined) return notFound
        const ref = BacklogReference.refOf(item)
        const actor = input.actor
        if (actor.kind !== 'agent' || actor.sessionId === undefined || actor.sessionId === '')
          return yield* new BacklogClaimRefused({ ref, reason: 'not-agent' })
        if (!ItemRelations.isOpen(item)) return yield* new BacklogClaimRefused({ ref, reason: 'closed' })
        const holder = actorIdOf(actor)
        const at = yield* Clock.currentTimeMillis
        const held = (yield* Ref.get(state)).leases.get(item.id)
        const live = held !== undefined && held.expiresAt > at ? held : undefined
        if (live !== undefined && live.holder !== holder) return yield* new BacklogItemClaimed({ ref, holder: live.holder, expiresAt: live.expiresAt })
        const idleMs = (yield* settings.get).leaseIdleMinutes * 60_000
        const lease: BacklogLease = { holder, acquiredAt: live?.acquiredAt ?? at, heartbeat: at, expiresAt: at + idleMs }
        const change: BacklogChange = {
          delegate: holder,
          links: BacklogItems.uniqueLinks([...item.links, { type: 'thread', target: actor.sessionId, provenance: 'agent' }]),
        }
        if (item.status !== 'doing') change.status = 'doing'
        const detail = change.status === undefined ? `claimed by ${holder}` : `${item.status} → doing (claimed by ${holder})`
        return found(
          yield* touch(item, actor, { kind: change.status === undefined ? 'edited' : 'moved', detail, threadId: actor.sessionId }, change, {
            kind: 'set',
            lease,
          }),
        )
      }, serialized)

      const release = Effect.fn('backlog store release')(function* (input: {
        readonly id: number
        readonly actor: BacklogActor
        readonly reason?: string | undefined
      }) {
        const item = yield* find(input.id)
        if (item === undefined) return notFound
        const at = yield* Clock.currentTimeMillis
        const held = (yield* Ref.get(state)).leases.get(item.id)
        const caller = actorIdOf(input.actor)
        if (input.actor.kind === 'agent' && held !== undefined && held.expiresAt > at && held.holder !== caller)
          return yield* new BacklogItemClaimed({ ref: BacklogReference.refOf(item), holder: held.holder, expiresAt: held.expiresAt })
        if (held === undefined && item.delegate === undefined) return yield* unchanged(item)
        const change: BacklogChange = { delegate: null }
        if (item.status === 'doing') change.status = 'todo'
        const why = input.reason ?? `released by ${caller === 'user' ? 'you' : caller}`
        const detail = change.status === undefined ? why : `doing → todo (${why})`
        const leaseWrite: LeaseWrite | undefined = held === undefined ? undefined : { kind: 'clear' }
        return found(yield* touch(item, input.actor, { kind: change.status === undefined ? 'edited' : 'moved', detail }, change, leaseWrite))
      }, serialized)

      const delegateTo = Effect.fn('backlog store delegate')(function* (input: {
        readonly id: number
        readonly sessionId: string
        readonly actor: BacklogActor
      }) {
        return yield* withItem(input.id, item => {
          const delegate = `agent:${input.sessionId}`
          if (item.delegate === delegate || !ItemRelations.isOpen(item)) return unchanged(item)
          return Effect.map(touch(item, input.actor, { kind: 'edited', detail: `delegated to ${delegate}`, threadId: input.sessionId }, { delegate }), found)
        })
      })

      const markTriaged = Effect.fn('backlog store mark triaged')(function* (id: number) {
        const item = yield* find(id)
        if (item === undefined) return
        const at = yield* Clock.currentTimeMillis
        yield* persist(
          { ...item, events: [...item.events, { at, actor: 'system', origin: 'system', kind: 'triaged', detail: BacklogItems.triageNoChange }] },
          'system',
        )
      }, serialized)

      const propose = Effect.fn('backlog store propose')(function* (input: { readonly id: number; readonly proposal: BacklogProposal }) {
        const lookup = yield* refLookup
        return yield* withItem(input.id, item =>
          Effect.map(
            touch(
              item,
              { kind: 'system' },
              { kind: 'triaged', detail: `suggested ${BacklogTriage.describe(input.proposal, lookup)}` },
              { proposal: input.proposal },
            ),
            found,
          ),
        )
      })

      const applyProposal = Effect.fn('backlog store apply proposal')(function* (input: {
        readonly id: number
        readonly proposal?: BacklogProposal | undefined
        readonly actor: BacklogActor
      }) {
        return yield* withItem(input.id, item =>
          Effect.gen(function* () {
            const chosen = input.proposal ?? item.proposal ?? undefined
            if (chosen === undefined) return yield* unchanged(item)
            const current = yield* Ref.get(state)
            const { change, applied } = proposalChange({
              item,
              chosen,
              actor: input.actor,
              refOfId: id => {
                const target = current.records.get(id)
                return target === undefined ? undefined : BacklogReference.refOf(target)
              },
            })
            const detail = `applied ${BacklogTriage.describe(applied, yield* refLookup) || 'nothing'}`
            return found(yield* touchAndCloseDuplicates(item, input.actor, { kind: 'triaged', detail }, change))
          }),
        )
      })

      const applySignal = Effect.fn('backlog store apply signal')(function* (input: {
        readonly id: number
        readonly status: 'doing' | 'done'
        readonly link: BacklogLink
        readonly reason: string
      }) {
        return yield* withItem(input.id, item =>
          Effect.gen(function* () {
            const linked = item.links.some(candidate => BacklogItems.sameLink(candidate, input.link))
            const order = ['inbox', 'todo', 'doing', 'done']
            const forward = item.status !== 'dropped' && order.indexOf(input.status) > order.indexOf(item.status)
            const moves = forward && !item.humanFields.includes('status')
            const closedChange = closedStateChange({ item, status: moves ? input.status : item.status })
            const hasClosedChange = closedChange.attention !== undefined || closedChange.proposal !== undefined
            if (linked && !moves) {
              if (!hasClosedChange) return yield* unchanged(item)
              const cleared = [...(closedChange.attention === undefined ? [] : ['attention']), ...(closedChange.proposal === undefined ? [] : ['suggestion'])]
              return found(yield* touch(item, { kind: 'system' }, { kind: 'edited', detail: `closed item: cleared ${cleared.join(' and ')}` }, closedChange))
            }
            const change: BacklogChange = { links: BacklogItems.uniqueLinks([...item.links, input.link]), ...closedChange }
            if (moves) change.status = input.status
            const detail = moves ? `${item.status} → ${input.status} (${input.reason})` : `${input.link.type}:${input.link.target} (${input.reason})`
            const sourceThread = input.link.type === 'thread' ? { threadId: input.link.target } : {}
            return found(yield* touchAndCloseDuplicates(item, { kind: 'system' }, { kind: moves ? 'moved' : 'linked', detail, ...sourceThread }, change))
          }),
        )
      })

      const applyThreadAttention = Effect.fn('backlog store apply thread attention')(function* (input: {
        readonly id: number
        readonly threadId: string
        readonly attention: 'blocked' | 'waiting' | 'none'
        readonly reason: string
      }) {
        const { threadId, reason } = input
        return yield* withItem(input.id, item =>
          Effect.gen(function* () {
            const system = { kind: 'system' } as const
            const attention = item.attention ?? 'none'
            if (item.humanFields.includes('attention')) return yield* unchanged(item)
            if (input.attention === 'waiting') {
              if (item.status !== 'doing' || attention !== 'none') return yield* unchanged(item)
              if (item.events.some(event => isIdleNudge(event) && event.threadId === threadId)) return yield* unchanged(item)
              return found(yield* touch(item, system, { kind: 'commented', detail: reason, threadId }, { attention: 'waiting', acknowledgedAt: null }))
            }
            if (input.attention === 'blocked') {
              if (attention !== 'none' || item.status === 'done' || item.status === 'dropped') return yield* unchanged(item)
              return found(
                yield* touch(
                  item,
                  system,
                  { kind: 'edited', detail: `attention: blocked (${reason})`, threadId },
                  { attention: 'blocked', acknowledgedAt: null },
                ),
              )
            }
            const last = item.events.at(-1)
            const stalledHere = last?.actor === 'system' && last.kind === 'edited' && last.detail.startsWith('attention: blocked (')
            const waitingHere = item.events.findLast(event => event.actor === 'system' && isIdleNudge(event))?.threadId === threadId
            const clears = (attention === 'blocked' && stalledHere) || (attention === 'waiting' && waitingHere)
            if (!clears) return yield* unchanged(item)
            return found(yield* touch(item, system, { kind: 'edited', detail: `attention: none (${reason})`, threadId }, { attention: 'none' }))
          }),
        )
      })

      const settleAnsweredQuestion = Effect.fn('backlog store settle answered question')(function* (input: {
        readonly id: number
        readonly threadId: string
        readonly reason: string
      }) {
        return yield* withItem(input.id, item =>
          ThreadLifecycle.answeredQuestionSettles({ item, threadId: input.threadId })
            ? Effect.map(
                touch(
                  item,
                  { kind: 'agent', sessionId: input.threadId },
                  { kind: 'edited', detail: `attention: none (${input.reason})`, threadId: input.threadId },
                  { attention: 'none' },
                ),
                found,
              )
            : unchanged(item),
        )
      })

      const acknowledge = Effect.fn('backlog store acknowledge')(function* (input: { readonly ids: readonly number[] }) {
        for (const id of input.ids) {
          const item = yield* find(id)
          if (item !== undefined) yield* persist({ ...item, acknowledgedAt: yield* Clock.currentTimeMillis }, 'user')
        }
      }, serialized)

      const dismissProposal = Effect.fn('backlog store dismiss proposal')(function* (input: { readonly id: number; readonly actor: BacklogActor }) {
        const lookup = yield* refLookup
        return yield* withItem(input.id, item =>
          item.proposal === undefined || item.proposal === null
            ? unchanged(item)
            : Effect.map(
                touch(item, input.actor, { kind: 'triaged', detail: `dismissed ${BacklogTriage.describe(item.proposal, lookup)}` }, { proposal: null }),
                found,
              ),
        )
      })

      const get = Effect.fn('backlog store get')(function* (id: number) {
        const item = yield* find(id)
        return item === undefined ? notFound : found(yield* detailOf(item))
      })

      const getMany = Effect.fn('backlog store get many')(function* (ids: readonly number[]) {
        const current = yield* view
        const items: BacklogDetail[] = []
        const missing: number[] = []
        for (const id of new Set(ids)) {
          const item = current.records.get(id)
          if (item === undefined) missing.push(id)
          if (item !== undefined) items.push(detailIn(current, item))
        }
        return { items, missing }
      })

      return BacklogStore.of({
        revision: Effect.map(Ref.get(state), current => current.revision),
        changes: Stream.fromPubSub(notices),
        capture,
        attachFile,
        importTweetContext,
        readFile,
        removeFile,
        delete: remove,
        update,
        link,
        comment,
        editComment,
        deleteComment,
        revert,
        triageInput: id =>
          Effect.map(Ref.get(state), current =>
            Option.map(Option.fromUndefinedOr(current.records.get(id)), item => ({ item, others: [...current.records.values()] })),
          ),
        triageCandidates: scope => Effect.map(Ref.get(state), current => BacklogBackfill.select([...current.records.values()], scope)),
        markTriaged,
        propose,
        applyProposal,
        applySignal,
        applyThreadAttention,
        settleAnsweredQuestion,
        claim,
        release,
        leases: Effect.map(Ref.get(state), current => [...current.leases].map(([id, lease]) => ({ id, lease }))),
        delegateTo,
        acknowledge,
        dismissProposal,
        projects: query => Effect.map(view, current => projectsIn(current, query)),
        shipped: query => Effect.map(view, current => BacklogShipped.digest({ items: current.records.values(), query, now: current.at })),
        list: query => Effect.map(view, current => listIn(current, query, searchIndex)),
        get,
        resolve: key => Effect.map(Ref.get(state), current => resolveIn(current.records, key)),
        labelOf: id => Effect.map(find(id), item => BacklogReference.labelOf(item ?? { id })),
        getMany,
        referencing: link => Effect.map(view, current => referencingIn(current, link)),
      })
    }),
  )
}
