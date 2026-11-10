import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { buildHost } from '../src/compiler/host/build.js'
import { HostRuntimeStore, type RuntimeSnapshot } from '../src/compiler/host/runtime-store.js'
import { writePluginFixture } from './plugin-fixture.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

const write = async (file: string, content: string): Promise<void> => {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content)
}

interface PackageManifest {
  readonly name: string
  readonly type?: 'module'
  readonly exports?: string | Readonly<Record<string, string>>
}

const json = (manifest: PackageManifest): string => `${JSON.stringify(manifest)}\n`

/** A built `@dshfiles/dshx` package, a dependency of its own, and a consumer project that links it. */
const workspace = async (): Promise<{ readonly base: string; readonly dshx: string; readonly consumer: string; readonly entry: string }> => {
  const base = await realpath(await mkdtemp(resolve(tmpdir(), 'dshx-runtime-store-')))
  temporaryDirectories.push(base)
  const dshx = join(base, 'tooling', 'dshx')
  await write(join(dshx, 'package.json'), json({ name: '@dshfiles/dshx', type: 'module', exports: { './runtime-store/*': './runtime-store/*' } }))
  await write(
    join(dshx, 'dist', 'host', 'runtime.js'),
    "import { label } from '../util.js'\nimport { HOST } from 'create-dshx/runtime-capabilities'\nexport const describe = () => `${label}:${HOST}`\nexport const state = new Map()\n",
  )
  await write(join(dshx, 'dist', 'util.js'), "export * from './names.js'\n")
  await write(join(dshx, 'dist', 'names.js'), "export const label = 'runtime'\n")
  await write(
    join(dshx, 'node_modules', 'create-dshx', 'package.json'),
    json({ name: 'create-dshx', type: 'module', exports: { './runtime-capabilities': './runtime-capabilities.js' } }),
  )
  await write(join(dshx, 'node_modules', 'create-dshx', 'runtime-capabilities.js'), "export const HOST = 'host'\n")
  const consumer = await linkedConsumer(base, 'consumer', dshx)
  return { base, dshx, consumer, entry: join(dshx, 'dist', 'host', 'runtime.js') }
}

const linkedConsumer = async (base: string, name: string, dshx: string): Promise<string> => {
  const consumer = join(base, 'plugins', name)
  await write(join(consumer, 'package.json'), json({ name: `@test/${name}`, type: 'module' }))
  await mkdir(join(consumer, 'node_modules', '@dshfiles'), { recursive: true })
  await symlink(dshx, join(consumer, 'node_modules', '@dshfiles', 'dshx'))
  return consumer
}

const snapshotOf = async (options: { readonly dshx: string; readonly consumer: string; readonly entry: string }): Promise<RuntimeSnapshot> => {
  const prepared = await HostRuntimeStore.prepare({ runtimeRoot: join(options.dshx, 'dist'), entries: [options.entry], consumerRoot: options.consumer })
  if ('reason' in prepared) throw new Error(`expected a snapshot, got: ${prepared.reason}`)
  return prepared
}

const reasonOf = async (options: { readonly dshx: string; readonly consumer: string; readonly entry: string }): Promise<string> => {
  const prepared = await HostRuntimeStore.prepare({ runtimeRoot: join(options.dshx, 'dist'), entries: [options.entry], consumerRoot: options.consumer })
  return 'reason' in prepared ? prepared.reason : `snapshot ${prepared.hash}`
}

describe('host runtime store', () => {
  it('addresses a snapshot by content only, so a rebuild with the same bytes reuses it', async () => {
    const first = await workspace()
    const second = await workspace()
    const snapshot = await snapshotOf(first)
    expect(snapshot.hash).toMatch(/^[0-9a-f]{20}$/)
    expect((await snapshotOf(first)).hash).toBe(snapshot.hash)
    expect((await snapshotOf(second)).hash).toBe(snapshot.hash)
    await write(join(first.dshx, 'dist', 'names.js'), "export const label = 'changed'\n")
    expect((await snapshotOf(first)).hash).not.toBe(snapshot.hash)
  })

  it('never rewrites a published snapshot', async () => {
    const project = await workspace()
    const original = await snapshotOf(project)
    const names = join(original.directory, 'names.js')
    const before = await stat(names)
    expect(before.mode & 0o222).toBe(0)
    await snapshotOf(project)
    expect((await stat(names)).mtimeMs).toBe(before.mtimeMs)
    await write(join(project.dshx, 'dist', 'names.js'), "export const label = 'next'\n")
    const next = await snapshotOf(project)
    expect(next.directory).not.toBe(original.directory)
    expect(await readFile(names, 'utf8')).toBe("export const label = 'runtime'\n")
    expect((await readdir(dirname(original.directory))).filter(name => name.startsWith('.staging-'))).toEqual([])
  })

  it('resolves every runtime module to one shared instance per snapshot, keeping older snapshots loadable', async () => {
    const project = await workspace()
    const other = await linkedConsumer(project.base, 'other', project.dshx)
    const snapshot = await snapshotOf(project)
    const specifier = snapshot.specifiers.get(project.entry)
    expect(specifier).toBe(`@dshfiles/dshx/runtime-store/${snapshot.hash}/host/runtime.js`)
    for (const consumer of [project.consumer, other]) await write(join(consumer, 'dist', 'index.js'), `export * from ${JSON.stringify(specifier)}\n`)
    const fromConsumer = await import(pathToFileURL(join(project.consumer, 'dist', 'index.js')).href)
    const fromOther = await import(pathToFileURL(join(other, 'dist', 'index.js')).href)
    expect(fromConsumer.describe()).toBe('runtime:host')
    expect(fromConsumer.state).toBe(fromOther.state)
    await write(join(project.dshx, 'dist', 'names.js'), "export const label = 'next'\n")
    const next = await snapshotOf(project)
    await write(join(other, 'dist', 'next.js'), `export * from ${JSON.stringify(next.specifiers.get(project.entry))}\n`)
    const fromNext = await import(pathToFileURL(join(other, 'dist', 'next.js')).href)
    expect(fromNext.describe()).toBe('next:host')
    expect(fromNext.state).not.toBe(fromConsumer.state)
    expect(fromConsumer.describe()).toBe('runtime:host')
  })

  it('falls back to inlining when a consumer would load the runtime or its imports differently', async () => {
    const project = await workspace()
    const unlinked = join(project.base, 'outside')
    await write(join(unlinked, 'package.json'), json({ name: '@test/outside' }))
    expect(await reasonOf({ ...project, consumer: unlinked })).toContain('does not resolve')

    await write(join(project.dshx, 'node_modules', 'lazy-peer', 'package.json'), json({ name: 'lazy-peer', type: 'module', exports: './index.js' }))
    await write(join(project.dshx, 'node_modules', 'lazy-peer', 'index.js'), 'export {}\n')
    await write(join(project.dshx, 'dist', 'lazy.js'), "export const load = () => import('lazy-peer')\n")
    const lazy = { ...project, entry: join(project.dshx, 'dist', 'lazy.js') }
    expect(await reasonOf(lazy)).toContain('lazy-peer (unresolved from the plugin')

    await write(join(project.consumer, 'node_modules', 'lazy-peer', 'package.json'), json({ name: 'lazy-peer', type: 'module', exports: './index.js' }))
    await write(join(project.consumer, 'node_modules', 'lazy-peer', 'index.js'), 'export {}\n')
    expect(await reasonOf(lazy)).toContain('would load different packages')

    await write(join(project.dshx, 'dist', 'broken.js'), "import { missing } from './names.js'\nexport const value = missing\n")
    expect(await reasonOf({ ...project, entry: join(project.dshx, 'dist', 'broken.js') })).toContain('does not export')

    const fromSource = join(project.dshx, 'src')
    await write(join(fromSource, 'host.js'), 'export {}\n')
    const prepared = await HostRuntimeStore.prepare({ runtimeRoot: fromSource, entries: [join(fromSource, 'host.js')], consumerRoot: project.consumer })
    expect(prepared).toEqual({ reason: 'dshx runs from source, not from its built dist' })
  })

  it('builds an inline Host when DSHX itself runs from source', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'dshx-host-'))
    temporaryDirectories.push(root)
    await writePluginFixture(root)
    await writeFile(resolve(root, 'src/host.ts'), "import { defineHost } from '@dshfiles/dshx/host'\nexport default defineHost({ setup() {} })\n")
    const report = await buildHost({
      packageId: '@dshx/fixture-plugin',
      root,
      entry: 'src/host.ts',
      outDir: 'dist',
      declarations: false,
      dshxRuntime: 'snapshot',
    })
    expect(report.dshxRuntime).toEqual({ mode: 'inline', reason: 'dshx runs from source, not from its built dist' })
    expect(await readFile(resolve(root, 'dist/index.js'), 'utf8')).not.toContain('runtime-store')
  })

  it('prunes only snapshots no bundle imports once they are past the grace period', async () => {
    const project = await workspace()
    const kept = await snapshotOf(project)
    await write(join(project.dshx, 'dist', 'names.js'), "export const label = 'young'\n")
    const young = await snapshotOf(project)
    await write(join(project.dshx, 'dist', 'names.js'), "export const label = 'stale'\n")
    const stale = await snapshotOf(project)
    const storeRoot = dirname(kept.directory)
    const staging = join(storeRoot, '.staging-abandoned')
    await mkdir(staging)
    const old = new Date(Date.now() - 3 * 86_400_000)
    for (const directory of [kept.directory, stale.directory, staging]) await utimes(directory, old, old)
    await write(join(project.consumer, 'dist', 'index.js'), `import ${JSON.stringify(kept.specifiers.get(project.entry))}\n`)
    const result = await HostRuntimeStore.prune({ storeRoot, referenceRoots: [join(project.base, 'plugins')] })
    expect(result).toEqual({ removed: [stale.hash], kept: [kept.hash, young.hash].sort() })
    expect(await readdir(storeRoot)).toEqual([kept.hash, young.hash].sort())
  })
})
