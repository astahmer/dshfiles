import { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { JobEvent, JobView } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import type { JobHistorySource } from './history.js'
import { JobsBoard } from './service.js'
import type { HistoryJob, JobIndexing, JobSession } from './types.js'
import { jobBoardSchema } from './types.js'

const indexing: JobIndexing = { active: false, caughtUp: true, files: 1, indexedFiles: 1, historyRows: 0, lastIndexedAt: 1, lastError: null }

const historySource = (jobs: readonly HistoryJob[], sessions: readonly JobSession[] = []): JobHistorySource => ({
  historyRows: jobs,
  indexing: { ...indexing, historyRows: jobs.length },
  sessionOf: (sessionId: string | null) => sessions.find(session => session.id === sessionId) ?? null,
})

const historyJob = (overrides: Partial<HistoryJob> & { readonly id: string }): HistoryJob => ({
  kind: 'bash',
  label: 'pnpm test',
  owner: 'session-aaaa',
  startedAt: 1_000,
  settled: true,
  status: 'completed',
  cause: 'producer',
  detail: 'exit code: 0',
  finishedAt: 2_000,
  ...overrides,
})

const jobId = (id: string): JobId => JobId(id)

const sessionId = (id: string): SessionId => SessionId(id)

const liveView = (overrides: Partial<JobView> & { readonly id: JobId }): JobView => ({
  kind: 'bash',
  label: 'pnpm check:e2e',
  owner: sessionId('session-bbbb'),
  status: 'running',
  startedAt: 3_000,
  output: { total: 0, earliest: 0 },
  ...overrides,
})

const registryStub = (options: { readonly chunks?: readonly { readonly at: number; readonly text: string }[] } = {}) => {
  let listener: (event: JobEvent) => void = () => undefined
  const calls: string[] = []
  return {
    calls,
    events: {
      subscribe: (filter: { readonly owners: 'all' }, next: (event: JobEvent) => void): (() => void) => {
        calls.push(`subscribe:${filter.owners}`)
        listener = next
        return () => {
          listener = () => undefined
        }
      },
    },
    emit: (event: JobEvent): void => listener(event),
    readAt: (id: string, from: number, caller?: string) => {
      calls.push(`readAt:${id}:${String(from)}:${caller ?? 'none'}`)
      return { chunks: options.chunks ?? [], next: from + 1, lossy: false }
    },
    kill: (id: string, caller?: string, reason?: string) => {
      calls.push(`kill:${id}:${caller ?? 'none'}:${reason ?? ''}`)
      return 'requested' as const
    },
  }
}

describe('background jobs board', () => {
  it('lists running jobs before finished ones and pages with a cursor', () => {
    const board = new JobsBoard({
      history: historySource([
        historyJob({ id: 'bash-1', startedAt: 5_000, finishedAt: 6_000 }),
        historyJob({ id: 'bash-2', startedAt: 4_000, finishedAt: 5_000 }),
      ]),
      now: () => 10_000,
    })
    const registry = registryStub()
    board.attachLive(registry)
    registry.emit({ type: 'registered', job: liveView({ id: jobId('bash-live'), startedAt: 9_000 }) })

    const first = board.board({ scope: 'all', limit: 2 })
    expect(first.rows.map(row => row.id)).toEqual(['bash-live', 'bash-1'])
    expect(first.hasMore).toBe(true)
    expect(first.runningCount).toBe(1)
    expect(first.finishedCount).toBe(2)

    const second = board.board({ scope: 'all', limit: 2, cursor: first.nextCursor ?? undefined })
    expect(second.rows.map(row => row.id)).toEqual(['bash-2'])
    expect(second.hasMore).toBe(false)
  })

  it('counts and filters by the category derived from the command', () => {
    const board = new JobsBoard({
      history: historySource([
        historyJob({ id: 'bash-tests', label: 'cd /x && pnpm test' }),
        historyJob({ id: 'bash-vcs', label: 'cd /x && jj log -r main' }),
        historyJob({ id: 'bash-vcs2', label: 'jj workspace list' }),
      ]),
    })
    const counts = board.board({ scope: 'all' }).categoryCounts
    expect(counts.tests).toBe(1)
    expect(counts.vcs).toBe(2)

    const filtered = board.board({ scope: 'all', categories: ['vcs'] })
    expect(filtered.rows.map(row => row.id).sort()).toEqual(['bash-vcs', 'bash-vcs2'])
    expect(filtered.categoryCounts.tests).toBe(1)
  })

  it('searches labels, ids and status detail', () => {
    const board = new JobsBoard({
      history: historySource([
        historyJob({ id: 'bash-a', label: 'grep -rn "danger" src/' }),
        historyJob({ id: 'bash-b', label: 'pnpm build', detail: 'exit code: 1', status: 'failed' }),
      ]),
    })
    expect(board.board({ scope: 'all', search: 'danger' }).rows.map(row => row.id)).toEqual(['bash-a'])
    expect(board.board({ scope: 'all', search: 'bash-b' }).rows.map(row => row.id)).toEqual(['bash-b'])
    expect(board.board({ scope: 'all', search: 'exit code: 1' }).rows.map(row => row.id)).toEqual(['bash-b'])
  })

  it('marks a recorded job without a settlement as interrupted until a live twin overrides it', () => {
    const board = new JobsBoard({
      history: historySource([historyJob({ id: 'bash-open', settled: false, status: null, detail: null, finishedAt: null })]),
    })
    expect(board.board({ scope: 'all' }).rows[0]?.status).toBe('interrupted')
    expect(board.board({ scope: 'running' }).rows).toHaveLength(0)
    expect(board.board({ scope: 'finished' }).rows).toHaveLength(0)
    expect(board.board({ scope: 'all' }).finishedCount).toBe(0)

    const registry = registryStub()
    board.attachLive(registry)
    registry.emit({ type: 'registered', job: liveView({ id: jobId('bash-open'), startedAt: 1_000 }) })
    const live = board.board({ scope: 'running' }).rows[0]
    expect(live?.status).toBe('running')
    expect(live?.live).toBe(true)

    registry.emit({
      type: 'settled',
      job: liveView({ id: jobId('bash-open'), startedAt: 1_000, status: 'killed', finishedAt: 4_000 }),
      cause: 'kill',
      awaited: false,
    })
    expect(board.board({ scope: 'all' }).rows[0]?.status).toBe('killed')
  })

  it('reads a live job output as its owner and refuses output from an earlier process', () => {
    const board = new JobsBoard({ history: historySource([historyJob({ id: 'bash-old' })]) })
    expect(board.output({ jobId: 'bash-old', from: 0 })).toMatchObject({ available: false })

    const registry = registryStub({ chunks: [{ at: 0, text: 'hello' }] })
    board.attachLive(registry)
    registry.emit({ type: 'registered', job: liveView({ id: jobId('bash-now'), owner: sessionId('session-cccc') }) })
    const output = board.output({ jobId: 'bash-now', from: 0 })
    expect(output.available).toBe(true)
    expect(output.chunks).toEqual([{ at: 0, channel: null, text: 'hello' }])
    expect(registry.calls).toContain('readAt:bash-now:0:session-cccc')
  })

  it('kills a running job as its owner and reports a settled one as already finished', () => {
    const board = new JobsBoard({ history: historySource([historyJob({ id: 'bash-done' })]) })
    const registry = registryStub()
    board.attachLive(registry)
    registry.emit({ type: 'registered', job: liveView({ id: jobId('bash-now'), owner: sessionId('session-dddd') }) })

    expect(board.kill({ jobId: 'bash-now' })).toEqual({ jobId: 'bash-now', outcome: 'requested' })
    expect(registry.calls.some(call => call.startsWith('kill:bash-now:session-dddd:'))).toBe(true)
    expect(board.kill({ jobId: 'bash-done' })).toEqual({ jobId: 'bash-done', outcome: 'already-finished' })
    expect(() => board.kill({ jobId: 'missing' })).toThrow()
  })

  it('reports the recorded session title for rows it lists', () => {
    const board = new JobsBoard({
      history: historySource(
        [historyJob({ id: 'bash-1', owner: 'session-eeee' })],
        [{ id: 'session-eeee', title: 'Fix the delayed rebase button', cwd: '/x', project: '/x' }],
      ),
    })
    expect(board.board({ scope: 'all' }).sessions).toEqual([{ id: 'session-eeee', title: 'Fix the delayed rebase button', cwd: '/x', project: '/x' }])
  })

  it('clamps an unbounded live view to the wire bounds so the board still parses', () => {
    const board = new JobsBoard({ history: historySource([]) })
    const registry = registryStub()
    board.attachLive(registry)
    registry.emit({
      type: 'registered',
      job: liveView({
        id: jobId('bash-huge'),
        kind: `bash${'x'.repeat(200)}`,
        label: `pnpm test${'\r'.repeat(3)}\n${'y'.repeat(5_000)}`,
        progress: 'p'.repeat(1_000),
        detail: 'd'.repeat(1_000),
        output: { total: 7, earliest: 0, spillPaths: Array.from({ length: 12 }, (_, index) => `${String(index)}-${'z'.repeat(1_500)}`) },
      }),
    })

    const parsed = jobBoardSchema.safeParse(board.board({ scope: 'all' }))
    expect(parsed.success).toBe(true)
    const row = board.board({ scope: 'all' }).rows[0]
    expect(row?.label).toHaveLength(2_000)
    expect(row?.label.includes('\r')).toBe(false)
    expect(row?.kind).toHaveLength(64)
    expect(row?.progress).toHaveLength(300)
    expect(row?.detail).toHaveLength(500)
    expect(row?.spillPaths).toHaveLength(8)
    expect(row?.category).toBe('tests')
  })

  it('keeps listing live jobs after the registry settles one', () => {
    const board = new JobsBoard({ history: historySource([]) })
    const registry = registryStub()
    board.attachLive(registry)
    registry.emit({ type: 'registered', job: liveView({ id: jobId('bash-xyz') }) })
    expect(board.board({ scope: 'running' }).rows).toHaveLength(1)
    registry.emit({ type: 'output', id: jobId('bash-xyz'), owner: sessionId('session-bbbb'), total: 42 })
    expect(board.board({ scope: 'running' }).rows[0]?.outputTotal).toBe(42)
    registry.emit({ type: 'removed', job: liveView({ id: jobId('bash-xyz') }) })
    expect(board.board({ scope: 'running' }).rows).toHaveLength(0)
  })
})
