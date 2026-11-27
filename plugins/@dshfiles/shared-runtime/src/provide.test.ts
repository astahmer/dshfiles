import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import config from '../dshx.config.js'

const provided = (): readonly string[] => config.client.sharedRuntime.provide

test('serves the kit components every boot bundle copied once, and keeps per-plugin state per plugin', () => {
  const kit = provided().filter(specifier => specifier.startsWith('@dshfiles/plugin-ui/'))
  for (const specifier of ['components/ui/button', 'components/ui/input', 'components/page', 'components/work-status', 'lib/utils', 'motion'])
    expect(kit).toContain(`@dshfiles/plugin-ui/${specifier}`)
  // query holds one QueryClient per plugin; icons is a lucide barrel; diff/chart/table/virtual are heavy or page-only.
  for (const kept of ['query', 'icons', 'diff', 'chart', 'table', 'virtual']) expect(kit).not.toContain(`@dshfiles/plugin-ui/${kept}`)
})

test('every provided kit specifier resolves to a source file', () => {
  const require = createRequire(fileURLToPath(import.meta.url))
  const unresolved = provided()
    .filter(specifier => specifier.startsWith('@dshfiles/plugin-ui/'))
    .filter(specifier => {
      try {
        return !existsSync(require.resolve(specifier))
      } catch {
        return true
      }
    })
  expect(unresolved).toEqual([])
})
