import type { ToolSchema } from '@deepseek-ai/dsh-llm'

interface SearchLimits {
  readonly maxResults: number
  readonly maxQueryChars: number
}

interface SearchMatch {
  readonly name: string
  readonly description: string
}

interface ValidatedSearch {
  readonly query: string
  readonly limit: number
}

const normalize = (text: string): string => text.normalize('NFKC').toLowerCase()

/** Plural folding only: `secrets` and `secret`, `entries` and `entry` share one term. */
const stem = (token: string): string => {
  if (token.length <= 3) return token
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (/(?:ss|us|is)$/u.test(token)) return token
  if (/(?:ch|sh|x|z)es$/u.test(token)) return token.slice(0, -2)
  return token.endsWith('s') ? token.slice(0, -1) : token
}
const tokenize = (text: string): string[] => (normalize(text).match(/[\p{L}\p{N}]+/gu) ?? []).map(stem)

/** Words that carry no capability; dropped from a query unless nothing else is left. */
const stopwords = new Set(
  'a an the i me my mine we us our you your it its this that these those is are was were be been being am do does did have has had to of in on at by for with from into onto about and or so as if than then what which who whom how much many any anything some can could should would will shall may might must there here still right now please just let up each'.split(
    ' ',
  ),
)

/**
 * Everyday words a query uses for a DSH capability, mapped to the words tool names and descriptions use. Expanded
 * terms score at {@link synonymWeight} of a literal term.
 */
const synonyms: Readonly<Record<string, string>> = {
  show: 'list',
  display: 'list',
  see: 'list',
  view: 'list',
  add: 'capture create',
  new: 'create capture',
  make: 'create',
  note: 'capture',
  record: 'capture',
  track: 'capture',
  todo: 'task backlog item',
  task: 'backlog item',
  ticket: 'backlog item',
  issue: 'backlog item',
  tracker: 'backlog',
  next: 'ready',
  mark: 'update status',
  done: 'status done',
  finish: 'done',
  close: 'done',
  change: 'update set',
  edit: 'update',
  modify: 'update',
  remove: 'delete',
  erase: 'delete',
  remind: 'reminder schedule',
  reminder: 'schedule',
  ping: 'reminder schedule',
  later: 'schedule',
  tomorrow: 'schedule',
  tonight: 'schedule',
  morning: 'schedule',
  hour: 'schedule after',
  minute: 'schedule after',
  recurring: 'schedule every',
  land: 'rebase integrate main',
  integrate: 'rebase main',
  unlanded: 'main revision',
  patch: 'revision diff',
  diff: 'revision patch',
  conversation: 'thread',
  chat: 'thread',
  talk: 'thread find earlier',
  talked: 'thread find earlier',
  discussed: 'thread find earlier',
  before: 'earlier',
  previously: 'earlier',
  remember: 'note memory',
  branch: 'fork',
  copy: 'fork',
  duplicate: 'fork',
  key: 'secret',
  credential: 'secret',
  password: 'secret',
  token: 'secret usage',
  spend: 'cost usage',
  spent: 'cost usage',
  bill: 'cost usage',
  price: 'cost',
  allowance: 'quota subscription',
  limit: 'quota',
  chatgpt: 'codex account',
  machine: 'host remote',
  server: 'host remote',
  remote: 'host',
  error: 'failure',
  failing: 'error failure',
  fail: 'error failure',
  slow: 'latency trace',
  diagram: 'whiteboard',
  drawing: 'whiteboard',
  sketch: 'whiteboard',
  pr: 'pull request',
  running: 'job',
  background: 'job',
  preference: 'setting',
  config: 'setting',
}
const synonymWeight = 0.6

/**
 * Family aliases: words that name what a whole tool family is for, appended once to every member's text, so a query
 * phrased in everyday words reaches the family and BM25 picks the member.
 */
const familyAliases: readonly (readonly [prefix: string, words: string, label: string])[] = [
  ['backlog_', 'task todo item tracker ticket issue bug idea', 'backlog tasks'],
  ['schedule_', 'reminder remind later timer recurring', 'reminders'],
  ['jj_thread_', 'land rebase main unlanded', 'thread workspaces and landing'],
  ['jj_', 'revision commit bookmark', 'jj revisions'],
  ['thread_', 'conversation chat', 'threads'],
  ['memory_', 'remember earlier recall', 'memory of earlier threads'],
  ['secret_', 'key credential password', 'secrets'],
  ['usage_', 'cost spend token', 'usage and cost'],
  ['ai_accounts_', 'subscription quota allowance account codex claude', 'AI accounts, subscriptions and quota'],
  ['multi_host_', 'remote machine host server ssh', 'remote hosts'],
  ['traces_', 'error failure latency slow span', 'traces and errors'],
  ['whiteboard_', 'diagram drawing sketch', 'whiteboards'],
  ['pull_request', 'pr pull request github', 'pull requests'],
  ['preview_', 'browser page web localhost', 'preview browser'],
  ['background_jobs_', 'job running background', 'background jobs'],
  ['settings_', 'setting preference configuration', 'DSH settings'],
]

const familyText = (name: string): string =>
  familyAliases
    .filter(([prefix]) => name.startsWith(prefix))
    .map(([, words]) => words)
    .join(' ')

/** Labels of the families with at least one of `names`, in table order, so a model knows what a search can find. */
const familyLabels = (names: Iterable<string>): string[] => {
  const present = [...names]
  return familyAliases.filter(([prefix]) => present.some(name => name.startsWith(prefix))).map(([, , label]) => label)
}

const compareToolNames = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

const validateSearch = (query: string, requestedLimit: number | undefined, limits: SearchLimits): ValidatedSearch => {
  const trimmed = query.trim()
  if (trimmed.length === 0) throw new TypeError('tool_search query must not be blank')
  if (trimmed.length > limits.maxQueryChars) throw new TypeError(`tool_search query exceeds maxQueryChars (${limits.maxQueryChars})`)
  const limit = requestedLimit ?? limits.maxResults
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > limits.maxResults) {
    throw new TypeError(`tool_search limit must be an integer from 1 to ${limits.maxResults}`)
  }
  return { query: trimmed, limit }
}

const compileAlwaysVisible = (patterns: readonly string[]): readonly RegExp[] => {
  const seen = new Set<string>()
  return patterns.map(pattern => {
    if (pattern.length === 0 || pattern.trim() !== pattern) throw new TypeError('alwaysVisible patterns must be non-empty and trimmed')
    if (seen.has(pattern)) throw new TypeError(`alwaysVisible repeats pattern ${JSON.stringify(pattern)}`)
    seen.add(pattern)
    const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
    return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
  })
}

interface PreparedTool {
  readonly name: string
  readonly description: string
  readonly length: number
  readonly frequencies: ReadonlyMap<string, number>
  readonly nameTokens: ReadonlySet<string>
}

const prepareTool = (schema: ToolSchema): PreparedTool => {
  const nameTokens = tokenize(schema.name)
  const tokens = [...nameTokens, ...tokenize(schema.description), ...tokenize(familyText(schema.name))]
  const frequencies = new Map<string, number>()
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
  return {
    name: normalize(schema.name),
    description: normalize(schema.description),
    length: tokens.length,
    frequencies,
    nameTokens: new Set(nameTokens),
  }
}

/** Only the name and description feed the preparation, so identical text reuses one entry across registry projections. */
const preparedTools = new Map<string, Map<string, PreparedTool>>()
const preparedLimit = 2048
let preparedCount = 0

const prepare = (schema: ToolSchema): PreparedTool => {
  const cached = preparedTools.get(schema.name)?.get(schema.description)
  if (cached !== undefined) return cached
  const prepared = prepareTool(schema)
  if (preparedCount >= preparedLimit) {
    preparedTools.clear()
    preparedCount = 0
  }
  const byDescription = preparedTools.get(schema.name) ?? new Map<string, PreparedTool>()
  byDescription.set(schema.description, prepared)
  preparedTools.set(schema.name, byDescription)
  preparedCount += 1
  return prepared
}

/** Literal query terms at weight 1, then their synonyms at {@link synonymWeight} unless already literal. */
const queryTerms = (query: string): ReadonlyMap<string, number> => {
  const tokens = [...new Set(tokenize(query))]
  const meaningful = tokens.filter(token => !stopwords.has(token))
  const literal = meaningful.length > 0 ? meaningful : tokens
  const weights = new Map(literal.map(token => [token, 1]))
  for (const token of literal) for (const expansion of tokenize(synonyms[token] ?? '')) if (!weights.has(expansion)) weights.set(expansion, synonymWeight)
  return weights
}

const rankTools = (query: string, schemas: readonly ToolSchema[]): SearchMatch[] => {
  const normalizedQuery = normalize(query)
  const terms = queryTerms(query)
  const queryTokens = [...terms.keys()]
  const rawTerms = new Set(normalizedQuery.split(/\s+/u).filter(Boolean))
  const entries = schemas.map(schema => ({ schema, prepared: prepare(schema) }))
  const documentFrequency = new Map(queryTokens.map(term => [term, entries.filter(entry => entry.prepared.frequencies.has(term)).length]))
  const averageLength = Math.max(1, entries.reduce((total, entry) => total + entry.prepared.length, 0) / Math.max(1, entries.length))
  const ranked = entries.flatMap(entry => {
    let score = 0
    if (entry.prepared.name === normalizedQuery) score += 1_000_000
    if (rawTerms.has(entry.prepared.name)) score += 100_000
    if (normalizedQuery.length > 0 && entry.prepared.name.includes(normalizedQuery)) score += 1_000
    if (normalizedQuery.length > 0 && entry.prepared.description.includes(normalizedQuery)) score += 100
    for (const [term, weight] of terms) {
      const termFrequency = entry.prepared.frequencies.get(term) ?? 0
      if (termFrequency > 0) {
        const frequency = documentFrequency.get(term) ?? 0
        const idf = Math.log(1 + (entries.length - frequency + 0.5) / (frequency + 0.5))
        score += (weight * idf * termFrequency * 2.2) / (termFrequency + 1.2 * (0.25 + (0.75 * entry.prepared.length) / averageLength))
      }
      if (entry.prepared.nameTokens.has(term)) score += 3 * weight
      if (entry.prepared.name.startsWith(term)) score += weight
    }
    return score > 0 ? [{ name: entry.schema.name, description: entry.schema.description, score }] : []
  })
  return ranked
    .sort((left, right) => right.score - left.score || compareToolNames(left.name, right.name))
    .map(({ name, description }) => ({ name, description }))
}

export class ToolSearchModel {
  static readonly compareToolNames = compareToolNames
  static readonly validate = validateSearch
  static readonly compileAlwaysVisible = compileAlwaysVisible
  static readonly rank = rankTools
  static readonly familyLabels = familyLabels
}
