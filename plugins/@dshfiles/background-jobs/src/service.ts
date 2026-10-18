import { JobId } from '@deepseek-ai/dsh-jobs/brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { classifyJob, type JobCategory } from './classify.js'
import type { JobHistorySource } from './history.js'
import { LiveJobs, type JobRegistrySurface } from './live.js'
import type { HistoryJob, JobBoard, JobBoardFilter, JobIndexing, JobKill, JobOutput, JobRow, JobSession } from './types.js'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200
const MAX_OUTPUT_CHUNK = 20_000
const MAX_OUTPUT_CHUNKS = 200
const KILL_REASON = 'stopped from the Background jobs board'

type CategoryCounts = Record<JobCategory, number>

const emptyCounts = () =>
  ({
    tests: 0,
    typecheck: 0,
    'lint-format': 0,
    build: 0,
    'install-deps': 0,
    vcs: 0,
    inspect: 0,
    scripts: 0,
    process: 0,
    files: 0,
    dsh: 0,
    workflow: 0,
    terminal: 0,
    other: 0,
  }) satisfies CategoryCounts

const isLiveStatus = (status: JobRow['status']): boolean => status === 'running' || status === 'stopping'

/** A recorded job whose process died never finished; it is neither running nor done. */
const isTerminalStatus = (status: JobRow['status']): boolean => status === 'completed' || status === 'killed' || status === 'failed'

const boundedText = (text: string): string => (text.length > MAX_OUTPUT_CHUNK ? text.slice(0, MAX_OUTPUT_CHUNK) : text)

export interface JobsBoardOptions {
  readonly history: JobHistorySource
  readonly now?: () => number
}

interface RankedRow {
  readonly row: JobRow
  readonly rank: 0 | 1
}

const cursorOf = (ranked: RankedRow): string => `${String(ranked.rank)}:${String(ranked.row.startedAt)}:${ranked.row.id}`

const parseCursor = (cursor: string): { readonly rank: number; readonly startedAt: number; readonly id: string } | null => {
  const [rank, startedAt, ...rest] = cursor.split(':')
  const id = rest.join(':')
  const rankValue = Number(rank)
  const startedAtValue = Number(startedAt)
  if (id.length === 0 || !Number.isSafeInteger(rankValue) || !Number.isSafeInteger(startedAtValue)) return null
  return { rank: rankValue, startedAt: startedAtValue, id }
}

const isAfterCursor = (ranked: RankedRow, cursor: { readonly rank: number; readonly startedAt: number; readonly id: string }): boolean => {
  if (ranked.rank !== cursor.rank) return ranked.rank > cursor.rank
  if (ranked.row.startedAt !== cursor.startedAt) return ranked.row.startedAt < cursor.startedAt
  return ranked.row.id > cursor.id
}

const matchesSearch = (row: JobRow, needle: string): boolean =>
  row.label.toLowerCase().includes(needle) ||
  row.kind.toLowerCase().includes(needle) ||
  row.id.toLowerCase().includes(needle) ||
  row.status.toLowerCase().includes(needle) ||
  (row.detail ?? '').toLowerCase().includes(needle)

const categoryOf = (job: { readonly kind: string; readonly label: string }): JobCategory => classifyJob({ kind: job.kind, label: job.label })

const rowFromHistory = (job: HistoryJob): JobRow => ({
  id: job.id,
  kind: job.kind,
  label: job.label,
  owner: job.owner,
  status: job.settled ? (job.status ?? 'completed') : 'interrupted',
  progress: null,
  detail: job.detail,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
  durationMs: job.finishedAt === null ? null : Math.max(0, job.finishedAt - job.startedAt),
  category: categoryOf(job),
  live: false,
  outputTotal: 0,
  spillPaths: [],
})

export class JobsBoard {
  private readonly history: JobHistorySource
  private readonly now: () => number
  private registry: JobRegistrySurface | null = null
  private live: LiveJobs | null = null
  private cachedRows: readonly JobRow[] | null = null

  constructor(options: JobsBoardOptions) {
    this.history = options.history
    this.now = options.now ?? (() => Date.now())
  }

  attachLive(registry: JobRegistrySurface): void {
    this.live?.dispose()
    this.registry = registry
    this.live = new LiveJobs({ registry, onChange: () => this.invalidate() })
    this.live.start()
    this.invalidate()
  }

  detachLive(): void {
    this.live?.dispose()
    this.live = null
    this.registry = null
    this.invalidate()
  }

  /** Drop the merged rows; the next read rebuilds them from history and live state. */
  invalidate(): void {
    this.cachedRows = null
  }

  get liveAvailable(): boolean {
    return this.live !== null
  }

  indexing(): JobIndexing {
    return this.history.indexing
  }

  /** Every row this Host can describe: this process's live jobs plus what the logs recorded. */
  rows(): readonly JobRow[] {
    if (this.cachedRows !== null) return this.cachedRows
    const merged = new Map<string, JobRow>()
    for (const job of this.history.historyRows) merged.set(job.id, rowFromHistory(job))
    for (const view of this.live?.values() ?? []) {
      merged.set(view.id, {
        id: view.id,
        kind: view.kind,
        label: view.label,
        owner: view.owner ?? null,
        status: view.status,
        progress: view.progress ?? null,
        detail: view.detail ?? null,
        startedAt: view.startedAt,
        finishedAt: view.finishedAt ?? null,
        durationMs: view.finishedAt === undefined ? null : Math.max(0, view.finishedAt - view.startedAt),
        category: categoryOf({ kind: view.kind, label: view.label }),
        live: true,
        outputTotal: view.output.total,
        spillPaths: [...(view.output.spillPaths ?? [])],
      })
    }
    this.cachedRows = [...merged.values()]
    return this.cachedRows
  }

  board(filter: JobBoardFilter): JobBoard {
    const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const needle = filter.search?.toLowerCase() ?? null
    const categories = filter.categories === undefined || filter.categories.length === 0 ? null : new Set<JobCategory>(filter.categories)
    const base = this.rows().filter(row => {
      if (filter.sessionId !== undefined && row.owner !== filter.sessionId) return false
      if (needle !== null && !matchesSearch(row, needle)) return false
      return true
    })
    const categoryCounts = emptyCounts()
    for (const row of base) categoryCounts[row.category] += 1
    const scopedByCategory = categories === null ? base : base.filter(row => categories.has(row.category))
    const runningCount = scopedByCategory.filter(row => isLiveStatus(row.status)).length
    const finishedCount = scopedByCategory.filter(row => isTerminalStatus(row.status)).length
    const inScope = scopedByCategory.filter(row => {
      if (filter.scope === 'running') return isLiveStatus(row.status)
      if (filter.scope === 'finished') return isTerminalStatus(row.status)
      return true
    })
    const ranked = inScope
      .map((row): RankedRow => ({ row, rank: isLiveStatus(row.status) ? 0 : 1 }))
      .sort((left, right) =>
        left.rank === right.rank
          ? right.row.startedAt - left.row.startedAt || (left.row.id < right.row.id ? -1 : left.row.id > right.row.id ? 1 : 0)
          : left.rank - right.rank,
      )
    const cursor = filter.cursor === undefined ? null : parseCursor(filter.cursor)
    const remaining = cursor === null ? ranked : ranked.filter(entry => isAfterCursor(entry, cursor))
    const page = remaining.slice(0, limit)
    const hasMore = remaining.length > page.length
    const lastPageEntry = page[page.length - 1]
    return {
      rows: page.map(entry => entry.row),
      total: inScope.length,
      hasMore,
      nextCursor: hasMore && lastPageEntry !== undefined ? cursorOf(lastPageEntry) : null,
      categoryCounts,
      runningCount,
      finishedCount,
      sessions: this.sessionsOf(base),
      indexing: this.indexing(),
      liveAvailable: this.liveAvailable,
      generatedAt: this.now(),
    }
  }

  private sessionsOf(rows: readonly JobRow[]): JobSession[] {
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (row.owner === null) continue
      counts.set(row.owner, (counts.get(row.owner) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 200)
      .map(([id]) => this.history.sessionOf(id) ?? { id, title: null, cwd: null, project: null })
  }

  output({ jobId, from }: { readonly jobId: string; readonly from: number }): JobOutput {
    const row = this.rows().find(candidate => candidate.id === jobId)
    if (row === undefined) {
      return { jobId, available: false, reason: 'No such job is retained on this Host.', chunks: [], next: from, lossy: false, spilled: [] }
    }
    const registry = this.registry
    if (registry === null || !row.live) {
      return {
        jobId,
        available: false,
        reason: 'This job ran in an earlier DSH process; only its lifecycle record was retained.',
        chunks: [],
        next: 0,
        lossy: false,
        spilled: row.spillPaths,
      }
    }
    const owner = row.owner === null ? undefined : SessionId(row.owner)
    const read = registry.readAt(JobId(jobId), from, owner)
    return {
      jobId,
      available: true,
      reason: null,
      chunks: read.chunks.slice(0, MAX_OUTPUT_CHUNKS).map(chunk => ({
        at: chunk.at,
        channel: chunk.channel ?? null,
        text: boundedText(chunk.text),
      })),
      next: read.next,
      lossy: read.lossy,
      spilled: row.spillPaths,
    }
  }

  kill({ jobId }: { readonly jobId: string }): JobKill {
    const row = this.rows().find(candidate => candidate.id === jobId)
    if (row === undefined) throw new Error('No such job is retained on this Host.')
    const registry = this.registry
    if (registry === null || !row.live) return { jobId, outcome: 'already-finished' }
    return { jobId, outcome: registry.kill(JobId(jobId), row.owner === null ? undefined : SessionId(row.owner), KILL_REASON) }
  }
}
