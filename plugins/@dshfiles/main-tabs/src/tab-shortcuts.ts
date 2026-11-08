import type { ShortcutBinding, ShortcutCommand } from '@deepseek-ai/dsh-client-shortcuts/client'

/** One main-tabs command's default chords. Pure data, so the cross-plugin collision test reads the real table. */
export interface TabShortcutBinding {
  readonly id: string
  /** Absent when another registered command already owns this chord on every desktop shell. */
  readonly desktop?: ShortcutBinding
  /** Desktop Linux reserves Tab, so cycling uses Ctrl+Shift+] / [ there. */
  readonly linux?: ShortcutBinding
  readonly web?: ShortcutBinding
}

const goTo = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((index): TabShortcutBinding => ({
  id: `mainTabs.goTo${index}`,
  desktop: { code: `Digit${index}`, modifiers: ['primary'] },
  web: { code: `Digit${index}`, modifiers: ['primary', 'alt'] },
}))

export const tabShortcutBindings: readonly TabShortcutBinding[] = [
  // Mod+T is the command palette's New thread on every desktop shell, so New tab uses its Web chord there too.
  { id: 'mainTabs.newTab', desktop: { code: 'KeyT', modifiers: ['primary', 'alt'] }, web: { code: 'KeyT', modifiers: ['primary', 'alt'] } },
  {
    id: 'mainTabs.reopenClosed',
    desktop: { code: 'KeyT', modifiers: ['primary', 'shift'] },
    web: { code: 'KeyT', modifiers: ['primary', 'alt', 'shift'] },
  },
  // DSH's own page.close owns Mod+W on every desktop shell, and the Host's shortcut registry
  // refuses two commands that claim one default, so this command ships without a default and
  // stays rebindable in Settings › Shortcuts instead of failing to register on every launch.
  { id: 'mainTabs.closeActive' },
  {
    id: 'mainTabs.next',
    desktop: { code: 'Tab', modifiers: ['control'] },
    linux: { code: 'BracketRight', modifiers: ['control', 'shift'] },
    web: { code: 'BracketRight', modifiers: ['primary', 'alt'] },
  },
  {
    id: 'mainTabs.previous',
    desktop: { code: 'Tab', modifiers: ['control', 'shift'] },
    linux: { code: 'BracketLeft', modifiers: ['control', 'shift'] },
    web: { code: 'BracketLeft', modifiers: ['primary', 'alt'] },
  },
  ...goTo,
]

/** The per-shell defaults the Host registry receives for one command. */
export const tabShortcutDefaults = (binding: TabShortcutBinding): ShortcutCommand['defaults'] => {
  if (binding.desktop === undefined) return {}
  const defaults: ShortcutCommand['defaults'] = {
    'desktop:macos': binding.desktop,
    'desktop:windows': binding.desktop,
    'desktop:linux': binding.linux ?? binding.desktop,
  }
  if (binding.web === undefined) return defaults
  return { ...defaults, 'web:macos': binding.web, 'web:windows': binding.web }
}
