import { expect, test } from 'vitest'
import { newThreadShortcutDefaults } from './new-thread-shortcut.js'

test('new thread uses primary+T on Desktop and has no Web default', () => {
  expect(newThreadShortcutDefaults).toEqual({
    'desktop:macos': { code: 'KeyT', modifiers: ['primary'] },
    'desktop:windows': { code: 'KeyT', modifiers: ['primary'] },
    'desktop:linux': { code: 'KeyT', modifiers: ['primary'] },
  })
})
