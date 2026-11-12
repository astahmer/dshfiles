import { describe, expect, it } from 'vitest'
import { AgentPresetMenuRequests } from '../src/native/menu-requests.ts'

describe('agent mode menu requests (b:4v6p)', () => {
  it('opens the mounted chip and says when none is mounted', () => {
    expect(AgentPresetMenuRequests.available()).toBe(false)
    expect(AgentPresetMenuRequests.open()).toBe(false)
    let opened = 0
    const stop = AgentPresetMenuRequests.subscribe(() => {
      opened += 1
    })
    expect(AgentPresetMenuRequests.available()).toBe(true)
    expect(AgentPresetMenuRequests.open()).toBe(true)
    expect(opened).toBe(1)
    stop()
    expect(AgentPresetMenuRequests.available()).toBe(false)
  })
})
