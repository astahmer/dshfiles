import { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { JobEvent, JobView } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Fiber, FileSystem, Layer, Option, Path, Schema, Stream, SubscriptionRef } from 'effect'
import { TestClock } from 'effect/testing'
import { HistoryConfig, HistoryIndex } from './history.js'
import { JobRegistry, type JobRegistrySurface, LiveJobs } from './live.js'
import { JobsBoard } from './service.js'
import { type HistoryJob, jobBoardSchema } from './types.js'

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

const logLine = (type: string, data: Readonly<Record<string, string | number | boolean | null>>): string => `${JSON.stringify({ type, data })}\n`

const logOf = (input: { readonly jobs: readonly HistoryJob[]; readonly title?: string }): string =>
  (input.title === undefined ? '' : logLine('session/title', { title: input.title })) +
  input.jobs
    .map(job => {
      const base = { jobId: job.id, kind: job.kind, label: job.label, startedAt: job.startedAt, ...(job.owner !== null && { owner: job.owner }) }
      const registered = logLine('job/registered', base)
      if (!job.settled) return registered
      return (
        registered +
        logLine('job/settled', {
          ...base,
          finishedAt: job.finishedAt,
          status: job.status,
          cause: job.cause,
          ...(job.detail !== null && { detail: job.detail }),
        })
      )
    })
    .join('')

const liveView = (overrides: Partial<JobView> & { readonly id: JobId }): JobView => ({
  kind: 'bash',
  label: 'pnpm check:e2e',
  owner: SessionId('session-bbbb'),
  status: 'running',
  startedAt: 3_000,
  output: { total: 0, earliest: 0 },
  ...overrides,
})

/** The DSH job registry is an external system: this stand-in records the fenced calls and delivers events on demand. */
const registryStub = (options: { readonly chunks?: readonly { readonly at: number; readonly text: string }[]; readonly killFails?: boolean } = {}) => {
  const listeners = new Set<(event: JobEvent) => void>()
  const calls: string[] = []
  const surface: JobRegistrySurface = {
    events: {
      subscribe: (filter, listener) => {
        calls.push(`subscribe:${filter.owners}`)
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    readAt: (id, from, caller) => {
      calls.push(`readAt:${id}:${String(from)}:${caller ?? 'none'}`)
      return { chunks: options.chunks ?? [], next: from + 1, lossy: false }
    },
    kill: (id, caller, reason) => {
      if (options.killFails === true) throw new Error('registry refused the kill')
      calls.push(`kill:${id}:${caller ?? 'none'}:${reason ?? ''}`)
      return 'requested'
    },
  }
  return { surface, calls, emit: (event: JobEvent) => listeners.forEach(listener => listener(event)) }
}

type RegistryStub = ReturnType<typeof registryStub>

const makeBoard = Effect.fn(function* (input: { readonly jobs?: readonly HistoryJob[]; readonly title?: string; readonly registry?: RegistryStub }) {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'background-jobs-board-' })
  const sessionDirectory = path.join(root, 'project', 'session-aaaa')
  yield* fileSystem.makeDirectory(sessionDirectory, { recursive: true })
  yield* fileSystem.writeFileString(
    path.join(sessionDirectory, 'session.v4.jsonl'),
    logOf({ jobs: input.jobs ?? [], ...(input.title !== undefined && { title: input.title }) }),
  )
  const registry = yield* SubscriptionRef.make(Option.fromUndefinedOr(input.registry?.surface))
  const context = yield* Layer.build(
    JobsBoard.layer.pipe(
      Layer.provideMerge(LiveJobs.layer),
      Layer.provideMerge(HistoryIndex.layer),
      Layer.provide([
        HistoryConfig.layer({ root, statePath: path.join(root, 'state.json') }),
        Layer.succeed(JobRegistry, JobRegistry.of({ changes: SubscriptionRef.changes(registry) })),
      ]),
    ),
  )
  const board = Context.get(context, JobsBoard)
  const live = Context.get(context, LiveJobs)
  const applied = (until: (revision: number) => boolean) =>
    live.changes.pipe(
      Stream.filter(state => until(state.revision)),
      Stream.runHead,
    )
  yield* board.refresh
  yield* applied(revision => revision >= 1)
  return {
    board,
    attach: Effect.fn(function* (stub: RegistryStub) {
      const before = (yield* live.state).revision
      yield* SubscriptionRef.set(registry, Option.some(stub.surface))
      yield* applied(revision => revision > before)
    }),
    emit: Effect.fn(function* (stub: RegistryStub, event: JobEvent) {
      const before = (yield* live.state).revision
      stub.emit(event)
      yield* applied(revision => revision > before)
    }),
  }
})

describe('background jobs board', () => {
  it.layer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))(it => {
    it.effect('lists running jobs before finished ones and pages with a cursor', () =>
      Effect.gen(function* () {
        const registry = registryStub()
        const fixture = yield* makeBoard({
          jobs: [historyJob({ id: 'bash-1', startedAt: 5_000, finishedAt: 6_000 }), historyJob({ id: 'bash-2', startedAt: 4_000, finishedAt: 5_000 })],
          registry,
        })
        yield* fixture.emit(registry, { type: 'registered', job: liveView({ id: JobId('bash-live'), startedAt: 9_000 }) })

        const first = yield* fixture.board.board({ scope: 'all', limit: 2 })
        expect(first.rows.map(row => row.id)).toEqual(['bash-live', 'bash-1'])
        expect(first).toMatchObject({ hasMore: true, runningCount: 1, finishedCount: 2, liveAvailable: true })

        const second = yield* fixture.board.board({ scope: 'all', limit: 2, cursor: first.nextCursor ?? undefined })
        expect(second.rows.map(row => row.id)).toEqual(['bash-2'])
        expect(second.hasMore).toBe(false)
      }),
    )

    it.effect('signals every live job change so the Host can tell browsers to read the board again', () =>
      Effect.gen(function* () {
        const registry = registryStub()
        const fixture = yield* makeBoard({ registry })
        const signals = yield* fixture.board.changes.pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped({ startImmediately: true }))
        yield* Effect.yieldNow
        yield* fixture.emit(registry, { type: 'registered', job: liveView({ id: JobId('bash-live') }) })
        yield* fixture.emit(registry, { type: 'output', id: JobId('bash-live'), owner: SessionId('session-bbbb'), total: 12 })
        expect(yield* Fiber.join(signals)).toHaveLength(2)
      }),
    )

    it.effect('counts and filters by the category derived from the command', () =>
      Effect.gen(function* () {
        const fixture = yield* makeBoard({
          jobs: [
            historyJob({ id: 'bash-tests', label: 'cd /x && pnpm test' }),
            historyJob({ id: 'bash-vcs', label: 'cd /x && jj log -r main' }),
            historyJob({ id: 'bash-vcs2', label: 'jj workspace list' }),
          ],
        })
        const counts = (yield* fixture.board.board({ scope: 'all' })).categoryCounts
        expect(counts.tests).toBe(1)
        expect(counts.vcs).toBe(2)

        const filtered = yield* fixture.board.board({ scope: 'all', categories: ['vcs'] })
        expect(filtered.rows.map(row => row.id).sort()).toEqual(['bash-vcs', 'bash-vcs2'])
        expect(filtered.categoryCounts.tests).toBe(1)
      }),
    )

    it.effect('searches labels, ids and status detail', () =>
      Effect.gen(function* () {
        const fixture = yield* makeBoard({
          jobs: [
            historyJob({ id: 'bash-a', label: 'grep -rn "danger" src/' }),
            historyJob({ id: 'bash-b', label: 'pnpm build', detail: 'exit code: 1', status: 'failed' }),
          ],
        })
        const ids = (search: string) => Effect.map(fixture.board.board({ scope: 'all', search }), board => board.rows.map(row => row.id))
        expect(yield* ids('danger')).toEqual(['bash-a'])
        expect(yield* ids('bash-b')).toEqual(['bash-b'])
        expect(yield* ids('exit code: 1')).toEqual(['bash-b'])
      }),
    )

    it.effect('marks a recorded job without a settlement as interrupted until a live twin overrides it', () =>
      Effect.gen(function* () {
        const fixture = yield* makeBoard({ jobs: [historyJob({ id: 'bash-open', settled: false, status: null, detail: null, finishedAt: null })] })
        const all = yield* fixture.board.board({ scope: 'all' })
        expect(all.rows[0]?.status).toBe('interrupted')
        expect(all.finishedCount).toBe(0)
        expect(all.liveAvailable).toBe(false)
        expect((yield* fixture.board.board({ scope: 'running' })).rows).toHaveLength(0)
        expect((yield* fixture.board.board({ scope: 'finished' })).rows).toHaveLength(0)

        const registry = registryStub()
        yield* fixture.attach(registry)
        yield* fixture.emit(registry, { type: 'registered', job: liveView({ id: JobId('bash-open'), startedAt: 1_000 }) })
        expect((yield* fixture.board.board({ scope: 'running' })).rows[0]).toMatchObject({ status: 'running', live: true })

        yield* fixture.emit(registry, {
          type: 'settled',
          job: liveView({ id: JobId('bash-open'), startedAt: 1_000, status: 'killed', finishedAt: 4_000 }),
          cause: 'kill',
          awaited: false,
        })
        expect((yield* fixture.board.board({ scope: 'all' })).rows[0]?.status).toBe('killed')
      }),
    )

    it.effect('reads a live job output as its owner and refuses output from an earlier process', () =>
      Effect.gen(function* () {
        const registry = registryStub({ chunks: [{ at: 0, text: 'hello' }] })
        const fixture = yield* makeBoard({ jobs: [historyJob({ id: 'bash-old' })], registry })
        expect(yield* fixture.board.output({ jobId: 'bash-old', from: 0 })).toMatchObject({ available: false })
        expect(yield* fixture.board.output({ jobId: 'missing', from: 3 })).toMatchObject({ available: false, next: 3 })

        yield* fixture.emit(registry, { type: 'registered', job: liveView({ id: JobId('bash-now'), owner: SessionId('session-cccc') }) })
        const output = yield* fixture.board.output({ jobId: 'bash-now', from: 0 })
        expect(output.available).toBe(true)
        expect(output.chunks).toEqual([{ at: 0, channel: null, text: 'hello' }])
        expect(registry.calls).toContain('readAt:bash-now:0:session-cccc')
      }),
    )

    it.effect('kills a running job as its owner and reports a settled one as already finished', () =>
      Effect.gen(function* () {
        const registry = registryStub()
        const fixture = yield* makeBoard({ jobs: [historyJob({ id: 'bash-done' })], registry })
        yield* fixture.emit(registry, { type: 'registered', job: liveView({ id: JobId('bash-now'), owner: SessionId('session-dddd') }) })

        expect(yield* fixture.board.kill({ jobId: 'bash-now' })).toEqual({ jobId: 'bash-now', outcome: 'requested' })
        expect(registry.calls.some(call => call.startsWith('kill:bash-now:session-dddd:'))).toBe(true)
        expect(yield* fixture.board.kill({ jobId: 'bash-done' })).toEqual({ jobId: 'bash-done', outcome: 'already-finished' })
      }),
    )

    it.effect('reports an unknown job as JobNotFound and a failing kill as JobKillFailed', () =>
      Effect.gen(function* () {
        const registry = registryStub({ killFails: true })
        const fixture = yield* makeBoard({ registry })
        yield* fixture.emit(registry, { type: 'registered', job: liveView({ id: JobId('bash-now') }) })

        const missing = yield* Effect.flip(fixture.board.kill({ jobId: 'missing' }))
        expect(missing).toMatchObject({ _tag: 'JobNotFound', jobId: 'missing', message: 'No such job is retained on this Host.' })
        const refused = yield* Effect.flip(fixture.board.kill({ jobId: 'bash-now' }))
        expect(refused).toMatchObject({ _tag: 'JobKillFailed', jobId: 'bash-now', message: 'The job could not be stopped.' })
      }),
    )

    it.effect('returns as soon as the awaited job settles, without polling', () =>
      Effect.gen(function* () {
        const registry = registryStub()
        const fixture = yield* makeBoard({ registry })
        yield* fixture.emit(registry, { type: 'registered', job: liveView({ id: JobId('bash-wait') }) })

        const waiting = yield* Effect.forkScoped(fixture.board.wait({ jobIds: ['bash-wait'], timeoutMs: 60_000 }))
        yield* TestClock.adjust('1 second')
        yield* fixture.emit(registry, {
          type: 'settled',
          job: liveView({ id: JobId('bash-wait'), status: 'completed', finishedAt: 4_000 }),
          cause: 'producer',
          awaited: false,
        })
        const result = yield* Fiber.join(waiting)
        expect(result).toMatchObject({ timedOut: false, waitedMs: 1_000, running: [], jobs: [{ jobId: 'bash-wait', status: 'completed', settled: true }] })
      }),
    )

    it.effect('waits for every job running when the call starts and times out on the clock', () =>
      Effect.gen(function* () {
        const registry = registryStub()
        const fixture = yield* makeBoard({ jobs: [historyJob({ id: 'bash-old' })], registry })
        yield* fixture.emit(registry, { type: 'registered', job: liveView({ id: JobId('bash-a') }) })
        yield* fixture.emit(registry, { type: 'registered', job: liveView({ id: JobId('bash-b') }) })

        const waiting = yield* Effect.forkScoped(fixture.board.wait({ timeoutMs: 2_000 }))
        yield* TestClock.adjust('2 seconds')
        const result = yield* Fiber.join(waiting)
        expect(result).toMatchObject({ timedOut: true, waitedMs: 2_000, until: 'settled' })
        expect([...result.running].sort()).toEqual(['bash-a', 'bash-b'])
      }),
    )

    it.effect('stops waiting at the first settled job with any-settled', () =>
      Effect.gen(function* () {
        const registry = registryStub()
        const fixture = yield* makeBoard({ jobs: [historyJob({ id: 'bash-done' })], registry })
        yield* fixture.emit(registry, { type: 'registered', job: liveView({ id: JobId('bash-a') }) })
        const result = yield* fixture.board.wait({ jobIds: ['bash-a', 'bash-done'], until: 'any-settled' })
        expect(result).toMatchObject({ timedOut: false, waitedMs: 0, running: ['bash-a'] })
      }),
    )

    it.effect('reports the recorded session title for rows it lists', () =>
      Effect.gen(function* () {
        const fixture = yield* makeBoard({ jobs: [historyJob({ id: 'bash-1', owner: 'session-aaaa' })], title: 'Fix the delayed rebase button' })
        expect((yield* fixture.board.board({ scope: 'all' })).sessions).toEqual([
          { id: 'session-aaaa', title: 'Fix the delayed rebase button', cwd: null, project: 'project' },
        ])
      }),
    )

    it.effect('clamps an unbounded live view to the wire bounds so the board still parses', () =>
      Effect.gen(function* () {
        const registry = registryStub()
        const fixture = yield* makeBoard({ registry })
        yield* fixture.emit(registry, {
          type: 'registered',
          job: liveView({
            id: JobId('bash-huge'),
            kind: `bash${'x'.repeat(200)}`,
            label: `pnpm test${'\r'.repeat(3)}\n${'y'.repeat(5_000)}`,
            progress: 'p'.repeat(1_000),
            detail: 'd'.repeat(1_000),
            output: { total: 7, earliest: 0, spillPaths: Array.from({ length: 12 }, (_, index) => `${String(index)}-${'z'.repeat(1_500)}`) },
          }),
        })

        const board = yield* fixture.board.board({ scope: 'all' })
        expect(Schema.is(jobBoardSchema)(board)).toBe(true)
        const row = board.rows[0]
        expect(row?.label).toHaveLength(2_000)
        expect(row?.label.includes('\r')).toBe(false)
        expect(row?.kind).toHaveLength(64)
        expect(row?.progress).toHaveLength(300)
        expect(row?.detail).toHaveLength(500)
        expect(row?.spillPaths).toHaveLength(8)
        expect(row?.category).toBe('tests')
      }),
    )

    it.effect('keeps listing live jobs after the registry settles one', () =>
      Effect.gen(function* () {
        const registry = registryStub()
        const fixture = yield* makeBoard({ registry })
        yield* fixture.emit(registry, { type: 'registered', job: liveView({ id: JobId('bash-xyz') }) })
        expect((yield* fixture.board.board({ scope: 'running' })).rows).toHaveLength(1)
        yield* fixture.emit(registry, { type: 'output', id: JobId('bash-xyz'), owner: SessionId('session-bbbb'), total: 42 })
        expect((yield* fixture.board.board({ scope: 'running' })).rows[0]?.outputTotal).toBe(42)
        yield* fixture.emit(registry, { type: 'removed', job: liveView({ id: JobId('bash-xyz') }) })
        expect((yield* fixture.board.board({ scope: 'running' })).rows).toHaveLength(0)
        expect(registry.calls).toEqual(['subscribe:all'])
      }),
    )
  })
})
