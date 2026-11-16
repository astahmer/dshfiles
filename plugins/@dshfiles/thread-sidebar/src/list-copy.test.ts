import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const locales = readFileSync(fileURLToPath(new URL('./locales.ts', import.meta.url)), 'utf8')
/** The English table is the first one in the file. */
const english = locales.slice(0, locales.indexOf('const zh'))

test('an unfiltered status reads "Any", not "None"', () => {
  // "Status: None" read as an error, or as "threads with no status"; the filter is simply not narrowing the list.
  expect(english).toContain("threadSidebarFilterNone: 'Any',")
})

test('an unsent draft is a new thread, not a chat', () => {
  // Glossary: thread, never chat. The row of the open blank draft read "New chat".
  expect(english).toContain("threadSidebarNewChat: 'New thread',")
})

test('the restart notice says what to do next when DSH cannot restart itself', () => {
  // "Restart DSH yourself to load them." named no step: the next action is in the terminal that runs DSH.
  expect(english).toMatch(/threadSidebarUpdatesManual: '[^']*stop DSH in the terminal[^']*start it again[^']*',/u)
})
