import { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { JobView } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Clock, Context, Effect, Layer, Option, Ref, Stream } from 'effect'
import { boundedLabel, clampText, MAX_DETAIL_LENGTH, MAX_KIND_LENGTH, MAX_PROGRESS_LENGTH, MAX_SPILL_PATHS, MAX_SPILL_PATH_LENGTH } from './bounds.js'
import { classifyJob, type JobCategory } from './classify.js'
import { JobKillFailed, JobNotFound } from './errors.js'
import { HistoryIndex, type HistorySnapshot } from './history.js'
import { LiveJobs, type LiveJobsState } from './live.js'
import { OutlivedJobs } from './outlived.js'
import type { HistoryJob, JobBoard, JobBoardFilter, JobIndexing, JobKill, JobOutput, JobRow, JobSession, JobWait, JobWaitInput } from './types.js'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200
const MAX_OUTPUT_CHUNK = 20_000
const MAX_OUTPUT_CHUNKS = 200
const KILL_REASON = 'stopped from the Background jobs board'
const WAIT_DEFAULT_TIMEOUT_MS = 300_000

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
  outlivedSince: null,
})

/**
 * A live view is producer-supplied and unbounded: a `bash` label is the whole
 * command line, a `pty-send` label is everything the Session typed. Clamp at
 * this boundary so one oversized producer cannot fail the whole board read.
 */
const rowFromLive = (view: JobView): JobRow => {
  const kind = clampText({ text: view.kind, limit: MAX_KIND_LENGTH })
  const label = boundedLabel(view.label)
  return {
    id: view.id,
    kind,
    label,
    owner: view.owner ?? null,
    status: view.status,
    progress: view.progress === undefined ? null : clampText({ text: view.progress, limit: MAX_PROGRESS_LENGTH }),
    detail: view.detail === undefined ? null : clampText({ text: view.detail, limit: MAX_DETAIL_LENGTH }),
    startedAt: view.startedAt,
    finishedAt: view.finishedAt ?? null,
    durationMs: view.finishedAt === undefined ? null : Math.max(0, view.finishedAt - view.startedAt),
    category: classifyJob({ kind, label }),
    live: true,
    outputTotal: view.output.total,
    spillPaths: (view.output.spillPaths ?? []).slice(0, MAX_SPILL_PATHS).map(path => clampText({ text: path, limit: MAX_SPILL_PATH_LENGTH })),
    outlivedSince: null,
  }
}

interface CachedRow {
  /** The immutable record the row was derived from; a different object means the row is stale. */
  readonly source: HistoryJob | JobView
  readonly row: JobRow
}

interface MergedRows {
  readonly historyJobs: ReadonlyMap<string, HistoryJob>
  readonly liveViews: ReadonlyMap<string, JobView>
  readonly rows: readonly JobRow[]
  readonly byJobId: ReadonlyMap<string, CachedRow>
}

const rowOf = (input: { readonly history: HistorySnapshot; readonly live: LiveJobsState; readonly jobId: string }): JobRow | undefined => {
  const view = input.live.views.get(input.jobId)
  if (view !== undefined) return rowFromLive(view)
  const job = input.history.jobs.get(input.jobId)
  return job === undefined ? undefined : rowFromHistory(job)
}

const waitTargetsOf = (input: { readonly history: HistorySnapshot; readonly live: LiveJobsState; readonly targets: readonly string[] }): JobWait['jobs'] =>
  input.targets.map(jobId => {
    const row = rowOf({ history: input.history, live: input.live, jobId })
    return {
      jobId,
      status: row?.status ?? null,
      settled: row === undefined || !isLiveStatus(row.status),
      label: row?.label ?? null,
      category: row?.category ?? null,
    }
  })

export class JobsBoard extends Context.Service<
  JobsBoard,
  {
    readonly board: (filter: JobBoardFilter) => Effect.Effect<JobBoard>
    readonly output: (input: { readonly jobId: string; readonly from: number }) => Effect.Effect<JobOutput>
    readonly kill: (input: { readonly jobId: string }) => Effect.Effect<JobKill, JobNotFound | JobKillFailed>
    /**
     * Block on job settlement instead of making the model poll: what it replaces is a model turn per
     * `job_output` call, which one week measured at 293 identical back-to-back calls in 74 Sessions.
     */
    readonly wait: (input: JobWaitInput) => Effect.Effect<JobWait>
    readonly refresh: Effect.Effect<JobIndexing>
    /** One element per change of the live jobs or the indexed history, without the current state. */
    readonly changes: Stream.Stream<void>
  }
>()('@dshfiles/background-jobs/JobsBoard') {
  static readonly layer = Layer.effect(
    JobsBoard,
    Effect.gen(function* () {
      const history = yield* HistoryIndex
      const live = yield* LiveJobs
      const outlived = yield* OutlivedJobs
      const merged = yield* Ref.make<Option.Option<MergedRows>>(Option.none())

      const states = Effect.all({ history: history.snapshot, live: live.state })

      const rowsOf = Effect.fnUntraced(function* (input: { readonly history: HistorySnapshot; readonly live: LiveJobsState }) {
        const cached = yield* Ref.get(merged)
        if (Option.isSome(cached) && cached.value.historyJobs === input.history.jobs && cached.value.liveViews === input.live.views) return cached.value.rows
        // A live event or an indexing pass replaces only the records it changed, so a row whose record
        // is still that same object is still current. Rebuilding every row here costs ~40ms at the
        // 20_000-row cap, which is what a board read following any job event used to pay.
        const previous = Option.getOrElse(cached, () => null)
        const byJobId = new Map<string, CachedRow>()
        const reuse = (source: HistoryJob | JobView, build: () => JobRow): JobRow => {
          const known = previous?.byJobId.get(source.id)
          const row = known !== undefined && known.source === source ? known.row : build()
          byJobId.set(source.id, { source, row })
          return row
        }
        for (const job of input.history.jobs.values()) reuse(job, () => rowFromHistory(job))
        for (const view of input.live.views.values()) reuse(view, () => rowFromLive(view))
        const rows = [...byJobId.values()].map(entry => entry.row)
        yield* Ref.set(merged, Option.some({ historyJobs: input.history.jobs, liveViews: input.live.views, rows, byJobId }))
        return rows
      })

      const sessionsOf = (input: { readonly history: HistorySnapshot; readonly rows: readonly JobRow[] }): JobSession[] => {
        const counts = new Map<string, number>()
        for (const row of input.rows) {
          if (row.owner === null) continue
          counts.set(row.owner, (counts.get(row.owner) ?? 0) + 1)
        }
        return [...counts.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 200)
          .map(([id]) => input.history.sessions.get(id) ?? { id, title: null, cwd: null, project: null })
      }

      const board = Effect.fn('background-jobs board')(function* (filter: JobBoardFilter) {
        const current = yield* states
        const outlivedSince = yield* outlived.current
        const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
        const needle = filter.search?.toLowerCase() ?? null
        const categories = filter.categories === undefined || filter.categories.length === 0 ? null : new Set<JobCategory>(filter.categories)
        const base = (yield* rowsOf(current)).filter(row => {
          if (filter.sessionId !== undefined && row.owner !== filter.sessionId) return false
          return needle === null || matchesSearch(row, needle)
        })
        const categoryCounts = emptyCounts()
        for (const row of base) categoryCounts[row.category] += 1
        const scopedByCategory = categories === null ? base : base.filter(row => categories.has(row.category))
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
        const lastPageEntry = page.at(-1)
        return {
          rows: page.map(entry => {
            const since = outlivedSince.get(entry.row.id)
            return since === undefined ? entry.row : { ...entry.row, outlivedSince: since }
          }),
          total: inScope.length,
          hasMore,
          nextCursor: hasMore && lastPageEntry !== undefined ? cursorOf(lastPageEntry) : null,
          categoryCounts,
          runningCount: scopedByCategory.filter(row => isLiveStatus(row.status)).length,
          finishedCount: scopedByCategory.filter(row => isTerminalStatus(row.status)).length,
          sessions: sessionsOf({ history: current.history, rows: base }),
          indexing: current.history.indexing,
          liveAvailable: Option.isSome(current.live.registry),
          generatedAt: yield* Clock.currentTimeMillis,
        }
      })

      const output = Effect.fn('background-jobs output')(function* (input: { readonly jobId: string; readonly from: number }) {
        const current = yield* states
        const row = rowOf({ ...current, jobId: input.jobId })
        if (row === undefined) {
          return {
            jobId: input.jobId,
            available: false,
            reason: 'No such job is retained on this Host.',
            chunks: [],
            next: input.from,
            lossy: false,
            spilled: [],
          }
        }
        if (Option.isNone(current.live.registry) || !row.live) {
          return {
            jobId: input.jobId,
            available: false,
            reason: 'This job ran in an earlier DSH process; only its lifecycle record was retained.',
            chunks: [],
            next: 0,
            lossy: false,
            spilled: row.spillPaths,
          }
        }
        const registry = current.live.registry.value
        const read = registry.readAt(JobId(input.jobId), input.from, row.owner === null ? undefined : SessionId(row.owner))
        return {
          jobId: input.jobId,
          available: true,
          reason: null,
          chunks: read.chunks.slice(0, MAX_OUTPUT_CHUNKS).map(chunk => ({ at: chunk.at, channel: chunk.channel ?? null, text: boundedText(chunk.text) })),
          next: read.next,
          lossy: read.lossy,
          spilled: row.spillPaths,
        }
      })

      const kill = Effect.fn('background-jobs kill')(function* (input: { readonly jobId: string }) {
        const current = yield* states
        const row = rowOf({ ...current, jobId: input.jobId })
        if (row === undefined) return yield* new JobNotFound({ jobId: input.jobId })
        if (Option.isNone(current.live.registry) || !row.live) return { jobId: input.jobId, outcome: 'already-finished' } satisfies JobKill
        const registry = current.live.registry.value
        const outcome = yield* Effect.try({
          try: () => registry.kill(JobId(input.jobId), row.owner === null ? undefined : SessionId(row.owner), KILL_REASON),
          catch: cause => new JobKillFailed({ jobId: input.jobId, cause }),
        })
        return { jobId: input.jobId, outcome } satisfies JobKill
      })

      const updates = Stream.merge(Stream.as(history.changes, undefined), Stream.as(live.changes, undefined))
      const changed = Stream.mergeAll(
        [history.changes.pipe(Stream.drop(1), Stream.as(undefined)), live.changes.pipe(Stream.drop(1), Stream.as(undefined)), outlived.changes],
        {
          concurrency: 'unbounded',
        },
      )

      const wait = Effect.fn('background-jobs wait')(function* (input: JobWaitInput) {
        const until = input.until ?? 'settled'
        const timeoutMs = input.timeoutMs ?? WAIT_DEFAULT_TIMEOUT_MS
        const startedAt = yield* Clock.currentTimeMillis
        const requested = input.jobIds ?? []
        const targets =
          requested.length > 0 ? [...new Set(requested)] : (yield* rowsOf(yield* states)).filter(row => isLiveStatus(row.status)).map(row => row.id)
        const isSettled = (jobs: JobWait['jobs']) => (until === 'any-settled' ? jobs.some(job => job.settled) : jobs.every(job => job.settled))
        const snapshot = Effect.map(states, current => waitTargetsOf({ ...current, targets }))
        const reached =
          targets.length === 0
            ? Option.none<JobWait['jobs']>()
            : Option.flatten(
                yield* updates.pipe(
                  Stream.mapEffect(() => snapshot),
                  Stream.filter(isSettled),
                  Stream.runHead,
                  Effect.timeoutOption(timeoutMs),
                ),
              )
        const jobs = Option.isSome(reached) ? reached.value : yield* snapshot
        return {
          startedAt,
          waitedMs: Math.max(0, (yield* Clock.currentTimeMillis) - startedAt),
          timeoutMs,
          until,
          timedOut: targets.length > 0 && !isSettled(jobs),
          jobs,
          running: jobs.filter(job => !job.settled).map(job => job.jobId),
        }
      })

      return JobsBoard.of({ board, output, kill, wait, refresh: history.pass, changes: changed })
    }),
  )
}
