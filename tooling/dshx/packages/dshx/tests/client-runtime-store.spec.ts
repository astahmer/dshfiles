import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import vm from 'node:vm'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it } from 'vitest'
import { build, type Plugin } from 'vite'
import { ClientRuntimeStore, type ClientRuntimeSnapshot } from '../src/compiler/client/runtime-store.js'
import { SharedRuntime } from '../src/compiler/client/shared-runtime.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

const write = async (file: string, content: string): Promise<void> => {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content)
}

const SUPPLIER = '@test/shared-runtime'

/**
 * A built `@dshfiles/dshx` whose Client runtime keeps module state and imports a library the supplier provides, plus a
 * supplier package that provides that library.
 */
const workspace = async () => {
  const base = await realpath(await mkdtemp(resolve(tmpdir(), 'dshx-client-runtime-store-')))
  temporaryDirectories.push(base)
  const dshx = join(base, 'dshx')
  await write(join(dshx, 'package.json'), JSON.stringify({ name: '@dshfiles/dshx', type: 'module' }))
  await write(
    join(dshx, 'dist', 'client', 'runtime.js'),
    [
      "import { label } from '../names.js'",
      "import { CLIENT } from 'create-dshx/runtime-capabilities'",
      "import * as library from 'shared-lib'",
      "export * from '../registry.js'",
      'export const describe = () => `${label}:${CLIENT}`',
      'export const libraryOf = () => library',
      '',
    ].join('\n'),
  )
  await write(join(dshx, 'dist', 'registry.js'), 'export const registry = new Map()\n')
  await write(join(dshx, 'dist', 'names.js'), "export const label = 'one'\n")
  await write(
    join(dshx, 'node_modules', 'create-dshx', 'package.json'),
    JSON.stringify({ name: 'create-dshx', type: 'module', exports: { './runtime-capabilities': './runtime-capabilities.js' } }),
  )
  await write(join(dshx, 'node_modules', 'create-dshx', 'runtime-capabilities.js'), "export const CLIENT = 'client'\n")
  const supplier = join(base, 'supplier')
  await write(join(supplier, 'package.json'), JSON.stringify({ name: SUPPLIER, type: 'module' }))
  await write(join(supplier, 'node_modules', 'shared-lib', 'package.json'), JSON.stringify({ name: 'shared-lib', type: 'module', exports: './index.js' }))
  await write(join(supplier, 'node_modules', 'shared-lib', 'index.js'), "export const origin = 'supplier'\n")
  return { base, dshx, runtimeRoot: join(dshx, 'dist'), entry: join(dshx, 'dist', 'client', 'runtime.js'), supplier }
}

const snapshotOf = async (options: { readonly runtimeRoot: string; readonly entry: string }): Promise<ClientRuntimeSnapshot> => {
  const prepared = await ClientRuntimeStore.prepare({ runtimeRoot: options.runtimeRoot, entries: [options.entry] })
  if ('reason' in prepared) throw new Error(`expected a snapshot, got: ${prepared.reason}`)
  return prepared
}

const virtualEntry = (id: string, code: string): Plugin => ({
  name: 'test-entry',
  enforce: 'pre',
  resolveId: source => (source === id ? source : null),
  load: loaded => (loaded === id ? code : null),
})

/** One CJS chunk, the way a DSH factory body receives it, with only the supplier left to `require`. */
const bundle = async (options: { readonly root: string; readonly entry: Plugin; readonly plugins: readonly Plugin[] }): Promise<string> => {
  const result = await build({
    root: options.root,
    configFile: false,
    logLevel: 'error',
    plugins: [options.entry, ...options.plugins],
    build: {
      outDir: join(options.root, 'dist'),
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        input: 'entry',
        preserveEntrySignatures: 'strict',
        external: [SUPPLIER],
        output: { format: 'cjs', exports: 'named', codeSplitting: false },
      },
    },
  })
  const output = Array.isArray(result) ? result[0] : result
  if (output === undefined || !('output' in output) || output.output[0] === undefined) throw new Error('no output')
  return output.output[0].code
}

interface SupplierExports {
  readonly sharedModules: { readonly 'shared-lib': object }
}

interface ConsumerExports {
  readonly describe: () => string
  readonly registry: Map<string, string>
  readonly libraryOf: () => object
}

const evaluate = (code: string, modules: ReadonlyMap<string, object>): object => {
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: (id: string) => modules.get(id) })
  return module.exports
}

const supplierManifest = Schema.Struct({ modules: Schema.Record(Schema.String, Schema.Array(Schema.String)) })

const supplierBundle = async (supplier: string, packageRoot: string): Promise<string> =>
  bundle({
    root: supplier,
    entry: virtualEntry('entry', SharedRuntime.supplierEntryExport()),
    plugins: [
      SharedRuntime.supplierPlugin({
        packageId: SUPPLIER,
        root: supplier,
        provide: ['shared-lib'],
        outDir: join(supplier, 'dist'),
        cssHash: () => undefined,
        keyedModules: async () => (await ClientRuntimeStore.stored(packageRoot)).flatMap(snapshot => snapshot.modules),
      }),
      ClientRuntimeStore.supplierPlugin({ root: supplier, packageRoot }),
    ],
  })

const consumerBundle = async (options: {
  readonly root: string
  readonly runtimeRoot: string
  readonly entry: string
  readonly snapshot: ClientRuntimeSnapshot
  readonly modules: ReadonlyMap<string, readonly string[]>
}) =>
  bundle({
    root: options.root,
    entry: virtualEntry('entry', `export { describe, registry, libraryOf } from ${JSON.stringify(options.entry)}\n`),
    plugins: [
      ClientRuntimeStore.consumerPlugin({ snapshot: options.snapshot, runtimeRoot: options.runtimeRoot, facade: SharedRuntime.facadeId }),
      SharedRuntime.consumerPlugin({ supplier: SUPPLIER, modules: options.modules, bundleDependencies: [] }),
    ],
  })

describe('client runtime store', () => {
  it('addresses a snapshot by content and records each module export names', async () => {
    const first = await workspace()
    const second = await workspace()
    const snapshot = await snapshotOf(first)
    expect(snapshot.hash).toMatch(/^[0-9a-f]{20}$/)
    expect((await snapshotOf(second)).hash).toBe(snapshot.hash)
    expect([...snapshot.keys.values()].sort()).toEqual(
      ['client/runtime.js', 'names.js', 'registry.js'].map(path => `@dshfiles/dshx/client-runtime/${snapshot.hash}/${path}`),
    )
    expect([...snapshot.bare]).toEqual(['shared-lib'])
    const [stored] = await ClientRuntimeStore.stored(first.dshx)
    expect(stored?.modules.find(module => module.key.endsWith('/client/runtime.js'))?.names).toEqual(['describe', 'libraryOf', 'registry'])
    expect((await stat(join(snapshot.directory, 'client', 'runtime.js'))).mode & 0o222).toBe(0)
    await write(join(first.runtimeRoot, 'names.js'), "export const label = 'two'\n")
    expect((await snapshotOf(first)).hash).not.toBe(snapshot.hash)
    expect((await ClientRuntimeStore.stored(first.dshx)).map(item => item.hash)).toHaveLength(2)
  })

  it('keeps inlining a runtime that runs from source or re-exports a bare module', async () => {
    const project = await workspace()
    await write(join(project.dshx, 'src', 'client', 'runtime.js'), 'export const value = 1\n')
    expect(await ClientRuntimeStore.prepare({ runtimeRoot: join(project.dshx, 'src'), entries: [join(project.dshx, 'src', 'client', 'runtime.js')] })).toEqual({
      reason: 'dshx runs from source, not from its built dist',
    })
    await write(join(project.runtimeRoot, 'registry.js'), "export * from 'shared-lib'\n")
    const prepared = await ClientRuntimeStore.prepare({ runtimeRoot: project.runtimeRoot, entries: [project.entry] })
    expect('reason' in prepared ? prepared.reason : prepared.hash).toContain('re-exports a bare module')
  })

  it('serves only its own hash and the hashes built sibling consumers name, and prune keeps exactly those', async () => {
    const project = await workspace()
    const hashes: string[] = []
    for (const label of ['one', 'two', 'three']) {
      await write(join(project.runtimeRoot, 'names.js'), `export const label = '${label}'\n`)
      hashes.push((await snapshotOf(project)).hash)
    }
    const [referenced, orphan, current] = hashes
    await write(join(project.base, 'consumer', 'dist', 'client.js'), `sharedModules["@dshfiles/dshx/client-runtime/${referenced}/client/runtime.js"]\n`)
    const served = await ClientRuntimeStore.served({ packageRoot: project.dshx, supplierRoot: project.supplier, current })
    expect(served.map(snapshot => snapshot.hash).sort()).toEqual([referenced, current].sort())
    const pruned = await ClientRuntimeStore.prune({
      packageRoot: project.dshx,
      referenceRoots: await ClientRuntimeStore.consumerDistRoots(project.supplier),
      graceMs: 0,
      now: Date.now() + 1000,
    })
    expect(pruned.removed).toContain(orphan)
    expect(pruned.kept).toContain(referenced)
  })

  it('serves every stored snapshot, so consumers of one hash share an instance and an older hash keeps its own', async () => {
    const project = await workspace()
    const older = await snapshotOf(project)
    const olderConsumer = join(project.base, 'older')
    await write(join(olderConsumer, 'package.json'), JSON.stringify({ name: '@test/older', type: 'module' }))
    const manifestOf = async () =>
      new Map(
        Object.entries(
          Schema.decodeUnknownSync(supplierManifest)(JSON.parse(await readFile(join(project.supplier, 'dist', 'shared-runtime.json'), 'utf8'))).modules,
        ),
      )
    await supplierBundle(project.supplier, project.dshx)
    const olderCode = await consumerBundle({
      root: olderConsumer,
      runtimeRoot: project.runtimeRoot,
      entry: project.entry,
      snapshot: older,
      modules: await manifestOf(),
    })

    await write(join(project.runtimeRoot, 'names.js'), "export const label = 'two'\n")
    const newer = await snapshotOf(project)
    const supplierCode = await supplierBundle(project.supplier, project.dshx)
    const modules = await manifestOf()
    expect([older.hash, newer.hash].every(hash => modules.has(`@dshfiles/dshx/client-runtime/${hash}/client/runtime.js`))).toBe(true)
    const newerCode = await consumerBundle({ root: olderConsumer, runtimeRoot: project.runtimeRoot, entry: project.entry, snapshot: newer, modules })
    expect(newerCode).not.toContain('new Map')
    expect(newerCode).not.toContain("'two'")

    const supplierExports = evaluate(supplierCode, new Map())
    // SAFETY: the supplier entry re-exports exactly the `sharedModules` table its plugin generates.
    const table = (supplierExports as SupplierExports).sharedModules
    // SAFETY: each consumer entry re-exports `describe`, `registry` and `libraryOf` from the runtime fixture above.
    const load = (code: string): ConsumerExports => evaluate(code, new Map([[SUPPLIER, supplierExports]])) as ConsumerExports
    const [a, b, old] = [load(newerCode), load(newerCode), load(olderCode)]
    expect([a.describe(), old.describe()]).toEqual(['two:client', 'one:client'])
    a.registry.set('owner', 'a')
    expect(b.registry.get('owner')).toBe('a')
    expect(old.registry.has('owner')).toBe(false)
    expect(a.libraryOf()).toBe(table['shared-lib'])
  })
})
