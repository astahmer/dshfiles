import { describe, expect, it } from 'vitest'

import { BacklogSignals } from './signals.js'

describe('signals', () => {
  it('finds item mentions without matching paths or longer words', () => {
    expect(BacklogSignals.mentionsIn('look at b:12 and b:3, not lib:4 or ab:5 or /b:6; b:12 again')).toEqual([12, 3])
  })

  it('closes only the items a magic word names', () => {
    expect(BacklogSignals.closedBy('feat(backlog): board\n\nPart of b:1.\nCloses b:12, b:13 and b:14\nFixes: b:2')).toEqual([12, 13, 14, 2])
    expect(BacklogSignals.closedBy('refactor: touch b:7 again')).toEqual([])
  })

  it('reads jj log records, skipping malformed ones', () => {
    const stdout = 'kvyxrlmkptyv\tfeat: one\n\nCloses b:1\n\u001e\nnot-a-change\tjunk\u001e\nruwkyzntnvpp\tdocs: two\n\u001e'
    expect(BacklogSignals.parseLog(stdout)).toEqual([
      { changeId: 'kvyxrlmkptyv', description: 'feat: one\n\nCloses b:1\n' },
      { changeId: 'ruwkyzntnvpp', description: 'docs: two\n' },
    ])
  })
})

describe('signals against a real jj repository', () => {
  it('reads closing references from jj log with the shipped template', async () => {
    const { execFileSync } = await import('node:child_process')
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const root = mkdtempSync(join(tmpdir(), 'backlog-signals-'))
    const jj = (...args: string[]): string =>
      execFileSync('jj', ['--color=never', '--no-pager', ...args], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, JJ_USER: 'Test', JJ_EMAIL: 'test@example.com', JJ_CONFIG: '/dev/null' },
      })
    try {
      jj('git', 'init')
      jj('describe', '-m', 'feat: first\n\nPart of b:1.')
      jj('new', '-m', 'fix: second\n\nCloses b:2 and b:3')
      jj('bookmark', 'set', 'main', '-r', '@')
      const revisions = BacklogSignals.parseLog(
        jj('log', '--no-graph', '--ignore-working-copy', '-r', 'ancestors(main, 50) ~ root()', '-T', BacklogSignals.logTemplate),
      )
      expect(revisions.flatMap(revision => BacklogSignals.closedBy(revision.description))).toEqual([2, 3])
      expect(revisions).toHaveLength(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
