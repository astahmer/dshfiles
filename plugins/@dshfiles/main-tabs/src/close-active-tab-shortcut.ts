import type { ShortcutBinding, ShortcutCommand } from '@deepseek-ai/dsh-client-shortcuts/client'

export const closeActiveTabShortcutBinding = { code: 'KeyW', modifiers: ['primary'] } satisfies ShortcutBinding

export const closeActiveTabShortcutDefaults = {
  'desktop:macos': closeActiveTabShortcutBinding,
  'desktop:windows': closeActiveTabShortcutBinding,
  'desktop:linux': closeActiveTabShortcutBinding,
} satisfies ShortcutCommand['defaults']
