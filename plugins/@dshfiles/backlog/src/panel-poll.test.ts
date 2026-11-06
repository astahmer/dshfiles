import { describe, expect, it } from 'vitest'
import { BacklogPanelPoll } from './panel-poll.js'

const snapshot = (status: 'success' | 'error') => ({ status, data: { active: false }, error: undefined, updatedAt: 1, fetching: false })

describe('BacklogPanelPoll', () => {
  it('polls the revision every 5 s, and only every minute while the Host pushes changes', () => {
    expect(BacklogPanelPoll.revision).toEqual({ pollInterval: 5_000, livePollInterval: 60_000 })
  })

  it('polls AI activity every second until a read fails', () => {
    expect(BacklogPanelPoll.aiActivity.pollInterval).toBe(1_000)
    expect(BacklogPanelPoll.aiActivity.shouldPoll(snapshot('success'))).toBe(true)
    expect(BacklogPanelPoll.aiActivity.shouldPoll(snapshot('error'))).toBe(false)
  })
})
