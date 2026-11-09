import { describe, expect, it } from 'vitest'
import { orderReviewFiles } from './file-importance.js'

describe('orderReviewFiles', () => {
  it('puts entry points and substantial source changes before tests, lockfiles and generated files', () => {
    const files = [
      { path: 'pnpm-lock.yaml', additions: 3000, deletions: 2 },
      { path: 'src/generated/api.ts', additions: 500, deletions: 0 },
      { path: 'src/main.test.ts', additions: 200, deletions: 0 },
      { path: 'src/small.ts', additions: 1, deletions: 0 },
      { path: 'src/feature.ts', additions: 40, deletions: 10 },
      { path: 'src/index.ts', additions: 2, deletions: 0 },
    ]
    expect(orderReviewFiles({ files }).map(file => file.path)).toEqual([
      'src/index.ts',
      'src/feature.ts',
      'src/small.ts',
      'src/main.test.ts',
      'pnpm-lock.yaml',
      'src/generated/api.ts',
    ])
    expect(files[0]?.path).toBe('pnpm-lock.yaml')
  })

  it('breaks ties by path and ignores viewed state', () => {
    const files = [
      { path: 'src/z.ts', additions: 1, deletions: 1, viewed: false },
      { path: 'src/a.ts', additions: 1, deletions: 1, viewed: true },
    ]
    expect(orderReviewFiles({ files }).map(file => file.path)).toEqual(['src/a.ts', 'src/z.ts'])
    expect(orderReviewFiles({ files: files.map(file => ({ ...file, viewed: !file.viewed })) }).map(file => file.path)).toEqual(['src/a.ts', 'src/z.ts'])
  })
})
