import { bootImports } from '@dshfiles/plugin-ui/testing/boot-imports'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

test('page boot does not parse the account pages; they load when one opens', () => {
  const boot = bootImports(fileURLToPath(new URL('./client.tsx', import.meta.url)))
  expect(boot.has('client.tsx')).toBe(true)
  const pages = ['accounts-panel.tsx', 'usage-history-panel.tsx', 'quota-forecast-panel.tsx', 'quota-accounts-view.tsx', 'models-page-accounts.tsx', 'settings-section.tsx']
  expect(pages.filter(page => boot.has(page))).toEqual([])
})
