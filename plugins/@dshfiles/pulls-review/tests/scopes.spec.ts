import { describe, expect, it } from 'vitest'
import { MAX_FILES } from '../src/api.js'
import { groupPatch } from '../src/scopes.js'

const PATCH = [
  'diff --git a/README.md b/README.md',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1 +1,2 @@',
  ' # Title',
  '+Reviewed changes.',
  'diff --git a/src/app.ts b/src/app.ts',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,2 +1,2 @@',
  '-const answer = 1',
  '+const answer = 2',
  'diff --git a/src/app.test.ts b/src/app.test.ts',
  '--- a/src/app.test.ts',
  '+++ b/src/app.test.ts',
  '@@ -0,0 +1,1 @@',
  "+it('works', () => {})",
  'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml',
  '--- a/pnpm-lock.yaml',
  '+++ b/pnpm-lock.yaml',
  '@@ -1 +1 @@',
  '-lockfileVersion: 8.0',
  '+lockfileVersion: 9.0',
  '',
].join('\n')

describe('groupPatch', () => {
  it('groups changed files with pulls.review rule-based scopes and exact stats', async () => {
    const grouped = await groupPatch({ patch: PATCH, title: 'main..@' })
    expect(grouped.fileCount).toBe(4)
    expect(grouped.additions).toBe(4)
    expect(grouped.deletions).toBe(2)
    expect(grouped.scopes.map(scope => scope.key)).toEqual(['docs', 'code', 'tests', 'generated'])
    expect(grouped.scopes.map(scope => scope.filePaths)).toEqual([['README.md'], ['src/app.ts'], ['src/app.test.ts'], ['pnpm-lock.yaml']])
    expect(grouped.scopes[0]?.label).toBe('Docs')
    expect(grouped.scopes[1]?.label).toBe('Code')
    expect(grouped.scopes[3]?.label).toBe('Generated')
    expect(grouped.clipped).toBe(false)
  })

  it('reports an empty patch as no scopes rather than an error', async () => {
    const grouped = await groupPatch({ patch: '', title: 'main..@' })
    expect(grouped).toEqual({ fileCount: 0, additions: 0, deletions: 0, files: [], scopes: [], clipped: false })
  })

  it('caps the listed files and scales each scope down to what it still lists', async () => {
    const grouped = await groupPatch({ patch: PATCH, title: 'main..@', limit: 2 })
    expect(grouped.fileCount).toBe(4)
    expect(grouped.additions).toBe(4)
    expect(grouped.files.map(file => file.path)).toEqual(['README.md', 'src/app.ts'])
    expect(grouped.scopes.map(scope => [scope.key, scope.filePaths])).toEqual([
      ['docs', ['README.md']],
      ['code', ['src/app.ts']],
    ])
    expect(grouped.scopes.reduce((total, scope) => total + scope.additions, 0)).toBe(2)
    expect(grouped.clipped).toBe(true)
  })

  it('admits exactly the cap without flagging a clip', async () => {
    const files = Array.from({ length: MAX_FILES }, (_, index) => [`diff --git a/f${index}.txt b/f${index}.txt`, '@@ -0,0 +1 @@', '+x', ''].join('\n'))
    const grouped = await groupPatch({ patch: files.join(''), title: 'main..@' })
    expect(grouped.fileCount).toBe(MAX_FILES)
    expect(grouped.clipped).toBe(false)
  })
})
