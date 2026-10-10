import type { ShortcutCommand } from '@deepseek-ai/dsh-client-shortcuts/client'

export const newThreadShortcutDefaults = {
  'desktop:macos': { code: 'KeyT', modifiers: ['primary'] },
  'desktop:windows': { code: 'KeyT', modifiers: ['primary'] },
  'desktop:linux': { code: 'KeyT', modifiers: ['primary'] },
} satisfies ShortcutCommand['defaults']
