import { expect, test } from 'vitest'
import type { ReviewResult } from './api.js'
import { ReviewModel } from './review-model.js'
import { viewedKey } from '@dshfiles/diff-viewed/marks-api'

const summary = {
  turn: 3,
  files: [
    { path: 'src/a.ts', display: 'src/a.ts', added: 4, deleted: 1 },
    { path: 'docs/b.md', display: 'docs/b.md', added: 2, deleted: 0 },
    { path: 'img.png', display: 'img.png', added: 0, deleted: 0, binary: true },
  ],
}

const workspaceResult: Extract<ReviewResult, { status: 'ok' }> = {
  status: 'ok',
  path: '/repo',
  base: 'main',
  head: 'abc',
  range: 'main..@',
  patch: '',
  truncated: false,
  fileCount: 3,
  additions: 9,
  deletions: 2,
  files: [
    { path: 'src/a.ts', status: 'modified', additions: 4, deletions: 1 },
    { path: 'docs/b.md', status: 'added', additions: 2, deletions: 0 },
    { path: 'misc.txt', status: 'modified', additions: 3, deletions: 1 },
  ],
  scopes: [
    { key: 'code', category: 'code', label: 'Code', summary: 'Source changes.', filePaths: ['src/a.ts'], additions: 4, deletions: 1 },
    { key: 'docs', category: 'docs', label: 'Docs', summary: 'Documentation updates.', filePaths: ['docs/b.md'], additions: 2, deletions: 0 },
  ],
}

test('builds the turn review files and one rail group', () => {
  const parsed = ReviewModel.turnSummaryFrom(summary)
  expect(parsed).toBeDefined()
  const files = ReviewModel.turnFiles(parsed ?? { turn: 0, files: [] })
  expect(files.map(file => file.index)).toEqual([0, 1, 2])
  expect(files[2]?.binary).toBe(true)
  const groups = ReviewModel.turnGroups(files)
  expect(groups).toHaveLength(1)
  expect(groups[0]?.additions).toBe(6)
})

test('keeps pulls.review scopes and collects files outside them', () => {
  const files = ReviewModel.workspaceFiles(workspaceResult)
  const groups = ReviewModel.workspaceGroups(workspaceResult, files)
  expect(groups.map(group => group.key)).toEqual(['code', 'docs', 'other'])
  expect(groups[2]?.files.map(file => file.path)).toEqual(['misc.txt'])
})

test('reads and writes the changes-review address', () => {
  const source = { kind: 'turn' as const, sessionId: 'session-1', seq: 7, turn: 2 }
  const address = ReviewModel.changesReviewAddress(source)
  expect(address).toBe('dsh-resource://changes-review/session/session-1/7/2')
  expect(ReviewModel.parseChangesReviewAddress(address)).toEqual(source)
  expect(ReviewModel.parseChangesReviewAddress('dsh-resource://changes-review/session/session-1/7')).toBeUndefined()
  expect(ReviewModel.parseChangesReviewAddress('dsh-resource://file/session/session-1/7/2')).toBeUndefined()
})

test('a review key and its comment source identify the same review', () => {
  const turn = { kind: 'turn' as const, sessionId: 's', seq: 3, turn: 1 }
  expect(ReviewModel.commentSource(turn)).toEqual({ kind: 'turn', sessionId: 's', seq: 3 })
  expect(ReviewModel.reviewKey(turn)).toBe(JSON.stringify(['turn', 's', 3]))
  const workspace = { kind: 'workspace' as const, path: '/repo', base: 'main', head: 'abc', range: 'main..@' }
  expect(ReviewModel.commentSource(workspace)).toEqual({ kind: 'workspace', path: '/repo', base: 'main', head: 'abc' })
})

test('only the turn own marks count as viewed', () => {
  const source = { kind: 'turn' as const, sessionId: 's', seq: 3, turn: 1 }
  const snapshot = {
    revision: 5,
    marks: [
      viewedKey({ sessionId: 's', seq: 3, path: 'a.ts' }),
      viewedKey({ sessionId: 's', seq: 4, path: 'b.ts' }),
      viewedKey({ sessionId: 'x', seq: 3, path: 'c.ts' }),
    ],
  }
  expect([...ReviewModel.viewedPathsOf(snapshot, source)]).toEqual(['a.ts'])
  expect(ReviewModel.viewedKeyOf(source, 'a.ts')).toBe(viewedKey({ sessionId: 's', seq: 3, path: 'a.ts' }))
})
