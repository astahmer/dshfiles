import { bootImports } from '@dshfiles/plugin-ui/testing/boot-imports'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

test('page boot does not parse the Secrets page; it loads when the page opens', () => {
  const boot = bootImports(fileURLToPath(new URL('./client.tsx', import.meta.url)))
  expect(boot.has('client.tsx')).toBe(true)
  expect(boot.has('secret-catalog-panel.tsx')).toBe(false)
})
