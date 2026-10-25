import { expect, test } from 'vitest'
import { ReviewDiffModel } from './review-diff.js'

test('numbers a hunk the way the native tab does', () => {
  const hunk = ReviewDiffModel.numberHunkLines({ oldStart: 10, newStart: 10, lines: [' keep', '-old', '+new', ' tail'] })
  expect(hunk.lines).toEqual([
    { kind: 'context', oldNumber: 10, newNumber: 10, text: 'keep' },
    { kind: 'del', oldNumber: 11, text: 'old' },
    { kind: 'add', newNumber: 11, text: 'new' },
    { kind: 'context', oldNumber: 12, newNumber: 12, text: 'tail' },
  ])
})

test('renders the turn snapshot comparison and keeps its flags', () => {
  const comparison = ReviewDiffModel.comparisonFromTurnDiff({
    kind: 'text',
    path: 'src/a.ts',
    display: 'src/a.ts',
    before: true,
    after: true,
    coarse: false,
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-one', '+two'] }],
  })
  expect(comparison.kind).toBe('text')
  expect(comparison.hunks[0]?.header).toBe('@@ -1,1 +1,1 @@')
  expect(comparison.truncated).toBe(false)
})

test('refuses a malformed snapshot as missing instead of drawing junk', () => {
  expect(ReviewDiffModel.comparisonFromTurnDiff({ kind: 'text', hunks: 'nope' }).kind).toBe('missing')
  expect(ReviewDiffModel.comparisonFromTurnDiff({ kind: 'binary', path: 'a.png', display: 'a.png' }).kind).toBe('binary')
})

test('parses one file patch into hunks', () => {
  const patch = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 111..222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,3 +1,4 @@',
    ' one',
    '-two',
    '+two!',
    '+three',
    ' four',
    '',
  ].join('\n')
  const comparison = ReviewDiffModel.comparisonFromPatch(patch)
  expect(comparison.kind).toBe('text')
  expect(comparison.hunks[0]?.header).toBe('@@ -1,3 +1,4 @@')
  expect(comparison.hunks[0]?.lines.map(line => line.kind)).toEqual(['context', 'del', 'add', 'add', 'context'])
})

test('pairs deletions with additions for the side-by-side view', () => {
  const hunk = ReviewDiffModel.numberHunkLines({ oldStart: 1, newStart: 1, lines: ['-a', '-b', '+c', ' x'] })
  const rows = ReviewDiffModel.splitHunkLines(hunk.lines)
  expect(rows[0]?.left?.text).toBe('a')
  expect(rows[0]?.right?.text).toBe('c')
  expect(rows[1]?.left?.text).toBe('b')
  expect(rows[1]?.right).toBeUndefined()
  expect(rows[2]?.left?.text).toBe('x')
  expect(rows[2]?.right?.text).toBe('x')
})

test('cuts a long comparison at the budget and says so', () => {
  const hunk = ReviewDiffModel.numberHunkLines({ oldStart: 1, newStart: 1, lines: Array.from({ length: 6 }, (_, index) => ` ${String(index)}`) })
  const cut = ReviewDiffModel.renderedHunks([hunk], 4)
  expect(cut.truncated).toBe(true)
  expect(cut.hunks[0]?.lines).toHaveLength(4)
})
