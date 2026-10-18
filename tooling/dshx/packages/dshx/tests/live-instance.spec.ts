import { describe, expect, it } from 'vitest'
import { LiveInstanceModel } from '../src/platform/live-instance.js'

const operation = (id: string, timestamp: string): string => `${id}\t${timestamp}`

describe('LiveInstanceModel', () => {
  it('reads the listener pid from an lsof field listing', () => {
    expect(LiveInstanceModel.parseListenerPid('p42847\nf16\nn127.0.0.1:3080\n')).toBe(42847)
    expect(LiveInstanceModel.parseListenerPid('f16\nn127.0.0.1:3080\n')).toBeUndefined()
    expect(LiveInstanceModel.parseListenerPid(undefined)).toBeUndefined()
  })

  it('reads the working directory of the process, not of the next field record', () => {
    expect(LiveInstanceModel.parseCwd('p42847\nfcwd\nn/Users/someone/dev/dshfiles\n')).toBe('/Users/someone/dev/dshfiles')
    expect(LiveInstanceModel.parseCwd('p42847\nf16\nn127.0.0.1:3080\n')).toBeUndefined()
  })

  it('parses the ps start time and rejects anything unparseable', () => {
    expect(LiveInstanceModel.parseStartTime('Sun Oct 18 03:30:32 2026')).toBe(Date.parse('Sun Oct 18 03:30:32 2026'))
    expect(LiveInstanceModel.parseStartTime('   \n')).toBeUndefined()
    expect(LiveInstanceModel.parseStartTime('not a date')).toBeUndefined()
  })

  it('takes the explicit profile, otherwise the web profile that a bare `dsh web` runs', () => {
    expect(LiveInstanceModel.parseProfile('node .../dsh web --port 3080')).toBe('web')
    expect(LiveInstanceModel.parseProfile('node .../dsh --profile probe web --port 3199')).toBe('probe')
    expect(LiveInstanceModel.parseProfile('node .../dsh --profile=probe web')).toBe('probe')
    expect(LiveInstanceModel.parseProfile('node .../dsh doctor')).toBeNull()
  })

  it('picks the newest operation at or before the launch, and skips malformed rows', () => {
    const startedAt = Date.parse('2026-10-18T03:30:31+02:00')
    const page = [
      operation('after', '2026-10-18 03:35:24.660 +02:00'),
      'missing-a-timestamp',
      operation('before', '2026-10-18 03:30:20.000 +02:00'),
      operation('older', '2026-10-18 03:00:00.000 +02:00'),
    ].join('\n')
    expect(LiveInstanceModel.operationBefore(page, startedAt)).toBe('before')
    expect(LiveInstanceModel.operationBefore(`missing\t\n`, startedAt)).toBeUndefined()
  })

  it('splits one tagged revision record, keeping an empty bookmarks field in place', () => {
    expect(LiveInstanceModel.parseRevision('cnvlkrlxlmoyk\nk2a36696844a2\nbmain other\ndwip')).toEqual({
      changeId: 'nvlkrlxlmoyk',
      commitId: '2a36696844a2',
      bookmarks: ['main', 'other'],
      description: 'wip',
    })
    expect(LiveInstanceModel.parseRevision('cuvxlkpppkwrt\nke76febe776a1\nb\ndfeat(scripts): add jj-state')).toEqual({
      changeId: 'uvxlkpppkwrt',
      commitId: 'e76febe776a1',
      bookmarks: [],
      description: 'feat(scripts): add jj-state',
    })
    expect(LiveInstanceModel.parseRevision('k2a36696844a2\nbmain\n')).toBeUndefined()
    expect(LiveInstanceModel.parseRevision(undefined)).toBeUndefined()
  })

  it('flags an unbuilt edit before a build the running Host cannot have loaded', () => {
    const startedAt = 1_000_000
    const stale = LiveInstanceModel.staleBundles(
      [
        { name: '@dshfiles/edited', builtAt: startedAt - 5_000, sourcesAt: startedAt + 5_000 },
        { name: '@dshfiles/rebuilt', builtAt: startedAt + 5_000, sourcesAt: startedAt - 5_000 },
        { name: '@dshfiles/current', builtAt: startedAt - 5_000, sourcesAt: startedAt - 6_000 },
        { name: '@dshfiles/never-built', builtAt: undefined, sourcesAt: startedAt + 5_000 },
      ],
      startedAt,
    )
    expect(stale).toEqual([
      { name: '@dshfiles/edited', builtAt: startedAt - 5_000, sourcesAt: startedAt + 5_000, reason: 'sources-newer' },
      { name: '@dshfiles/rebuilt', builtAt: startedAt + 5_000, sourcesAt: startedAt - 5_000, reason: 'built-after-start' },
    ])
  })

  it('ignores sub-second mtime noise so a rebuild is not reported for nothing', () => {
    expect(LiveInstanceModel.staleBundles([{ name: '@dshfiles/noise', builtAt: 1_000_000, sourcesAt: 1_000_500 }], 2_000_000)).toEqual([])
  })
})
