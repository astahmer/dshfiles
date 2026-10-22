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
const tokenize = (text: string): string[] => normalize(text).match(/[\p{L}\p{N}]+/gu) ?? []

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

const rankTools = (query: string, schemas: readonly ToolSchema[]): SearchMatch[] => {
  const normalizedQuery = normalize(query)
  const queryTokens = [...new Set(tokenize(query))]
  const rawTerms = new Set(normalizedQuery.split(/\s+/u).filter(Boolean))
  const entries = schemas.map(schema => {
    const tokens = [...tokenize(schema.name), ...tokenize(schema.description)]
    const frequencies = new Map<string, number>()
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
    return { schema, name: normalize(schema.name), description: normalize(schema.description), tokens, frequencies }
  })
  const documentFrequency = new Map(queryTokens.map(term => [term, entries.filter(entry => entry.frequencies.has(term)).length]))
  const averageLength = Math.max(1, entries.reduce((total, entry) => total + entry.tokens.length, 0) / Math.max(1, entries.length))
  const ranked = entries.flatMap(entry => {
    let score = 0
    if (entry.name === normalizedQuery) score += 1_000_000
    if (rawTerms.has(entry.name)) score += 100_000
    if (normalizedQuery.length > 0 && entry.name.includes(normalizedQuery)) score += 1_000
    if (normalizedQuery.length > 0 && entry.description.includes(normalizedQuery)) score += 100
    const nameTokens = new Set(tokenize(entry.schema.name))
    for (const term of queryTokens) {
      const termFrequency = entry.frequencies.get(term) ?? 0
      if (termFrequency > 0) {
        const frequency = documentFrequency.get(term) ?? 0
        const idf = Math.log(1 + (entries.length - frequency + 0.5) / (frequency + 0.5))
        score += (idf * termFrequency * 2.2) / (termFrequency + 1.2 * (0.25 + (0.75 * entry.tokens.length) / averageLength))
      }
      if (nameTokens.has(term)) score += 50
      if (entry.name.startsWith(term)) score += 20
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
}
