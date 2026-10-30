import { describe, expect, test, vi } from 'vitest'
import { ThreadError } from './threads.js'
import { readRepositoryView } from './repository-view-read.js'

describe('repository view reads', () => {
  test('drops a stale repository location and invalidates its cache', async () => {
    const invalidate = vi.fn()

    await expect(
      readRepositoryView({
        read: async () => {
          throw new ThreadError('not-a-repository', '/Users/astahmer/dev is not inside a jj repository.')
        },
        onNotRepository: invalidate,
      }),
    ).resolves.toBeUndefined()
    expect(invalidate).toHaveBeenCalledOnce()
  })

  test('propagates repository errors other than a missing repository', async () => {
    const invalidate = vi.fn()
    const failure = new ThreadError('jj-failed', 'jj failed')

    await expect(
      readRepositoryView({
        read: async () => {
          throw failure
        },
        onNotRepository: invalidate,
      }),
    ).rejects.toBe(failure)
    expect(invalidate).not.toHaveBeenCalled()
  })
})
