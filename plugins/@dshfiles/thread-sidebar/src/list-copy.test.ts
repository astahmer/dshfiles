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
