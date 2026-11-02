import { describe, expect, it } from 'vitest'
import { Config } from './host.js'

describe('session-search Host configuration', () => {
  it('accepts a missing row config and retains optional index settings', async () => {
    expect(await Config['~standard'].validate(undefined)).toEqual({ value: undefined })
    expect(await Config['~standard'].validate({ indexPath: '/tmp/session-search.sqlite', windowBytes: 4_096 })).toEqual({
      value: { indexPath: '/tmp/session-search.sqlite', windowBytes: 4_096 },
    })
  })

  it('rejects an empty path and non-positive ingest window', async () => {
    expect(await Config['~standard'].validate({ indexPath: '' })).toMatchObject({ issues: expect.any(Array) })
    expect(await Config['~standard'].validate({ windowBytes: 0 })).toMatchObject({ issues: expect.any(Array) })
  })
})
