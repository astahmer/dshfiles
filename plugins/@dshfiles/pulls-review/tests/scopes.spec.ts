import { describe, expect, it } from 'vitest'
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
  })

  it('reports an empty patch as no scopes rather than an error', async () => {
    const grouped = await groupPatch({ patch: '', title: 'main..@' })
    expect(grouped).toEqual({ fileCount: 0, additions: 0, deletions: 0, files: [], scopes: [] })
  })
})
