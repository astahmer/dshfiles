import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility, defineDomain, domainTable } from '../src/native/index.ts'
import type { DomainSpec } from '../src/native/spec.ts'
import type { DomainChanged } from '../src/native/events.ts'
import { CountingMediaPool, CountingStorageBackend } from './helpers/counting-backend.ts'

const itemSchema = z.object({ label: z.string(), count: z.number().int() })
type Item = z.infer<typeof itemSchema>

/** A disposable per-record domain: lazy by default because its records are backed up and skipped. */
const disposableSpec = (overrides: Partial<DomainSpec> = {}): DomainSpec => defineDomain({
  name: 'demo',
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  ...overrides,
  tables: { items: domainTable<string, Item>(itemSchema) },
})

const rows = (entries: ReadonlyArray<readonly [string, Item]>): Map<string, unknown> => new Map(entries)

/** Boot a context with the storage hub, one counting backend, and a facility over it. */
async function harness(options?: { pool?: CountingMediaPool }) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new CountingStorageBackend(options?.pool)
  ctx.storage.backend.register('memory', backend)
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  const changes: DomainChanged[] = []
  ctx.on('domain/changed', (change) => { changes.push(change) })
  return { ctx, backend, facility, changes }
}

/** Seed one medium before any open, so the first open sees stored documents. */
function seed(pool: CountingMediaPool, records: ReadonlyArray<readonly [string, unknown]>, options?: { name?: string; version?: number; global?: unknown }) {
  const name = options?.name ?? 'demo'
  pool.media.set(name, { tables: new Map([['items', rows(records as [string, Item][])]]), global: options?.global ?? null, foreign: new Set() })
  pool.versions.set(name, options?.version ?? 1)
  return pool
}

describe('lazy hydration', () => {
  it('opens from document keys and reads no record', async () => {
    const pool = seed(new CountingMediaPool(), [['a', { label: 'a', count: 1 }], ['b', { label: 'b', count: 2 }]])
    const { facility } = await harness({ pool })

    const domain = await facility.open(disposableSpec())
    const table = domain.table('items')

    expect(pool.counts.loadAll).toBe(0)
    expect(pool.counts.listKeys).toBe(1)
    expect(pool.counts.getRecord).toBe(0)
    expect(table.size).toBe(2)
    expect([...table.keys()]).toEqual(['a', 'b'])
    await domain.close()
  })

  it('hydrates one record per miss and serves the second read from the LRU', async () => {
    const pool = seed(new CountingMediaPool(), [['a', { label: 'a', count: 1 }]])
    const { facility } = await harness({ pool })
    const domain = await facility.open(disposableSpec())
    const table = domain.table('items')

    expect(table.get('a')).toEqual({ label: 'a', count: 1 })
    expect(pool.counts.getRecord).toBe(1)
    expect(table.get('a')).toEqual({ label: 'a', count: 1 })
    expect(pool.counts.getRecord).toBe(1)
    expect(table.get('missing')).toBeUndefined()
    expect(pool.counts.getRecord).toBe(1)
    await domain.close()
  })

  it('bounds the cache and re-reads an evicted record', async () => {
    const entries = Array.from({ length: 70 }, (_, index) => [`k${String(index)}`, { label: `l${String(index)}`, count: index }] as const)
    const pool = seed(new CountingMediaPool(), entries)
    const { facility } = await harness({ pool })
    const domain = await facility.open(disposableSpec())
    const table = domain.table('items')

    for (const [key] of entries) expect(table.get(key)).toBeDefined()
    expect(pool.counts.getRecord).toBe(70)
    // The first key was evicted (bound is 64), so the next read hydrates again.
    expect(table.get('k0')).toBeDefined()
    expect(pool.counts.getRecord).toBe(71)
    await domain.close()
  })

  it('serves keys, entries, and size exactly as the eager path does', async () => {
    const entries = [['a', { label: 'a', count: 1 }], ['b', { label: 'b', count: 2 }], ['c', { label: 'c', count: 3 }]] as const
    const lazyPool = seed(new CountingMediaPool(), entries, { name: 'lazy' })
    const eagerPool = seed(new CountingMediaPool(), entries, { name: 'eager' })
    const lazyHarness = await harness({ pool: lazyPool })
    const eagerHarness = await harness({ pool: eagerPool })

    const lazyDomain = await lazyHarness.facility.open(disposableSpec({ name: 'lazy' }))
    const lazy = lazyDomain.table('items')
    const lazyEntries = [...lazy.entries()]
    const eagerDomain = await eagerHarness.facility.open(disposableSpec({ name: 'eager', hydration: 'all' }))
    const eagerEntries = [...eagerDomain.table('items').entries()]

    expect(lazyEntries).toEqual(eagerEntries)
    expect([...lazy.keys()]).toEqual(['a', 'b', 'c'])
    expect(lazy.size).toBe(3)
    await lazyDomain.close()
    await eagerDomain.close()
  })

  it('writes through: a put is durable and visible without a re-read, deletes and updates follow', async () => {
    const pool = seed(new CountingMediaPool(), [['a', { label: 'a', count: 1 }]])
    const { facility, changes } = await harness({ pool })
    const domain = await facility.open(disposableSpec())
    const table = domain.table('items')

    await table.put('b', { label: 'b', count: 2 })
    expect(table.get('b')).toEqual({ label: 'b', count: 2 })
    expect(pool.counts.getRecord).toBe(0)
    expect(changes.at(-1)).toMatchObject({ table: 'items', key: 'b', operation: 'put' })

    await expect(table.update('b', (current) => {
      expect(current).toEqual({ label: 'b', count: 2 })
      return { label: 'b', count: 3 }
    })).resolves.toEqual({ label: 'b', count: 3 })
    expect(table.get('b')).toEqual({ label: 'b', count: 3 })

    expect(await table.delete('b')).toBe(true)
    expect(await table.delete('b')).toBe(false)
    expect(table.get('b')).toBeUndefined()

    await domain.close()
    // A fresh open over the same medium sees the durable state only.
    const reopened = await facility.open(disposableSpec())
    expect([...reopened.table('items').keys()]).toEqual(['a'])
    await reopened.close()
  })

  it('rejects an update of a record that is absent', async () => {
    const pool = seed(new CountingMediaPool(), [])
    const { facility } = await harness({ pool })
    const domain = await facility.open(disposableSpec())

    await expect(domain.table('items').update('nope', current => current)).rejects.toMatchObject({ code: 'missing-key' })
    await domain.close()
  })

  it('leaves the cache and the medium untouched when a write fails', async () => {
    const pool = seed(new CountingMediaPool(), [['a', { label: 'a', count: 1 }]])
    const { facility } = await harness({ pool })
    const domain = await facility.open(disposableSpec())
    const table = domain.table('items')

    pool.failNextWrites = 1
    await expect(table.put('b', { label: 'b', count: 2 })).rejects.toThrow(/injected write failure/)
    expect(table.get('b')).toBeUndefined()
    expect(table.size).toBe(1)
    await domain.close()
  })

  it('backs up and skips a record whose document fails its schema, on first read', async () => {
    const pool = seed(new CountingMediaPool(), [['good', { label: 'g', count: 1 }], ['bad', { label: 'missing count' }]])
    const { facility, ctx } = await harness({ pool })
    const log = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
    const domain = await facility.open(disposableSpec())
    const table = domain.table('items')

    expect(table.get('bad')).toBeUndefined()
    // The backup runs on the write chain, so the log and the moved document
    // land after the read that discovered the failure.
    await vi.waitFor(() => { expect(pool.counts.backup).toBe(1) })
    expect(pool.backedUp).toEqual(['items/bad'])
    expect(log).toHaveBeenCalledWith(expect.stringContaining("moved to 'bad.json.bak.test'"))
    expect(table.size).toBe(1)
    expect([...table.entries()]).toEqual([['good', { label: 'g', count: 1 }]])
    await domain.close()
  })

  it('treats a foreign document as absent and drops it from the index', async () => {
    const pool = seed(new CountingMediaPool(), [['a', { label: 'a', count: 1 }], ['stale', { label: 's', count: 9 }]])
    pool.media.get('demo')?.foreign.add('items\u0000stale')
    const { facility } = await harness({ pool })
    const domain = await facility.open(disposableSpec())
    const table = domain.table('items')

    expect(table.size).toBe(2)
    expect(table.get('stale')).toBeUndefined()
    expect(table.size).toBe(1)
    expect([...table.entries()]).toEqual([['a', { label: 'a', count: 1 }]])
    await domain.close()
  })

  it('throws invalid-record at the read when the spec opts in but cannot skip', async () => {
    const pool = seed(new CountingMediaPool(), [['bad', { label: 'missing count' }]], { name: 'strict' })
    const { facility } = await harness({ pool })
    const domain = await facility.open(disposableSpec({ name: 'strict', invalidRecords: undefined, hydration: 'lazy' }))
    const table = domain.table('items')

    expect(() => table.get('bad')).toThrow(/does not match its schema/)
    expect(pool.counts.backup).toBe(0)
    await domain.close()
  })

  it('keeps the open-time loud failure for an authoritative per-record domain', async () => {
    const pool = seed(new CountingMediaPool(), [['bad', { label: 'missing count' }]], { name: 'strict' })
    const { facility } = await harness({ pool })

    await expect(facility.open(disposableSpec({ name: 'strict', invalidRecords: undefined })))
      .rejects.toMatchObject({ code: 'invalid-record' })
    expect(pool.counts.loadAll).toBe(1)
    expect(pool.counts.getRecord).toBe(0)
  })

  it('honours hydration: all over a disposable domain', async () => {
    const pool = seed(new CountingMediaPool(), [['a', { label: 'a', count: 1 }]])
    const { facility } = await harness({ pool })
    const domain = await facility.open(disposableSpec({ hydration: 'all' }))

    expect(pool.counts.loadAll).toBe(1)
    expect(pool.counts.listKeys).toBe(0)
    expect(domain.table('items').get('a')).toEqual({ label: 'a', count: 1 })
    expect(pool.counts.getRecord).toBe(0)
    await domain.close()
  })

  it('reads the global slot at open and serves initial until it is written', async () => {
    const schema = defineDomain({
      name: 'with_global',
      version: 1,
      layout: 'per-record',
      invalidRecords: 'backup-and-skip',
      global: { schema: z.object({ theme: z.string() }), initial: { theme: 'plain' } },
      tables: { items: domainTable<string, Item>(itemSchema) },
    })
    const pool = seed(new CountingMediaPool(), [['a', { label: 'a', count: 1 }]], { name: 'with_global' })
    const { facility } = await harness({ pool })

    const domain = await facility.open(schema)
    expect(domain.global.get()).toEqual({ theme: 'plain' })
    await domain.global.set({ theme: 'dark' })
    expect(domain.global.get()).toEqual({ theme: 'dark' })
    await domain.close()

    const reopened = await facility.open(schema)
    expect(reopened.global.get()).toEqual({ theme: 'dark' })
    expect(pool.counts.getGlobal).toBe(2)
    await reopened.close()
  })

  it('rejects hydration: lazy on a single-layout domain at declaration time', () => {
    expect(() => defineDomain({
      name: 'single',
      version: 1,
      hydration: 'lazy',
      tables: { items: domainTable<string, Item>(itemSchema) },
    })).toThrow(/needs layout 'per-record'/)
  })

  it('rejects an unknown hydration policy at declaration time', () => {
    expect(() => defineDomain({
      name: 'demo',
      version: 1,
      layout: 'per-record',
      hydration: 'eventually' as 'lazy',
      tables: { items: domainTable<string, Item>(itemSchema) },
    })).toThrow(/hydration must be 'lazy' or 'all'/)
  })
})
