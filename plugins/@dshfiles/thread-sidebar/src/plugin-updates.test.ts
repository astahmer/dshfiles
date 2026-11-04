import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, FileSystem, Layer, Path, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import { PluginUpdateWatch, staleClientEntries, type PluginRegistry } from './plugin-updates.js'

/** How many files the watch read; the real file system underneath counts every `readFileString`. */
class FileReads extends Context.Service<FileReads, Ref.Ref<number>>()('test/FileReads') {}

const countingFileSystem = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const real = yield* FileSystem.FileSystem
    const reads = yield* FileReads
    return {
      ...real,
      readFileString: (path, encoding) =>
        Effect.andThen(
          Ref.update(reads, count => count + 1),
          real.readFileString(path, encoding),
        ),
    }
  }),
).pipe(Layer.provideMerge(Layer.effect(FileReads, Ref.make(0))), Layer.provideMerge(NodeFileSystem.layer))

const watchLayer = PluginUpdateWatch.layer.pipe(Layer.provideMerge(countingFileSystem), Layer.provideMerge(NodePath.layer))

/** A temporary plugins root and a registry over the ids a test lists there. */
const pluginsRoot = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'thread-sidebar-updates-' })
  const ids: string[] = []
  const registry: PluginRegistry = { ids: () => ids, clientPath: id => path.join(root, id, 'dist', 'client.js') }
  const write = (relative: string, text: string) =>
    Effect.gen(function* () {
      const file = path.join(root, relative)
      yield* fs.makeDirectory(path.dirname(file), { recursive: true })
      yield* fs.writeFileString(file, text)
    })
  const addPackage = Effect.fn(function* (name: string) {
    yield* write(`${name}/package.json`, JSON.stringify({ name, exports: { '.': './dist/index.js', './client': './dist/client.js' } }))
    yield* write(`${name}/dist/index.js`, 'export default 1')
    yield* write(`${name}/dist/client.js`, 'export default 1')
    ids.push(name)
  })
  return { registry, write, addPackage }
})

const readsDuring = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const reads = yield* FileReads
    yield* Ref.set(reads, 0)
    const value = yield* effect
    return { value, reads: yield* Ref.get(reads) }
  })

describe('plugin update watch', () => {
  it.effect('only Host code or manifest changes since boot need a restart, not client rebuilds or identical rebuilds', () =>
    Effect.gen(function* () {
      const watch = yield* PluginUpdateWatch
      const plugins = yield* pluginsRoot
      yield* plugins.addPackage('@x/host-change')
      yield* watch.remember(plugins.registry)
      expect(yield* watch.pending(plugins.registry)).toEqual([])

      yield* plugins.write('@x/host-change/dist/client.js', 'export default 2')
      yield* plugins.write('@x/host-change/dist/index.js', 'export default 1')
      expect(yield* watch.pending(plugins.registry)).toEqual([])

      yield* plugins.addPackage('@x/late')
      yield* plugins.write('@x/host-change/dist/index.js', 'export default 2')
      expect(yield* watch.pending(plugins.registry)).toEqual(['@x/host-change'])

      yield* plugins.write('@x/late/cordis.patch.yml', '- insert: []')
      expect(yield* watch.pending(plugins.registry)).toEqual(['@x/host-change', '@x/late'])
    }).pipe(Effect.provide(watchLayer)),
  )

  it.effect('a repeat check whose files kept their revision reads nothing, and a real change is still seen', () =>
    Effect.gen(function* () {
      const watch = yield* PluginUpdateWatch
      const plugins = yield* pluginsRoot
      yield* plugins.addPackage('@x/steady')
      yield* watch.remember(plugins.registry)
      expect(yield* watch.pending(plugins.registry)).toEqual([])

      // The revision hints still match, so the check costs stats only.
      expect(yield* readsDuring(watch.pending(plugins.registry))).toEqual({ value: [], reads: 0 })

      yield* plugins.write('@x/steady/dist/index.js', 'export default 333')
      const changed = yield* readsDuring(watch.pending(plugins.registry))
      expect(changed.value).toEqual(['@x/steady'])
      expect(changed.reads).toBeGreaterThan(0)

      // The boot baseline still differs, so the change stays reported; past the window the bytes are hashed again.
      yield* TestClock.adjust('60 seconds')
      const rehashed = yield* readsDuring(watch.pending(plugins.registry))
      expect(rehashed.value).toEqual(['@x/steady'])
      expect(rehashed.reads).toBeGreaterThan(0)
    }).pipe(Effect.provide(watchLayer)),
  )

  it.effect('concurrent checks share the work instead of rehashing everything twice', () =>
    Effect.gen(function* () {
      const watch = yield* PluginUpdateWatch
      const plugins = yield* pluginsRoot
      for (const id of ['@x/one', '@x/two', '@x/three']) yield* plugins.addPackage(id)
      yield* watch.remember(plugins.registry)
      expect(yield* watch.pending(plugins.registry)).toEqual([])

      yield* plugins.write('@x/two/dist/index.js', 'export default 2222')
      const both = yield* readsDuring(Effect.all([watch.pending(plugins.registry), watch.pending(plugins.registry)], { concurrency: 'unbounded' }))
      expect(both.value).toEqual([['@x/two'], ['@x/two']])
      // One rehash of the changed plugin reads its three files once; the second check finds them at the cached revision.
      expect(both.reads).toBeLessThanOrEqual(3)
    }).pipe(Effect.provide(watchLayer)),
  )
})

describe('client bundle revisions', () => {
  it('a page reloads for the client bundles it runs at another revision, and for entries it never loaded', () => {
    const page = [
      { id: '@x/unchanged', rev: 'a1' },
      { id: '@x/rebuilt', rev: 'b1' },
      { id: '@x/removed', rev: 'c1' },
    ]
    const served = [
      { id: '@x/unchanged', rev: 'a1' },
      { id: '@x/rebuilt', rev: 'b2' },
      { id: '@x/added', rev: 'd1' },
    ]
    expect(staleClientEntries({ page, served })).toEqual({ stale: ['@x/rebuilt'], added: ['@x/added'] })
  })

  it('a page that already applied a rebuild over hot reload stays out of the reload banner', () => {
    const served = [{ id: '@x/rebuilt', rev: 'b2' }]
    expect(staleClientEntries({ page: served, served })).toEqual({ stale: [], added: [] })
  })

  it('an empty page revision list reports every served entry as an addition', () => {
    expect(staleClientEntries({ page: [], served: [{ id: '@x/one', rev: 'a1' }] })).toEqual({ stale: [], added: ['@x/one'] })
  })
})
