import { bootImports } from '@dshfiles/plugin-ui/testing/boot-imports'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

test('page boot does not parse the revision graph panel; it loads when History opens', () => {
  const boot = bootImports(fileURLToPath(new URL('./client-entry.tsx', import.meta.url)))
  expect(boot.has('client-entry.tsx')).toBe(true)
  expect(boot.has('client.tsx')).toBe(false)
  expect(boot.has('source-control-view.tsx')).toBe(false)
})
