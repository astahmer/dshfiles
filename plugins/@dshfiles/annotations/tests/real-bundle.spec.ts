import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AnnotationSources } from '../src/source.js'

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const bundleRoot = dirname(pluginRoot)
const built = existsSync(join(pluginRoot, 'dist/client.js.map'))

describe.skipIf(!built)('source resolver against the built bundle', () => {
  it('finds a label from this plugin in its own source map', async () => {
    const resolver = AnnotationSources.createSourceResolver({ roots: [bundleRoot] })
    const matches = await resolver.resolveText(['Annotate an element'])
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0]?.file.endsWith('src/ui/annotations-action.tsx')).toBe(true)
    expect(matches[0]?.confidence).toBe('text')
  })
})
