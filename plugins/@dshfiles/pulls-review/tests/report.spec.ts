import { describe, expect, it } from 'vitest'
import type { ReviewResult } from '../src/api.js'
import { renderScopeReport } from '../src/report.js'

type OkReview = Extract<ReviewResult, { readonly status: 'ok' }>

const review: OkReview = {
  status: 'ok',
  path: '/work/thread',
  base: 'main',
  head: 'abc1234',
  range: 'main..@',
  patch: '',
  truncated: false,
  fileCount: 2,
  additions: 12,
  deletions: 3,
  files: [
    { path: 'src/app.ts', status: 'modified', additions: 10, deletions: 3 },
    { path: 'README.md', status: 'added', additions: 2, deletions: 0 },
  ],
  scopes: [
    {
      key: 'docs',
      category: 'docs',
      label: 'Docs',
      summary: 'Documentation updates.',
      filePaths: ['README.md'],
      additions: 2,
      deletions: 0,
    },
    {
      key: 'code',
      category: 'core',
      label: 'Code',
      summary: 'Source changes.',
      filePaths: ['src/app.ts'],
      additions: 10,
      deletions: 3,
    },
  ],
}

describe('renderScopeReport', () => {
  it('renders the range, totals and one line per scope with its files', () => {
    const text = renderScopeReport(review)
    expect(text.split('\n')[0]).toBe('pulls.review · main..@ · 2 files · +12 −3')
    expect(text).toContain('Docs (1) · +2 −0 · Documentation updates.')
    expect(text).toContain('  - README.md (+2 −0)')
    expect(text).toContain('Code (1) · +10 −3 · Source changes.')
    expect(text).toContain('  - src/app.ts (+10 −3)')
  })

  it('flags a truncated read and counts a single file in the singular', () => {
    const text = renderScopeReport({ ...review, truncated: true, fileCount: 1 })
    expect(text.split('\n')[0]).toBe('pulls.review · main..@ · 1 file · +12 −3')
    expect(text).toContain('The diff was too large for one read and is truncated.')
  })

  it('lists at most twenty files per scope and names the remainder', () => {
    const paths = Array.from({ length: 22 }, (_, index) => `src/file-${index}.ts`)
    const text = renderScopeReport({
      ...review,
      scopes: [{ ...review.scopes[1]!, filePaths: paths, additions: 22, deletions: 0 }],
    })
    expect(text.match(/ {2}- src\/file-\d+\.ts/g)).toHaveLength(20)
    expect(text).toContain('… 2 more')
  })
})
