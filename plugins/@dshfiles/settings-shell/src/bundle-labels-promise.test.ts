import type { BundleInfo } from '@deepseek-ai/dsh-plugin-manager/types'
import { HostContext } from '@dshfiles/dshx/effect'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { BundleLabels } from './bundle-labels-promise.js'

const bundle: BundleInfo = {
  name: '@dshfiles/thread-sidebar',
  official: false,
  availability: 'profile',
  enabled: true,
  installed: true,
  optional: false,
  removable: true,
  description: 'Threads beside the chat',
  meta: { title: { en: 'Thread Sidebar', zh: '线程侧栏' } },
  rows: [{ rowId: 'dshfiles-thread-sidebar', moduleName: '@dshfiles/thread-sidebar' }],
  overrides: [],
}

const labelsWith = (input: {
  readonly entries: () => readonly { readonly id: string; readonly name: string }[]
  readonly listBundles: () => Promise<BundleInfo[]>
}) =>
  Effect.gen(function* () {
    const host = yield* Effect.acquireRelease(
      Effect.promise(() => createTestHost()),
      created => Effect.promise(() => created.dispose()),
    )
    for (const [name, value] of [
      ['loader', { entries: () => input.entries().map(entry => ({ id: entry.id, options: { name: entry.name } })) }],
      ['pluginManager', { listBundles: input.listBundles }],
    ] as const) {
      host.ctx.provide(name)
      // SAFETY: the cache reads only `loader.entries()` ids and names and `pluginManager.listBundles()`.
      host.ctx.set(name, value as never)
    }
    const services = yield* Layer.build(BundleLabels.layer.pipe(Layer.provide(HostContext.layer({ ctx: host.ctx, packageId: '@dshfiles/settings-shell' }))))
    return Context.get(services, BundleLabels)
  })

describe('BundleLabels', () => {
  it.effect('reads the bundles once per set of Loader rows', () =>
    Effect.scoped(
      Effect.gen(function* () {
        let reads = 0
        let entries = [{ id: '1', name: '@dshfiles/thread-sidebar' }]
        const labels = yield* labelsWith({
          entries: () => entries,
          listBundles: async () => {
            reads += 1
            return [bundle]
          },
        })
        const first = yield* labels.read
        yield* labels.read
        expect(reads).toBe(1)
        expect(first).toEqual([
          {
            rowId: 'dshfiles-thread-sidebar',
            moduleName: '@dshfiles/thread-sidebar',
            bundleName: '@dshfiles/thread-sidebar',
            title: { en: 'Thread Sidebar', zh: '线程侧栏' },
            description: undefined,
            bundleDescription: 'Threads beside the chat',
          },
        ])
        entries = [...entries, { id: '2', name: '@dshfiles/backlog' }]
        yield* labels.read
        expect(reads).toBe(2)
      }),
    ),
  )

  it.effect('reads again after a failed read instead of keeping no labels', () =>
    Effect.scoped(
      Effect.gen(function* () {
        let reads = 0
        const labels = yield* labelsWith({
          entries: () => [],
          listBundles: async () => {
            reads += 1
            if (reads === 1) throw new Error('profile manifest unreadable')
            return [bundle]
          },
        })
        expect(yield* labels.read).toEqual([])
        expect(yield* labels.read).toHaveLength(1)
        expect(reads).toBe(2)
      }),
    ),
  )
})
