import { describe, expect, it } from 'vitest'
import { ChangesKeysModel, type KeyFile, type KeyHunk } from './changes-keys.js'

const hunk = (overrides: Partial<KeyHunk> = {}): KeyHunk => ({
  collapsedBefore: 3,
  additionStart: 10,
  additionCount: 4,
  deletionStart: 10,
  deletionCount: 2,
  ...overrides,
})

const files: readonly KeyFile[] = [
  { name: 'a.ts', hunks: [hunk({ collapsedBefore: 0, additionStart: 1 }), hunk({ additionStart: 40 })] },
  { name: 'b.ts', hunks: [hunk()] },
  { name: 'c.ts', hunks: [] },
]
const paths = files.map(file => file.name)

describe('changes keyboard review', () => {
  it('J/K step through files and stop at the ends', () => {
    expect(ChangesKeysModel.stepFile(paths, null, 1)).toBe('a.ts')
    expect(ChangesKeysModel.stepFile(paths, null, -1)).toBe('c.ts')
    expect(ChangesKeysModel.stepFile(paths, 'a.ts', 1)).toBe('b.ts')
    expect(ChangesKeysModel.stepFile(paths, 'c.ts', 1)).toBe('c.ts')
    expect(ChangesKeysModel.stepFile(paths, 'a.ts', -1)).toBe('a.ts')
    expect(ChangesKeysModel.stepFile([], null, 1)).toBeUndefined()
  })

  it('V moves to the next unviewed file, wrapping, and says when none is left', () => {
    expect(ChangesKeysModel.nextUnviewed(paths, new Set(['a.ts']), 'a.ts')).toBe('b.ts')
    expect(ChangesKeysModel.nextUnviewed(paths, new Set(['b.ts', 'c.ts']), 'c.ts')).toBe('a.ts')
    expect(ChangesKeysModel.nextUnviewed(paths, new Set(paths), 'b.ts')).toBeUndefined()
  })

  it('N/P walk hunks across files, starting in the current file', () => {
    expect(ChangesKeysModel.stepHunk(files, null, 1, 'b.ts')).toEqual({ path: 'b.ts', hunk: 0 })
    expect(ChangesKeysModel.stepHunk(files, null, -1, 'a.ts')).toEqual({ path: 'a.ts', hunk: 1 })
    expect(ChangesKeysModel.stepHunk(files, { path: 'a.ts', hunk: 1 }, 1, 'a.ts')).toEqual({ path: 'b.ts', hunk: 0 })
    expect(ChangesKeysModel.stepHunk(files, { path: 'b.ts', hunk: 0 }, 1, 'b.ts')).toEqual({ path: 'b.ts', hunk: 0 })
    expect(ChangesKeysModel.stepHunk([{ name: 'x', hunks: [] }], null, 1, null)).toBeUndefined()
  })

  it('finds the separator above a hunk, none for a file that changes on its first line', () => {
    const first = files[0]?.hunks ?? []
    expect(ChangesKeysModel.separatorIndex(first, 0)).toBeUndefined()
    expect(ChangesKeysModel.separatorIndex(first, 1)).toBe(0)
    expect(ChangesKeysModel.separatorIndex([hunk(), hunk()], 1)).toBe(1)
  })

  it('C comments on the hunk’s new lines, or its old lines when it only deletes', () => {
    expect(ChangesKeysModel.hunkLines(hunk())).toEqual({ start: 10, end: 13, side: 'additions' })
    expect(ChangesKeysModel.hunkLines(hunk({ additionCount: 0, deletionStart: 7, deletionCount: 3 }))).toEqual({ start: 7, end: 9, side: 'deletions' })
  })
})
