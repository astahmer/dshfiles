import { describe, expect, it } from 'vitest'
import { BootWarning } from '../src/scratch/boot-warning.js'

const hostLog = [
  'dsh: warning: 2 entries did not activate',
  'dshfiles-session-controller (@dshfiles/session-controller): pending (waiting for service: sessionQuery)',
  'thread-sidebar (@dshfiles/thread-sidebar): pending (waiting for services: sessionController, sessionQuery)',
  'dsh web: http://localhost:4100/?token=X',
].join('\n')

describe('boot warning', () => {
  it('treats entries that activated after the boot snapshot as a late activation', () => {
    expect(BootWarning.lateActivation({ hostLog, activeIds: new Set(['dshfiles-session-controller', 'thread-sidebar']) })).toEqual({
      header: 'dsh: warning: 2 entries did not activate',
      entries: ['dshfiles-session-controller', 'thread-sidebar'],
    })
  })

  it('keeps the warning when a listed entry is still not active', () => {
    expect(BootWarning.lateActivation({ hostLog, activeIds: new Set(['dshfiles-session-controller']) })).toBeUndefined()
  })

  it('keeps the warning when the block names a failed entry', () => {
    const failed = hostLog.replace('thread-sidebar): pending', 'thread-sidebar): failed')
    expect(BootWarning.lateActivation({ hostLog: failed, activeIds: new Set(['dshfiles-session-controller', 'thread-sidebar']) })).toBeUndefined()
  })

  it('finds nothing in a log without the warning', () => {
    expect(BootWarning.lateActivation({ hostLog: 'dsh web: http://localhost:4100/', activeIds: new Set() })).toBeUndefined()
  })
})
