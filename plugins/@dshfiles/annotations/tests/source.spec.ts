import { join } from 'node:path'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { NodeFileSystem } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem } from 'effect'
import { classCandidates, discoverPluginRoots, listBundles, SourceResolver } from '../src/source.js'

const bundleRoot = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'dsh-annotations-' })
  const dist = join(root, 'fake-plugin', 'dist')
  yield* fileSystem.makeDirectory(dist, { recursive: true })
  yield* fileSystem.writeFileString(join(dist, 'client.js'), 'const styles={"primary":"_primary_abc12"};export{styles}\n')
  yield* fileSystem.writeFileString(
    join(dist, 'client.js.map'),
    JSON.stringify({
      version: 3,
      sources: ['../src/tab-strip.module.css'],
      sourcesContent: ['.primary{color:red}\n.secondary{color:blue}'],
      mappings: 'AAAA',
      names: [],
    }),
  )
  return root
})

const resolverFor = Effect.flatMap(bundleRoot, root => SourceResolver.make({ roots: [root] }))

/** A bundle whose only mapping decodes to source line 0, the way a minified chunk's segment can. */
const unreadableMappingRoot = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'dsh-annotations-unreadable-' })
  const dist = join(root, 'fake-plugin', 'dist')
  yield* fileSystem.makeDirectory(dist, { recursive: true })
  yield* fileSystem.writeFileString(join(dist, 'client.js'), 'const styles={"bad":"_unreadable_abc12"};export{styles}\n')
  yield* fileSystem.writeFileString(
    join(dist, 'client.js.map'),
    JSON.stringify({ version: 3, sources: ['../src/tab-strip.module.css'], mappings: 'AADA', names: [] }),
  )
  return root
})

describe('source resolver', () => {
  it.layer(NodeFileSystem.layer)(it => {
    it.effect('lists built client bundles', () =>
      Effect.gen(function* () {
        const bundles = yield* listBundles({ root: yield* bundleRoot })
        expect(bundles.map(entry => entry.name)).toEqual(['fake-plugin'])
      }).pipe(Effect.scoped),
    )

    it.effect('maps a class hash to its module source', () =>
      Effect.gen(function* () {
        const matches = yield* (yield* resolverFor).resolve(['_primary_abc12'])
        expect(matches).toHaveLength(1)
        expect(matches[0]?.file.endsWith('src/tab-strip.module.css')).toBe(true)
        expect(matches[0]?.confidence).toBe('map')
      }).pipe(Effect.scoped),
    )

    it.effect('answers no match when the mapped line is one an annotation cannot hold', () =>
      Effect.gen(function* () {
        const resolver = yield* SourceResolver.make({ roots: [yield* unreadableMappingRoot] })
        expect(yield* resolver.resolve(['_unreadable_abc12'])).toEqual([])
      }).pipe(Effect.scoped),
    )

    it.effect('falls back to text in the original source', () =>
      Effect.gen(function* () {
        const matches = yield* (yield* resolverFor).resolveText(['color:blue'])
        expect(matches[0]?.line).toBe(2)
        expect(matches[0]?.confidence).toBe('text')
      }).pipe(Effect.scoped),
    )

    it.effect('returns no match rather than guessing', () =>
      Effect.gen(function* () {
        expect(yield* (yield* resolverFor).resolve(['_missing_class'])).toEqual([])
      }).pipe(Effect.scoped),
    )

    it.effect('records the resolve span', () =>
      Effect.gen(function* () {
        const recorder = yield* Effect.acquireRelease(
          Effect.sync(() => recordSpans()),
          spans => Effect.sync(() => spans[Symbol.dispose]()),
        )
        yield* (yield* resolverFor).resolve(['_primary_abc12'])
        expect(recorder.span('annotations resolve source')).toBeDefined()
      }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer)),
    )

    it.effect('derives the bundle root from the Host module URL, then from DSHFILES_DIR', () =>
      Effect.gen(function* () {
        expect(
          yield* discoverPluginRoots({
            start: '/tmp',
            dshfilesDirectory: undefined,
            moduleUrl: 'file:///checkout/plugins/@dshfiles/annotations/dist/index.js',
          }),
        ).toEqual(['/checkout/plugins/@dshfiles'])
        expect(yield* discoverPluginRoots({ start: '/tmp', dshfilesDirectory: '/checkout' })).toEqual([join('/checkout', 'plugins', '@dshfiles')])
      }),
    )
  })
})

describe('classCandidates', () => {
  it('keeps CSS-module names and drops bare utilities', () => {
    expect(classCandidates('div.uV2eYG_row > button.dshx\\:inline-flex.cta')).toEqual(['uV2eYG_row'])
  })

  it('reads every CSS-module class of one compound as its own name', () => {
    expect(classCandidates('div._actions_1mjtw_5._actions_100cw_7 > div > button')).toEqual(['_actions_1mjtw_5', '_actions_100cw_7'])
  })

  it('keeps a single-class target and drops the bare descendants around it', () => {
    expect(classCandidates('div._actions_1mjtw_5 > div > div.dshx-root.dshx\\:flex > button.dshx\\:flex.dshx\\:items-center')).toEqual(['_actions_1mjtw_5'])
    expect(classCandidates('button._row_1mjtw_3')).toEqual(['_row_1mjtw_3'])
  })

  it('unescapes a dot that belongs to the class name instead of splitting on it', () => {
    expect(classCandidates('div._weird\\.name_abc12 > span')).toEqual(['_weird.name_abc12'])
  })

  it('returns nothing for a selector without a module class', () => {
    expect(classCandidates('button.cta')).toEqual([])
  })
})
