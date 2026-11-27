// @vitest-environment jsdom
import { OPEN_SETTINGS_EVENT } from '@dshfiles/settings-shell/open-settings'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestSettings } from './sidebar-shell.js'

describe('requestSettings', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prefers the open-only settings event over the settings.open toggle command', () => {
    const onOpen = vi.fn((event: Event) => event.preventDefault())
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen)
    const runCommand = vi.fn(() => true)
    try {
      requestSettings(runCommand)
      expect(onOpen).toHaveBeenCalledOnce()
      expect(runCommand).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen)
    }
  })

  it('falls back to the settings.open command when settings-shell does not handle the event', () => {
    const runCommand = vi.fn(() => true)
    requestSettings(runCommand)
    expect(runCommand).toHaveBeenCalledWith('settings.open')
  })
})
