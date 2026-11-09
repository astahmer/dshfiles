import type { ShortcutCommand } from '@deepseek-ai/dsh-client-shortcuts/client'

/**
 * Desktop Mod+T. main-tabs' New tab takes Mod+Alt+T instead (its Web default too); the Host registry refuses a second
 * command claiming one chord, which left one of them unbound and logged a conflict on every launch.
 */
export const newThreadShortcutDefaults = {
  'desktop:macos': { code: 'KeyT', modifiers: ['primary'] },
  'desktop:windows': { code: 'KeyT', modifiers: ['primary'] },
  'desktop:linux': { code: 'KeyT', modifiers: ['primary'] },
} satisfies ShortcutCommand['defaults']
