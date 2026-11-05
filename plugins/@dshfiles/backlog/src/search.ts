import type { BacklogItem, BacklogLink } from './item.js'

const DAY_MS = 86_400_000
const SNIPPET_RADIUS = 60

type MatchField = 'id' | 'title' | 'tag' | 'body' | 'comment' | 'link' | 'project' | 'capture'

/** Where a text term was found and how much that counts: a title hit outranks one buried in a comment. */
const fieldWeights = { id: 12, title: 8, tag: 6, project: 3, link: 3, body: 2, capture: 1.5, comment: 1 } satisfies Record<MatchField, number>

type ActorKind = 'user' | 'agent' | 'system'

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
  readonly updatedWithinDays: number | null
  readonly olderThanDays: number | null
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
  updatedWithinDays: null,
  olderThanDays: null,
})

const addToken = (filters: MutableFilters, token: string): void => {
  const [key, ...rest] = token.split(':')
  const value = rest.join(':')
  const actor = actorWords.get(value)
  if (token.startsWith('#') && token.length > 1) filters.tags.push(token.slice(1))
  else if (key === 'kind' && kindWords.has(value)) filters.kinds.push(value)
  else if (key === 'status' && statusWords.has(value)) filters.statuses.push(value)
  else if (key === 'is' && kindWords.has(value)) filters.kinds.push(value)
  else if (key === 'is' && statusWords.has(value)) filters.statuses.push(value)
  else if (key === 'is' && attentionWords.has(value)) filters.attentions.push(attentionWords.get(value) ?? value)
  else if (key === 'project' && value !== '') filters.projects.push(value)
  else if (key === 'by' && actor !== undefined) filters.actors.push(actor)
  else if (key === 'created' && actor !== undefined) filters.creators.push(actor)
  else if (key === 'has' && hasWords.has(value)) filters.has.push(hasWords.get(value) ?? 'url')
  else if (key === 'updated' && /^[<>]\d+d$/.test(value)) {
    const days = Number(value.slice(1, -1))
    if (value.startsWith('<')) filters.updatedWithinDays = days
    else filters.olderThanDays = days
  } else filters.terms.push(token)
}

/**
 * Free text plus operators, all optional and combinable: `kind:bug`, `status:doing`, `is:blocked` (kind, status or
 * attention), `#tag`, `project:welii`, `by:agent` (touched by), `created:me` (captured by), `has:thread`,
 * `updated:<7d`, `updated:>30d`. Quoted text is one term. A leading `-` negates any of them, words included.
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

/** The actor who captured the item: its owner, or the `created` event of a row that lost its owner entry. */
const creatorOf = (item: BacklogItem): string | undefined =>
  item.actors.find(actor => actor.role === 'owner')?.id ?? item.events.find(event => event.kind === 'created')?.actor

const tagMatches = (item: BacklogItem, tag: string): boolean => item.tags.some(own => own.startsWith(tag))
const projectMatches = (item: BacklogItem, project: string): boolean => (item.project ?? '').toLowerCase().includes(project)
const touchedBy = (item: BacklogItem, kind: ActorKind): boolean => item.actors.some(actor => isActor(actor.id, kind))
const createdBy = (item: BacklogItem, kind: ActorKind): boolean => {
  const creator = creatorOf(item)
  return creator !== undefined && isActor(creator, kind)
}
const hasLink = (item: BacklogItem, type: BacklogLink['type']): boolean => item.links.some(link => link.type === type)
const updatedWithin = (item: BacklogItem, days: number, now: number): boolean => now - item.lastActivityAt <= days * DAY_MS
const idleFor = (item: BacklogItem, days: number, now: number): boolean => now - item.lastActivityAt >= days * DAY_MS
const termHits = (item: BacklogItem, term: string): boolean =>
  sourcesOf(item).some(([field, texts]) => (field === 'id' ? texts.includes(term) : texts.some(text => text.toLowerCase().includes(term))))

/** Whether the item passes every operator; free-text terms are scored separately. */
const passesFilters = (item: BacklogItem, query: SearchQuery, now: number): boolean => {
  if (query.kinds.length > 0 && !query.kinds.includes(item.kind)) return false
  if (query.statuses.length > 0 && !query.statuses.includes(item.status)) return false
  if (query.attentions.length > 0 && !query.attentions.includes(item.attention ?? 'none')) return false
  if (query.tags.some(tag => !tagMatches(item, tag))) return false
  if (query.projects.some(project => !projectMatches(item, project))) return false
  if (query.actors.some(kind => !touchedBy(item, kind))) return false
  if (query.creators.length > 0 && !query.creators.some(kind => createdBy(item, kind))) return false
  if (query.has.some(type => !hasLink(item, type))) return false
  if (query.updatedWithinDays !== null && !updatedWithin(item, query.updatedWithinDays, now)) return false
  if (query.olderThanDays !== null && !idleFor(item, query.olderThanDays, now)) return false
  return !isExcluded(item, query.excluded, now)
}

const isExcluded = (item: BacklogItem, excluded: SearchFilters, now: number): boolean =>
  excluded.kinds.includes(item.kind) ||
  excluded.statuses.includes(item.status) ||
  excluded.attentions.includes(item.attention ?? 'none') ||
  excluded.tags.some(tag => tagMatches(item, tag)) ||
  excluded.projects.some(project => projectMatches(item, project)) ||
  excluded.actors.some(kind => touchedBy(item, kind)) ||
  excluded.creators.some(kind => createdBy(item, kind)) ||
  excluded.has.some(type => hasLink(item, type)) ||
  (excluded.updatedWithinDays !== null && updatedWithin(item, excluded.updatedWithinDays, now)) ||
  (excluded.olderThanDays !== null && idleFor(item, excluded.olderThanDays, now)) ||
  excluded.terms.some(term => termHits(item, term))

/**
 * Every text a free-text term may hit, per field, in scoring order. The search index reads the same list, so an item
 * the index skips is one this scorer could never have matched.
 */
const sourcesOf = (item: BacklogItem): readonly (readonly [MatchField, readonly string[]])[] => {
  const comments = item.events.filter(event => event.kind === 'commented').map(event => event.detail)
  const capture = item.events.find(event => event.kind === 'created')?.detail ?? ''
  return [
    ['id', [`b:${String(item.id)}`, String(item.id)]],
    ['title', [item.title]],
    ['tag', item.tags.map(tag => `#${tag}`)],
    ['project', [item.project ?? '']],
    ['link', item.links.map(link => link.target)],
    ['body', [item.body]],
    ['capture', [capture]],
    ['comment', comments],
  ]
}

/**
 * Scores one item against a query, or null when it does not match. Every free-text term must hit some field; the
 * score adds each hit's field weight, and the result says which fields matched with a snippet of the best text hit.
 */
const score = (item: BacklogItem, query: SearchQuery, now: number): SearchMatch | null => {
  if (!passesFilters(item, query, now)) return null
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
  static readonly creatorOf = creatorOf
  static readonly score = score
  static readonly sourcesOf = sourcesOf
}
