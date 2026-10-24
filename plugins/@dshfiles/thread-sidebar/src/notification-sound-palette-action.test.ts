import assert from 'node:assert/strict'
import { PaletteApi } from '@dshfiles/command-palette/api'
import { beforeEach, test } from 'vitest'
import { createNotificationSoundPaletteAction, createNotificationSnoozePaletteAction } from './notification-sound-palette-action.js'
import { storedNotificationSoundsMuted, storedNotificationsMuted } from './thread-notifications.js'

const labels = {
  threadSidebarMuteNotificationSounds: 'Mute notification sounds',
  threadSidebarUnmuteNotificationSounds: 'Unmute notification sounds',
  threadSidebarSnoozeNotifications: 'Snooze notifications',
  threadSidebarResumeNotifications: 'Resume notifications',
} as const

const translate = (key: Parameters<import('./thread-view-manager.js').ThreadSidebarTranslate>[0]): string => {
  if (key === 'threadSidebarMuteNotificationSounds') return labels.threadSidebarMuteNotificationSounds
  if (key === 'threadSidebarUnmuteNotificationSounds') return labels.threadSidebarUnmuteNotificationSounds
  if (key === 'threadSidebarSnoozeNotifications') return labels.threadSidebarSnoozeNotifications
  if (key === 'threadSidebarResumeNotifications') return labels.threadSidebarResumeNotifications
  return key
}

const registeredAction = () => {
  const action = PaletteApi.getSnapshot().actions.find(candidate => candidate.id === '@dshfiles/thread-sidebar/notification-sounds/toggle')
  assert.ok(action !== undefined)
  return action
}

beforeEach(() => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
    configurable: true,
  })
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true })
  storedNotificationSoundsMuted.set(false)
  storedNotificationsMuted.set(false)
})

test('the palette action label reflects the current mute state', () => {
  const action = createNotificationSoundPaletteAction(translate)
  const dispose = PaletteApi.registerAction(action)
  try {
    assert.equal(action.label(), 'Mute notification sounds')
    storedNotificationSoundsMuted.set(true)
    assert.equal(action.label(), 'Unmute notification sounds')
  } finally {
    dispose()
  }
})

test('the notification palette action toggles silent mode in both directions', () => {
  const action = createNotificationSnoozePaletteAction(translate)
  assert.equal(action.label(), 'Snooze notifications')
  const dispose = PaletteApi.registerAction(action)
  try {
    const registered = PaletteApi.getSnapshot().actions.find(candidate => candidate.id === '@dshfiles/thread-sidebar/notifications/toggle')
    assert.ok(registered !== undefined)
    const context = { thread: null, workspace: null, workspaces: [], themePreference: 'system' as const }
    registered.run(context)
    assert.equal(storedNotificationsMuted.get(), true)
    assert.equal(action.label(), 'Resume notifications')
    registered.run(context)
    assert.equal(storedNotificationsMuted.get(), false)
  } finally {
    dispose()
  }
})

test('executing the palette action toggles shared mute state in both directions', () => {
  const dispose = PaletteApi.registerAction(createNotificationSoundPaletteAction(translate))
  try {
    const action = registeredAction()
    const context = { thread: null, workspace: null, workspaces: [], themePreference: 'system' as const }
    action.run(context)
    assert.equal(storedNotificationSoundsMuted.get(), true)
    action.run(context)
    assert.equal(storedNotificationSoundsMuted.get(), false)
  } finally {
    dispose()
  }
})
