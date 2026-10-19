import { defineDomain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { BacklogDetailView, BacklogSummaryView } from './api.js'
import {
  BacklogItems,
  type BacklogEvent,
  type BacklogFreshness,
  type BacklogHumanField,
  type BacklogItem,
  type BacklogKind,
  type BacklogLink,
  type BacklogProposal,
  type BacklogStatus,
} from './item.js'
import { BacklogTriage } from './triage.js'

export const backlogDomain = defineDomain({
  name: 'backlog',
  version: 1,
  tables: {
    items: { valueSchema: BacklogItems.itemSchema, __key: 'items' },
  },
})

type ItemTable = KvTable<string, BacklogItem>

export type BacklogActor =
  | { readonly kind: 'user' }
  | { readonly kind: 'system' }
  | { readonly kind: 'agent'; readonly sessionId?: string | undefined; readonly cwd?: string | undefined }

export interface BacklogListQuery {
  readonly query?: string | undefined
  readonly statuses?: readonly BacklogStatus[] | undefined
  readonly kinds?: readonly BacklogKind[] | undefined
  readonly project?: string | undefined
  readonly tag?: string | undefined
  readonly actor?: string | undefined
  /** `active` (fresh + stale, the feed), `all`, or one freshness state. */
  readonly freshness?: 'active' | 'all' | BacklogFreshness | undefined
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
}

export type BacklogResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: 'not-found' }

export interface BacklogStore {
  revision(): number
  capture(input: {
    readonly text: string
    readonly project?: string | null | undefined
    readonly status?: BacklogStatus | undefined
    readonly actor: BacklogActor
  }): Promise<BacklogDetail>
  update(input: BacklogUpdate & { readonly actor: BacklogActor }): Promise<BacklogResult<BacklogDetail>>
  link(input: {
    readonly id: number
    readonly link: BacklogLink
    readonly remove?: boolean | undefined
    readonly actor: BacklogActor
  }): Promise<BacklogResult<BacklogDetail>>
  comment(input: { readonly id: number; readonly text: string; readonly actor: BacklogActor }): Promise<BacklogResult<BacklogDetail>>
  /** The item and every other item, for a triage pass to read. */
  triageInput(id: number): { readonly item: BacklogItem; readonly others: readonly BacklogItem[] } | undefined
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
  dismissProposal(input: { readonly id: number; readonly actor: BacklogActor }): Promise<BacklogResult<BacklogDetail>>
  list(query: BacklogListQuery): { readonly revision: number; readonly items: BacklogSummary[]; readonly total: number }
  get(id: number): BacklogResult<BacklogDetail>
  referencing(link: BacklogLink): BacklogSummary[]
  flush(): Promise<void>
}

const DEFAULT_LIST_LIMIT = 100
const MAX_LIST_LIMIT = 500

const actorIdOf = (actor: BacklogActor): string => {
  if (actor.kind !== 'agent') return actor.kind
  return actor.sessionId === undefined || actor.sessionId === '' ? 'agent:unknown' : `agent:${actor.sessionId}`
}

const callerLinks = (actor: BacklogActor): BacklogLink[] =>
  actor.kind === 'agent' && actor.sessionId !== undefined && actor.sessionId !== '' ? [{ type: 'thread', target: actor.sessionId }] : []

const withActor = (actors: BacklogItem['actors'], id: string, role: 'owner' | 'contributor'): BacklogItem['actors'] =>
  actors.some(actor => actor.id === id) ? actors : [...actors, { id, role }]

const summarize = (item: BacklogItem, now: number): BacklogSummary => ({
  id: item.id,
  title: item.title,
  kind: item.kind,
  status: item.status,
  project: item.project,
  tags: item.tags,
  links: item.links,
  actors: item.actors,
  pinned: item.pinned,
  freshness: BacklogItems.freshness(item, now),
  createdAt: item.createdAt,
  lastActivityAt: item.lastActivityAt,
  preview: item.body.slice(0, 280),
  proposal: item.proposal ?? null,
})

/** Pinned first, then newest activity: the Discord order, where idle things sink on their own. */
const byActivity = (left: BacklogItem, right: BacklogItem): number =>
  Number(right.pinned) - Number(left.pinned) || right.lastActivityAt - left.lastActivityAt || right.id - left.id

const createBacklogStore = ({
  items,
  now = Date.now,
  reportError = error => console.error('Backlog write failed', { error: error instanceof Error ? error.message.slice(0, 200) : String(error) }),
}: {
  readonly items: ItemTable
  readonly now?: () => number
  readonly reportError?: (error: unknown) => void
}): BacklogStore => {
  const records = new Map<number, BacklogItem>([...items.entries()].map(([, item]) => [item.id, item]))
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
    item: { ...item, freshness: BacklogItems.freshness(item, now()) },
    backlinks: backlinksOf(item.id),
  })

  const referencing = (link: BacklogLink): BacklogSummary[] =>
    [...records.values()]
      .filter(item => item.links.some(candidate => BacklogItems.sameLink(candidate, link)))
      .sort(byActivity)
      .map(item => summarize(item, now()))

  /** Applies a change and its event; touching an item is what keeps it fresh. */
  const touch = async (
    item: BacklogItem,
    actor: BacklogActor,
    event: Pick<BacklogEvent, 'kind' | 'detail'>,
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
    return detailOf(next)
  }

  const find = (id: number): BacklogItem | undefined => records.get(id)

  const list: BacklogStore['list'] = query => {
    const at = now()
    const freshnessFilter = query.freshness ?? 'active'
    const matching = [...records.values()]
      .filter(item => query.statuses === undefined || query.statuses.length === 0 || query.statuses.includes(item.status))
      .filter(item => query.kinds === undefined || query.kinds.length === 0 || query.kinds.includes(item.kind))
      .filter(item => query.project === undefined || item.project === query.project)
      .filter(item => query.tag === undefined || item.tags.includes(query.tag.toLowerCase().replace(/^#/, '')))
      .filter(item => query.actor === undefined || item.actors.some(actor => actor.id === query.actor))
      .filter(item => {
        if (freshnessFilter === 'all') return true
        const state = BacklogItems.freshness(item, at)
        return freshnessFilter === 'active' ? state === 'fresh' || state === 'stale' : state === freshnessFilter
      })
      .filter(item => BacklogItems.matches(item, query.query ?? ''))
      .sort(byActivity)
    const limit = Math.min(query.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
    return { revision, total: matching.length, items: matching.slice(0, limit).map(item => summarize(item, at)) }
  }

  return {
    revision: () => revision,
    capture: async ({ text, project, status, actor }) => {
      const at = now()
      const triaged = BacklogItems.triage(text)
      const actorId = actorIdOf(actor)
      const item: BacklogItem = {
        id: nextId,
        title: triaged.title,
        body: triaged.body,
        kind: triaged.kind,
        status: status ?? 'inbox',
        project: project ?? (actor.kind === 'agent' ? (actor.cwd ?? null) : null),
        tags: triaged.tags,
        links: BacklogItems.uniqueLinks([...triaged.links, ...callerLinks(actor)]),
        actors: [{ id: actorId, role: 'owner' }],
        pinned: false,
        humanFields: [],
        createdAt: at,
        lastActivityAt: at,
        events: [{ at, actor: actorId, kind: 'created', detail: text.slice(0, BacklogItems.maxBodyChars) }],
      }
      nextId += 1
      await persist(item)
      return detailOf(item)
    },
    update: async ({ id, actor, ...fields }) => {
      const item = find(id)
      if (item === undefined) return { ok: false, reason: 'not-found' }
      const change: Partial<BacklogItem> = {}
      const changed: BacklogHumanField[] = []
      if (fields.title !== undefined && fields.title.trim() !== '' && fields.title !== item.title) {
        change.title = fields.title.trim().slice(0, BacklogItems.maxTitleChars)
        changed.push('title')
      }
      if (fields.body !== undefined && fields.body !== item.body) {
        change.body = fields.body.slice(0, BacklogItems.maxBodyChars)
        // A body edit re-reads its references, keeping links the user added by hand.
        change.links = BacklogItems.uniqueLinks([...item.links, ...BacklogItems.extractLinks(fields.body)])
        changed.push('body')
      }
      if (fields.kind !== undefined && fields.kind !== item.kind) {
        change.kind = fields.kind
        changed.push('kind')
      }
      if (fields.status !== undefined && fields.status !== item.status) {
        change.status = fields.status
        changed.push('status')
      }
      if (fields.project !== undefined && fields.project !== item.project) {
        change.project = fields.project
        changed.push('project')
      }
      if (fields.tags !== undefined) {
        const tags = [...new Set(fields.tags.map(tag => tag.toLowerCase().replace(/^#/, '')).filter(Boolean))]
        if (tags.join('\n') !== item.tags.join('\n')) {
          change.tags = tags
          changed.push('tags')
        }
      }
      if (fields.pinned !== undefined && fields.pinned !== item.pinned) {
        change.pinned = fields.pinned
        changed.push('pinned')
      }
      if (changed.length === 0) return { ok: true, value: detailOf(item) }
      if (actor.kind === 'user') change.humanFields = [...new Set([...item.humanFields, ...changed])]
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
      const links = remove === true ? item.links.filter(candidate => !BacklogItems.sameLink(candidate, link)) : BacklogItems.uniqueLinks([...item.links, link])
      return { ok: true, value: await touch(item, actor, { kind: remove === true ? 'unlinked' : 'linked', detail: `${link.type}:${link.target}` }, { links }) }
    },
    comment: async ({ id, text, actor }) => {
      const item = find(id)
      if (item === undefined) return { ok: false, reason: 'not-found' }
      const links = BacklogItems.uniqueLinks([...item.links, ...BacklogItems.extractLinks(text), ...callerLinks(actor)])
      return { ok: true, value: await touch(item, actor, { kind: 'commented', detail: text.slice(0, BacklogItems.maxBodyChars) }, { links }) }
    },
    triageInput: id => {
      const item = find(id)
      return item === undefined ? undefined : { item, others: [...records.values()] }
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
      // Accepting is a person or an agent choosing those values, so they become theirs.
      if (actor.kind !== 'system') {
        const owned = (['kind', 'status', 'title', 'tags'] as const).filter(field => applied[field] !== undefined)
        change.humanFields = [...new Set([...item.humanFields, ...owned])]
      }
      return { ok: true, value: await touch(item, actor, { kind: 'triaged', detail: `applied ${BacklogTriage.describe(applied) || 'nothing'}` }, change) }
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
    list,
    get: id => {
      const item = find(id)
      return item === undefined ? { ok: false, reason: 'not-found' } : { ok: true, value: detailOf(item) }
    },
    referencing,
    flush: () => writes,
  }
}

export class BacklogModel {
  static readonly createStore = createBacklogStore
}
