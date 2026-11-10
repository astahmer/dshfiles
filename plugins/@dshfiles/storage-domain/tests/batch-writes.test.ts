import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import Storage from '@deepseek-ai/dsh-storage'
import { defineDomain, domainTable } from '../src/native/spec.ts'
import { DomainFacility } from '../src/native/index.ts'
import type { DomainSpec } from '../src/native/spec.ts'
import type { DomainChanged } from '../src/native/events.ts'
import { CountingMediaPool, CountingStorageBackend } from './helpers/counting-backend.ts'

const itemSchema = z.object({ label: z.string(), count: z.number().int() })
type Item = z.infer<typeof itemSchema>

/** One eager table over a backend that publishes the unit as one document (the JSON `single` layout). */
const singleSpec = (overrides: Partial<DomainSpec> = {}): DomainSpec => defineDomain({
  name: 'demo',
  version: 1,
  ...overrides,
  tables: { items: domainTable<string, Item>(itemSchema) },
})

/** A disposable per-record domain: lazy by default because its records are backed up and skipped. */
const lazySpec = (): DomainSpec => defineDomain({
  name: 'lazy',
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: { items: domainTable<string, Item>(itemSchema) },
})

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

/** Seed one medium before any open, so the first open sees stored records. */
function seed(pool: CountingMediaPool, records: ReadonlyArray<readonly [string, Item]>, name = 'demo') {
  pool.media.set(name, { tables: new Map([['items', new Map(records)]]), global: null, foreign: new Set() })
  pool.versions.set(name, 1)
  return pool
}

const item = (label: string, count: number): Item => ({ label, count })

describe('batch table writes', () => {
  it('commits a batch as ONE durable write and announces each key once', async () => {
    const pool = seed(new CountingMediaPool(), [['a', item('a', 1)]])
    const { facility, changes } = await harness({ pool })
    const domain = await facility.open(singleSpec())
    const table = domain.table('items')

    await table.putMany([['b', item('b', 2)], ['c', item('c', 3)]])

    // Two records, one durable write: the backend published them together.
    expect(pool.counts.writes).toBe(1)
    expect(pool.counts.putRecords).toBe(1)
    expect(pool.counts.putRecord).toBe(0)
    expect([...table.keys()]).toEqual(['a', 'b', 'c'])
    expect(changes).toEqual([
      { domain: 'demo', table: 'items', key: 'b', operation: 'put', value: item('b', 2) },
      { domain: 'demo', table: 'items', key: 'c', operation: 'put', value: item('c', 3) },
    ])
    await domain.close()

    const reopened = await facility.open(singleSpec())
    expect([...reopened.table('items').entries()]).toEqual([
      ['a', item('a', 1)],
      ['b', item('b', 2)],
      ['c', item('c', 3)],
    ])
    await reopened.close()
  })

  it('writes and announces nothing for an empty batch', async () => {
    const pool = seed(new CountingMediaPool(), [['a', item('a', 1)]])
    const { facility, changes } = await harness({ pool })
    const domain = await facility.open(singleSpec())

    await domain.table('items').putMany([])

    expect(pool.counts.writes).toBe(0)
    expect(changes).toEqual([])
    expect(domain.table('items').size).toBe(1)
    await domain.close()
  })

  it('applies duplicate keys in order, the last value winning, with one event per key', async () => {
    const pool = seed(new CountingMediaPool(), [])
    const { facility, changes } = await harness({ pool })
    const domain = await facility.open(singleSpec())

    await domain.table('items').putMany([
      ['a', item('first', 1)],
      ['b', item('b', 2)],
      ['a', item('last', 3)],
    ])

    expect(pool.counts.writes).toBe(1)
    expect(domain.table('items').get('a')).toEqual(item('last', 3))
    // One event per distinct key: the intermediate value of 'a' is never announced.
    expect(changes).toEqual([
      { domain: 'demo', table: 'items', key: 'a', operation: 'put', value: item('last', 3) },
      { domain: 'demo', table: 'items', key: 'b', operation: 'put', value: item('b', 2) },
    ])
    await domain.close()
  })

  it('keeps memory and medium untouched when the one-publish batch is rejected', async () => {
    const pool = seed(new CountingMediaPool(), [['a', item('a', 1)]])
    const { facility, changes } = await harness({ pool })
    const domain = await facility.open(singleSpec())
    const table = domain.table('items')

    pool.failNextWrites = 1
    const error: unknown = await table.putMany([['b', item('b', 2)], ['c', item('c', 3)]]).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(Error)
    // The batch capability propagates the backend failure unchanged: nothing of
    // the batch is durable, so there is no partial state to report.
    expect(error).toMatchObject({ message: 'injected write failure' })
    expect((error as { code?: string }).code).toBeUndefined()
    expect(pool.counts.writes).toBe(0)
    expect(changes).toEqual([])
    expect(table.get('b')).toBeUndefined()
    expect(table.size).toBe(1)
    await domain.close()

    const reopened = await facility.open(singleSpec())
    expect([...reopened.table('items').keys()]).toEqual(['a'])
    await reopened.close()
  })

  it('falls back to per-record writes and names exactly what landed when one fails mid-batch', async () => {
    const pool = seed(new CountingMediaPool(), [])
    // A backend with no one-publish batch write (the per-record document layouts).
    pool.batchWrites = false
    const { facility, changes } = await harness({ pool })
    const domain = await facility.open(singleSpec())
    const table = domain.table('items')

    // Fail the second record of the batch: the first one is already durable when it throws.
    pool.failWriteCall = 2
    const error: unknown = await table.putMany([['b', item('b', 2)], ['c', item('c', 3)], ['d', item('d', 4)]]).catch((cause: unknown) => cause)

    // The failure is honest about durability: one record landed before it.
    expect(error).toMatchObject({ code: 'batch-partial', detail: { table: 'items', key: 'c' } })
    expect((error as Error).message).toMatch(/after 1 of 3 records were durably written/)
    expect(pool.counts.putRecords).toBe(0)
    expect(pool.counts.putRecord).toBe(1)
    // The landed record is durable and readable; the rest never were.
    expect(table.get('b')).toEqual(item('b', 2))
    expect(table.get('c')).toBeUndefined()
    expect(table.get('d')).toBeUndefined()
    expect(changes.map(change => change.key)).toEqual(['b'])
    await domain.close()

    const reopened = await facility.open(singleSpec())
    expect([...reopened.table('items').keys()]).toEqual(['b'])
    await reopened.close()
  })

  it('serves a batch written through a lazy per-record table from its cache, with one durable write', async () => {
    const pool = seed(new CountingMediaPool(), [], 'lazy')
    const { facility, changes } = await harness({ pool })
    const domain = await facility.open(lazySpec())
    const table = domain.table('items')
    const hydrations = pool.counts.getRecord

    await table.putMany([['x', item('x', 1)], ['y', item('y', 2)]])

    expect(pool.counts.writes).toBe(1)
    // Written values are served from the LRU: no hydrate reads the medium back.
    expect(table.get('x')).toEqual(item('x', 1))
    expect(table.get('y')).toEqual(item('y', 2))
    expect(pool.counts.getRecord).toBe(hydrations)
    expect(changes.map(change => change.key)).toEqual(['x', 'y'])
    await domain.close()
  })
})
