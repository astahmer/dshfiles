import { describe, expect, it } from 'vitest'
import { RpcFailure } from './rpc-failure.ts'

const KEPT = 'Your message is kept; send it again once DSH is back.'

describe('a Host call that failed, in one sentence', () => {
  it('says DSH could not be reached for a failed fetch, keeping the draft, with no code or endpoint', () => {
    const error = { code: 'gateway/internal', message: 'client api: session/prompt failed: Failed to fetch' }
    expect(RpcFailure.sentence({ subject: 'Your message', error, kept: KEPT })).toBe(`Could not reach DSH. ${KEPT}`)
  })

  it('reads a tunnel that answered 502 as DSH being away', () => {
    const error = { code: 'gateway/internal', message: 'transport failure for /api/session/prompt: HTTP 502' }
    expect(RpcFailure.sentence({ subject: 'Your message', error, kept: KEPT })).toBe(`Could not reach DSH. ${KEPT}`)
  })

  it("shows a handler's own plain sentence without its code", () => {
    const error = { code: 'command/rejected', message: 'plan mode is not available in this thread' }
    expect(RpcFailure.sentence({ subject: 'Plan mode', error })).toBe('Plan mode is not available in this thread.')
  })
})
