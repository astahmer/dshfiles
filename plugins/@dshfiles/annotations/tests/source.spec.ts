import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { BundleSources } from '../src/source.js'

const bundle = async (root: string): Promise<string> => {
  const dist = join(root, 'fake-plugin', 'dist')
  await mkdir(dist, { recursive: true })
  await writeFile(join(dist, 'client.js'), 'const styles={"primary":"_primary_abc12"};export{styles}\n', 'utf8')
  await writeFile(
    join(dist, 'client.js.map'),
    JSON.stringify({
      version: 3,
      sources: ['../src/tab-strip.module.css'],
      sourcesContent: ['.primary{color:red}\n.secondary{color:blue}'],
      mappings: 'AAAA',
      names: [],
    }),
    'utf8',
  )
  return root
}

const temporary: string[] = []

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-annotations-'))
  temporary.push(root)
  return await bundle(root)
}

afterEach(() => {
  temporary.length = 0
})

describe('source resolver', () => {
  it('lists built client bundles', async () => {
    const root = await temporaryRoot()
    const bundles = await BundleSources.listBundles({ root })
    expect(bundles.map(entry => entry.name)).toEqual(['fake-plugin'])
  })

  it('maps a class hash to its module source', async () => {
    const root = await temporaryRoot()
    const resolver = BundleSources.createSourceResolver({ roots: [root] })
    const matches = await resolver.resolve(['_primary_abc12'])
    expect(matches).toHaveLength(1)
    expect(matches[0]?.file.endsWith('src/tab-strip.module.css')).toBe(true)
    expect(matches[0]?.confidence).toBe('map')
  })

  it('falls back to text in the original source', async () => {
    const root = await temporaryRoot()
    const resolver = BundleSources.createSourceResolver({ roots: [root] })
    const matches = await resolver.resolveText(['color:blue'])
    expect(matches[0]?.line).toBe(2)
    expect(matches[0]?.confidence).toBe('text')
  })

  it('returns no match rather than guessing', async () => {
    const root = await temporaryRoot()
    const resolver = BundleSources.createSourceResolver({ roots: [root] })
    expect(await resolver.resolve(['_missing_class'])).toEqual([])
  })

  it('records the resolve span', async () => {
    const root = await temporaryRoot()
    using recorder = recordSpans()
    const resolver = BundleSources.createSourceResolver({ roots: [root] })
    await resolver.resolve(['_primary_abc12'])
    expect(recorder.span('annotations resolve source')).toBeDefined()
  })

  it('derives the bundle root from the Host module URL', async () => {
    const roots = await BundleSources.discoverPluginRoots({
      start: '/tmp',
      env: {},
      moduleUrl: 'file:///checkout/plugins/@dshfiles/annotations/dist/index.js',
    })
    expect(roots).toEqual(['/checkout/plugins/@dshfiles'])
  })

  it('discovers the checkout from DSHFILES_DIR', async () => {
    const roots = await BundleSources.discoverPluginRoots({ start: '/tmp', env: { DSHFILES_DIR: '/checkout' } })
    expect(roots).toEqual([join('/checkout', 'plugins', '@dshfiles')])
  })
})

describe('classCandidates', () => {
  it('keeps CSS-module names and drops bare utilities', () => {
    expect(BundleSources.classCandidates('div.uV2eYG_row > button.dshx\\:inline-flex.cta')).toEqual(['uV2eYG_row'])
  })

  it('returns nothing for a selector without a module class', () => {
    expect(BundleSources.classCandidates('button.cta')).toEqual([])
  })
})
