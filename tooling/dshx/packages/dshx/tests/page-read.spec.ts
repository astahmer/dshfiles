import { describe, expect, it } from 'vitest'
import { PageReadModel } from '../src/client/page-read.js'

const deferred = <Value>() => {
  let resolve: (value: Value) => void = () => undefined
  const promise = new Promise<Value>(settle => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('PageReadModel.join', () => {
  it('shares one in-flight read between callers of the same key', async () => {
    const answer = deferred<string>()
    let reads = 0
    const read = (): Promise<string> => {
      reads += 1
      return answer.promise
    }
    const first = PageReadModel.join({ key: 'test:shared', read })
    const second = PageReadModel.join({ key: 'test:shared', read })
    answer.resolve('catalog')
    await expect(Promise.all([first, second])).resolves.toEqual(['catalog', 'catalog'])
    expect(reads).toBe(1)
  })

  it('never serves a settled read again', async () => {
    let reads = 0
    const read = async (): Promise<number> => {
      reads += 1
      return reads
    }
    await expect(PageReadModel.join({ key: 'test:settled', read })).resolves.toBe(1)
    await expect(PageReadModel.join({ key: 'test:settled', read })).resolves.toBe(2)
  })

  it('starts a fresh read when the one in flight began before the change that asked for it', async () => {
    const stale = deferred<string>()
    const fresh = deferred<string>()
    const answers = [stale, fresh]
    let reads = 0
    const read = (): Promise<string> => answers[reads++]!.promise
    const before = PageReadModel.join({ key: 'test:fresh', read })
    const changedAt = performance.now() + 1
    const after = PageReadModel.join({ key: 'test:fresh', read, notBefore: changedAt })
    const joined = PageReadModel.join({ key: 'test:fresh', read, notBefore: changedAt - 1 })
    stale.resolve('before')
    fresh.resolve('after')
    await expect(Promise.all([before, after, joined])).resolves.toEqual(['before', 'after', 'after'])
    expect(reads).toBe(2)
  })

  it('keeps keys apart and forgets a failed read', async () => {
    let reads = 0
    const failing = (): Promise<string> => {
      reads += 1
      return Promise.reject(new Error('refused'))
    }
    await expect(PageReadModel.join({ key: 'test:failed', read: failing })).rejects.toThrow('refused')
    await expect(PageReadModel.join({ key: 'test:failed', read: failing })).rejects.toThrow('refused')
    await expect(PageReadModel.join({ key: 'test:other', read: async () => 'other' })).resolves.toBe('other')
    expect(reads).toBe(2)
  })
})
