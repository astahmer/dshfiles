import { Utf8 } from '@dshfiles/optmem-core'

/** Where one finder hit was observed. A session can be found by several sources at once. */
export type ThreadFinderSource = 'session-title' | 'session-metadata' | 'session-content' | 'memory-digest' | 'memory-message' | 'memory-note'

/** Why a hit was ranked: exact matches are distinguished from inferred similarity. */
export type ThreadFinderEvidence =
  | 'exact-title'
  | 'title-match'
  | 'identifier'
  | 'text-match'
  | 'digest-match'
  | 'explicit-lineage'
  | 'shared-workspace'
  | 'topic-candidate'

export type ThreadFinderAvailability = 'live' | 'persisted'

/** One logical session as the finder sees it, decoded once at the boundary from supported session reads. */
export type ThreadFinderRecord = {
  readonly sessionId: string
  readonly title: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly cwd: string | null
  readonly project: string
  readonly live: boolean
  readonly persisted: boolean
  readonly parentSessionId: string | null
}

export type ThreadFinderMemoryHit =
  | {
      readonly kind: 'digest'
      readonly sessionId: string
      readonly project: string
      readonly updatedAt: number
      readonly title: string
      readonly text: string
      readonly score: number
    }
  | {
      readonly kind: 'note'
      readonly noteId: number
      readonly project: string
      readonly updatedAt: number
      readonly text: string
      readonly sourceThread: string | null
      readonly score: number
    }
  | {
      readonly kind: 'message'
      readonly sessionId: string
      readonly seq: number
      readonly role: string
      readonly project: string
      readonly updatedAt: number
      readonly text: string
      readonly score: number
    }

export type ThreadFinderHit = {
  readonly sessionId: string
  readonly title: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly cwd: string | null
  readonly project: string
  readonly live: boolean
  readonly persisted: boolean
  readonly parentSessionId: string | null
  readonly snippet: string
  readonly sources: readonly ThreadFinderSource[]
  readonly evidence: readonly ThreadFinderEvidence[]
  readonly score: number
}

export type ThreadFinderNote = {
  readonly noteId: number
  readonly project: string
  readonly updatedAt: number
  readonly sourceThread: string | null
  readonly excerpt: string
}

/** A source the finder could not use, with enough detail to act on. It never hides behind an empty page. */
export type ThreadFinderDegradation = {
  readonly source: 'session-content'
  readonly code: string
  readonly message: string
  readonly attempts: number
  readonly elapsedMs: number
}

export type ThreadFinderDiagnostics = {
  readonly correlationId: string
  readonly elapsedMs: number
  readonly sources: readonly ThreadFinderSource[]
  readonly attempts: number
  readonly scannedSessions: number
  readonly incomplete: boolean
}

export type ThreadFinderPage = {
  readonly hits: readonly ThreadFinderHit[]
  readonly notes: readonly ThreadFinderNote[]
  readonly nextCursor: string | null
  readonly degraded: readonly ThreadFinderDegradation[]
  readonly diagnostics: ThreadFinderDiagnostics
}

export type ThreadFinderRelations = {
  readonly seed: ThreadFinderHit
  readonly explicit: readonly ThreadFinderHit[]
  readonly inferred: readonly ThreadFinderHit[]
  readonly degraded: readonly ThreadFinderDegradation[]
  readonly diagnostics: ThreadFinderDiagnostics
}

export type ThreadFinderQuery = {
  readonly query: string
  /** Projects the caller may search; empty means every project the caller is allowed to see. */
  readonly projects: readonly string[]
  readonly ownProject: string
  readonly limit: number
  readonly cursor?: string | undefined
  readonly availability?: readonly ThreadFinderAvailability[] | undefined
  readonly createdFrom?: number | undefined
  readonly createdTo?: number | undefined
  readonly includeNotes?: boolean | undefined
}

export type ThreadFinderRelatedQuery = {
  readonly sessionId: string
  readonly projects: readonly string[]
  readonly limit: number
}

export type ThreadFinderErrorCode = 'invalid-request' | 'stale-cursor' | 'not-found' | 'search-unavailable'

/** A typed failure: the caller learns whether to retry, restart the search, or widen its scope. */
export class ThreadFinderError extends Error {
  readonly code: ThreadFinderErrorCode

  constructor(code: ThreadFinderErrorCode, message: string) {
    super(message)
    this.name = 'ThreadFinderError'
    this.code = code
  }
}

export type ThreadFinderLogger = { readonly info: (message: string, fields: Readonly<Record<string, unknown>>) => void }

export type ThreadFinderRetry = {
  readonly attempts: number
  readonly delaysMs: readonly number[]
  readonly sleep: (ms: number) => Promise<void>
}

export type ThreadFinderDeps = {
  readonly listSessions: (signal?: AbortSignal) => Promise<readonly ThreadFinderRecord[]>
  /**
   * Called when a content attempt missed its deadline, so the Host can reconcile the session-content index in
   * the background without making this caller wait. One background pass makes later pages complete.
   */
  readonly warmContent?: ((query: string) => void) | undefined
  /** Raw full-text search over session content. Throws `SessionQueryError` with its own `code`. */
  readonly searchContent: (
    request: { readonly query: string; readonly limit: number },
    signal?: AbortSignal,
  ) => Promise<{ readonly hits: readonly { readonly sessionId: string; readonly snippet: string }[]; readonly hasMore: boolean }>
  readonly searchMemory: (
    request: { readonly query: string; readonly limit: number; readonly projects: readonly string[] },
    signal?: AbortSignal,
  ) => Promise<readonly ThreadFinderMemoryHit[]>
  readonly readDigest: (sessionId: string) => Promise<string | null>
  /**
   * How long one session-content attempt may run before the finder degrades to title, workspace and memory
   * hits. The installed SQLite backend reconciles the whole corpus before answering, which takes minutes on a
   * large or cold history; a palette must never wait for that. `0` waits forever.
   */
  readonly contentDeadlineMs?: number | undefined
  readonly now?: (() => number) | undefined
  readonly correlationId?: (() => string) | undefined
  readonly logger?: ThreadFinderLogger | undefined
  readonly retry?: Partial<ThreadFinderRetry> | undefined
  readonly signal?: AbortSignal | undefined
}

/** A content search that has not answered by now is reconciling the corpus; the caller needs an answer. */
const defaultContentDeadlineMs = 1_500

const defaultRetry: ThreadFinderRetry = {
  attempts: 4,
  delaysMs: [0, 75, 200, 500],
  sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
}

const cursorVersion = 1
const snippetBytes = 240
const recencyCeiling = 50
const hourMs = 3_600_000

const stopWords = new Set(
  'a an and are as at be by can could did do does for from had has have how i if in into is it its me my no not of on or our should so that the their them then there these they this to us was we were what when where which who why will with would you your'.split(
    ' ',
  ),
)

const normalize = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim()

const terms = (text: string): readonly string[] => [
  ...new Set(
    normalize(text)
      .split(/[^\p{L}\p{N}._:/-]+/u)
      .filter(term => term.length > 1 && !stopWords.has(term)),
  ),
]

const clip = (text: string, needles: readonly string[]): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()
  const at = needles.map(needle => lower.indexOf(needle)).find(index => index >= 0) ?? 0
  const start = Math.max(0, at - 80)
  return `${start > 0 ? '…' : ''}${Utf8.clip(flat.slice(start), snippetBytes)}`
}

const overlap = (left: readonly string[], right: readonly string[]): readonly string[] => left.filter(term => right.includes(term))

const encodeCursor = (value: { readonly offset: number; readonly stamp: string }): string =>
  Buffer.from(JSON.stringify({ v: cursorVersion, offset: value.offset, stamp: value.stamp }), 'utf8').toString('base64url')

const decodeCursor = (cursor: string): { readonly offset: number; readonly stamp: string } => {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { v?: unknown; offset?: unknown; stamp?: unknown }
    if (
      parsed.v !== cursorVersion ||
      typeof parsed.offset !== 'number' ||
      typeof parsed.stamp !== 'string' ||
      !Number.isInteger(parsed.offset) ||
      parsed.offset < 0
    )
      throw new Error('shape')
    return { offset: parsed.offset, stamp: parsed.stamp }
  } catch {
    throw new ThreadFinderError('invalid-request', 'The cursor is not one this finder issued; start the search again.')
  }
}

/** The failure contract of the supported full-text backend; anything else is not retried. */
const isTransientContentFailure = (error: unknown): boolean => {
  const code = (error as { readonly code?: unknown } | null)?.code
  return code === 'SESSION_QUERY_PERSISTENCE_FAILED'
}

const failureCode = (error: unknown): string => {
  const code = (error as { readonly code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'unknown'
}

type Candidate = {
  record: ThreadFinderRecord
  score: number
  snippet: string
  sources: readonly ThreadFinderSource[]
  evidence: readonly ThreadFinderEvidence[]
}

const mergeCandidate = (
  candidates: Map<string, Candidate>,
  record: ThreadFinderRecord,
  contribution: { readonly score: number; readonly snippet: string; readonly source: ThreadFinderSource; readonly evidence: ThreadFinderEvidence },
): void => {
  const existing = candidates.get(record.sessionId)
  if (existing === undefined) {
    candidates.set(record.sessionId, {
      record,
      score: contribution.score,
      snippet: contribution.snippet,
      sources: [contribution.source],
      evidence: [contribution.evidence],
    })
    return
  }
  candidates.set(record.sessionId, {
    record,
    score: Math.max(existing.score, contribution.score),
    snippet: existing.snippet.length > 0 ? existing.snippet : contribution.snippet,
    sources: existing.sources.includes(contribution.source) ? existing.sources : [...existing.sources, contribution.source],
    evidence: existing.evidence.includes(contribution.evidence) ? existing.evidence : [...existing.evidence, contribution.evidence],
  })
}

const toHit = (candidate: Candidate): ThreadFinderHit => ({
  sessionId: candidate.record.sessionId,
  title: candidate.record.title,
  createdAt: candidate.record.createdAt,
  updatedAt: candidate.record.updatedAt,
  cwd: candidate.record.cwd,
  project: candidate.record.project,
  live: candidate.record.live,
  persisted: candidate.record.persisted,
  parentSessionId: candidate.record.parentSessionId,
  snippet: candidate.snippet,
  sources: candidate.sources,
  evidence: candidate.evidence,
  score: candidate.score,
})

const ordered = (candidates: Iterable<Candidate>): readonly Candidate[] =>
  [...candidates].sort(
    (left, right) =>
      right.score - left.score ||
      right.record.updatedAt - left.record.updatedAt ||
      (left.record.sessionId < right.record.sessionId ? -1 : left.record.sessionId > right.record.sessionId ? 1 : 0),
  )

/**
 * Cross-session discovery over supported session reads and memory retrieval.
 *
 * Every hit names its source and evidence, the page is bounded and deduplicated by canonical session id, and a
 * source that failed is reported as a labeled degradation instead of an empty page.
 */
export const createThreadFinder = (deps: ThreadFinderDeps) => {
  const now = deps.now ?? Date.now
  const correlationId = deps.correlationId ?? (() => Math.random().toString(36).slice(2, 10))
  const retry: ThreadFinderRetry = { ...defaultRetry, ...deps.retry }
  const log = (fields: Readonly<Record<string, unknown>>): void => deps.logger?.info('thread finder', fields)

  const inScope = (record: ThreadFinderRecord, query: Pick<ThreadFinderQuery, 'projects' | 'availability' | 'createdFrom' | 'createdTo'>): boolean => {
    if (query.projects.length > 0 && !query.projects.includes(record.project)) return false
    if (query.availability !== undefined && query.availability.length > 0) {
      const available = query.availability.some(value => (value === 'live' ? record.live : record.persisted))
      if (!available) return false
    }
    if (query.createdFrom !== undefined && record.createdAt < query.createdFrom) return false
    if (query.createdTo !== undefined && record.createdAt > query.createdTo) return false
    return true
  }

  const contentSearch = async (
    query: string,
    limit: number,
  ): Promise<{
    readonly hits: readonly { readonly sessionId: string; readonly snippet: string }[]
    readonly attempts: number
    readonly elapsedMs: number
    readonly failure: ThreadFinderDegradation | null
  }> => {
    const startedAt = now()
    const deadlineMs = deps.contentDeadlineMs ?? defaultContentDeadlineMs
    for (let attempt = 0; attempt < retry.attempts; attempt += 1) {
      const wait = retry.delaysMs[Math.min(attempt, retry.delaysMs.length - 1)] ?? 0
      if (attempt > 0 && wait > 0) await retry.sleep(wait)
      const deadline = new AbortController()
      const timer = deadlineMs > 0 ? setTimeout(() => deadline.abort(), deadlineMs) : undefined
      const signal = deps.signal === undefined ? deadline.signal : AbortSignal.any([deps.signal, deadline.signal])
      try {
        const page = await deps.searchContent({ query, limit }, signal)
        return { hits: page.hits, attempts: attempt + 1, elapsedMs: now() - startedAt, failure: null }
      } catch (error) {
        if (deps.signal?.aborted) throw error
        // A deadline miss means the index is reconciling the corpus: a retry would only buy another wait.
        if (deadline.signal.aborted) {
          deps.warmContent?.(query)
          return {
            hits: [],
            attempts: attempt + 1,
            elapsedMs: now() - startedAt,
            failure: {
              source: 'session-content',
              code: 'SESSION_QUERY_TIMEOUT',
              message: `Session content search was still reconciling the corpus after ${deadlineMs} ms; these hits come from titles, workspace paths and memory.`,
              attempts: attempt + 1,
              elapsedMs: now() - startedAt,
            },
          }
        }
        if (!isTransientContentFailure(error) || attempt === retry.attempts - 1) {
          return {
            hits: [],
            attempts: attempt + 1,
            elapsedMs: now() - startedAt,
            failure: {
              source: 'session-content',
              code: failureCode(error),
              message: error instanceof Error ? error.message : String(error),
              attempts: attempt + 1,
              elapsedMs: now() - startedAt,
            },
          }
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }
    throw new ThreadFinderError('search-unavailable', 'Session content search could not be attempted.')
  }

  const find = async (query: ThreadFinderQuery): Promise<ThreadFinderPage> => {
    const text = query.query.trim()
    if (text.length === 0) throw new ThreadFinderError('invalid-request', 'A finder query needs at least one character.')
    const limit = Math.max(1, Math.min(query.limit, 20))
    const startedAt = now()
    const id = correlationId()
    const records = (await deps.listSessions(deps.signal)).filter(record => inScope(record, query))
    const byId = new Map(records.map(record => [record.sessionId, record]))
    const stamp = `${records.length}:${records.reduce((newest, record) => Math.max(newest, record.updatedAt), 0)}`

    let offset = 0
    if (query.cursor !== undefined && query.cursor.length > 0) {
      const decoded = decodeCursor(query.cursor)
      if (decoded.stamp !== stamp)
        throw new ThreadFinderError(
          'stale-cursor',
          'The session corpus changed since that cursor was issued; start the search again to page over current results.',
        )
      offset = decoded.offset
    }

    const needle = normalize(text)
    const needles = terms(text)
    const words = new Set(needles)
    const candidates = new Map<string, Candidate>()
    const notes: ThreadFinderNote[] = []
    const sources = new Set<ThreadFinderSource>()
    const recency = (updatedAt: number): number => Math.max(0, recencyCeiling - Math.floor((now() - updatedAt) / (24 * hourMs)))

    for (const record of records) {
      const title = normalize(record.title)
      const titleTerms = new Set(terms(record.title))
      const shared = [...words].filter(term => titleTerms.has(term))
      const cwd = normalize(record.cwd ?? '')
      const project = normalize(record.project)
      let score = 0
      const evidence: ThreadFinderEvidence[] = []
      if (title.length > 0 && title === needle) {
        score = 1_000
        evidence.push('exact-title')
      } else if (needle.length > 2 && title.includes(needle)) {
        score = 700
        evidence.push('title-match')
      } else if (shared.length > 0) {
        score = Math.round(400 * (shared.length / Math.max(1, Math.min(words.size, titleTerms.size))))
        evidence.push('title-match')
      }
      if (needle.length > 2 && (record.sessionId.toLowerCase() === needle || record.sessionId.toLowerCase().startsWith(needle))) {
        score = Math.max(score, 900)
        evidence.push('identifier')
      }
      if (needle.length > 2 && (cwd.includes(needle) || project.includes(needle))) {
        score = Math.max(score, 600)
        evidence.push('identifier')
      }
      if (evidence.length === 0) continue
      const snippet = record.title.length > 0 ? record.title : (record.cwd ?? record.sessionId)
      for (const label of evidence)
        mergeCandidate(candidates, record, {
          score: score + recency(record.updatedAt),
          snippet,
          source: label === 'identifier' ? 'session-metadata' : 'session-title',
          evidence: label,
        })
      sources.add(evidence.includes('identifier') ? 'session-metadata' : 'session-title')
    }

    const contentLimit = Math.min(40, limit * 4)
    // Content search and memory retrieval are independent: start both, then merge in this fixed order so the ranking
    // stays deterministic. `Promise.all` attaches its handlers to both, so a rejected source is not an unhandled one.
    const [content, memoryHits] = await Promise.all([
      contentSearch(text, contentLimit),
      deps.searchMemory({ query: text, limit: contentLimit, projects: query.projects }, deps.signal),
    ])
    if (content.failure === null) sources.add('session-content')
    const contentRank = new Map(content.hits.map((hit, index) => [hit.sessionId, index]))
    for (const hit of content.hits) {
      const record = byId.get(hit.sessionId)
      if (record === undefined) continue
      const bonus = Math.round(100 * (1 - (contentRank.get(hit.sessionId) ?? 0) / Math.max(1, content.hits.length)))
      mergeCandidate(candidates, record, {
        score: 500 + bonus + recency(record.updatedAt),
        snippet: clip(hit.snippet, needles),
        source: 'session-content',
        evidence: 'text-match',
      })
    }

    const memoryRank = new Map(memoryHits.map((hit, index) => [hit.kind === 'note' ? `n:${hit.noteId}` : hit.sessionId, index]))
    for (const hit of memoryHits) {
      const bonus = Math.round(80 * (1 - (memoryRank.get(hit.kind === 'note' ? `n:${hit.noteId}` : hit.sessionId) ?? 0) / Math.max(1, memoryHits.length)))
      if (hit.kind === 'note') {
        if (query.includeNotes !== true) continue
        sources.add('memory-note')
        notes.push({ noteId: hit.noteId, project: hit.project, updatedAt: hit.updatedAt, sourceThread: hit.sourceThread, excerpt: clip(hit.text, needles) })
        continue
      }
      const record = byId.get(hit.sessionId)
      if (record === undefined) continue
      if (hit.kind === 'digest') {
        sources.add('memory-digest')
        mergeCandidate(candidates, record, {
          score: 430 + bonus + recency(record.updatedAt),
          snippet: clip(hit.text, needles),
          source: 'memory-digest',
          evidence: 'digest-match',
        })
        continue
      }
      sources.add('memory-message')
      mergeCandidate(candidates, record, {
        score: 410 + bonus + recency(record.updatedAt),
        snippet: clip(hit.text, needles),
        source: 'memory-message',
        evidence: 'text-match',
      })
    }

    const ranked = ordered(candidates.values())
    const hits = ranked.slice(offset, offset + limit).map(toHit)
    const nextOffset = offset + hits.length
    const degraded = content.failure === null ? [] : [content.failure]
    const diagnostics: ThreadFinderDiagnostics = {
      correlationId: id,
      elapsedMs: now() - startedAt,
      sources: [...sources],
      attempts: content.attempts,
      scannedSessions: records.length,
      incomplete: degraded.length > 0,
    }
    log({
      correlationId: id,
      queryChars: text.length,
      hits: hits.length,
      notes: notes.length,
      scannedSessions: records.length,
      attempts: content.attempts,
      degraded: degraded.map(entry => entry.code).join(',') || 'none',
      elapsedMs: diagnostics.elapsedMs,
    })
    if (hits.length === 0 && notes.length === 0 && degraded.length > 0)
      throw new ThreadFinderError(
        'search-unavailable',
        `Session content search is unavailable (${degraded[0]?.code ?? 'unknown'} after ${diagnostics.attempts} attempt(s)) and no session matched by title, workspace, or memory. Retry shortly or narrow the query.`,
      )
    return {
      hits,
      notes,
      nextCursor: nextOffset < ranked.length ? encodeCursor({ offset: nextOffset, stamp }) : null,
      degraded,
      diagnostics,
    }
  }

  const related = async (query: ThreadFinderRelatedQuery): Promise<ThreadFinderRelations> => {
    const limit = Math.max(1, Math.min(query.limit, 20))
    const startedAt = now()
    const id = correlationId()
    const records = await deps.listSessions(deps.signal)
    const scope = records.filter(record => query.projects.length === 0 || query.projects.includes(record.project))
    const seed = scope.find(record => record.sessionId === query.sessionId)
    if (seed === undefined) throw new ThreadFinderError('not-found', `No Session ${JSON.stringify(query.sessionId)} is visible in this scope.`)
    const parent = seed.parentSessionId === null ? undefined : scope.find(record => record.sessionId === seed.parentSessionId)
    const children = scope.filter(record => record.parentSessionId === seed.sessionId)
    const explicit = [...(parent === undefined ? [] : [parent]), ...children].map(record =>
      toHit({
        record,
        score: 1_000,
        snippet: record.title.length > 0 ? record.title : (record.cwd ?? record.sessionId),
        sources: ['session-metadata'],
        evidence: ['explicit-lineage'],
      }),
    )
    const explicitIds = new Set(explicit.map(hit => hit.sessionId))
    const seedText = `${seed.title} ${(await deps.readDigest(seed.sessionId).catch(() => null)) ?? ''}`
    const seedTerms = terms(seedText)
    const seedCwd = normalize(seed.cwd ?? '')
    const inferred: Candidate[] = []
    for (const record of scope) {
      if (record.sessionId === seed.sessionId || explicitIds.has(record.sessionId)) continue
      const shared = overlap(terms(record.title), seedTerms)
      const sameWorkspace = seedCwd.length > 0 && normalize(record.cwd ?? '') === seedCwd
      if (!sameWorkspace && shared.length === 0) continue
      const evidence: ThreadFinderEvidence[] = []
      if (sameWorkspace) evidence.push('shared-workspace')
      if (shared.length > 0) evidence.push('topic-candidate')
      inferred.push({
        record,
        score: (sameWorkspace ? 300 : 100) + Math.round(200 * (shared.length / Math.max(1, seedTerms.length))),
        snippet: record.title.length > 0 ? record.title : (record.cwd ?? record.sessionId),
        sources: ['session-metadata'],
        evidence,
      })
    }
    const diagnostics: ThreadFinderDiagnostics = {
      correlationId: id,
      elapsedMs: now() - startedAt,
      sources: ['session-metadata'],
      attempts: 0,
      scannedSessions: scope.length,
      incomplete: false,
    }
    log({ correlationId: id, operation: 'related', explicit: explicit.length, inferred: inferred.length, elapsedMs: diagnostics.elapsedMs })
    return {
      seed: toHit({
        record: seed,
        score: 0,
        snippet: seed.title.length > 0 ? seed.title : (seed.cwd ?? seed.sessionId),
        sources: ['session-metadata'],
        evidence: [],
      }),
      explicit,
      inferred: ordered(inferred).slice(0, limit).map(toHit),
      degraded: [],
      diagnostics,
    }
  }

  return { find, related }
}

export type ThreadFinder = ReturnType<typeof createThreadFinder>
