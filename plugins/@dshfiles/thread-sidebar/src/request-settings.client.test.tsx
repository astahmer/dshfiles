// @vitest-environment jsdom
import { OPEN_SETTINGS_EVENT } from '@dshfiles/settings-shell/open-settings'
import { afterEach, expect, it, vi } from 'vitest'
import { requestSettings } from './sidebar-shell.js'

const opened = vi.fn((event: Event) => event.preventDefault())
afterEach(() => window.removeEventListener(OPEN_SETTINGS_EVENT, opened))

it('opens Settings on every press and never runs the toggling command while the shell answers', () => {
  window.addEventListener(OPEN_SETTINGS_EVENT, opened)
  const runCommand = vi.fn(() => true)
  for (let press = 0; press < 3; press += 1) requestSettings(runCommand)
  expect(opened).toHaveBeenCalledTimes(3)
  expect(runCommand).not.toHaveBeenCalled()
})

it('falls back to the command when no shell answers the open request', () => {
  const runCommand = vi.fn(() => true)
  requestSettings(runCommand)
  expect(runCommand).toHaveBeenCalledWith('settings.open')
})
