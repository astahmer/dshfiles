import { defineDomain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { BacklogDetailView, BacklogSummaryView } from './api.js'
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
import { z } from 'zod'
import { BacklogBackfill, type BackfillScope, type BackfillSelection } from './backfill.js'
import { BacklogSearch, type SearchMatch } from './search.js'
import { BacklogTriage } from './triage.js'

export const backlogDomain = defineDomain({
  name: 'backlog',
  version: 1,
  tables: {
    items: { valueSchema: BacklogItems.itemSchema, __key: 'items' },
  },
})

/** File bytes live beside the items instead of inside them: a list never decodes a megabyte it does not show. */
const storedFileSchema = z
  .object({
    itemId: z.number().int().positive(),
    attachment: BacklogItems.attachmentSchema,
    data: z.string().min(1).max(12_000_000),
  })
  .strict()

export const backlogFileDomain = defineDomain({
  name: 'backlog_files',
  version: 1,
  tables: {
    files: { valueSchema: storedFileSchema, __key: 'files' },
  },
})

type ItemTable = KvTable<string, BacklogItem>
type FileTable = KvTable<string, z.infer<typeof storedFileSchema>>
export type BacklogFileRecord = z.infer<typeof storedFileSchema>

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

export interface BacklogStore {
  revision(): number
  capture(input: {
    readonly text: string
    readonly project?: string | null | undefined
    readonly status?: BacklogStatus | undefined
    readonly kind?: BacklogKind | undefined
    readonly files?: readonly BacklogFileInput[] | undefined
    readonly actor: BacklogActor
  }): Promise<BacklogDetail>
  attachFile(input: { readonly id: number; readonly file: BacklogFileInput; readonly actor: BacklogActor }): Promise<BacklogResult<BacklogDetail>>
  readFile(input: { readonly id: number; readonly attachmentId: string }): Promise<BacklogResult<{ readonly dataUrl: string }>>
  removeFile(input: { readonly id: number; readonly attachmentId: string; readonly actor: BacklogActor }): Promise<BacklogResult<BacklogDetail>>
  update(input: BacklogUpdate & { readonly actor: BacklogActor }): Promise<BacklogResult<BacklogDetail>>
  link(input: {
    readonly id: number
    readonly link: BacklogLink
    readonly remove?: boolean | undefined
    readonly actor: BacklogActor
  }): Promise<BacklogResult<BacklogDetail>>
  comment(input: {
    readonly id: number
    readonly text: string
    readonly files?: readonly BacklogFileInput[] | undefined
    readonly actor: BacklogActor
  }): Promise<BacklogResult<BacklogDetail>>
  /** The item and every other item, for a triage pass to read. */
  triageInput(id: number): { readonly item: BacklogItem; readonly others: readonly BacklogItem[] } | undefined
  /** What one backfill run should triage, oldest first, and how many eligible items it leaves for a later run. */
  triageCandidates(scope: BackfillScope): BackfillSelection
  /** Records that triage looked at an item and found nothing to change, without making the item look recently active. */
  markTriaged(id: number): Promise<void>
  propose(input: { readonly id: number; readonly proposal: BacklogProposal }): Promise<BacklogResult<BacklogDetail>>
  /**
   * Applies a proposal. For `system` (automatic triage) fields the user set by hand are left alone; for a person or an
   * agent accepting it, every field applies. A duplicate is linked and commented, never closed.
   */
  applyProposal(input: {
    readonly id: number
    readonly proposal?: BacklogProposal | undefined
    readonly actor: BacklogActor
  }): Promise<BacklogResult<BacklogDetail>>
  /**
   * A lifecycle signal from outside the panel (a thread mentioning the item, a revision closing it): the link is always
   * recorded; the status moves only forward and never over a status the user set by hand.
   */
  applySignal(input: {
    readonly id: number
    readonly status: 'doing' | 'done'
    readonly link: BacklogLink
    readonly reason: string
  }): Promise<BacklogResult<BacklogDetail>>
  /**
   * A thread signal about one item: a thread that stopped flags its open items so they reach the Inbox, and a later
   * finished turn clears only that same flag. A status or attention you set by hand always wins.
   */
  applyThreadAttention(input: {
    readonly id: number
    readonly threadId: string
    readonly attention: 'blocked' | 'waiting' | 'none'
    readonly reason: string
  }): Promise<BacklogResult<BacklogDetail>>
  /** Marks an item's request as seen; it stays in the Inbox until its attention is cleared. Not an activity. */
  acknowledge(input: { readonly ids: readonly number[] }): Promise<void>
  dismissProposal(input: { readonly id: number; readonly actor: BacklogActor }): Promise<BacklogResult<BacklogDetail>>
  /** Per-project counts over every item, so project progress never depends on how many rows a list returned. */
  projects(): readonly {
    readonly project: string | null
    readonly counts: Readonly<Record<BacklogStatus, number>>
    readonly needsYou: number
    readonly actors: readonly string[]
    readonly lastActivityAt: number
  }[]
  list(query: BacklogListQuery): { readonly revision: number; readonly items: BacklogSummary[]; readonly total: number }
  get(id: number): BacklogResult<BacklogDetail>
  /** Several items in one call, in the order asked, with the ids that do not exist kept separate. */
  getMany(ids: readonly number[]): { readonly items: BacklogDetail[]; readonly missing: number[] }
  referencing(link: BacklogLink): BacklogSummary[]
  flush(): Promise<void>
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
}): Partial<BacklogItem> => {
  if (input.status !== 'done' && input.status !== 'dropped') return {}
  const attention = input.attention ?? input.item.attention ?? 'none'
  const clearAttention = attention !== 'none' && !input.item.humanFields.includes('attention')
  const clearProposal = input.item.proposal !== undefined && input.item.proposal !== null
  if (!clearAttention && !clearProposal) return {}
  const change: Partial<BacklogItem> = {}
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

const createBacklogStore = ({
  items,
  files,
  now = Date.now,
  dormantDays = () => BacklogItems.defaultDormantDays,
  onEvent = () => undefined,
  reportError = error => console.error('Backlog write failed', { error: error instanceof Error ? error.message.slice(0, 200) : String(error) }),
}: {
  readonly items: ItemTable
  readonly files: FileTable
  readonly now?: () => number
  /** Idle days per kind before an open item goes dormant; read on every query so a settings change applies at once. */
  readonly dormantDays?: () => Readonly<Record<BacklogKind, number>>
  /** Told about every event after it is stored, for reporting elsewhere (the Activity timeline). */
  readonly onEvent?: (item: BacklogItem, event: BacklogEvent) => void
  readonly reportError?: (error: unknown) => void
}): BacklogStore => {
  /** A project is where the work happens, so one recorded in a jj workspace reads as the checkout it was cut from. */
  const withProject = (item: BacklogItem): BacklogItem => {
    const project = BacklogItems.projectOf(item.project)
    return project === item.project ? item : { ...item, project }
  }
  const records = new Map<number, BacklogItem>([...items.entries()].map(([, item]) => [item.id, withProject(item)]))
  let nextId = Math.max(0, ...records.keys()) + 1
  let revision = now()
  let writes: Promise<void> = Promise.resolve()

  const persist = async (item: BacklogItem): Promise<void> => {
    records.set(item.id, item)
    revision = Math.max(revision + 1, now())
    const result = writes.then(() => items.put(String(item.id), item)).then(() => undefined)
    writes = result.catch(() => undefined)
    await result.catch(reportError)
  }

  const backlinksOf = (id: number): BacklogSummary[] => referencing({ type: 'item', target: String(id) })

  const detailOf = (item: BacklogItem): BacklogDetail => ({
    item: { ...item, freshness: BacklogItems.freshness(item, now(), dormantDays()) },
    backlinks: backlinksOf(item.id),
  })

  const referencing = (link: BacklogLink): BacklogSummary[] =>
    [...records.values()]
      .filter(item => item.links.some(candidate => BacklogItems.sameLink(candidate, link)))
      .sort(byActivity)
      .map(item => summarize(item, now(), null, dormantDays()))

  /** Applies a change and its event; touching an item is what keeps it fresh. */
  const touch = async (
    item: BacklogItem,
    actor: BacklogActor,
    event: Pick<BacklogEvent, 'kind' | 'detail' | 'threadId' | 'attachments'>,
    change: Partial<BacklogItem>,
  ): Promise<BacklogDetail> => {
    const at = now()
    const actorId = actorIdOf(actor)
    const next: BacklogItem = {
      ...item,
      ...change,
      actors: withActor(change.actors ?? item.actors, actorId, 'contributor'),
      lastActivityAt: at,
      events: BacklogItems.appendEvent(item.events, { at, actor: actorId, ...event }),
    }
    await persist(next)
    const stored = next.events.at(-1)
    if (stored !== undefined) onEvent(next, stored)
    return detailOf(next)
  }

  const find = (id: number): BacklogItem | undefined => records.get(id)

  const attachmentOf = (file: BacklogFileInput, at: number): BacklogAttachment => {
    const attachment: BacklogAttachment = {
      id: file.id,
      kind: file.kind,
      name: file.name,
      mediaType: file.mediaType,
      bytes: file.bytes,
      createdAt: at,
    }
    if (file.width !== undefined) attachment.width = file.width
    if (file.height !== undefined) attachment.height = file.height
    return attachment
  }

  /** An attachment kept on the item or inside one of its events, such as an image a comment carried. */
  const attachmentOfItem = (item: BacklogItem, attachmentId: string): BacklogAttachment | undefined =>
    item.attachments.find(attachment => attachment.id === attachmentId) ??
    item.events.flatMap(event => event.attachments ?? []).find(attachment => attachment.id === attachmentId)

  const storeFiles = async (itemId: number, input: readonly BacklogFileInput[], at: number): Promise<BacklogAttachment[]> => {
    const kept: BacklogAttachment[] = []
    for (const file of input.slice(0, BacklogItems.maxAttachments)) {
      const attachment = attachmentOf(file, at)
      await files.put(fileKey(itemId, attachment.id), { itemId, attachment, data: file.data })
      kept.push(attachment)
    }
    return kept
  }

  const list: BacklogStore['list'] = query => {
    const at = now()
    const freshnessFilter = query.freshness ?? 'active'
    // A caller may still ask for the workspace an item was captured in; the item is filed under its project.
    const project = query.project === undefined ? undefined : BacklogItems.projectOf(query.project)
    const projects = query.projects?.map(candidate => (candidate === null ? null : BacklogItems.projectOf(candidate)))
    const matching = [...records.values()]
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
        const state = BacklogItems.freshness(item, at, dormantDays())
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
    return { revision, total: scored.length, items: scored.slice(0, limit).map(entry => summarize(entry.item, at, entry.match, dormantDays())) }
  }

  return {
    revision: () => revision,
    capture: async ({ text, project, status, kind, files: pendingFiles = [], actor }) => {
      const at = now()
      const triaged = BacklogItems.triage(text)
      const actorId = actorIdOf(actor)
      const attachments = await storeFiles(nextId, pendingFiles, at)
      const chosenKind = kind ?? triaged.kind
      const chosenStatus = status ?? 'inbox'
      const chosenProject = BacklogItems.projectOf(project ?? (actor.kind === 'agent' ? (actor.cwd ?? null) : null))
      const createdEvent: BacklogEvent = { at, actor: actorId, kind: 'created', detail: text.slice(0, BacklogItems.maxBodyChars) }
      if (actor.kind === 'agent' && actor.sessionId !== undefined && actor.sessionId !== '') createdEvent.threadId = actor.sessionId
      const item: BacklogItem = {
        id: nextId,
        title: triaged.title,
        body: triaged.body,
        kind: chosenKind,
        status: chosenStatus,
        project: chosenProject,
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
      nextId += 1
      await persist(item)
      const created = item.events[0]
      if (created !== undefined) onEvent(item, created)
      return detailOf(item)
    },
    attachFile: async ({ id, file, actor }) => {
      const item = find(id)
      if (item === undefined) return { ok: false, reason: 'not-found' }
      if (item.attachments.length >= BacklogItems.maxAttachments) return { ok: true, value: detailOf(item) }
      const at = now()
      const attachment = attachmentOf(file, at)
      await files.put(fileKey(id, attachment.id), { itemId: id, attachment, data: file.data })
      return {
        ok: true,
        value: await touch(item, actor, { kind: 'edited', detail: `attached ${attachment.name}` }, { attachments: [...item.attachments, attachment] }),
      }
    },
    readFile: async ({ id, attachmentId }) => {
      const item = find(id)
      if (item === undefined || attachmentOfItem(item, attachmentId) === undefined) return { ok: false, reason: 'not-found' }
      const stored = files.get(fileKey(id, attachmentId))
      if (stored === undefined) return { ok: false, reason: 'not-found' }
      return { ok: true, value: { dataUrl: `data:${stored.attachment.mediaType};base64,${stored.data}` } }
    },
    removeFile: async ({ id, attachmentId, actor }) => {
      const item = find(id)
      if (item === undefined) return { ok: false, reason: 'not-found' }
      const attachment = item.attachments.find(candidate => candidate.id === attachmentId)
      if (attachment === undefined) return { ok: true, value: detailOf(item) }
      await files.delete(fileKey(id, attachmentId))
      return {
        ok: true,
        value: await touch(
          item,
          actor,
          { kind: 'edited', detail: `removed ${attachment.name}` },
          { attachments: item.attachments.filter(candidate => candidate.id !== attachmentId) },
        ),
      }
    },
    update: async ({ id, actor, ...fields }) => {
      const item = find(id)
      if (item === undefined) return { ok: false, reason: 'not-found' }
      const change: Partial<BacklogItem> = {}
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
        // A body edit re-reads its references, keeping links the user added by hand.
        change.links = BacklogItems.uniqueLinks([...item.links, ...BacklogItems.extractLinks(fields.body)])
        recordChange('body')
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
        else if (change.attention !== closedChange.attention) userChanged.delete('attention')
      }
      Object.assign(change, closedChange)
      const clearedSuggestion = change.proposal === null
      if (changed.length === 0 && change.snoozedUntil === undefined && !clearedSuggestion) return { ok: true, value: detailOf(item) }
      if (changed.length === 0) {
        const details = [
          ...(change.snoozedUntil === undefined ? [] : [change.snoozedUntil === null ? 'woke it' : 'snoozed it']),
          ...(clearedSuggestion ? ['cleared closed-item suggestion'] : []),
        ]
        return { ok: true, value: await touch(item, actor, { kind: 'edited', detail: details.join('; ') }, change) }
      }
      if (actor.kind === 'user') change.humanFields = [...new Set([...item.humanFields, ...userChanged])]
      const detail =
        change.status === undefined
          ? `${changed.join(', ')}`
          : `${item.status} → ${change.status}${changed.length > 1 ? `; ${changed.filter(field => field !== 'status').join(', ')}` : ''}`
      return { ok: true, value: await touch(item, actor, { kind: change.status === undefined ? 'edited' : 'moved', detail }, change) }
    },
    link: async ({ id, link, remove, actor }) => {
      const item = find(id)
      if (item === undefined) return { ok: false, reason: 'not-found' }
      const present = item.links.some(candidate => BacklogItems.sameLink(candidate, link))
      if (remove === true ? !present : present) return { ok: true, value: detailOf(item) }
      const stamped = { ...link, provenance: link.provenance ?? (actor.kind === 'agent' ? 'agent' : actor.kind === 'user' ? 'user' : 'inferred') }
      const links =
        remove === true ? item.links.filter(candidate => !BacklogItems.sameLink(candidate, link)) : BacklogItems.uniqueLinks([...item.links, stamped])
      const label = `${link.relation === undefined || link.relation === 'related' ? '' : `${link.relation} `}${link.type}:${link.target}`
      const sourceThread = link.type === 'thread' ? { threadId: link.target } : {}
      return { ok: true, value: await touch(item, actor, { kind: remove === true ? 'unlinked' : 'linked', detail: label, ...sourceThread }, { links }) }
    },
    comment: async ({ id, text, files: commentFiles = [], actor }) => {
      const item = find(id)
      if (item === undefined) return { ok: false, reason: 'not-found' }
      const at = now()
      const attachments = commentFiles.length === 0 ? [] : await storeFiles(id, commentFiles, at)
      const links = BacklogItems.uniqueLinks([...item.links, ...BacklogItems.extractLinks(text), ...callerLinks(actor)])
      const sourceThread = actor.kind === 'agent' && actor.sessionId !== undefined && actor.sessionId !== '' ? { threadId: actor.sessionId } : {}
      const event = { kind: 'commented' as const, detail: text.slice(0, BacklogItems.maxBodyChars), ...sourceThread }
      if (attachments.length > 0) return { ok: true, value: await touch(item, actor, { ...event, attachments }, { links }) }
      return { ok: true, value: await touch(item, actor, event, { links }) }
    },
    triageInput: id => {
      const item = find(id)
      return item === undefined ? undefined : { item, others: [...records.values()] }
    },
    triageCandidates: scope => BacklogBackfill.select([...records.values()], scope),
    markTriaged: async id => {
      const item = find(id)
      if (item === undefined) return
      await persist({
        ...item,
        events: BacklogItems.appendEvent(item.events, { at: now(), actor: 'system', kind: 'triaged', detail: BacklogItems.triageNoChange }),
      })
    },
    propose: async ({ id, proposal }) => {
      const item = find(id)
      if (item === undefined) return { ok: false, reason: 'not-found' }
      return {
        ok: true,
        value: await touch(item, { kind: 'system' }, { kind: 'triaged', detail: `suggested ${BacklogTriage.describe(proposal)}` }, { proposal }),
      }
    },
    applyProposal: async ({ id, proposal, actor }) => {
      const item = find(id)
      const chosen = proposal ?? item?.proposal ?? undefined
      if (item === undefined) return { ok: false, reason: 'not-found' }
      if (chosen === undefined) return { ok: true, value: detailOf(item) }
      const locked = actor.kind === 'system' ? new Set(item.humanFields) : new Set<BacklogHumanField>()
      const change: Partial<BacklogItem> = { proposal: null }
      const applied: Pick<BacklogProposal, 'kind' | 'status' | 'title' | 'tags' | 'duplicateOf'> = {}
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
      if (chosen.duplicateOf !== undefined && records.has(chosen.duplicateOf)) {
        change.links = BacklogItems.uniqueLinks([...item.links, { type: 'item', target: String(chosen.duplicateOf) }])
        applied.duplicateOf = chosen.duplicateOf
      }
      Object.assign(change, closedStateChange({ item, status: change.status ?? item.status }))
      // Accepting is a person or an agent choosing those values, so they become theirs.
      if (actor.kind !== 'system') {
        const owned = (['kind', 'status', 'title', 'tags'] as const).filter(field => applied[field] !== undefined)
        change.humanFields = [...new Set([...item.humanFields, ...owned])]
      }
      return { ok: true, value: await touch(item, actor, { kind: 'triaged', detail: `applied ${BacklogTriage.describe(applied) || 'nothing'}` }, change) }
    },
    applySignal: async ({ id, status, link, reason }) => {
      const item = find(id)
      if (item === undefined) return { ok: false, reason: 'not-found' }
      const linked = item.links.some(candidate => BacklogItems.sameLink(candidate, link))
      const order = ['inbox', 'todo', 'doing', 'done']
      const forward = item.status !== 'dropped' && order.indexOf(status) > order.indexOf(item.status)
      const moves = forward && !item.humanFields.includes('status')
      const closedChange = closedStateChange({ item, status: moves ? status : item.status })
      const hasClosedChange = closedChange.attention !== undefined || closedChange.proposal !== undefined
      if (linked && !moves) {
        if (!hasClosedChange) return { ok: true, value: detailOf(item) }
        const cleared: string[] = []
        if (closedChange.attention !== undefined) cleared.push('attention')
        if (closedChange.proposal !== undefined) cleared.push('suggestion')
        return {
          ok: true,
          value: await touch(item, { kind: 'system' }, { kind: 'edited', detail: `closed item: cleared ${cleared.join(' and ')}` }, closedChange),
        }
      }
      const change: Partial<BacklogItem> = { links: BacklogItems.uniqueLinks([...item.links, link]), ...closedChange }
      if (moves) change.status = status
      const detail = moves ? `${item.status} → ${status} (${reason})` : `${link.type}:${link.target} (${reason})`
      const sourceThread = link.type === 'thread' ? { threadId: link.target } : {}
      return { ok: true, value: await touch(item, { kind: 'system' }, { kind: moves ? 'moved' : 'linked', detail, ...sourceThread }, change) }
    },
    applyThreadAttention: async ({ id, threadId, attention, reason }) => {
      const item = find(id)
      if (item === undefined) return { ok: false, reason: 'not-found' }
      if (item.humanFields.includes('attention')) return { ok: true, value: detailOf(item) }
      if (attention === 'waiting') {
        if (item.status !== 'doing' || (item.attention ?? 'none') !== 'none') return { ok: true, value: detailOf(item) }
        const alreadyWaiting = item.events.some(
          event => event.kind === 'commented' && event.threadId === threadId && event.detail.startsWith('Thread idle nudge:'),
        )
        if (alreadyWaiting) return { ok: true, value: detailOf(item) }
        return {
          ok: true,
          value: await touch(item, { kind: 'system' }, { kind: 'commented', detail: reason, threadId }, { attention: 'waiting', acknowledgedAt: null }),
        }
      }
      if (attention === 'blocked') {
        if ((item.attention ?? 'none') !== 'none' || item.status === 'done' || item.status === 'dropped') return { ok: true, value: detailOf(item) }
        return {
          ok: true,
          value: await touch(
            item,
            { kind: 'system' },
            { kind: 'edited', detail: `attention: blocked (${reason})`, threadId },
            { attention: 'blocked', acknowledgedAt: null },
          ),
        }
      }
      const last = item.events.at(-1)
      const stalledHere = last?.actor === 'system' && last.kind === 'edited' && last.detail.startsWith('attention: blocked (')
      const waitingSignal = item.events.findLast(
        event => event.actor === 'system' && event.kind === 'commented' && event.detail.startsWith('Thread idle nudge:'),
      )
      const waitingHere = waitingSignal?.threadId === threadId
      if ((item.attention ?? 'none') === 'blocked' && stalledHere === true) {
        return {
          ok: true,
          value: await touch(item, { kind: 'system' }, { kind: 'edited', detail: `attention: none (${reason})`, threadId }, { attention: 'none' }),
        }
      }
      if ((item.attention ?? 'none') !== 'waiting' || waitingHere !== true) return { ok: true, value: detailOf(item) }
      return {
        ok: true,
        value: await touch(item, { kind: 'system' }, { kind: 'edited', detail: `attention: none (${reason})`, threadId }, { attention: 'none' }),
      }
    },
    acknowledge: async ({ ids }) => {
      for (const id of ids) {
        const item = find(id)
        if (item !== undefined) await persist({ ...item, acknowledgedAt: now() })
      }
    },
    dismissProposal: async ({ id, actor }) => {
      const item = find(id)
      if (item === undefined) return { ok: false, reason: 'not-found' }
      if (item.proposal === undefined || item.proposal === null) return { ok: true, value: detailOf(item) }
      return {
        ok: true,
        value: await touch(item, actor, { kind: 'triaged', detail: `dismissed ${BacklogTriage.describe(item.proposal)}` }, { proposal: null }),
      }
    },
    projects: () => {
      const byProject = new Map<string | null, BacklogItem[]>()
      for (const item of records.values()) byProject.set(item.project, [...(byProject.get(item.project) ?? []), item])
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
    },
    list,
    get: id => {
      const item = find(id)
      return item === undefined ? { ok: false, reason: 'not-found' } : { ok: true, value: detailOf(item) }
    },
    getMany: ids => {
      const items: BacklogDetail[] = []
      const missing: number[] = []
      for (const id of new Set(ids)) {
        const item = find(id)
        if (item === undefined) missing.push(id)
        else items.push(detailOf(item))
      }
      return { items, missing }
    },
    referencing,
    flush: () => writes,
  }
}

export class BacklogModel {
  static readonly createStore = createBacklogStore
}
