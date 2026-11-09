import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newThreadShortcutDefaults } from '../plugins/@dshfiles/command-palette/src/new-thread-shortcut.ts'
import { tabShortcutBindings, tabShortcutDefaults } from '../plugins/@dshfiles/main-tabs/src/tab-shortcuts.ts'

/**
 * The Host shortcut registry refuses a second command that claims a default chord another command already owns, so
 * a collision leaves one command unbound and logs a conflict on every launch. These are the shipped defaults of the
 * plugins that bind global chords, plus the DSH core commands they sit beside (core is not importable as source; its
 * rows restate `@deepseek-ai/dsh-client-ui-workspace` session.new and `page.close` at 0.2.1-rc.2).
 */
const core = [
  {
    id: 'session.new',
    defaults: {
      'desktop:macos': { code: 'KeyN', modifiers: ['primary'] },
      'desktop:windows': { code: 'KeyN', modifiers: ['primary'] },
      'desktop:linux': { code: 'KeyN', modifiers: ['primary'] },
      'web:macos': { code: 'KeyN', modifiers: ['primary', 'alt'] },
      'web:windows': { code: 'KeyN', modifiers: ['primary', 'alt'] },
    },
  },
  {
    id: 'page.close',
    defaults: {
      'desktop:macos': { code: 'KeyW', modifiers: ['primary'] },
      'desktop:windows': { code: 'KeyW', modifiers: ['primary'] },
      'desktop:linux': { code: 'KeyW', modifiers: ['primary'] },
    },
  },
]

const commands = [
  ...core,
  { id: 'commandPalette.newThread', defaults: newThreadShortcutDefaults },
  ...tabShortcutBindings.map(binding => ({ id: binding.id, defaults: tabShortcutDefaults(binding) })),
]

const chordOf = binding => [...binding.modifiers].sort().concat(binding.code).join('+')

test('no two shipped commands claim the same default chord on one shell', () => {
  const owners = new Map()
  const collisions = []
  for (const command of commands) {
    for (const [shell, binding] of Object.entries(command.defaults)) {
      const key = `${shell} ${chordOf(binding)}`
      const owner = owners.get(key)
      if (owner === undefined) owners.set(key, command.id)
      else collisions.push(`${key}: ${owner} and ${command.id}`)
    }
  }
  assert.deepEqual(collisions, [])
})

test('New thread keeps Mod+T and New tab moves to Mod+Alt+T', () => {
  const newTab = tabShortcutBindings.find(binding => binding.id === 'mainTabs.newTab')
  assert.deepEqual(newTab?.desktop, { code: 'KeyT', modifiers: ['primary', 'alt'] })
  assert.deepEqual(newThreadShortcutDefaults['desktop:macos'], { code: 'KeyT', modifiers: ['primary'] })
})
