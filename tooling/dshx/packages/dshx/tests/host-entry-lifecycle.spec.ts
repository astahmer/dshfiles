import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Plugin } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it } from 'vitest'
import { buildHost } from '../src/compiler/host/build.js'
import { createTestHost, type TestHost } from '../src/testing/index.js'
import { writePluginFixture } from './plugin-fixture.js'

// The Loader applies the built `dist/index.js` namespace. Cordis constructs (`new apply(…)`) any `apply` that has a
// prototype and then drops its return value, so these tests go through the built entry and the real Loader rather
// than `createHostPlugin`, whose method-shorthand `apply` Cordis calls normally.

const temporaryDirectories: string[] = []
declare global {
  // The built fixtures push their lifecycle here; they run in this process but in their own module graph.
  var __dshxLifecycle: string[] | undefined
}
const lifecycle = (): string[] => (globalThis.__dshxLifecycle ??= [])
const builtApply = Schema.Struct({
  apply: Schema.declare((value): value is (...arguments_: ReadonlyArray<unknown>) => unknown => typeof value === 'function'),
})

afterEach(async () => {
  lifecycle().splice(0)
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

const buildFixture = async (source: readonly string[]): Promise<Plugin> => {
  const root = await mkdtemp(resolve(tmpdir(), 'dshx-host-lifecycle-'))
  temporaryDirectories.push(root)
  await writePluginFixture(root)
  await writeFile(resolve(root, 'src/host.ts'), [...source, ''].join('\n'))
  await buildHost({ packageId: '@dshx/fixture-plugin', logicalName: 'dshx-fixture', root, entry: 'src/host.ts', outDir: 'dist' })
  return import(`${pathToFileURL(resolve(root, 'dist/index.js')).href}?lifecycle=${Date.now()}`)
}

const mountThroughLoader = async (host: TestHost, plugin: Plugin) => {
  await host.ctx.plugin(Loader).await()
  const loader = host.ctx.loader
  loader.builtins['dshx-lifecycle-fixture'] = plugin
  const id = await loader.create({ name: 'cordis:dshx-lifecycle-fixture' })
  await loader.await()
  return {
    entry: () => loader.resolve(id),
    disable: async () => {
      await loader.update(id, { disabled: true })
      await loader.await()
    },
    enable: async () => {
      await loader.update(id, { disabled: null })
      await loader.await()
    },
  }
}

const servedResponse = Schema.Struct({ result: Schema.Struct({ value: Schema.Struct({ output: Schema.Number }) }) })

const callGeneration = async (host: TestHost): Promise<number | 'refused'> => {
  const response = await host.connection.requestApi({
    packageId: '@dshx/fixture-plugin',
    apiId: 'lifecycle-fixture',
    method: 'generation',
    version: 1,
    input: undefined,
  })
  const decoded = Schema.decodeUnknownOption(servedResponse)(await response.json().catch(() => undefined))
  return decoded._tag === 'Some' ? decoded.value.result.value.output : 'refused'
}

const effectPluginSource = [
  "import { defineApi, method } from '@dshfiles/dshx/api'",
  "import { Api, DshxPlugin } from '@dshfiles/dshx/effect'",
  "import { Context, Effect, Layer } from 'effect'",
  "import * as Schema from 'effect/Schema'",
  'const log = (globalThis.__dshxLifecycle ??= [])',
  'let generations = 0',
  "class Generation extends Context.Service<Generation, { readonly value: number }>()('dshx-fixture/Generation') {}",
  'const api = defineApi({',
  "  id: 'lifecycle-fixture',",
  '  version: 1,',
  "  owner: '@dshx/fixture-plugin',",
  '  methods: { generation: method({ input: Schema.Void, output: Schema.Number }) },',
  '})',
  'const layer = Layer.effect(',
  '  Generation,',
  '  Effect.acquireRelease(',
  '    Effect.sync(() => {',
  '      generations += 1',
  '      log.push(`acquire ${generations}`)',
  '      return Generation.of({ value: generations })',
  '    }),',
  '    generation => Effect.sync(() => log.push(`release ${generation.value}`)),',
  '  ),',
  ')',
  'export default DshxPlugin.make({',
  "  name: 'dshx-fixture',",
  '  layer,',
  '  apis: [Api.bind(api, { generation: () => Effect.gen(function* () { return (yield* Generation).value }) })],',
  '})',
]

describe('built Host entry under the Cordis Loader', () => {
  it('exports an apply Cordis calls instead of constructing', async () => {
    const plugin = await buildFixture(["import { defineHost } from '@dshfiles/dshx/host'", 'export default defineHost({})'])
    expect(Object.hasOwn(Schema.decodeUnknownSync(builtApply)(plugin).apply, 'prototype')).toBe(false)
  })

  it('runs the disposer an async setup returns when the row is disabled', async () => {
    const plugin = await buildFixture([
      "import { defineHost } from '@dshfiles/dshx/host'",
      'const log = (globalThis.__dshxLifecycle ??= [])',
      'export default defineHost({',
      '  async setup() {',
      "    log.push('setup')",
      "    return () => { log.push('dispose') }",
      '  },',
      '})',
    ])
    const host = await createTestHost()
    try {
      const row = await mountThroughLoader(host, plugin)
      expect(lifecycle()).toEqual(['setup'])
      await row.disable()
      expect(lifecycle()).toEqual(['setup', 'dispose'])
    } finally {
      await host.dispose()
    }
  })

  it('stops an Effect plugin on disable and serves a fresh generation after re-enable', async () => {
    const plugin = await buildFixture(effectPluginSource)
    const host = await createTestHost()
    try {
      const row = await mountThroughLoader(host, plugin)
      expect(await callGeneration(host)).toBe(1)
      for (let round = 1; round <= 3; round += 1) {
        await row.disable()
        expect(await callGeneration(host)).toBe('refused')
        expect(lifecycle().at(-1)).toBe(`release ${round}`)
        await row.enable()
        expect(row.entry().fiber?.state).toBe(2)
        expect(await callGeneration(host)).toBe(round + 1)
      }
      expect(lifecycle()).toEqual(['acquire 1', 'release 1', 'acquire 2', 'release 2', 'acquire 3', 'release 3', 'acquire 4'])
    } finally {
      await host.dispose()
    }
  })

  it('fails only the row when an async activation throws, without an unhandled rejection', async () => {
    const plugin = await buildFixture([
      "import { defineHost } from '@dshfiles/dshx/host'",
      'export default defineHost({',
      '  async setup() {',
      "    throw new Error('fixture activation failed')",
      '  },',
      '})',
    ])
    const unhandled: unknown[] = []
    const record = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', record)
    const host = await createTestHost()
    try {
      const row = await mountThroughLoader(host, plugin)
      await new Promise(resolve => setImmediate(resolve))
      expect(unhandled).toEqual([])
      expect(row.entry().fiber?.state).toBe(3)
      await expect(row.entry().fiber?.await()).rejects.toThrow('fixture activation failed')
    } finally {
      process.off('unhandledRejection', record)
      await host.dispose()
    }
  })
})
