import { bootImports } from '@dshfiles/plugin-ui/testing/boot-imports'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

test('page boot does not parse the Traces page or the thread Traces and Requests views; they load when one opens', () => {
  const boot = bootImports(fileURLToPath(new URL('./client.tsx', import.meta.url)))
  expect(boot.has('client.tsx')).toBe(true)
  expect(['panel.tsx', 'session-view.tsx', 'session-requests-view.tsx', 'trace-detail.tsx'].filter(view => boot.has(view))).toEqual([])
})
