import { bootImports } from '@dshfiles/plugin-ui/testing/boot-imports'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

test('page boot does not parse the editor or Artifacts pages; they load when one opens', () => {
  const boot = bootImports(fileURLToPath(new URL('./client-entry.tsx', import.meta.url)))
  expect(boot.has('client-entry.tsx')).toBe(true)
  expect(['artifacts-panel.tsx', 'editor-panel.tsx'].filter(file => boot.has(file))).toEqual([])
})
