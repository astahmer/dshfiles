import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost, mountPlugin } from '@dshfiles/dshx/testing'
import { describe, expect, it } from 'vitest'
import type { ReviewMark } from './review-progress.js'
import { jujutsuReviewProgressApi } from './review-progress-api.js'

/**
 * Wiring check for the Host half: the built bundle opens the durable review
 * domain, serves the review-progress API, and releases the domain when the Host
 * fiber stops. The store and its bounds are covered by unit tests; this proves
 * the plugin actually registers the API and writes through it.
 */

const builtEntry = new URL('../dist/index.js', import.meta.url).href

const table = (rows: Map<string, ReviewMark>) => ({
  get: (key: string) => rows.get(key),
  entries: () => rows.entries(),
  keys: () => rows.keys(),
  get size() {
    return rows.size
  },
  put: async (key: string, value: ReviewMark) => {
    rows.set(key, value)
  },
  delete: async (key: string) => rows.delete(key),
  update: async (key: string, change: (current: ReviewMark) => ReviewMark) => {
    const current = rows.get(key)
    if (current === undefined) throw new Error('missing row')
    const next = change(current)
    rows.set(key, next)
    return next
  },
})

const startHarness = async () => {
  const host = await createTestHost()
  const rows = new Map<string, ReviewMark>()
  const openedDomains: string[] = []
  let closed = false
  host.ctx.provide('storageDomain', {
    open: async (domain: { readonly name: string }) => {
      openedDomains.push(domain.name)
      return {
        table: () => table(rows),
        close: async () => {
          closed = true
        },
      }
    },
  })
  host.ctx.provide('subprocess', {})
  host.ctx.provide('webServer', {})
  host.ctx.provide('settings', {
    configure: () => () => undefined,
    describe: () => [],
    update: async () => undefined,
    replace: async () => undefined,
  })
  const plugin: unknown = await import(builtEntry)
  await mountPlugin(host, plugin, { packageId: '@dshfiles/jujutsu', native: true })
  return {
    rows,
    openedDomains,
    closed: () => closed,
    reviews: createHostApiClient(host.ctx, jujutsuReviewProgressApi, '@dshfiles/jujutsu'),
    dispose: () => host.dispose(),
  }
}

describe('jujutsu review progress wiring', () => {
  it('stores review progress for every browser on the Host', async () => {
    const harness = await startHarness()
    expect(harness.openedDomains).toEqual(['jujutsu_review_progress'])

    const toggled = await harness.reviews.toggle({
      repositoryRoot: '/workspace/project',
      commitId: 'a'.repeat(40),
      file: { path: 'src/main.ts', contentDigest: 'b'.repeat(64) },
      reviewed: true,
    })
    expect(toggled.store.marks.map(mark => mark.path)).toEqual(['src/main.ts'])
    expect(harness.rows.size).toBe(1)

    const state = await harness.reviews.state()
    expect(state.store.marks.map(mark => mark.contentDigest)).toEqual(['b'.repeat(64)])

    await harness.dispose()
    expect(harness.closed()).toBe(true)
  })
})
