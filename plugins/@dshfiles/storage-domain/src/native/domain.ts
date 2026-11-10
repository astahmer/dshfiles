/**
 * Runtime of one open domain: authoritative in-memory state, the single
 * per-domain write chain, and change-event emission. Reads are synchronous
 * from memory; every write queues on the chain, awaits backend durability
 * FIRST, then mutates memory, then emits `domain/changed` — a rejected
 * backend write leaves memory untouched (no divergence between reads and the
 * medium), and events carry values that equal the in-memory state at
 * emission, in write order. A multi-record write (`putMany`) is one link of
 * that same chain: on a backend that publishes the unit as one document it is
 * one durable publish for the whole batch.
 * @module @deepseek-ai/dsh-storage-domain/src/domain
 */

import type { Context } from '@deepseek-ai/cordis'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import type { ZodType } from 'zod'
import { DomainError } from './error.ts'
import type { DomainSpec, DomainGlobalSpec, TableKeyOf, TableValueOf } from './spec.ts'
import type { DomainChanged } from './events.ts'

/** Handle on a domain's global singleton. */
export interface DomainGlobal<G> {
  /**
   * Current value, synchronously from the authoritative in-memory state.
   * Before the first `set` this is the spec's `initial`.
   * @returns the current global value.
   */
  get(): G

  /**
   * Replace the value durably. Queued on the domain's write chain; the first
   * `set` is what materializes the global on the medium.
   * @param value - New value; must satisfy the spec's schema (not re-checked
   * here — validation happens at the durable read boundary).
   * @returns resolution after durability and event emission.
   */
  set(value: G): Promise<void>
}

/**
 * Handle on one declared table. Records are plain immutable data: returned
 * values are the stored objects themselves (no defensive copies) and must not
 * be mutated in place — replace via `put`/`update`.
 */
export interface KvTable<K extends string, V> {
  /**
   * Read one record, synchronously from memory.
   * @param key - Record key.
   * @returns the record, or `undefined` when absent.
   */
  get(key: K): V | undefined

  /**
   * Snapshot iterator over `[key, record]` pairs. A snapshot, not a live
   * view: iteration stays stable while queued writes land.
   * @returns the pair iterator.
   */
  entries(): IterableIterator<[K, V]>

  /**
   * Snapshot iterator over keys.
   * @returns the key iterator.
   */
  keys(): IterableIterator<K>

  /** Current record count. */
  readonly size: number

  /**
   * Insert or overwrite one record durably.
   * @param key - Record key.
   * @param value - The full new record (no partial merge).
   * @returns resolution after durability and event emission.
   */
  put(key: K, value: V): Promise<void>

  /**
   * Insert or overwrite several records in one durable write.
   *
   * The batch occupies ONE slot of the domain's write chain, so no other
   * write of this domain interleaves with it. On a backend that publishes the
   * unit as one document (the JSON `single` layout) the whole batch is ONE
   * durable publish: it is all-or-nothing at the document level, a rejected
   * batch leaves the previously persisted state intact, and nothing of it is
   * durable. A backend with one document per record has no whole-unit publish:
   * the batch still holds its chain slot, but each record lands on its own, so
   * a mid-batch rejection leaves the records written before the failure
   * durable and visible — the rejection is then a `DomainError` with code
   * `batch-partial`, whose message names how many records landed.
   *
   * Duplicate keys apply in order, so the last value wins, and exactly one
   * `domain/changed` `put` event is emitted per distinct key, after
   * durability — never one per duplicate entry. An empty batch writes nothing
   * and emits nothing.
   * @param entries - `[key, value]` pairs, in application order.
   * @returns resolution after durability and event emission.
   */
  putMany(entries: ReadonlyArray<readonly [K, V]>): Promise<void>

  /**
   * Delete one record durably.
   * @param key - Record key.
   * @returns `true` when the record existed, `false` when it was already
   * absent (no write and no event in that case).
   */
  delete(key: K): Promise<boolean>

  /**
   * Atomic read-modify-write on the domain's write chain: `fn` sees the
   * value current at its queue slot, so concurrent updates never interleave.
   * @param key - Record key; a missing key rejects with `missing-key`.
   * @param fn - Synchronous pure transform from current to next record.
   * @returns the stored next record.
   */
  update(key: K, fn: (current: V) => V): Promise<V>
}

/** Global handle of a spec: typed when declared, `never` (inaccessible) when not. */
export type DomainGlobalHandleOf<S extends DomainSpec> =
  S extends { readonly global: DomainGlobalSpec<infer G> } ? DomainGlobal<G> : never

/** One open domain, typed by its spec. */
export interface Domain<S extends DomainSpec> {
  /** Domain name from the spec. */
  readonly name: string
  /** Global singleton handle; a spec without `global` has no usable handle (`never`). */
  readonly global: DomainGlobalHandleOf<S>
  /**
   * Resolve one declared table handle. Handles are stable — repeated calls
   * return the same instance.
   * @param name - Declared table name.
   * @returns the typed table handle.
   */
  table<N extends keyof S['tables'] & string>(name: N): KvTable<TableKeyOf<S, N>, TableValueOf<S, N>>

  /**
   * Close this domain: reject new writes immediately, drain already-queued
   * writes (their events still emit), release the backend unit, then free
   * the domain name for a later open. Idempotent — repeated calls share one
   * teardown. The consumer owns this call (typically as its own `ctx.effect`
   * disposer); the facility closes any domain left open when it unmounts.
   * @returns resolution after the unit is released.
   */
  close(): Promise<void>
}

/** Internal boundary handing table handles their domain-owned write machinery. */
interface TableHost {
  readonly domainName: string
  readonly unit: KvUnit
  /** The unit's one-publish multi-record write, when the backend has one. */
  readonly batch: BatchWriteCapability | undefined
  /** Queue one job on the domain's single write chain. */
  enqueue<T>(job: () => Promise<T>): Promise<T>
  /** Throw `closed` once the domain has fully closed (reads stay valid while draining). */
  assertReadable(): void
  /** Emit `domain/changed` for one durably landed write. */
  emitChanged(change: DomainChanged): void
}

/**
 * Synchronous per-record reads a `per-record` backend MAY expose (fork
 * delta; the owned json backend's per-record unit does). The domain's read
 * contract is synchronous — `KvTable.get` cannot await — so a lazy hydrate
 * needs a synchronous read, and the capability is probed rather than
 * required: a backend that does not offer it keeps the open-time `loadAll`
 * path. `getRecordSync` must return exactly what the backend's `loadAll`
 * would have put in that table, and `undefined` for a foreign record.
 */
export interface HydrationCapability {
  /** Stored record keys of one declared table, from document names only. */
  listKeysSync(table: string): string[]
  /** One stored record value, parsed and version-checked; absent reads `undefined`. */
  getRecordSync(table: string, key: string): unknown
  /** The stored global value; `undefined` when never written. */
  getGlobalSync(): unknown
}

/**
 * Narrow a unit to its lazy-hydration capability, when it has one. The
 * assignment below is the structural probe (same pattern as the optional
 * `backupRecord` capability): no `as unknown` hop and no runtime coupling to
 * the backend package.
 * @param unit - The opened backend unit.
 * @returns the capability, or `undefined` for a backend without per-record reads.
 */
export function hydratingUnit(unit: KvUnit): HydrationCapability | undefined {
  const candidate: KvUnit & Partial<HydrationCapability> = unit
  const { listKeysSync, getRecordSync, getGlobalSync } = candidate
  if (typeof listKeysSync !== 'function') return undefined
  if (typeof getRecordSync !== 'function') return undefined
  if (typeof getGlobalSync !== 'function') return undefined
  // The probe destructures the methods, so the wrapper restores the backend
  // instance as their receiver.
  return {
    listKeysSync: table => listKeysSync.call(candidate, table),
    getRecordSync: (table, key) => getRecordSync.call(candidate, table, key),
    getGlobalSync: () => getGlobalSync.call(candidate),
  }
}

/**
 * Multi-record durable write a `single`-layout backend MAY expose (fork
 * delta; the owned json backend's single-layout unit does). One call applies
 * the whole batch to the unit's authoritative state and publishes it as ONE
 * document, so the batch is all-or-nothing at the document level: a rejected
 * publish leaves the previous document and the previous in-memory state
 * intact, and nothing of the batch is durable. Duplicate keys apply in order
 * (the last value wins) and an empty batch writes nothing. The capability is
 * probed rather than required: a backend without it gets the per-record
 * fallback of {@link commitPutMany}.
 */
export interface BatchWriteCapability {
  /** Insert or overwrite every entry of one table in one durable publish. */
  putRecords(table: string, entries: ReadonlyArray<readonly [string, unknown]>): Promise<void>
}

/**
 * Narrow a unit to its one-publish batch write, when it has one. Same
 * structural probe as {@link hydratingUnit}: no `as unknown` hop and no
 * runtime coupling to the backend package.
 * @param unit - The opened backend unit.
 * @returns the capability, or `undefined` for a backend without it.
 */
function batchingUnit(unit: KvUnit): BatchWriteCapability | undefined {
  const candidate: KvUnit & Partial<BatchWriteCapability> = unit
  const { putRecords } = candidate
  if (typeof putRecords !== 'function') return undefined
  // The probe destructures the method, so the wrapper restores the backend
  // instance as its receiver.
  return { putRecords: (table, entries) => putRecords.call(candidate, table, entries) }
}

/** How many hydrated records one lazy table keeps before evicting its least recently read. */
export const LAZY_TABLE_CACHE_ROWS = 64

/** How one table's records are seeded at open: materialized, or by key with lazy hydration. */
export type TableSeed =
  | { readonly kind: 'eager'; readonly records: Map<string, unknown> }
  | {
    readonly kind: 'lazy'
    readonly keys: readonly string[]
    readonly valueSchema: ZodType
    readonly hydration: HydrationCapability
  }

const noop = () => {}

/**
 * The single domain implementation behind the {@link Domain} interface. The
 * facility constructs it from a validated `loadAll` snapshot and erases it to
 * `Domain<S>`; nothing outside this package constructs one.
 */
export class DomainImpl {
  /** Domain name from the spec. */
  readonly name: string

  private readonly tables = new Map<string, KvTable<string, unknown>>()
  private globalValue: unknown
  private readonly globalHandle?: DomainGlobal<unknown>

  /** Tail of the write chain; every link settles (rejections are observed by the caller's slice). */
  private chain: Promise<void> = Promise.resolve()
  /** Set when close begins: new writes reject while already-queued writes drain. */
  private disposing = false
  /** Set when close finishes (chain drained, unit closed): reads reject from here on. */
  private closed = false
  private disposal?: Promise<void>

  /**
   * @param ctx - Context that carries `domain/changed` emissions.
   * @param spec - The domain declaration.
   * @param unit - The opened backend unit; this instance owns its lifecycle.
   * @param seeds - One seed per declared table (empty maps included) — the
   * facility builds it from the spec, so the entry set IS the table set. An
   * eager seed carries the validated `loadAll` records; a lazy seed carries
   * only keys plus the capability to hydrate one record at a time.
   * @param globalValue - Validated stored global, or the spec's `initial`
   * when the medium held none; `undefined` when the spec declares no global.
   * @param onClosed - Facility hook run once after teardown completes; frees
   * the domain name for a later open.
   */
  constructor(
    private readonly ctx: Context,
    private readonly spec: DomainSpec,
    private readonly unit: KvUnit,
    seeds: ReadonlyMap<string, TableSeed>,
    globalValue: unknown,
    private readonly onClosed: () => void,
  ) {
    this.name = spec.name
    const host: TableHost = {
      domainName: spec.name,
      unit,
      batch: batchingUnit(unit),
      enqueue: job => this.enqueue(job),
      assertReadable: () => { this.assertReadable() },
      emitChanged: (change) => { this.emitChanged(change) },
    }
    for (const [table, seed] of seeds) {
      this.tables.set(
        table,
        seed.kind === 'eager'
          ? new KvTableImpl(host, table, seed.records)
          : new LazyKvTableImpl(
            host,
            table,
            seed.valueSchema,
            seed.hydration,
            seed.keys,
            (key, error) => this.backupInvalidRecord(table, key, error),
          ),
      )
    }
    if (spec.global !== undefined) {
      this.globalValue = globalValue
      this.globalHandle = {
        get: () => {
          this.assertReadable()
          return this.globalValue
        },
        set: value => this.enqueue(async () => {
          await this.unit.setGlobal(value)
          this.globalValue = value
          this.emitChanged({ domain: this.name, table: '', key: '', operation: 'put', value })
        }),
      }
    }
  }

  /** Global singleton handle; accessing it on a spec that declares no global is a caller bug and throws. */
  get global(): DomainGlobal<unknown> {
    if (this.globalHandle === undefined) {
      throw new Error(`domain '${this.name}' declares no global`)
    }
    return this.globalHandle
  }

  /**
   * Resolve one declared table handle; an undeclared name is a caller bug
   * and throws.
   * @param name - Declared table name.
   * @returns the stable table handle.
   */
  table(name: string): KvTable<string, unknown> {
    const table = this.tables.get(name)
    if (table === undefined) {
      throw new Error(`domain '${this.name}' declares no table '${name}'`)
    }
    return table
  }

  /**
   * Close this domain: reject new writes immediately, drain already-queued
   * writes (their events still emit), close the unit, then free the name via
   * the facility hook. Idempotent — repeated calls share one teardown.
   * @returns resolution after the unit is released.
   */
  close(): Promise<void> {
    this.disposal ??= this.runClose()
    return this.disposal
  }

  private async runClose(): Promise<void> {
    this.disposing = true
    // Chain links never reject (each is settled via then(noop, noop)), so
    // this await is a pure drain barrier.
    await this.chain
    await this.unit.close()
    this.closed = true
    this.onClosed()
  }

  /**
   * Dispatch one post-durability change notification, containing observer
   * failures: the write is already committed (medium and memory both hold
   * the new state), so a throwing listener must not retroactively reject it.
   */
  private emitChanged(change: DomainChanged): void {
    try {
      this.ctx.emit('domain/changed', change)
    } catch (error) {
      // Swallows synchronous observer exceptions only: emit dispatches
      // listeners inline and nothing else runs in the try. The event is a
      // notification, not a transaction participant — the commit point has
      // passed, so containment (with a log) is the only correct outcome.
      this.ctx.logger.warn(`domain '${this.name}': domain/changed listener failed: ${String(error)}`)
    }
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    if (this.disposing) {
      return Promise.reject(new DomainError('closed', `domain '${this.name}' is closed`))
    }
    const result = this.chain.then(job)
    this.chain = result.then(noop, noop)
    return result
  }

  private assertReadable(): void {
    if (this.closed) {
      throw new DomainError('closed', `domain '${this.name}' is closed`)
    }
  }

  /**
   * Handle one lazy hydrate whose stored record failed its schema: when the
   * spec declares disposable records and the unit can move documents aside,
   * back the document up on the write chain and serve the record as absent;
   * otherwise the read throws the very `invalid-record` error the open-time
   * load would have thrown. Nothing here awaits, so a hydrate that runs
   * inside a queued write job cannot deadlock the chain.
   * @param table - Declared table of the failing record.
   * @param key - Failing record key.
   * @param error - The `invalid-record` error to log or throw.
   * @returns `true` when the record was skipped (backed up asynchronously).
   */
  private backupInvalidRecord(table: string, key: string, error: DomainError): boolean {
    if (this.spec.invalidRecords !== 'backup-and-skip') return false
    const unit = this.unit
    const backupRecord = unit.backupRecord
    if (backupRecord === undefined) return false
    void this.enqueue(async () => {
      const moved = await backupRecord.call(unit, table, key)
      this.ctx.logger.error(
        `domain '${this.name}': stored record '${key}' in table '${table}' failed schema validation; `
        + `moved to '${moved}' and treated as absent. Cause: ${String(error.cause)}`,
      )
    }).catch((failure: unknown) => {
      this.ctx.logger.error(
        `domain '${this.name}': stored record '${key}' in table '${table}' failed schema validation and could not be moved aside: ${String(failure)}`,
      )
    })
    return true
  }
}

/** Table handle bound to one in-memory record map and its domain's write chain. */
class KvTableImpl<K extends string, V> implements KvTable<K, V> {
  constructor(
    private readonly host: TableHost,
    private readonly tableName: string,
    private readonly records: Map<string, unknown>,
  ) {}

  get(key: K): V | undefined {
    this.host.assertReadable()
    return this.records.get(key) as V | undefined
  }

  entries(): IterableIterator<[K, V]> {
    this.host.assertReadable()
    return ([...this.records.entries()] as [K, V][])[Symbol.iterator]()
  }

  keys(): IterableIterator<K> {
    this.host.assertReadable()
    return ([...this.records.keys()] as K[])[Symbol.iterator]()
  }

  get size(): number {
    this.host.assertReadable()
    return this.records.size
  }

  put(key: K, value: V): Promise<void> {
    return this.host.enqueue(async () => {
      await this.host.unit.putRecord(this.tableName, key, value)
      this.records.set(key, value)
      this.emitPut(key, value)
    })
  }

  putMany(entries: ReadonlyArray<readonly [K, V]>): Promise<void> {
    return this.host.enqueue(() =>
      commitPutMany({
        host: this.host,
        table: this.tableName,
        entries,
        apply: (key, value) => {
          this.records.set(key, value)
        },
      }))
  }

  delete(key: K): Promise<boolean> {
    return this.host.enqueue(async () => {
      // Existence is decided at this job's chain slot, not at call time: an
      // earlier queued put of the same key makes this delete observe it.
      if (!this.records.has(key)) return false
      await this.host.unit.deleteRecord(this.tableName, key)
      this.records.delete(key)
      this.host.emitChanged({
        domain: this.host.domainName,
        table: this.tableName,
        key,
        operation: 'deleted',
      })
      return true
    })
  }

  update(key: K, fn: (current: V) => V): Promise<V> {
    return this.host.enqueue(async () => {
      if (!this.records.has(key)) {
        throw new DomainError(
          'missing-key',
          `domain '${this.host.domainName}' table '${this.tableName}' has no record '${key}' to update`,
        )
      }
      const next = fn(this.records.get(key) as V)
      await this.host.unit.putRecord(this.tableName, key, next)
      this.records.set(key, next)
      this.emitPut(key, next)
      return next
    })
  }

  private emitPut(key: K, value: V): void {
    this.host.emitChanged({
      domain: this.host.domainName,
      table: this.tableName,
      key,
      operation: 'put',
      value,
    })
  }
}

/**
 * Table handle over per-record documents: `open` indexes keys only, each read
 * hydrates one record from the medium, and a bounded LRU keeps the most
 * recently read values. Semantics match {@link KvTableImpl} exactly — a
 * foreign document reads absent, a schema failure is backed up and skipped
 * (when the spec allows it) or thrown as `invalid-record`, and every write is
 * durable before the cache changes. `keys` and `size` count stored documents,
 * including a document that only a read proves foreign; that read then drops
 * it from the index.
 */
class LazyKvTableImpl<K extends string, V> implements KvTable<K, V> {
  private readonly index: Map<string, true>
  private readonly cache = new Map<string, V>()

  constructor(
    private readonly host: TableHost,
    private readonly tableName: string,
    private readonly valueSchema: ZodType<V>,
    private readonly hydration: HydrationCapability,
    keys: readonly string[],
    private readonly backupInvalid: (key: string, error: DomainError) => boolean,
  ) {
    this.index = new Map(keys.map(key => [key, true] as const))
  }

  get(key: K): V | undefined {
    this.host.assertReadable()
    return this.hydrate(key)
  }

  entries(): IterableIterator<[K, V]> {
    this.host.assertReadable()
    const pairs: [K, V][] = []
    for (const key of [...this.index.keys()]) {
      const value = this.hydrate(key)
      // `undefined` means the document turned out to be foreign, which the
      // open-time load would simply not have indexed.
      if (value !== undefined) pairs.push([key as K, value])
    }
    return pairs[Symbol.iterator]()
  }

  keys(): IterableIterator<K> {
    this.host.assertReadable()
    return ([...this.index.keys()] as K[])[Symbol.iterator]()
  }

  get size(): number {
    this.host.assertReadable()
    return this.index.size
  }

  put(key: K, value: V): Promise<void> {
    return this.host.enqueue(async () => {
      await this.host.unit.putRecord(this.tableName, key, value)
      this.index.set(key, true)
      this.remember(key, value)
      this.emitPut(key, value)
    })
  }

  putMany(entries: ReadonlyArray<readonly [K, V]>): Promise<void> {
    return this.host.enqueue(() =>
      commitPutMany({
        host: this.host,
        table: this.tableName,
        entries,
        apply: (key, value) => {
          this.index.set(key, true)
          this.remember(key, value)
        },
      }))
  }

  delete(key: K): Promise<boolean> {
    return this.host.enqueue(async () => {
      // Existence is decided at this job's chain slot, not at call time: an
      // earlier queued put of the same key makes this delete observe it.
      if (!this.index.has(key)) return false
      await this.host.unit.deleteRecord(this.tableName, key)
      this.index.delete(key)
      this.cache.delete(key)
      this.host.emitChanged({
        domain: this.host.domainName,
        table: this.tableName,
        key,
        operation: 'deleted',
      })
      return true
    })
  }

  update(key: K, fn: (current: V) => V): Promise<V> {
    return this.host.enqueue(async () => {
      const current = this.index.has(key) ? this.hydrate(key) : undefined
      if (current === undefined) {
        throw new DomainError(
          'missing-key',
          `domain '${this.host.domainName}' table '${this.tableName}' has no record '${key}' to update`,
        )
      }
      const next = fn(current)
      await this.host.unit.putRecord(this.tableName, key, next)
      this.index.set(key, true)
      this.remember(key, next)
      this.emitPut(key, next)
      return next
    })
  }

  /** Read one record through the LRU, hydrating from the medium on a miss. */
  private hydrate(key: string): V | undefined {
    const cached = this.cache.get(key)
    if (cached !== undefined) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return cached
    }
    if (!this.index.has(key)) return undefined
    const raw = this.hydration.getRecordSync(this.tableName, key)
    if (raw === undefined) {
      // A document that parses as foreign is absent, exactly as the open-time
      // load would have left it out of its table.
      this.index.delete(key)
      return undefined
    }
    let value: V
    try {
      value = this.valueSchema.parse(raw)
    } catch (cause) {
      this.index.delete(key)
      const error = new DomainError(
        'invalid-record',
        `domain '${this.host.domainName}': stored record '${key}' in table '${this.tableName}' does not match its schema`,
        { detail: { table: this.tableName, key }, cause },
      )
      if (!this.backupInvalid(key, error)) throw error
      return undefined
    }
    this.remember(key, value)
    return value
  }

  /** Store one value as most recently used, evicting the oldest past the cache bound. */
  private remember(key: string, value: V): void {
    this.cache.delete(key)
    this.cache.set(key, value)
    while (this.cache.size > LAZY_TABLE_CACHE_ROWS) {
      const oldest = this.cache.keys().next()
      if (oldest.done === true) return
      this.cache.delete(oldest.value)
    }
  }

  private emitPut(key: K, value: V): void {
    this.host.emitChanged({
      domain: this.host.domainName,
      table: this.tableName,
      key,
      operation: 'put',
      value,
    })
  }
}

/**
 * Commit one batch of records inside the caller's write-chain slot. The batch
 * is one durable publish when the unit offers one ({@link BatchWriteCapability}),
 * so a rejection leaves memory and medium untouched; otherwise each record is
 * written on its own and a mid-batch rejection reports exactly how many landed
 * (`batch-partial`), because those stay durable and visible. Memory and
 * `domain/changed` events change only after durability, once per distinct key.
 */
async function commitPutMany<K extends string, V>(input: {
  readonly host: TableHost
  readonly table: string
  readonly entries: ReadonlyArray<readonly [K, V]>
  readonly apply: (key: K, value: V) => void
}): Promise<void> {
  // Duplicate keys collapse to their last value, in first-appearance order, so
  // the batch writes and announces each key exactly once.
  const batch = [...new Map(input.entries)]
  if (batch.length === 0) return
  const { host } = input
  const emitPut = (key: K, value: V): void => {
    host.emitChanged({ domain: host.domainName, table: input.table, key, operation: 'put', value })
  }
  if (host.batch !== undefined) {
    await host.batch.putRecords(input.table, batch)
    for (const [key, value] of batch) {
      input.apply(key, value)
      emitPut(key, value)
    }
    return
  }
  let landed = 0
  for (const [key, value] of batch) {
    try {
      await host.unit.putRecord(input.table, key, value)
    } catch (cause) {
      throw new DomainError(
        'batch-partial',
        `domain '${host.domainName}' table '${input.table}': the batch failed at '${key}' after ${String(landed)} of ${String(batch.length)} records were durably written; those ${String(landed)} stay durable and visible, the rest were not written`,
        { detail: { table: input.table, key }, cause },
      )
    }
    landed += 1
    input.apply(key, value)
    emitPut(key, value)
  }
}
