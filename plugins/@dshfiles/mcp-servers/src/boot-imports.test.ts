import { bootImports } from '@dshfiles/plugin-ui/testing/boot-imports'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

test('page boot does not parse the MCP servers manager; the quick panel, which the composer mounts, stays in it', () => {
  const boot = bootImports(fileURLToPath(new URL('./client.tsx', import.meta.url)))
  expect(boot.has('client.tsx')).toBe(true)
  expect(boot.has('manager-view.tsx')).toBe(false)
  // The composer mounts the quick panel with every thread, so a lazy quick panel only adds a request at boot.
  expect(boot.has('mcp-quick-panel.tsx')).toBe(true)
})
