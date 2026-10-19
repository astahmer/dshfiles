import type { BacklogItem, BacklogLink } from './item.js'

const DAY_MS = 86_400_000
const SNIPPET_RADIUS = 60

type MatchField = 'id' | 'title' | 'tag' | 'body' | 'comment' | 'link' | 'project' | 'capture'

/** Where a text term was found and how much that counts: a title hit outranks one buried in a comment. */
const fieldWeights = { id: 12, title: 8, tag: 6, project: 3, link: 3, body: 2, capture: 1.5, comment: 1 } satisfies Record<MatchField, number>

export interface SearchQuery {
  readonly terms: readonly string[]
  readonly kinds: readonly string[]
  readonly statuses: readonly string[]
  readonly attentions: readonly string[]
  readonly tags: readonly string[]
  readonly projects: readonly string[]
  readonly actors: readonly ('user' | 'agent' | 'system')[]
  readonly has: readonly BacklogLink['type'][]
  readonly updatedWithinDays: number | null
  readonly olderThanDays: number | null
}

interface MutableQuery {
  terms: string[]
  kinds: string[]
  statuses: string[]
  attentions: string[]
  tags: string[]
  projects: string[]
  actors: ('user' | 'agent' | 'system')[]
  has: BacklogLink['type'][]
  updatedWithinDays: number | null
  olderThanDays: number | null
}

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

/**
 * Free text plus operators, all optional and combinable: `kind:bug`, `status:doing`, `is:blocked` (kind, status or
 * attention), `#tag`, `project:welii`, `by:agent`, `has:thread`, `updated:<7d`, `updated:>30d`. Quoted text is one term.
 */
const parse = (raw: string): SearchQuery => {
  const query: MutableQuery = {
    terms: [],
    kinds: [],
    statuses: [],
    attentions: [],
    tags: [],
    projects: [],
    actors: [],
    has: [],
    updatedWithinDays: null,
    olderThanDays: null,
  }
  for (const match of raw.toLowerCase().matchAll(/"([^"]+)"|(\S+)/g)) {
    const token = match[1] ?? match[2] ?? ''
    if (match[1] !== undefined) {
      query.terms.push(token)
      continue
    }
    const [key, ...rest] = token.split(':')
    const value = rest.join(':')
    if (token.startsWith('#') && token.length > 1) query.tags.push(token.slice(1))
    else if (key === 'kind' && kindWords.has(value)) query.kinds.push(value)
    else if (key === 'status' && statusWords.has(value)) query.statuses.push(value)
    else if (key === 'is' && kindWords.has(value)) query.kinds.push(value)
    else if (key === 'is' && statusWords.has(value)) query.statuses.push(value)
    else if (key === 'is' && attentionWords.has(value)) query.attentions.push(attentionWords.get(value) ?? value)
    else if (key === 'project' && value !== '') query.projects.push(value)
    else if (key === 'by' && (value === 'user' || value === 'me')) query.actors.push('user')
    else if (key === 'by' && (value === 'agent' || value === 'system')) query.actors.push(value)
    else if (key === 'has' && hasWords.has(value)) query.has.push(hasWords.get(value) ?? 'url')
    else if (key === 'updated' && /^[<>]\d+d$/.test(value)) {
      const days = Number(value.slice(1, -1))
      if (value.startsWith('<')) query.updatedWithinDays = days
      else query.olderThanDays = days
    } else query.terms.push(token)
  }
  return query
}

const snippetAround = (text: string, term: string): string => {
  const index = text.toLowerCase().indexOf(term)
  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = Math.min(text.length, index + term.length + SNIPPET_RADIUS)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`
}

/** Whether the item passes every operator; free-text terms are scored separately. */
const passesFilters = (item: BacklogItem, query: SearchQuery, now: number): boolean => {
  if (query.kinds.length > 0 && !query.kinds.includes(item.kind)) return false
  if (query.statuses.length > 0 && !query.statuses.includes(item.status)) return false
  if (query.attentions.length > 0 && !query.attentions.includes(item.attention ?? 'none')) return false
  if (query.tags.some(tag => !item.tags.some(own => own.startsWith(tag)))) return false
  if (query.projects.some(project => !(item.project ?? '').toLowerCase().includes(project))) return false
  if (query.actors.some(kind => !item.actors.some(actor => (kind === 'agent' ? actor.id.startsWith('agent:') : actor.id === kind)))) return false
  if (query.has.some(type => !item.links.some(link => link.type === type))) return false
  if (query.updatedWithinDays !== null && now - item.lastActivityAt > query.updatedWithinDays * DAY_MS) return false
  if (query.olderThanDays !== null && now - item.lastActivityAt < query.olderThanDays * DAY_MS) return false
  return true
}

/**
 * Scores one item against a query, or null when it does not match. Every free-text term must hit some field; the
 * score adds each hit's field weight, and the result says which fields matched with a snippet of the best text hit.
 */
const score = (item: BacklogItem, query: SearchQuery, now: number): SearchMatch | null => {
  if (!passesFilters(item, query, now)) return null
  if (query.terms.length === 0) return { score: 0, fields: [], snippet: null }
  const comments = item.events.filter(event => event.kind === 'commented').map(event => event.detail)
  const capture = item.events.find(event => event.kind === 'created')?.detail ?? ''
  const sources: readonly (readonly [MatchField, readonly string[]])[] = [
    ['id', [`b:${String(item.id)}`, String(item.id)]],
    ['title', [item.title]],
    ['tag', item.tags.map(tag => `#${tag}`)],
    ['project', [item.project ?? '']],
    ['link', item.links.map(link => link.target)],
    ['body', [item.body]],
    ['capture', [capture]],
    ['comment', comments],
  ]
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
}
