import { bootImports } from '@dshfiles/plugin-ui/testing/boot-imports'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

test('page boot does not parse the Backlog page; it loads when the page opens', () => {
  const boot = bootImports(fileURLToPath(new URL('./client-entry.tsx', import.meta.url)))
  expect(boot.has('client-entry.tsx')).toBe(true)
  expect(boot.has('backlog-panel.tsx')).toBe(false)
})
