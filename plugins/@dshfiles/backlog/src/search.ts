import { BacklogItems, type BacklogItem, type BacklogLink, type BacklogPriority } from './item.js'
import { BacklogReference } from './backlog-reference.js'
import { DueDates } from './due-date.js'

const DAY_MS = 86_400_000
const SNIPPET_RADIUS = 60

type MatchField = 'id' | 'title' | 'tag' | 'body' | 'comment' | 'link' | 'project' | 'capture'

/** Where a text term was found and how much that counts: a title hit outranks one buried in a comment. */
const fieldWeights = { id: 12, title: 8, tag: 6, project: 3, link: 3, body: 2, capture: 1.5, comment: 1 } satisfies Record<MatchField, number>

type ActorKind = 'user' | 'agent' | 'system'
type SearchState =
  | 'ready'
  | 'blocked-by-deps'
  | 'delegated'
  | 'claimed'
  | 'children'
  | 'parent'
  | 'criteria'
  | 'plan'
  | 'summary'
  | 'plan-pending'
  | 'overdue'
  | 'due'
  | 'gated'
  | 'gates'

/** What an operator needs from the other items: readiness, blockers, sub-issues and claims are not on the item itself. */
export interface SearchContext {
  readonly isReady: (item: BacklogItem) => boolean
  readonly isBlockedByDeps: (item: BacklogItem) => boolean
  readonly hasChildren: (item: BacklogItem) => boolean
  readonly isClaimed: (item: BacklogItem) => boolean
  /** An open gate (a PR not merged, a revision not on main, a check not passed, a date not reached) holds it back. */
  readonly isGated: (item: BacklogItem) => boolean
  /** The calendar date the search reads at, for due-date operators. */
  readonly today: string
}

const noContext: SearchContext = {
  isReady: () => false,
  isBlockedByDeps: () => false,
  hasChildren: () => false,
  isClaimed: () => false,
  isGated: () => false,
  today: '',
}

/** The operator part of a query: every list narrows on its own, and a negated copy excludes what it matches. */
interface SearchFilters {
  readonly terms: readonly string[]
  readonly kinds: readonly string[]
  readonly statuses: readonly string[]
  readonly attentions: readonly string[]
  readonly tags: readonly string[]
  readonly projects: readonly string[]
  /** Anyone who touched the item (`by:`). */
  readonly actors: readonly ActorKind[]
  /** Who captured it (`created:`). */
  readonly creators: readonly ActorKind[]
  readonly has: readonly BacklogLink['type'][]
  readonly priorities: readonly BacklogPriority[]
  /** Refs of the parents an item must sit under (`parent:b:k3f9`). */
  readonly parents: readonly string[]
  /** Derived states: `is:ready`, `is:blocked-by-deps`, `is:delegated`, `is:claimed`, `has:children`, `has:parent`. */
  readonly states: readonly SearchState[]
  /** Who an item is handed to (`delegate:agent`). */
  readonly delegates: readonly ActorKind[]
  readonly updatedWithinDays: number | null
  readonly olderThanDays: number | null
  /** `due:<7d`: due within that many days from today, overdue included. */
  readonly dueWithinDays: number | null
  /** `due:>30d`: due later than that many days from today. */
  readonly dueAfterDays: number | null
}

export interface SearchQuery extends SearchFilters {
  /** `-` operators and words: an item matching any one of them is left out. */
  readonly excluded: SearchFilters
}

type MutableFilters = { -readonly [K in keyof SearchFilters]: SearchFilters[K] extends readonly (infer Entry)[] ? Entry[] : SearchFilters[K] }

export interface SearchMatch {
  readonly score: number
  readonly fields: readonly MatchField[]
  readonly snippet: string | null
}

const kindWords = new Set(['task', 'bug', 'idea', 'note', 'question'])
const statusWords = new Set(['inbox', 'todo', 'doing', 'done', 'dropped'])
const attentionWords = new Map([
  ['needs-input', 'needs-input'],
  ['needs-you', 'needs-input'],
  ['blocked', 'blocked'],
  ['waiting', 'waiting'],
])
const hasWords = new Map<string, BacklogLink['type']>([
  ['thread', 'thread'],
  ['revision', 'revision'],
  ['rev', 'revision'],
  ['branch', 'branch'],
  ['workspace', 'workspace'],
  ['url', 'url'],
  ['link', 'url'],
  ['item', 'item'],
])
const stateWords = new Map<string, SearchState>([
  ['ready', 'ready'],
  ['blocked-by-deps', 'blocked-by-deps'],
  ['delegated', 'delegated'],
  ['claimed', 'claimed'],
  ['plan-pending', 'plan-pending'],
  ['overdue', 'overdue'],
  ['gated', 'gated'],
])
/** `has:` words about the item's own sections rather than its links. */
const sectionWords = new Map<string, SearchState>([
  ['children', 'children'],
  ['parent', 'parent'],
  ['criteria', 'criteria'],
  ['plan', 'plan'],
  ['summary', 'summary'],
  ['due', 'due'],
  ['gate', 'gates'],
  ['gates', 'gates'],
])
const actorWords = new Map<string, ActorKind>([
  ['me', 'user'],
  ['user', 'user'],
  ['agent', 'agent'],
  ['system', 'system'],
])

const emptyFilters = (): MutableFilters => ({
  terms: [],
  kinds: [],
  statuses: [],
  attentions: [],
  tags: [],
  projects: [],
  actors: [],
  creators: [],
  has: [],
  priorities: [],
  parents: [],
  states: [],
  delegates: [],
  updatedWithinDays: null,
  olderThanDays: null,
  dueWithinDays: null,
  dueAfterDays: null,
})

const addToken = (filters: MutableFilters, token: string): void => {
  const [key, ...rest] = token.split(':')
  const value = rest.join(':')
  const actor = actorWords.get(value)
  const priority = BacklogItems.priorities.find(candidate => candidate === value)
  if (token.startsWith('#') && token.length > 1) filters.tags.push(token.slice(1))
  else if (key === 'kind' && kindWords.has(value)) filters.kinds.push(value)
  else if (key === 'status' && statusWords.has(value)) filters.statuses.push(value)
  else if (key === 'is' && kindWords.has(value)) filters.kinds.push(value)
  else if (key === 'is' && statusWords.has(value)) filters.statuses.push(value)
  else if (key === 'is' && attentionWords.has(value)) filters.attentions.push(attentionWords.get(value) ?? value)
  else if (key === 'project' && value !== '') filters.projects.push(value)
  else if (key === 'by' && actor !== undefined) filters.actors.push(actor)
  else if (key === 'created' && actor !== undefined) filters.creators.push(actor)
  else if (key === 'has' && sectionWords.has(value)) filters.states.push(sectionWords.get(value) ?? 'children')
  else if (key === 'has' && hasWords.has(value)) filters.has.push(hasWords.get(value) ?? 'url')
  else if (key === 'is' && stateWords.has(value)) filters.states.push(stateWords.get(value) ?? 'ready')
  else if (key === 'priority' && priority !== undefined) filters.priorities.push(priority)
  else if (key === 'parent' && BacklogReference.parse(value) !== undefined) filters.parents.push(BacklogReference.parse(value) ?? '')
  else if (key === 'delegate' && actor !== undefined) filters.delegates.push(actor)
  else if (key === 'due' && /^[<>]\d+d$/.test(value)) {
    const days = Number(value.slice(1, -1))
    if (value.startsWith('<')) filters.dueWithinDays = days
    else filters.dueAfterDays = days
  } else if (key === 'updated' && /^[<>]\d+d$/.test(value)) {
    const days = Number(value.slice(1, -1))
    if (value.startsWith('<')) filters.updatedWithinDays = days
    else filters.olderThanDays = days
  } else filters.terms.push(token)
}

/**
 * Free text plus operators, all optional and combinable: `kind:bug`, `status:doing`, `is:blocked` (kind, status or
 * attention), `#tag`, `project:welii`, `by:agent` (touched by), `created:me` (captured by), `has:thread`,
 * `updated:<7d`, `updated:>30d`, `priority:high`, `parent:b:k3f9`, `has:children`, `is:ready`, `is:blocked-by-deps`,
 * `is:delegated`, `is:claimed`, `delegate:agent`, `has:criteria`, `has:plan`, `has:summary`, `is:plan-pending`, `has:due`, `is:overdue`, `due:<7d`, `due:>30d`, `has:gate`, `is:gated`. Quoted text is one term. A leading `-` negates any of them, words included.
 */
const parse = (raw: string): SearchQuery => {
  const included = emptyFilters()
  const excluded = emptyFilters()
  for (const match of raw.toLowerCase().matchAll(/(-?)"([^"]+)"|(\S+)/g)) {
    if (match[2] !== undefined) {
      ;(match[1] === '-' ? excluded : included).terms.push(match[2])
      continue
    }
    const token = match[3] ?? ''
    if (token.startsWith('-') && token.length > 1) addToken(excluded, token.slice(1))
    else addToken(included, token)
  }
  return { ...included, excluded }
}

const snippetAround = (text: string, term: string): string => {
  const index = text.toLowerCase().indexOf(term)
  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = Math.min(text.length, index + term.length + SNIPPET_RADIUS)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`
}

const isActor = (actorId: string, kind: ActorKind): boolean => (kind === 'agent' ? actorId.startsWith('agent:') : actorId === kind)

const tagMatches = (item: BacklogItem, tag: string): boolean => item.tags.some(own => own.startsWith(tag))
const projectMatches = (item: BacklogItem, project: string): boolean => (item.project ?? '').toLowerCase().includes(project)
const touchedBy = (item: BacklogItem, kind: ActorKind): boolean => item.actors.some(actor => isActor(actor.id, kind))
const createdBy = (item: BacklogItem, kind: ActorKind): boolean => {
  const creator = BacklogItems.creatorOf(item)
  return creator !== undefined && isActor(creator, kind)
}
const hasLink = (item: BacklogItem, type: BacklogLink['type']): boolean => item.links.some(link => link.type === type)
const priorityIs = (item: BacklogItem, priority: BacklogPriority): boolean => (item.priority ?? 'none') === priority
const delegatedTo = (item: BacklogItem, kind: ActorKind): boolean => item.delegate !== undefined && isActor(item.delegate, kind)
const inState = (item: BacklogItem, state: SearchState, context: SearchContext): boolean => {
  switch (state) {
    case 'ready':
      return context.isReady(item)
    case 'blocked-by-deps':
      return context.isBlockedByDeps(item)
    case 'delegated':
      return item.delegate !== undefined
    case 'claimed':
      return context.isClaimed(item)
    case 'children':
      return context.hasChildren(item)
    case 'parent':
      return item.parent !== undefined
    case 'criteria':
      return (item.criteria?.length ?? 0) > 0
    case 'plan':
      return item.plan !== undefined
    case 'summary':
      return item.summary !== undefined
    case 'plan-pending':
      return item.planApproval === 'pending'
    case 'due':
      return item.due !== undefined
    case 'overdue':
      return DueDates.isOverdue({ due: item.due, status: item.status, today: context.today })
    case 'gates':
      return (item.gates?.length ?? 0) > 0
    case 'gated':
      return context.isGated(item)
  }
}
const updatedWithin = (item: BacklogItem, days: number, now: number): boolean => now - item.lastActivityAt <= days * DAY_MS
const idleFor = (item: BacklogItem, days: number, now: number): boolean => now - item.lastActivityAt >= days * DAY_MS
const dueWithin = (item: BacklogItem, days: number, today: string): boolean =>
  item.due !== undefined && today !== '' && DueDates.daysBetween(today, item.due) <= days
const dueAfter = (item: BacklogItem, days: number, today: string): boolean =>
  item.due !== undefined && today !== '' && DueDates.daysBetween(today, item.due) > days
const termHits = (item: BacklogItem, term: string): boolean =>
  sourcesOf(item).some(([field, texts]) => (field === 'id' ? texts.includes(term) : texts.some(text => text.toLowerCase().includes(term))))

/** Whether the item passes every operator; free-text terms are scored separately. */
const passesFilters = (item: BacklogItem, query: SearchQuery, now: number, context: SearchContext): boolean => {
  if (query.kinds.length > 0 && !query.kinds.includes(item.kind)) return false
  if (query.statuses.length > 0 && !query.statuses.includes(item.status)) return false
  if (query.attentions.length > 0 && !query.attentions.includes(item.attention ?? 'none')) return false
  if (query.tags.some(tag => !tagMatches(item, tag))) return false
  if (query.projects.some(project => !projectMatches(item, project))) return false
  if (query.actors.some(kind => !touchedBy(item, kind))) return false
  if (query.creators.length > 0 && !query.creators.some(kind => createdBy(item, kind))) return false
  if (query.has.some(type => !hasLink(item, type))) return false
  if (query.priorities.length > 0 && !query.priorities.some(priority => priorityIs(item, priority))) return false
  if (query.parents.length > 0 && !query.parents.includes(item.parent ?? '')) return false
  if (query.states.some(state => !inState(item, state, context))) return false
  if (query.delegates.some(kind => !delegatedTo(item, kind))) return false
  if (query.updatedWithinDays !== null && !updatedWithin(item, query.updatedWithinDays, now)) return false
  if (query.olderThanDays !== null && !idleFor(item, query.olderThanDays, now)) return false
  if (query.dueWithinDays !== null && !dueWithin(item, query.dueWithinDays, context.today)) return false
  if (query.dueAfterDays !== null && !dueAfter(item, query.dueAfterDays, context.today)) return false
  return !isExcluded(item, query.excluded, now, context)
}

const isExcluded = (item: BacklogItem, excluded: SearchFilters, now: number, context: SearchContext): boolean =>
  excluded.kinds.includes(item.kind) ||
  excluded.statuses.includes(item.status) ||
  excluded.attentions.includes(item.attention ?? 'none') ||
  excluded.tags.some(tag => tagMatches(item, tag)) ||
  excluded.projects.some(project => projectMatches(item, project)) ||
  excluded.actors.some(kind => touchedBy(item, kind)) ||
  excluded.creators.some(kind => createdBy(item, kind)) ||
  excluded.has.some(type => hasLink(item, type)) ||
  excluded.priorities.some(priority => priorityIs(item, priority)) ||
  excluded.parents.includes(item.parent ?? '') ||
  excluded.states.some(state => inState(item, state, context)) ||
  excluded.delegates.some(kind => delegatedTo(item, kind)) ||
  (excluded.updatedWithinDays !== null && updatedWithin(item, excluded.updatedWithinDays, now)) ||
  (excluded.olderThanDays !== null && idleFor(item, excluded.olderThanDays, now)) ||
  (excluded.dueWithinDays !== null && dueWithin(item, excluded.dueWithinDays, context.today)) ||
  (excluded.dueAfterDays !== null && dueAfter(item, excluded.dueAfterDays, context.today)) ||
  excluded.terms.some(term => termHits(item, term))

/**
 * Every text a free-text term may hit, per field, in scoring order. The search index reads the same list, so an item
 * the index skips is one this scorer could never have matched.
 */
const sourcesOf = (item: BacklogItem): readonly (readonly [MatchField, readonly string[]])[] => {
  const comments = item.events.filter(event => event.kind === 'commented').map(event => event.detail)
  const capture = item.events.find(event => event.kind === 'created')?.detail ?? ''
  return [
    ['id', [BacklogReference.labelOf(item), BacklogReference.refOf(item)]],
    ['title', [item.title]],
    ['tag', item.tags.map(tag => `#${tag}`)],
    ['project', [item.project ?? '']],
    ['link', item.links.map(link => link.target)],
    ['body', [item.body, item.plan ?? '', item.summary ?? '', ...(item.criteria ?? []).map(criterion => criterion.text)]],
    ['capture', [capture]],
    ['comment', comments],
  ]
}

/**
 * Scores one item against a query, or null when it does not match. Every free-text term must hit some field; the
 * score adds each hit's field weight, and the result says which fields matched with a snippet of the best text hit.
 */
const score = (item: BacklogItem, query: SearchQuery, now: number, context: SearchContext = noContext): SearchMatch | null => {
  if (!passesFilters(item, query, now, context)) return null
  if (query.terms.length === 0) return { score: 0, fields: [], snippet: null }
  const sources = sourcesOf(item)
  let total = 0
  const fields = new Set<MatchField>()
  let snippet: string | null = null
  for (const term of query.terms) {
    let hit = false
    for (const [field, texts] of sources) {
      const found = field === 'id' ? texts.find(text => text === term) : texts.find(text => text.toLowerCase().includes(term))
      if (found === undefined) continue
      hit = true
      fields.add(field)
      total += fieldWeights[field] + (field === 'title' && item.title.toLowerCase().startsWith(term) ? 4 : 0)
      if (snippet === null && (field === 'body' || field === 'comment' || field === 'capture')) snippet = snippetAround(found, term)
    }
    if (!hit) return null
  }
  return { score: total, fields: [...fields], snippet }
}

export class BacklogSearch {
  static readonly parse = parse
  static readonly score = score
  static readonly sourcesOf = sourcesOf
}
