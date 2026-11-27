import { bootImports } from '@dshfiles/plugin-ui/testing/boot-imports'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

test('page boot does not parse the Usage page, its charts or the Cost facet; they load when one opens', () => {
  const boot = bootImports(fileURLToPath(new URL('./client.tsx', import.meta.url)))
  expect(boot.has('client.tsx')).toBe(true)
  const views = ['panel.tsx', 'charts.tsx', 'account-usage-dashboard.tsx', 'thread-cost-facet.tsx', 'api.ts']
  expect(views.filter(view => boot.has(view))).toEqual([])
})
