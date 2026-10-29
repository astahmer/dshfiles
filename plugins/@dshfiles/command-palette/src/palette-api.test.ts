import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { PaletteApi } from './palette-api.js'
import type { PaletteAction, PaletteActionContext } from './palette-contract.js'

const context: PaletteActionContext = {
  thread: {
    id: 'session-1',
    title: 'Example',
    cwd: '/repo',
    workspaceId: 'workspace-1',
    pinned: false,
    archived: false,
  },
  workspace: { id: 'workspace-1', title: 'Repo' },
  workspaces: [{ id: 'workspace-1', title: 'Repo' }],
  themePreference: 'system',
}

const registeredDisposers: Array<() => void> = []
beforeEach(() => vi.stubGlobal('window', {}))
afterEach(() => {
  for (const dispose of registeredDisposers.splice(0)) dispose()
  PaletteApi.close()
  PaletteApi.setRecentLimit(10)
  vi.unstubAllGlobals()
})

test('registrations publish actions, notify subscribers, and dispose cleanly', () => {
  let notifications = 0
  const unsubscribe = PaletteApi.subscribe(() => notifications++)
  const initialSnapshot = PaletteApi.getSnapshot()
  expect(PaletteApi.getSnapshot()).toBe(initialSnapshot)
  const action: PaletteAction = {
    id: '@dshfiles/example/open-panel',
    label: 'Open panel',
    isAvailable: current => current.thread !== null,
    run: () => undefined,
  }
  const dispose = PaletteApi.registerAction(action)
  registeredDisposers.push(dispose)
  const registeredSnapshot = PaletteApi.getSnapshot()
  expect(registeredSnapshot).not.toBe(initialSnapshot)
  expect(PaletteApi.getSnapshot()).toBe(registeredSnapshot)
  expect(registeredSnapshot.actions).toContainEqual(action)
  expect(registeredSnapshot.actions[0]?.isAvailable?.(context)).toBe(true)
  dispose()
  expect(PaletteApi.getSnapshot()).not.toBe(registeredSnapshot)
  expect(PaletteApi.getSnapshot().actions).not.toContainEqual(action)
  expect(notifications).toBe(2)
  unsubscribe()
})

test('duplicate and un-namespaced action IDs are rejected', () => {
  const action: PaletteAction = { id: '@dshfiles/example/open-panel', label: 'Open panel', run: () => undefined }
  const dispose = PaletteApi.registerAction(action)
  registeredDisposers.push(dispose)
  expect(() => PaletteApi.registerAction(action)).toThrow(/already registered/u)
  expect(() => PaletteApi.registerAction({ ...action, id: 'open-panel' })).toThrow(/invalid definition/u)
})

test('palette mode and recent limit share the browser registry across API calls', () => {
  PaletteApi.open('threads')
  PaletteApi.setRecentLimit(20)
  expect(PaletteApi.getSnapshot().mode).toBe('threads')
  expect(PaletteApi.getSnapshot().recentLimit).toBe(20)
  expect(() => PaletteApi.setRecentLimit(51)).toThrow()
})
