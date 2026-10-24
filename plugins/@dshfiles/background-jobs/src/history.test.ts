import { recordSpans } from '@dshfiles/dshx/tracing'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HistoryIndex } from './history.js'

const record = (type: string, data: Record<string, string | number | boolean>): string => `${JSON.stringify({ type, data })}\n`

const setup = async (): Promise<{ readonly root: string; readonly statePath: string; readonly logPath: string }> => {
  const root = await mkdtemp(join(tmpdir(), 'background-jobs-'))
  const sessionDirectory = join(root, '--Users-astahmer-dev-dshfiles--', 'session-aaaa')
  await mkdir(sessionDirectory, { recursive: true })
  const logPath = join(sessionDirectory, 'session.v4.jsonl')
  await writeFile(
    logPath,
    record('session', { version: 4, id: 'session-aaaa', createdAt: 1, cwd: '/Users/astahmer/dev/dshfiles' }) +
      record('session/title', { title: 'Fix the delayed rebase button' }) +
      record('job/registered', { jobId: 'bash-1', owner: 'session-aaaa', kind: 'bash', label: 'cd /x && pnpm test', startedAt: 1_000 }) +
      record('job/settled', {
        jobId: 'bash-1',
        owner: 'session-aaaa',
        kind: 'bash',
        label: 'cd /x && pnpm test',
        startedAt: 1_000,
        finishedAt: 2_000,
        status: 'completed',
        cause: 'producer',
        detail: 'exit code: 0',
      }) +
      record('job/registered', { jobId: 'bash-2', owner: 'session-aaaa', kind: 'bash', label: 'jj log', startedAt: 3_000 }),
  )
  return { root, statePath: join(root, 'state.json'), logPath }
}

describe('job history index', () => {
  it('records job lifecycle events, session titles and a settled/unsettled status', async () => {
    const { root, statePath } = await setup()
    const index = new HistoryIndex({ root, statePath })
    await index.load()
    await index.pass()

    const rows = [...index.historyRows].sort((left, right) => left.startedAt - right.startedAt)
    expect(rows.map(row => row.id)).toEqual(['bash-1', 'bash-2'])
    expect(rows[0]).toMatchObject({ settled: true, status: 'completed', detail: 'exit code: 0', finishedAt: 2_000 })
    expect(rows[1]).toMatchObject({ settled: false, status: null })
    expect(index.sessionOf('session-aaaa')).toEqual({
      id: 'session-aaaa',
      title: 'Fix the delayed rebase button',
      cwd: '/Users/astahmer/dev/dshfiles',
      project: '--Users-astahmer-dev-dshfiles--',
    })
    expect(index.indexing).toMatchObject({ caughtUp: true, historyRows: 2 })
  })

  it('records a background-jobs history pass span with the files it read', async () => {
    const { root, statePath } = await setup()
    const index = new HistoryIndex({ root, statePath })
    await index.load()
    using recorder = recordSpans()
    await index.pass()
    expect(recorder.span('background-jobs history pass').attributes).toEqual({
      'dshx.background-jobs.files': 1,
      'dshx.background-jobs.read_files': 1,
      'dshx.background-jobs.caught_up': true,
    })
  })

  it('resumes from the persisted offset and reads only the appended records', async () => {
    const { root, statePath, logPath } = await setup()
    const first = new HistoryIndex({ root, statePath })
    await first.load()
    await first.pass()
    expect(first.historyRows).toHaveLength(2)

    await writeFile(logPath, record('job/registered', { jobId: 'bash-3', owner: 'session-aaaa', kind: 'bash', label: 'pnpm lint', startedAt: 4_000 }), {
      flag: 'a',
    })
    const second = new HistoryIndex({ root, statePath })
    await second.load()
    await second.pass()
    expect([...second.historyRows].map(row => row.id).sort()).toEqual(['bash-1', 'bash-2', 'bash-3'])
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({ schemaVersion: 1 })
  })

  it('keeps the durable record when a state file is malformed', async () => {
    const { root, statePath } = await setup()
    await writeFile(statePath, '{"schemaVersion":99,"offsets":{}}')
    const index = new HistoryIndex({ root, statePath })
    await index.load()
    await index.pass()
    expect(index.historyRows).toHaveLength(2)
  })

  it('bounds retained history to the configured maximum', async () => {
    const { root, statePath } = await setup()
    const index = new HistoryIndex({ root, statePath, maxJobs: 1 })
    await index.load()
    await index.pass()
    expect(index.historyRows).toHaveLength(1)
    expect(index.historyRows[0]?.id).toBe('bash-2')
  })

  it('tolerates a missing sessions root instead of throwing', async () => {
    const index = new HistoryIndex({ root: join(tmpdir(), 'background-jobs-missing-root'), statePath: join(tmpdir(), 'background-jobs-missing.json') })
    await index.load()
    await index.pass()
    expect(index.indexing.historyRows).toBe(0)
  })
})
