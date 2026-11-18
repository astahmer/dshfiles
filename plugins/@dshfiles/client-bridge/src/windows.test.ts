import { describe, expect, it } from 'vitest'
import { BridgeLimits, type WindowState } from './api.js'
import { BridgeWindows, type KnownWindow } from './windows.js'

const tool = (name: string) => ({ name, title: name, description: name, readOnly: false, inputSchema: {} })

const state = (clientId: string, overrides: Partial<WindowState> = {}): WindowState => ({
  clientId,
  label: 'Chrome on macOS',
  focused: false,
  visible: true,
  sessionId: null,
  tools: [tool('settings_open')],
  ...overrides,
})

const known = (clientId: string, lastActiveAt: number, overrides: Partial<WindowState> = {}): KnownWindow => ({
  ...state(clientId, overrides),
  lastSeenAt: lastActiveAt,
  lastActiveAt,
})

describe('client-bridge windows', () => {
  it('prefers the window showing the caller’s thread, then focus, then recency', () => {
    const windows = [known('old', 1), known('focused', 2, { focused: true }), known('mine', 0, { sessionId: 's1' })]
    expect(BridgeWindows.pick({ windows, sessionId: 's1', tool: 'settings_open', clientId: undefined })).toMatchObject({
      kind: 'picked',
      window: { clientId: 'mine' },
    })
    expect(BridgeWindows.pick({ windows, sessionId: 'other', tool: 'settings_open', clientId: undefined })).toMatchObject({
      kind: 'picked',
      window: { clientId: 'focused' },
    })
  })

  it('lets the Agent name the window', () => {
    const windows = [known('a', 1, { focused: true }), known('b', 0)]
    expect(BridgeWindows.pick({ windows, sessionId: undefined, tool: 'settings_open', clientId: 'b' })).toMatchObject({
      kind: 'picked',
      window: { clientId: 'b' },
    })
    expect(BridgeWindows.pick({ windows, sessionId: undefined, tool: 'settings_open', clientId: 'gone' })).toEqual({ kind: 'unknown-window', clientId: 'gone' })
  })

  it('skips to a window that offers the tool, and says when none does', () => {
    const windows = [known('bare', 5, { focused: true, tools: [] }), known('tabs', 1, { tools: [tool('tabs_open')] })]
    expect(BridgeWindows.pick({ windows, sessionId: undefined, tool: 'tabs_open', clientId: undefined })).toMatchObject({
      kind: 'picked',
      window: { clientId: 'tabs' },
    })
    expect(BridgeWindows.pick({ windows, sessionId: undefined, tool: 'nope', clientId: undefined })).toMatchObject({ kind: 'unknown-tool' })
    expect(BridgeWindows.pick({ windows: [], sessionId: undefined, tool: 'tabs_open', clientId: undefined })).toEqual({ kind: 'no-window' })
  })

  it('forgets a window it has not heard from within the TTL', () => {
    const windows = [known('fresh', 1_000), known('stale', 0)]
    expect(BridgeWindows.live(windows, BridgeLimits.windowTtlMs + 500).map(window => window.clientId)).toEqual(['fresh'])
  })

  it('keeps the last focus time while a window stays in the background', () => {
    const first = BridgeWindows.announce(undefined, state('a', { focused: true }), 10)
    const blurred = BridgeWindows.announce(first, state('a', { focused: false }), 20)
    expect(blurred).toMatchObject({ lastSeenAt: 20, lastActiveAt: 10 })
  })

  it('marks the windows that show the caller’s thread', () => {
    const view = BridgeWindows.view([known('a', 1), known('b', 0, { sessionId: 's1' })], 's1')
    expect(view.map(window => [window.clientId, window.showsYourThread])).toEqual([
      ['b', true],
      ['a', false],
    ])
  })
})
