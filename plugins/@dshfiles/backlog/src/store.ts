import { Clock, Context, Effect, Layer, Option, PubSub, Ref, Semaphore, Stream } from 'effect'
import type { BacklogDetailView, BacklogSummaryView } from './api.js'
import { BacklogBackfill, type BackfillScope, type BackfillSelection } from './backfill.js'
import { BacklogSettingsTag } from './backlog-settings.js'
import { BacklogTables, type BacklogFileRecord } from './backlog-tables.js'
import { BacklogWriteFailed } from './errors.js'
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
  type BacklogLink,
  type BacklogProposal,
  type BacklogStatus,
} from './item.js'
import { BacklogSearch, type SearchMatch } from './search.js'
import { ThreadLifecycle } from './thread-lifecycle.js'
import { BacklogTriage } from './triage.js'

/** The fields one edit replaces, mutable because a handler assembles them before the record is rewritten. */
type BacklogChange = { -readonly [K in keyof BacklogItem]?: BacklogItem[K] }
/** The optional dimensions an upload carries; mutable while the attachment is assembled. */
type AttachmentDimensions = { -readonly [K in 'width' | 'height']?: BacklogAttachment[K] }
type ProposalDraft = { -readonly [K in keyof BacklogProposal]?: BacklogProposal[K] }

const fileKey = (itemId: number, attachmentId: string): string => `${String(itemId)}:${attachmentId}`

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
}

export type BacklogResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: 'not-found' }

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

const summarize = (item: BacklogItem, now: number, match: SearchMatch | null = null, dormantDays = BacklogItems.defaultDormantDays): BacklogSummary => ({
  id: item.id,
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
})

/** Pinned first, then newest activity: the Discord order, where idle things sink on their own. */
const byActivity = (left: BacklogItem, right: BacklogItem): number =>
  Number(right.pinned) - Number(left.pinned) || right.lastActivityAt - left.lastActivityAt || right.id - left.id

const notFound = { ok: false, reason: 'not-found' } as const

const found = <T>(value: T): BacklogResult<T> => ({ ok: true, value })

type EventDraft = Pick<BacklogEvent, 'kind' | 'detail' | 'threadId' | 'attachments' | 'commentId'>

/** One stored event of one item, as the Activity timeline hears about it. */
export interface BacklogChangeNotice {
  readonly item: BacklogItem
  readonly event: BacklogEvent
}

interface StoreState {
  readonly records: ReadonlyMap<number, BacklogItem>
  readonly nextId: number
  readonly revision: number
}

/** What a read sees: the records, the time it reads at and the dormancy thresholds of that moment. */
interface StoreView {
  readonly records: ReadonlyMap<number, BacklogItem>
  readonly revision: number
  readonly at: number
  readonly dormantDays: Readonly<Record<BacklogKind, number>>
}

/** A project is where the work happens, so one recorded in a jj workspace reads as the checkout it was cut from. */
const withProject = (item: BacklogItem): BacklogItem => {
  const project = BacklogItems.projectOf(item.project)
  return project === item.project ? item : { ...item, project }
}

const referencingIn = (view: StoreView, link: BacklogLink): BacklogSummary[] =>
  [...view.records.values()]
    .filter(item => item.links.some(candidate => BacklogItems.sameLink(candidate, link)))
    .sort(byActivity)
    .map(item => summarize(item, view.at, null, view.dormantDays))

const detailIn = (view: StoreView, item: BacklogItem): BacklogDetail => ({
  item: {
    ...item,
    events: item.events.map((event, index) =>
      event.kind === 'commented' && event.commentId === undefined ? { ...event, commentId: `legacy-${String(event.at)}-${String(index)}` } : event,
    ),
    freshness: BacklogItems.freshness(item, view.at, view.dormantDays),
  },
  backlinks: referencingIn(view, { type: 'item', target: String(item.id) }),
})

const listIn = (view: StoreView, query: BacklogListQuery) => {
  const at = view.at
  const freshnessFilter = query.freshness ?? 'active'
  // A caller may still ask for the workspace an item was captured in; the item is filed under its project.
  const project = query.project === undefined ? undefined : BacklogItems.projectOf(query.project)
  const projects = query.projects?.map(candidate => (candidate === null ? null : BacklogItems.projectOf(candidate)))
  const matching = [...view.records.values()]
    .filter(item => query.statuses === undefined || query.statuses.length === 0 || query.statuses.includes(item.status))
    .filter(item => query.kinds === undefined || query.kinds.length === 0 || query.kinds.includes(item.kind))
    .filter(item => project === undefined || item.project === project)
    .filter(item => projects === undefined || projects.length === 0 || projects.includes(item.project))
    .filter(item => query.tag === undefined || item.tags.includes(query.tag.toLowerCase().replace(/^#/, '')))
    .filter(item => query.actor === undefined || item.actors.some(actor => actor.id === query.actor))
    .filter(item => query.inbox !== true || wantsUser(item, at))
    .filter(item => query.inbox === true || freshnessFilter === 'all' || (item.snoozedUntil ?? 0) <= at)
    .filter(item => {
      if (freshnessFilter === 'all') return true
      const state = BacklogItems.freshness(item, at, view.dormantDays)
      return freshnessFilter === 'active' ? state === 'fresh' || state === 'stale' : state === freshnessFilter
    })
  const search = BacklogSearch.parse(query.query ?? '')
  const scored = matching.flatMap(item => {
    const match = BacklogSearch.score(item, search, at)
    return match === null ? [] : [{ item, match }]
  })
  // A text search ranks by relevance, then activity; browsing keeps the activity order.
  scored.sort((left, right) => right.match.score - left.match.score || byActivity(left.item, right.item))
  const limit = Math.min(query.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  return {
    revision: view.revision,
    total: scored.length,
    items: scored.slice(0, limit).map(entry => summarize(entry.item, at, entry.match, view.dormantDays)),
  }
}

const projectsIn = (view: StoreView) => {
  const byProject = new Map<string | null, BacklogItem[]>()
  for (const item of view.records.values()) byProject.set(item.project, [...(byProject.get(item.project) ?? []), item])
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

/** What one `update` call changes, the fields it records, and the fields that become the user's. */
const updateChange = (item: BacklogItem, fields: Omit<BacklogUpdate, 'id'>) => {
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
  if (fields.snoozedUntil !== undefined && fields.snoozedUntil !== (item.snoozedUntil ?? null)) change.snoozedUntil = fields.snoozedUntil
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
  readonly exists: (id: number) => boolean
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
  if (chosen.duplicateOf !== undefined && input.exists(chosen.duplicateOf)) {
    const duplicateTarget = String(chosen.duplicateOf)
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

const isIdleNudge = (event: BacklogEvent): boolean => event.kind === 'commented' && event.detail.startsWith('Thread idle nudge:')

type Detailed = Effect.Effect<BacklogResult<BacklogDetail>, BacklogWriteFailed>

/**
 * Every backlog item, mirrored in memory and written through to the Host storage domain. Writes run one at a time, so
 * a read-modify-write never interleaves with another and ids are never allocated twice.
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
      readonly files?: readonly BacklogFileInput[] | undefined
      readonly actor: BacklogActor
    }) => Effect.Effect<BacklogDetail, BacklogWriteFailed>
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
    readonly update: (input: BacklogUpdate & { readonly actor: BacklogActor }) => Detailed
    readonly link: (input: { readonly id: number; readonly link: BacklogLink; readonly remove?: boolean | undefined; readonly actor: BacklogActor }) => Detailed
    readonly comment: (input: {
      readonly id: number
      readonly text: string
      readonly files?: readonly BacklogFileInput[] | undefined
      readonly actor: BacklogActor
    }) => Detailed
    readonly editComment: (input: {
      readonly id: number
      readonly commentId: string
      readonly text: string
      readonly files?: readonly BacklogFileInput[] | undefined
      readonly actor: BacklogActor
    }) => Detailed
    readonly deleteComment: (input: { readonly id: number; readonly commentId: string; readonly actor: BacklogActor }) => Detailed
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
    /** Marks an item's request as seen; it stays in the Inbox until its attention is cleared. Not an activity. */
    readonly acknowledge: (input: { readonly ids: readonly number[] }) => Effect.Effect<void, BacklogWriteFailed>
    readonly dismissProposal: (input: { readonly id: number; readonly actor: BacklogActor }) => Detailed
    /** Per-project counts over every item, so project progress never depends on how many rows a list returned. */
    readonly projects: Effect.Effect<ReturnType<typeof projectsIn>>
    readonly list: (query: BacklogListQuery) => Effect.Effect<ReturnType<typeof listIn>>
    readonly get: (id: number) => Effect.Effect<BacklogResult<BacklogDetail>>
    /** Several items in one call, in the order asked, with the ids that do not exist kept separate. */
    readonly getMany: (ids: readonly number[]) => Effect.Effect<{ readonly items: BacklogDetail[]; readonly missing: number[] }>
    readonly referencing: (link: BacklogLink) => Effect.Effect<BacklogSummary[]>
  }
>()('@dshfiles/backlog/BacklogStore') {
  static readonly layer = Layer.effect(
    BacklogStore,
    Effect.gen(function* () {
      const tables = yield* BacklogTables
      const settings = yield* BacklogSettingsTag
      const loaded = yield* tables.items.entries.pipe(Effect.orDie)
      const records = new Map(loaded.map(([, item]) => [item.id, withProject(item)]))
      const state = yield* Ref.make<StoreState>({
        records,
        nextId: Math.max(0, ...records.keys()) + 1,
        revision: yield* Clock.currentTimeMillis,
      })
      const writes = yield* Semaphore.make(1)
      const notices = yield* PubSub.unbounded<BacklogChangeNotice>()

      const view = Effect.gen(function* () {
        const current = yield* Ref.get(state)
        const at = yield* Clock.currentTimeMillis
        const dormantDays = (yield* settings.get).dormantAfterDays
        return { records: current.records, revision: current.revision, at, dormantDays } satisfies StoreView
      })
      const find = (id: number) => Effect.map(Ref.get(state), current => current.records.get(id))
      const detailOf = (item: BacklogItem) => Effect.map(view, current => detailIn(current, item))
      const unchanged = (item: BacklogItem) => Effect.map(detailOf(item), found)
      const serialized = <A, E, R>(effect: Effect.Effect<A, E, R>) => writes.withPermit(effect)

      const persist = Effect.fnUntraced(function* (item: BacklogItem) {
        yield* tables.items.put(String(item.id), item).pipe(Effect.mapError(cause => new BacklogWriteFailed({ itemId: item.id, operation: 'put', cause })))
        const at = yield* Clock.currentTimeMillis
        yield* Ref.update(state, current => ({
          ...current,
          records: new Map(current.records).set(item.id, item),
          revision: Math.max(current.revision + 1, at),
        }))
      })

      const putFile = (itemId: number, record: BacklogFileRecord) =>
        tables.files
          .put(fileKey(itemId, record.attachment.id), record)
          .pipe(Effect.mapError(cause => new BacklogWriteFailed({ itemId, operation: 'put', cause })))

      const deleteFile = (itemId: number, attachmentId: string) =>
        tables.files.delete(fileKey(itemId, attachmentId)).pipe(Effect.mapError(cause => new BacklogWriteFailed({ itemId, operation: 'delete', cause })))

      const storeFiles = Effect.fnUntraced(function* (itemId: number, input: readonly BacklogFileInput[], at: number) {
        const kept = input.slice(0, BacklogItems.maxAttachments).map(file => ({ attachment: attachmentOf(file, at), data: file.data }))
        yield* Effect.forEach(kept, file => putFile(itemId, { itemId, attachment: file.attachment, data: file.data }), { discard: true })
        return kept.map(file => file.attachment)
      })

      /** Applies a change and its event; touching an item is what keeps it fresh. */
      const touch = Effect.fnUntraced(function* (item: BacklogItem, actor: BacklogActor, event: EventDraft, change: BacklogChange) {
        const at = yield* Clock.currentTimeMillis
        const actorId = actorIdOf(actor)
        const fieldChanges = (['title', 'body', 'kind', 'status', 'project', 'tags', 'pinned', 'attention'] as const).flatMap(field => {
          const after = change[field]
          if (after === undefined || (field === 'attention' && after === 'none' && item.attention === undefined)) return []
          const before = item[field]
          const display = (value: typeof after | typeof before): string =>
            value === null || value === undefined ? '' : Array.isArray(value) ? value.join(', ') : String(value)
          const beforeText = display(before)
          const afterText = display(after)
          return beforeText === afterText ? [] : [{ field, before: beforeText, after: afterText }]
        })
        const next: BacklogItem = {
          ...item,
          ...change,
          actors: withActor(change.actors ?? item.actors, actorId, 'contributor'),
          lastActivityAt: at,
          events: BacklogItems.appendEvent(item.events, { at, actor: actorId, ...event, ...(fieldChanges.length !== 0 && { fieldChanges }) }),
        }
        yield* persist(next)
        const stored = next.events.at(-1)
        if (stored !== undefined) yield* PubSub.publish(notices, { item: next, event: stored })
        return yield* detailOf(next)
      })

      const closeDuplicateTargets = Effect.fnUntraced(function* (source: BacklogItem) {
        for (const link of source.links) {
          if (link.type !== 'item' || link.relation !== 'duplicates') continue
          const targetId = Number(link.target)
          if (!Number.isSafeInteger(targetId)) continue
          const target = yield* find(targetId)
          if (target === undefined || target.status === 'done' || target.status === 'dropped' || target.humanFields.includes('status')) continue
          const change = { status: 'done' as const, ...closedStateChange({ item: target, status: 'done' }) }
          yield* touch(target, { kind: 'system' }, { kind: 'moved', detail: `${target.status} → done (duplicate b:${String(source.id)} resolved)` }, change)
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
      const withItem = (id: number, body: (item: BacklogItem) => Detailed): Detailed =>
        serialized(Effect.flatMap(find(id), item => (item === undefined ? Effect.succeed(notFound) : body(item))))

      const capture = Effect.fn('backlog store capture')(function* (input: {
        readonly text: string
        readonly project?: string | null | undefined
        readonly status?: BacklogStatus | undefined
        readonly kind?: BacklogKind | undefined
        readonly files?: readonly BacklogFileInput[] | undefined
        readonly actor: BacklogActor
      }) {
        const { text, project, status, kind, actor } = input
        const at = yield* Clock.currentTimeMillis
        const id = (yield* Ref.get(state)).nextId
        const triaged = BacklogItems.triage(text)
        const actorId = actorIdOf(actor)
        const attachments = yield* storeFiles(id, input.files ?? [], at)
        const startedInThread = actor.kind === 'agent' && actor.sessionId !== undefined && actor.sessionId !== '' ? actor.sessionId : null
        const createdEvent: BacklogEvent =
          startedInThread === null
            ? { at, actor: actorId, kind: 'created', detail: text.slice(0, BacklogItems.maxBodyChars) }
            : { at, actor: actorId, kind: 'created', detail: text.slice(0, BacklogItems.maxBodyChars), threadId: startedInThread }
        const item: BacklogItem = {
          id,
          title: triaged.title,
          body: triaged.body,
          kind: kind ?? triaged.kind,
          status: status ?? 'inbox',
          project: BacklogItems.projectOf(project ?? (actor.kind === 'agent' ? (actor.cwd ?? null) : null)),
          tags: triaged.tags,
          links: BacklogItems.uniqueLinks([...triaged.links, ...callerLinks(actor)]),
          attachments,
          actors: [{ id: actorId, role: 'owner' }],
          pinned: false,
          humanFields: [
            ...(kind === undefined ? [] : (['kind'] as const)),
            ...(status === undefined ? [] : (['status'] as const)),
            ...(project === undefined ? [] : (['project'] as const)),
          ],
          createdAt: at,
          lastActivityAt: at,
          events: [createdEvent],
        }
        yield* persist(item)
        yield* Ref.update(state, current => ({ ...current, nextId: id + 1 }))
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
            yield* putFile(input.id, { itemId: input.id, attachment, data: input.file.data })
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
              input.id,
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
        const stored = yield* tables.files.get(fileKey(input.id, input.attachmentId)).pipe(Effect.orDie)
        if (Option.isNone(stored)) return notFound
        return found({ dataUrl: `data:${stored.value.attachment.mediaType};base64,${stored.value.data}` })
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
            yield* deleteFile(input.id, input.attachmentId)
            const attachments = item.attachments.filter(candidate => candidate.id !== input.attachmentId)
            return found(yield* touch(item, input.actor, { kind: 'edited', detail: `removed ${attachment.name}` }, { attachments }))
          }),
        )
      })

      const remove = Effect.fn('backlog store delete')(function* (input: { readonly id: number }) {
        const item = yield* find(input.id)
        if (item === undefined) return notFound
        const files = yield* tables.files.entries.pipe(Effect.orDie)
        yield* Effect.forEach(
          files.filter(([, record]) => record.itemId === input.id),
          ([key]) => tables.files.delete(key).pipe(Effect.mapError(cause => new BacklogWriteFailed({ itemId: input.id, operation: 'delete', cause }))),
          { discard: true },
        )
        yield* tables.items.delete(String(input.id)).pipe(Effect.mapError(cause => new BacklogWriteFailed({ itemId: input.id, operation: 'delete', cause })))
        const at = yield* Clock.currentTimeMillis
        yield* Ref.update(state, current => {
          const next = new Map(current.records)
          next.delete(input.id)
          return { ...current, records: next, revision: Math.max(current.revision + 1, at) }
        })
        return found(undefined)
      }, serialized)

      const update = Effect.fn('backlog store update')(function* (input: BacklogUpdate & { readonly actor: BacklogActor }) {
        const { id, actor, ...fields } = input
        return yield* withItem(id, item =>
          Effect.gen(function* () {
            const { change, changed, userChanged } = updateChange(item, fields)
            const clearedSuggestion = change.proposal === null
            if (changed.length === 0 && change.snoozedUntil === undefined && !clearedSuggestion) return yield* unchanged(item)
            if (changed.length === 0) {
              const details = [
                ...(change.snoozedUntil === undefined ? [] : [change.snoozedUntil === null ? 'woke it' : 'snoozed it']),
                ...(clearedSuggestion ? ['cleared closed-item suggestion'] : []),
              ]
              return found(yield* touchAndCloseDuplicates(item, actor, { kind: 'edited', detail: details.join('; ') }, change))
            }
            if (actor.kind === 'user') change.humanFields = [...new Set([...item.humanFields, ...userChanged])]
            const detail =
              change.status === undefined
                ? `${changed.join(', ')}`
                : `${item.status} → ${change.status}${changed.length > 1 ? `; ${changed.filter(field => field !== 'status').join(', ')}` : ''}`
            return found(yield* touchAndCloseDuplicates(item, actor, { kind: change.status === undefined ? 'edited' : 'moved', detail }, change))
          }),
        )
      })

      const link = Effect.fn('backlog store link')(function* (input: {
        readonly id: number
        readonly link: BacklogLink
        readonly remove?: boolean | undefined
        readonly actor: BacklogActor
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
            return found(yield* touch(item, input.actor, { kind: removing ? 'unlinked' : 'linked', detail: label, ...sourceThread }, { links }))
          }),
        )
      })

      const comment = Effect.fn('backlog store comment')(function* (input: {
        readonly id: number
        readonly text: string
        readonly files?: readonly BacklogFileInput[] | undefined
        readonly actor: BacklogActor
      }) {
        return yield* withItem(input.id, item =>
          Effect.gen(function* () {
            const commentFiles = input.files ?? []
            const attachments = commentFiles.length === 0 ? [] : yield* storeFiles(input.id, commentFiles, yield* Clock.currentTimeMillis)
            const links = BacklogItems.uniqueLinks([...item.links, ...BacklogItems.extractLinks(input.text), ...callerLinks(input.actor)])
            const actor = input.actor
            const sourceThread = actor.kind === 'agent' && actor.sessionId !== undefined && actor.sessionId !== '' ? { threadId: actor.sessionId } : {}
            const commentId = globalThis.crypto.randomUUID()
            const event = { kind: 'commented' as const, detail: input.text.slice(0, BacklogItems.maxBodyChars), ...sourceThread, commentId }
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
            const attachments = replacements === undefined ? existing.attachments : yield* storeFiles(input.id, replacements, yield* Clock.currentTimeMillis)
            if (replacements !== undefined) {
              const dropped = (existing.attachments ?? []).filter(attachment => !replacements.some(file => file.id === attachment.id))
              yield* Effect.forEach(dropped, attachment => deleteFile(input.id, attachment.id), { discard: true })
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
            yield* Effect.forEach(existing.attachments ?? [], attachment => deleteFile(input.id, attachment.id), { discard: true })
            const events = item.events.filter((_event, index) => index !== commentIndex)
            return found(yield* touch({ ...item, events }, input.actor, { kind: 'edited', detail: 'deleted a reply' }, {}))
          }),
        )
      })

      const markTriaged = Effect.fn('backlog store mark triaged')(function* (id: number) {
        const item = yield* find(id)
        if (item === undefined) return
        const at = yield* Clock.currentTimeMillis
        yield* persist({
          ...item,
          events: BacklogItems.appendEvent(item.events, { at, actor: 'system', kind: 'triaged', detail: BacklogItems.triageNoChange }),
        })
      }, serialized)

      const propose = Effect.fn('backlog store propose')(function* (input: { readonly id: number; readonly proposal: BacklogProposal }) {
        return yield* withItem(input.id, item =>
          Effect.map(
            touch(item, { kind: 'system' }, { kind: 'triaged', detail: `suggested ${BacklogTriage.describe(input.proposal)}` }, { proposal: input.proposal }),
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
            const { change, applied } = proposalChange({ item, chosen, actor: input.actor, exists: id => current.records.has(id) })
            const detail = `applied ${BacklogTriage.describe(applied) || 'nothing'}`
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
          if (item !== undefined) yield* persist({ ...item, acknowledgedAt: yield* Clock.currentTimeMillis })
        }
      }, serialized)

      const dismissProposal = Effect.fn('backlog store dismiss proposal')(function* (input: { readonly id: number; readonly actor: BacklogActor }) {
        return yield* withItem(input.id, item =>
          item.proposal === undefined || item.proposal === null
            ? unchanged(item)
            : Effect.map(
                touch(item, input.actor, { kind: 'triaged', detail: `dismissed ${BacklogTriage.describe(item.proposal)}` }, { proposal: null }),
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
        acknowledge,
        dismissProposal,
        projects: Effect.map(view, projectsIn),
        list: query => Effect.map(view, current => listIn(current, query)),
        get,
        getMany,
        referencing: link => Effect.map(view, current => referencingIn(current, link)),
      })
    }),
  )
}
