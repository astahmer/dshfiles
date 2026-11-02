import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeFileSystem } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SourceResolver } from '../src/source.js'

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const bundleRoot = dirname(pluginRoot)
const built = existsSync(join(pluginRoot, 'dist/client.js.map'))

describe.skipIf(!built)('source resolver against the built bundle', () => {
  it.effect('finds a label from this plugin in its own source map', () =>
    Effect.gen(function* () {
      const resolver = yield* SourceResolver.make({ roots: [bundleRoot] })
      const matches = yield* resolver.resolveText(['Annotate an element'])
      expect(matches.length).toBeGreaterThan(0)
      expect(matches[0]?.file.endsWith('src/ui/annotations-action.tsx')).toBe(true)
      expect(matches[0]?.confidence).toBe('text')
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  )
})
