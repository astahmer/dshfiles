/**
 * In-memory backend test double that ALSO exposes the fork's synchronous
 * per-record reads, so a test can drive the lazy-hydration path without a
 * filesystem. Adapted from the upstream domain suite's helper
 * (`packages/storage/storage-domain/tests/helpers/memory-backend.ts` at
 * `dsh-v0.2.1-rc.2`), extended with read counters, a foreign-record set, and
 * the `listKeysSync` / `getRecordSync` / `getGlobalSync` capability.
 * @module
 */

import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'

/** One unit's medium: table → record key → value, plus the global slot. */
export interface CountingMedium {
  tables: Map<string, Map<string, unknown>>
  global: unknown
  /** `table\u0000key` entries a sync read must report as absent (a foreign document). */
  foreign: Set<string>
}

/** Call counters a test asserts against: an open must read keys, not records. */
export interface ReadCounts {
  listKeys: number
  getRecord: number
  getGlobal: number
  loadAll: number
  backup: number
}

/** Shared media pool, so one medium can be reopened as a restart would. */
export class CountingMediaPool {
  readonly media = new Map<string, CountingMedium>()
  readonly versions = new Map<string, number>()
  readonly counts: ReadCounts = { listKeys: 0, getRecord: 0, getGlobal: 0, loadAll: 0, backup: 0 }
  /** Backed-up record keys, in call order (`<table>/<key>`). */
  readonly backedUp: string[] = []
  failNextWrites = 0

  consumeInjectedFailure(): void {
    if (this.failNextWrites > 0) {
      this.failNextWrites -= 1
      throw new Error('injected write failure')
    }
  }
}

class CountingKvUnit implements KvUnit {
  private closed = false

  constructor(
    private readonly pool: CountingMediaPool,
    private readonly medium: CountingMedium,
    private readonly descriptor: KvUnitDescriptor,
    private readonly onClose: () => void,
  ) {}

  private assertOpen(): void {
    if (this.closed) {
      throw new StorageError('closed', `memory unit '${this.descriptor.name}' is closed`)
    }
  }

  private isForeign(table: string, key: string): boolean {
    return this.medium.foreign.has(`${table}\u0000${key}`)
  }

  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    this.assertOpen()
    this.pool.counts.loadAll += 1
    const tables: Record<string, Record<string, unknown>> = {}
    for (const table of this.descriptor.tables) {
      const records: Record<string, unknown> = {}
      for (const [key, value] of this.medium.tables.get(table) ?? []) {
        if (this.isForeign(table, key)) continue
        records[key] = value
      }
      tables[table] = records
    }
    return { tables, global: this.medium.global }
  }

  listKeysSync(table: string): string[] {
    this.assertOpen()
    this.pool.counts.listKeys += 1
    return [...(this.medium.tables.get(table)?.keys() ?? [])]
  }

  getRecordSync(table: string, key: string): unknown {
    this.assertOpen()
    this.pool.counts.getRecord += 1
    if (this.isForeign(table, key)) return undefined
    return this.medium.tables.get(table)?.get(key)
  }

  getGlobalSync(): unknown {
    this.assertOpen()
    this.pool.counts.getGlobal += 1
    // `null` is the medium's never-written sentinel; the capability reports
    // absence as `undefined`, like the json backend's missing global document.
    return this.medium.global === null ? undefined : this.medium.global
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertOpen()
    this.pool.consumeInjectedFailure()
    let records = this.medium.tables.get(table)
    if (records === undefined) {
      records = new Map()
      this.medium.tables.set(table, records)
    }
    records.set(key, value)
    this.medium.foreign.delete(`${table}\u0000${key}`)
  }

  async deleteRecord(table: string, key: string): Promise<void> {
    this.assertOpen()
    this.pool.consumeInjectedFailure()
    this.medium.tables.get(table)?.delete(key)
    this.medium.foreign.delete(`${table}\u0000${key}`)
  }

  async backupRecord(table: string, key: string): Promise<string> {
    this.assertOpen()
    this.pool.counts.backup += 1
    this.pool.backedUp.push(`${table}/${key}`)
    this.medium.tables.get(table)?.delete(key)
    this.medium.foreign.delete(`${table}\u0000${key}`)
    return `${key}.json.bak.test`
  }

  async setGlobal(value: unknown): Promise<void> {
    this.assertOpen()
    this.pool.consumeInjectedFailure()
    this.medium.global = value
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.onClose()
  }
}

/** In-memory backend with a `kv` facet and the fork's sync per-record reads. */
export class CountingStorageBackend implements StorageBackend {
  readonly kv: KvFacet
  private readonly openUnits = new Set<string>()
  private closed = false

  constructor(readonly pool: CountingMediaPool = new CountingMediaPool()) {
    this.kv = {
      open: async (descriptor: KvUnitDescriptor): Promise<KvUnit> => {
        if (this.closed) throw new StorageError('closed', 'memory backend is closed')
        if (this.openUnits.has(descriptor.name)) {
          throw new Error(`memory unit '${descriptor.name}' is already open (double-open is a caller bug)`)
        }
        const stamped = this.pool.versions.get(descriptor.name)
        if (stamped === undefined) {
          this.pool.versions.set(descriptor.name, descriptor.version)
        } else if (stamped !== descriptor.version) {
          throw new StorageError(
            'version-mismatch',
            `memory unit '${descriptor.name}' is stamped v${stamped}, descriptor wants v${descriptor.version}`,
          )
        }
        let medium = this.pool.media.get(descriptor.name)
        if (medium === undefined) {
          medium = { tables: new Map(), global: null, foreign: new Set() }
          this.pool.media.set(descriptor.name, medium)
        }
        this.openUnits.add(descriptor.name)
        return new CountingKvUnit(this.pool, medium, descriptor, () => this.openUnits.delete(descriptor.name))
      },
    }
  }

  async close(): Promise<void> {
    this.closed = true
    this.openUnits.clear()
  }
}
