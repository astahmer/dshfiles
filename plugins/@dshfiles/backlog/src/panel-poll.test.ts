import { describe, expect, it } from 'vitest'
import { BacklogPanelPoll } from './panel-poll.js'

describe('BacklogPanelPoll', () => {
  it('polls the revision every 5 s only while the panel is visible', () => {
    expect(BacklogPanelPoll.revisionMs({ visible: true })).toBe(5_000)
    expect(BacklogPanelPoll.revisionMs({ visible: false })).toBe(false)
  })

  it('polls AI activity every second only while visible and healthy', () => {
    expect(BacklogPanelPoll.aiActivityMs({ visible: true, failed: false })).toBe(1_000)
    expect(BacklogPanelPoll.aiActivityMs({ visible: true, failed: true })).toBe(false)
    expect(BacklogPanelPoll.aiActivityMs({ visible: false, failed: false })).toBe(false)
    expect(BacklogPanelPoll.aiActivityMs({ visible: false, failed: true })).toBe(false)
  })

  it('refreshes once when a hidden panel is shown, never on first mount or while it stays put', () => {
    expect(BacklogPanelPoll.shouldRefreshOnReveal({ wasVisible: false, visible: true })).toBe(true)
    expect(BacklogPanelPoll.shouldRefreshOnReveal({ wasVisible: undefined, visible: true })).toBe(false)
    expect(BacklogPanelPoll.shouldRefreshOnReveal({ wasVisible: true, visible: true })).toBe(false)
    expect(BacklogPanelPoll.shouldRefreshOnReveal({ wasVisible: true, visible: false })).toBe(false)
    expect(BacklogPanelPoll.shouldRefreshOnReveal({ wasVisible: false, visible: false })).toBe(false)
  })
})
