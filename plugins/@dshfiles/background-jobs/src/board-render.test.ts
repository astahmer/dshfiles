import { describe, expect, it } from 'vitest'
import { renderBoard } from './board-render.js'
import type { JobBoard, JobRow } from './types.js'

const row = (overrides: Partial<JobRow> = {}): JobRow => ({
  id: 'bash-1',
  kind: 'bash',
  label: 'pnpm --dir plugins/@dshfiles/backlog test',
  owner: 'session-a',
  status: 'running',
  progress: null,
  detail: null,
  startedAt: 0,
  finishedAt: null,
  durationMs: 61_000,
  category: 'tests',
  live: true,
  outputTotal: 0,
  spillPaths: [],
  outlivedSince: null,
  ...overrides,
})

const board = (rows: readonly JobRow[], indexing: Partial<JobBoard['indexing']> = {}): JobBoard => ({
  rows: [...rows],
  total: rows.length,
  hasMore: false,
  nextCursor: null,
  categoryCounts: {
    tests: rows.length,
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
  },
  runningCount: rows.filter(candidate => candidate.status === 'running').length,
  finishedCount: rows.filter(candidate => candidate.status !== 'running').length,
  sessions: [{ id: 'session-a', title: 'A Session title that must not reach the model', cwd: '/Users/astahmer/dev/x', project: 'dshfiles' }],
  indexing: { active: false, caughtUp: true, files: 10, indexedFiles: 10, historyRows: 100, lastIndexedAt: null, lastError: null, ...indexing },
  liveAvailable: true,
  generatedAt: 0,
})

describe('renderBoard', () => {
  it('prints one line per job with its id, status, category and elapsed time', () => {
    expect(renderBoard(board([row()]), 61_000)).toBe(
      '1 running · 0 finished · 1 total\nbash-1 running bash/tests 1m · pnpm --dir plugins/@dshfiles/backlog test',
    )
  })

  it('leaves the browser-only payload out of the model text', () => {
    const text = renderBoard(board([row()]), 61_000)
    expect(text).not.toContain('sessions')
    expect(text).not.toContain('A Session title')
    expect(text).not.toContain('spillPaths')
  })

  it('collapses whitespace and shortens a long label', () => {
    const text = renderBoard(board([row({ label: `line one\nline two ${'x'.repeat(200)}` })]), 61_000)
    expect(text).toContain('· line one line two ')
    expect(text).toContain('…')
    expect(text.split('\n')[1]?.split(' · ')[1]?.length).toBeLessThanOrEqual(141)
  })

  it('shows progress and marks a job that outlived its Session', () => {
    const text = renderBoard(board([row({ progress: '2 of 5 steps', outlivedSince: 1 })]), 61_000)
    expect(text).toContain('(2 of 5 steps)')
    expect(text).toContain('orphaned')
  })

  it('bounds the rows it prints and reports the remainder', () => {
    const text = renderBoard(board(Array.from({ length: 45 }, (_, index) => row({ id: `bash-${String(index)}` }))), 61_000)
    expect(text.split('\n')).toHaveLength(42)
    expect(text).toContain('… 5 more row(s)')
  })

  it('adds an indexing line only while indexing is behind', () => {
    expect(renderBoard(board([row()], { caughtUp: false, indexedFiles: 4 }), 61_000)).toContain('indexing 4/10 files')
    expect(renderBoard(board([row()], { caughtUp: true }), 61_000)).not.toContain('indexing')
  })

  it('states when more pages exist', () => {
    const withPages = { ...board([row()]), hasMore: true }
    expect(renderBoard(withPages, 61_000)).toContain('more pages available')
  })
})
