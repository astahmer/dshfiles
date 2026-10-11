import { describe, expect, it } from 'vitest'
import { JUJUTSU_QUERY_GC_TIME, JUJUTSU_QUERY_STALE_TIME, jujutsuQueryKeys } from './repository-query-cache.js'

describe('Jujutsu repository query cache', () => {
  it('shares state and detail queries by canonical root', () => {
    expect(jujutsuQueryKeys.state('/work/repo', 200)).toEqual(['jujutsu', '/work/repo', 'state', 200])
    expect(jujutsuQueryKeys.details('/work/repo', 'change-a')).toEqual(['jujutsu', '/work/repo', 'details', 'change-a'])
    expect(jujutsuQueryKeys.state('/work/other', 200)).not.toEqual(jujutsuQueryKeys.state('/work/repo', 200))
  })

  it('uses one root prefix for invalidating every repository read', () => {
    const prefix = jujutsuQueryKeys.repository('/work/repo')
    const keys = [
      jujutsuQueryKeys.state('/work/repo', 200),
      jujutsuQueryKeys.details('/work/repo', 'change-a'),
      jujutsuQueryKeys.revisionFiles('/work/repo', ['change-a']),
    ]

    expect(keys.every(key => prefix.every((part, index) => key[index] === part))).toBe(true)
    expect(jujutsuQueryKeys.state('/work/other', 200).slice(0, prefix.length)).not.toEqual(prefix)
  })

  it('keeps cached reads fresh briefly and retains them for a short unmount window', () => {
    expect(JUJUTSU_QUERY_STALE_TIME).toBe(60_000)
    expect(JUJUTSU_QUERY_GC_TIME).toBe(120_000)
  })
})
