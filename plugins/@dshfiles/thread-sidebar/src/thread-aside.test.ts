import { describe, expect, it } from 'vitest'
import { threadAsideAddress, threadAsideSessionId } from './thread-aside.js'

describe('thread aside address', () => {
  it('round-trips one session id', () => {
    expect(threadAsideSessionId(threadAsideAddress('session-1'))).toBe('session-1')
  })

  it('keeps an id that needs encoding intact', () => {
    const address = threadAsideAddress('session/with space')
    expect(address).toBe('dsh-resource://threadaside/session/session%2Fwith%20space')
    expect(threadAsideSessionId(address)).toBe('session/with space')
  })

  it('rejects another protocol, another type, and an empty id', () => {
    expect(threadAsideSessionId('dsh-resource://btwchat/session/session-1')).toBeUndefined()
    expect(threadAsideSessionId('dsh-resource://threadaside/other/session-1')).toBeUndefined()
    expect(threadAsideSessionId('dsh-resource://threadaside/session/')).toBeUndefined()
  })
})
