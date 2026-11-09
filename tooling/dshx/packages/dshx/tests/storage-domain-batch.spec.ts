import { describe, expect, it } from '@effect/vitest'
import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, DomainSpec, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Effect, Layer } from 'effect'
import { z } from 'zod'
import { HostContext } from '../src/effect/host-context.js'
import { StorageDomain, type StorageTable, StorageDomainWriteFailed } from '../src/effect/storage-domain.js'

const specOf = (name: string) => defineDomain({
  name,
  version: 1,
  tables: { items: domainTable<string, number>(z.number()) },
})

/** Calls a test asserts against: one `putMany` batch, or one `put` per record on the fallback path. */
interface TableCalls {
  puts: string[]
  batches: ReadonlyArray<readonly [string, number]>[]
}

/** Multi-record write the owned storage-domain fork adds to a table. */
interface BatchKvTable<Key extends string, Value> {
  putMany(entries: ReadonlyArray<readonly [Key, Value]>): Promise<void>
}

type FakeTable = KvTable<string, number> & Partial<BatchKvTable<string, number>>

const noPairs = (): [string, number][] => []

/** A table double: `batch` decides whether it offers the fork's one-publish write. */
const fakeTable = (calls: TableCalls, options: { readonly batch: boolean }): FakeTable => {
  const table: FakeTable = {
    get: () => undefined,
    entries: () => noPairs()[Symbol.iterator](),
    keys: () => [][Symbol.iterator](),
    size: 0,
    put: async (key) => { calls.puts.push(key) },
    delete: async () => true,
    update: async (_key, f) => f(0),
  }
  if (options.batch) {
    table.putMany = async (entries) => { calls.batches.push(entries) }
  }
  return table
}

/** A Host whose `storageDomain` service serves one fake domain over `table`. */
const hostWith = (table: FakeTable) => {
  const facility = {
    // SAFETY: the adapter only reads `name`, `table` and `close`; the domain type is erased by the facility.
    open: async () => ({ name: 'batch_demo', global: undefined, table: () => table, close: async () => {} }) as unknown as Domain<DomainSpec>,
    get: () => undefined,
  }
  // SAFETY: the adapter reaches the Host only through `ctx.get('storageDomain')`; `changes` is never consumed here.
  const ctx = { get: (name: string) => (name === 'storageDomain' ? facility : undefined) } as unknown as CordisContext
  return HostContext.layer({ ctx, packageId: '@test/storage-batch' })
}

/** Open a domain over the fake Host, run `use` with its table handle, and close the domain with the Scope. */
const withTable = <A, E>(input: {
  readonly name: string
  readonly table: FakeTable
  readonly use: (items: StorageTable<string, number>) => Effect.Effect<A, E>
}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const opened = yield* (yield* StorageDomain).open(specOf(input.name))
      return yield* input.use(opened.table('items'))
    }).pipe(Effect.provide(StorageDomain.layer.pipe(Layer.provide(hostWith(input.table))))),
  )

describe('StorageDomain table batch writes', () => {
  it.effect('publishes a batch through the one-publish write when the table offers it', () => {
    const calls: TableCalls = { puts: [], batches: [] }
    return withTable({
      name: 'batch_publish',
      table: fakeTable(calls, { batch: true }),
      use: items =>
        Effect.gen(function* () {
          yield* items.putMany([['a', 1], ['b', 2]])
          // One call for the whole batch, and no per-record write behind it.
          expect(calls.batches).toEqual([[['a', 1], ['b', 2]]])
          expect(calls.puts).toEqual([])
        }),
    })
  })

  it.effect('falls back to one put per record when the table has no batch write', () => {
    const calls: TableCalls = { puts: [], batches: [] }
    return withTable({
      name: 'batch_fallback',
      table: fakeTable(calls, { batch: false }),
      use: items =>
        Effect.gen(function* () {
          yield* items.putMany([['a', 1], ['b', 2]])
          yield* items.putMany([])
          expect(calls.batches).toEqual([])
          // The batch is written in order, one record at a time; an empty batch writes nothing.
          expect(calls.puts).toEqual(['a', 'b'])
        }),
    })
  })

  it.effect('reports the batch operation and the batch-partial code of a failed batch', () => {
    const calls: TableCalls = { puts: [], batches: [] }
    const table = fakeTable(calls, { batch: true })
    table.putMany = async () => { throw Object.assign(new Error('two of four landed'), { code: 'batch-partial' }) }
    return withTable({
      name: 'batch_partial',
      table,
      use: items =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(items.putMany([['a', 1]]))
          expect(error).toBeInstanceOf(StorageDomainWriteFailed)
          expect(error).toMatchObject({ domain: 'batch_partial', table: 'items', operation: 'put-many', code: 'batch-partial' })
        }),
    })
  })
})
