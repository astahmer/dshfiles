import { bootImports } from '@dshfiles/plugin-ui/testing/boot-imports'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

test('page boot does not parse the whiteboard pages; they load when one opens', () => {
  const boot = bootImports(fileURLToPath(new URL('./client.tsx', import.meta.url)))
  expect(boot.has('client.tsx')).toBe(true)
  expect(['board-view.tsx', 'boards-panel.tsx'].filter(file => boot.has(file))).toEqual([])
})
