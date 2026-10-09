import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  closePalette,
  getPaletteActions,
  getPaletteMode,
  getPaletteRecentLimit,
  openPalette,
  registerPaletteAction,
  setPaletteRecentLimit,
  subscribePaletteActions,
  type PaletteAction,
  type PaletteActionContext,
} from './palette-api.js'

const context: PaletteActionContext = {
  thread: {
    id: 'session-1',
    title: 'Example',
    cwd: '/repo',
    workspaceId: 'workspace-1',
    pinned: false,
    archived: false,
    unread: false,
  },
  workspace: { id: 'workspace-1', title: 'Repo' },
  workspaces: [{ id: 'workspace-1', title: 'Repo' }],
  themePreference: 'system',
}

const registeredDisposers: Array<() => void> = []
beforeEach(() => vi.stubGlobal('window', {}))
afterEach(() => {
  for (const dispose of registeredDisposers.splice(0)) dispose()
  closePalette()
  setPaletteRecentLimit(10)
  vi.unstubAllGlobals()
})

test('registrations publish actions, notify subscribers, and dispose cleanly', () => {
  let notifications = 0
  const unsubscribe = subscribePaletteActions(() => notifications++)
  const action: PaletteAction = {
    id: '@dshfiles/example/open-panel',
    label: 'Open panel',
    isAvailable: current => current.thread !== null,
    run: () => undefined,
  }
  const dispose = registerPaletteAction(action)
  registeredDisposers.push(dispose)
  expect(getPaletteActions()).toContainEqual(action)
  expect(getPaletteActions()[0]?.isAvailable?.(context)).toBe(true)
  dispose()
  expect(getPaletteActions()).not.toContainEqual(action)
  expect(notifications).toBe(2)
  unsubscribe()
})

test('duplicate and un-namespaced action IDs are rejected', () => {
  const action: PaletteAction = { id: '@dshfiles/example/open-panel', label: 'Open panel', run: () => undefined }
  const dispose = registerPaletteAction(action)
  registeredDisposers.push(dispose)
  expect(() => registerPaletteAction(action)).toThrow(/already registered/u)
  expect(() => registerPaletteAction({ ...action, id: 'open-panel' })).toThrow(/invalid definition/u)
})

test('palette mode and recent limit share the browser registry across API calls', () => {
  openPalette('threads')
  setPaletteRecentLimit(20)
  expect(getPaletteMode()).toBe('threads')
  expect(getPaletteRecentLimit()).toBe(20)
  expect(() => setPaletteRecentLimit(51)).toThrow()
})
