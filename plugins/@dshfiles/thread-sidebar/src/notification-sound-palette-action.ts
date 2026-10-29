import type { PaletteAction } from '@dshfiles/command-palette/palette-contract'
import type { ThreadSidebarTranslate } from './thread-view-manager.js'
import { storedNotificationSoundsMuted, storedNotificationsMuted } from './thread-notifications.js'

export const createNotificationSoundPaletteAction = (t: ThreadSidebarTranslate): PaletteAction & { readonly label: () => string } => ({
  id: '@dshfiles/thread-sidebar/notification-sounds/toggle',
  label: () => t(storedNotificationSoundsMuted.get() === true ? 'threadSidebarUnmuteNotificationSounds' : 'threadSidebarMuteNotificationSounds'),
  aliases: ['mute sounds', 'unmute sounds', 'notification sound'],
  group: 'command',
  run: () => {
    storedNotificationSoundsMuted.set(storedNotificationSoundsMuted.get() !== true)
  },
})

export const createNotificationSnoozePaletteAction = (t: ThreadSidebarTranslate): PaletteAction & { readonly label: () => string } => ({
  id: '@dshfiles/thread-sidebar/notifications/toggle',
  label: () => t(storedNotificationsMuted.get() === true ? 'threadSidebarResumeNotifications' : 'threadSidebarSnoozeNotifications'),
  aliases: ['snooze notifications', 'silent mode', 'resume notifications'],
  group: 'command',
  run: () => {
    storedNotificationsMuted.set(storedNotificationsMuted.get() !== true)
  },
})
