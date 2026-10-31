import { describe, expect, it } from 'vitest'
import { Config } from './host.js'

describe('session-search Host configuration', () => {
  it('defaults a missing row config and retains optional index settings', () => {
    expect(Config.parse(undefined)).toEqual({})
    expect(Config.parse({ indexPath: '/tmp/session-search.sqlite', windowBytes: 4_096 })).toEqual({
      indexPath: '/tmp/session-search.sqlite',
      windowBytes: 4_096,
    })
  })

  it('rejects an empty path and non-positive ingest window', () => {
    expect(() => Config.parse({ indexPath: '' })).toThrow()
    expect(() => Config.parse({ windowBytes: 0 })).toThrow()
  })
})
