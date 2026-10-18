import { z } from 'zod'

import type { JsonValue } from './client.js'

/** One Session search result as the platform CLI shows it; `evidence` is present only for metadata matches. */
export type SessionSearchItem = {
  readonly sessionId: string
  readonly snippet: string
  readonly evidence?: readonly string[]
}

export type SessionSearchSummary = {
  readonly sessionId: string
  readonly updatedAt: number
  readonly cwd?: string
  readonly projections?: JsonValue
}

export type SessionSearchFailure = {
  readonly code: string
  readonly message: string
  readonly attempts: number
  readonly elapsedMs: number
}

/**
 * What a `sessions search` call observed: which source answered, how many attempts it took, and whether the page is
 * known to be incomplete because full-text session content was unavailable.
 */
export type SessionSearchOutcome = {
  readonly items: readonly SessionSearchItem[]
  readonly hasMore: boolean
  readonly source: 'session-content' | 'session-metadata'
  readonly incomplete: boolean
  readonly attempts: number
  readonly elapsedMs: number
  readonly failure: SessionSearchFailure | null
}

export type SearchSessionsOptions = {
  readonly query: string
  readonly search: (query: string) => Promise<{ readonly items: readonly SessionSearchItem[]; readonly hasMore: boolean }>
  readonly list: () => Promise<readonly SessionSearchSummary[]>
  readonly limit?: number
  readonly attempts?: number
  readonly delaysMs?: readonly number[]
  readonly sleep?: (milliseconds: number) => Promise<void>
  readonly now?: () => number
}

const defaultAttempts = 3
const defaultDelaysMs = [0, 150, 400] as const

/** Failures that a metadata fallback cannot answer either: the launch URL, the session, or the RPC envelope itself. */
const fatalCodes = new Set([
  'authentication-expired',
  'authentication-failed',
  'missing-url',
  'invalid-url',
  'unsafe-url',
  'cancelled',
  'rpc-unreachable',
  'connection-failed',
  'invalid-response',
  'invalid-method',
  'api-unreachable',
  'api-http-error',
])

const codeOf = (error: unknown): string => {
  const code = (error as { readonly code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'unknown'
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * The supported session-query backend observes the corpus before it searches and gives that observation one retry, so a
 * busy Host fails with `SESSION_QUERY_PERSISTENCE_FAILED`. The core RPC replaces the code with `gateway/internal` and
 * keeps the sentence, so both shapes are recognized here; nothing else is retried.
 */
const isTransientSessionSearchFailure = (error: unknown): boolean => {
  const code = codeOf(error)
  if (code === 'SESSION_QUERY_PERSISTENCE_FAILED') return true
  if (code !== 'gateway/internal' && code !== 'remote-error') return false
  return /persistence observation did not stabilize|persistence observation failed/iu.test(messageOf(error))
}

const isFatalSessionSearchFailure = (error: unknown): boolean => fatalCodes.has(codeOf(error))

const projectionTitle = z.object({ values: z.object({ title: z.string() }) })

/** The title the Host already projects for a Session row, decoded defensively; a different projection shape means no title. */
const sessionTitleOf = (summary: { readonly projections?: JsonValue | undefined }): string | undefined => {
  const parsed = projectionTitle.safeParse(summary.projections)
  return parsed.success ? parsed.data.values.title : undefined
}

const normalize = (value: string): string => value.toLowerCase().replace(/\s+/gu, ' ').trim()

const termsOf = (value: string): readonly string[] => [
  ...new Set(
    normalize(value)
      .split(/[^\p{L}\p{N}._:/-]+/u)
      .filter(term => term.length > 1),
  ),
]

/** Title, identifier and term matches over Session metadata only: no full-text index is involved. */
const metadataSessionMatches = (summaries: readonly SessionSearchSummary[], query: string, limit: number): readonly SessionSearchItem[] => {
  const needle = normalize(query)
  if (needle.length === 0) return []
  const words = termsOf(query)
  const scored: { readonly item: SessionSearchItem; readonly score: number; readonly updatedAt: number }[] = []
  for (const summary of summaries) {
    const title = sessionTitleOf(summary) ?? ''
    const normalizedTitle = normalize(title)
    const cwd = normalize(summary.cwd ?? '')
    const sessionId = summary.sessionId.toLowerCase()
    const shared = words.filter(term => normalizedTitle.includes(term))
    const evidence: string[] = []
    let score = 0
    if (normalizedTitle.length > 0 && normalizedTitle === needle) {
      score = 4
      evidence.push('exact-title')
    } else if (needle.length > 2 && (sessionId === needle || sessionId.startsWith(`session-${needle}`) || sessionId.startsWith(needle))) {
      score = 3
      evidence.push('identifier')
    } else if (needle.length > 2 && cwd.includes(needle)) {
      score = 3
      evidence.push('identifier')
    } else if (needle.length > 2 && normalizedTitle.includes(needle)) {
      score = 2
      evidence.push('title-match')
    } else if (shared.length > 0) {
      score = 1
      evidence.push('title-match')
    }
    if (score === 0) continue
    scored.push({
      item: { sessionId: summary.sessionId, snippet: title.length > 0 ? title : (summary.cwd ?? summary.sessionId), evidence },
      score,
      updatedAt: summary.updatedAt,
    })
  }
  return scored
    .sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt || left.item.sessionId.localeCompare(right.item.sessionId))
    .slice(0, Math.max(1, limit))
    .map(entry => entry.item)
}

/**
 * Search Session content with a bounded retry over the backend's own one-retry observation, then fall back to a
 * clearly labeled metadata search. A transient failure is retried; a fatal one is rethrown; everything else degrades.
 */
const searchSessionsResilient = async (options: SearchSessionsOptions): Promise<SessionSearchOutcome> => {
  const attempts = Math.max(1, options.attempts ?? defaultAttempts)
  const delays = options.delaysMs ?? defaultDelaysMs
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  const now = options.now ?? Date.now
  const limit = options.limit ?? 20
  const startedAt = now()
  let failure: SessionSearchFailure | null = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const wait = delays[Math.min(attempt, delays.length - 1)] ?? 0
    if (attempt > 0 && wait > 0) await sleep(wait)
    try {
      const page = await options.search(options.query)
      return {
        items: page.items,
        hasMore: page.hasMore,
        source: 'session-content',
        incomplete: false,
        attempts: attempt + 1,
        elapsedMs: now() - startedAt,
        failure: null,
      }
    } catch (error) {
      if (isFatalSessionSearchFailure(error)) throw error
      failure = { code: codeOf(error), message: messageOf(error), attempts: attempt + 1, elapsedMs: now() - startedAt }
      if (!isTransientSessionSearchFailure(error)) break
    }
  }
  return {
    items: metadataSessionMatches(await options.list(), options.query, limit),
    hasMore: false,
    source: 'session-metadata',
    incomplete: true,
    attempts: failure?.attempts ?? attempts,
    elapsedMs: now() - startedAt,
    failure,
  }
}

export class SessionSearchModel {
  static readonly isTransientFailure = isTransientSessionSearchFailure
  static readonly isFatalFailure = isFatalSessionSearchFailure
  static readonly titleOf = sessionTitleOf
  static readonly metadataMatches = metadataSessionMatches
  static readonly searchResilient = searchSessionsResilient
}
