import type { PaletteAction } from '@dshfiles/command-palette/api'
import type { ThreadSidebarTranslate } from './thread-view-manager.js'
import { storedNotificationSoundsMuted } from './thread-notifications.js'

export const createNotificationSoundPaletteAction = (t: ThreadSidebarTranslate): PaletteAction & { readonly label: () => string } => ({
  id: '@dshfiles/thread-sidebar/notification-sounds/toggle',
  label: () => t(storedNotificationSoundsMuted.get() === true ? 'threadSidebarUnmuteNotificationSounds' : 'threadSidebarMuteNotificationSounds'),
  aliases: ['mute sounds', 'unmute sounds', 'notification sound'],
  group: 'command',
  run: () => {
    storedNotificationSoundsMuted.set(storedNotificationSoundsMuted.get() !== true)
  },
})
