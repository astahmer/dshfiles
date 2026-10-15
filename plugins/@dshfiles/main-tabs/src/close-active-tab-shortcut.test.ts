import { expect, test } from 'vitest'
import { closeActiveTabShortcutDefaults } from './close-active-tab-shortcut.js'

test('close active tab uses primary+W on Desktop and has no Web default', () => {
  expect(closeActiveTabShortcutDefaults).toEqual({
    'desktop:macos': { code: 'KeyW', modifiers: ['primary'] },
    'desktop:windows': { code: 'KeyW', modifiers: ['primary'] },
    'desktop:linux': { code: 'KeyW', modifiers: ['primary'] },
  })
})
