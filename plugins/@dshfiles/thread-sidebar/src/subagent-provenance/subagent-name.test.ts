import { describe, expect, it } from 'vitest'
import { subagentName } from './subagent-name.js'

describe('subagentName', () => {
  it('assigns a stable readable name to a session tool call', () => {
    const input = { sessionId: 'session-1', callId: 'call-1' }
    const name = subagentName(input)

    expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
    expect(subagentName(input)).toBe(name)
    expect(subagentName({ ...input, callId: 'call-2' })).not.toBe(name)
    expect(subagentName({ ...input, sessionId: 'session-2' })).not.toBe(name)
  })
})
