import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonStorageBackend } from '../src/native/index.ts'
import { JsonStorageBackend as StockJsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import type { KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'

const roots: string[] = []

const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dshfiles-storage-json-'))
  roots.push(root)
  return root
}

const descriptor = (overrides: Partial<KvUnitDescriptor> = {}): KvUnitDescriptor => ({
  name: 'demo',
  version: 3,
  tables: ['items'],
  hasGlobal: true,
  layout: 'per-record',
  ...overrides,
})

/** The fork's unit, typed with the optional sync capability its class always has. */
const openUnit = async (root: string, overrides: Partial<KvUnitDescriptor> = {}) => {
  const backend = new JsonStorageBackend(root)
  const unit = await backend.kv.open(descriptor(overrides))
  return { backend, unit: unit as KvUnit & { listKeysSync(table: string): string[]; getRecordSync(table: string, key: string): unknown; getGlobalSync(): unknown } }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('synchronous per-record reads', () => {
  it('indexes stored document keys without reading a record', async () => {
    const root = await makeRoot()
    const stock = new StockJsonStorageBackend(root)
    const stockUnit = await stock.kv.open(descriptor())
    await stockUnit.putRecord('items', 'a', { label: 'a' })
    await stockUnit.putRecord('items', 'b', { label: 'b' })
    await stockUnit.setGlobal({ theme: 'dark' })
    await stock.close()

    const { unit } = await openUnit(root)
    expect(unit.listKeysSync('items').sort()).toEqual(['a', 'b'])
    expect(unit.getRecordSync('items', 'a')).toEqual({ label: 'a' })
    expect(unit.getGlobalSync()).toEqual({ theme: 'dark' })
    // The keys came from the directory listing, not from `loadAll`.
    expect(unit.getRecordSync('items', 'missing')).toBeUndefined()
  })

  it('reads a record the stock backend wrote and writes one it reads back', async () => {
    const root = await makeRoot()
    const fork = await openUnit(root)
    await fork.unit.putRecord('items', 'fromFork', { label: 'fork', at: 1 })
    await fork.backend.close()

    const stock = new StockJsonStorageBackend(root)
    const stockUnit = await stock.kv.open(descriptor())
    const snapshot = await stockUnit.loadAll()
    expect(snapshot.tables.items).toEqual({ fromFork: { label: 'fork', at: 1 } })
    const document = JSON.parse(await readFile(join(root, 'demo', 'items', 'fromFork.json'), 'utf8'))
    expect(document).toEqual({ version: 3, record: { label: 'fork', at: 1 } })
  })

  it('reports a foreign document as absent, exactly like loadAll does', async () => {
    const root = await makeRoot()
    const { backend, unit } = await openUnit(root)
    await unit.putRecord('items', 'current', { label: 'c' })
    // A record stamped with a version outside the accepted set.
    await writeFile(join(root, 'demo', 'items', 'stale.json'), `${JSON.stringify({ version: 2, record: { label: 'old' } })}\n`)
    // A malformed document.
    await writeFile(join(root, 'demo', 'items', 'broken.json'), 'not json')

    expect(unit.listKeysSync('items').sort()).toEqual(['broken', 'current', 'stale'])
    expect(unit.getRecordSync('items', 'stale')).toBeUndefined()
    expect(unit.getRecordSync('items', 'broken')).toBeUndefined()
    const snapshot = await unit.loadAll()
    expect(snapshot.tables.items).toEqual({ current: { label: 'c' } })
    await backend.close()
  })

  it('accepts a compatible stored version stamp', async () => {
    const root = await makeRoot()
    const { backend, unit } = await openUnit(root, { version: 3, compatibleVersions: [2] })
    await mkdir(join(root, 'demo', 'items'), { recursive: true })
    await writeFile(join(root, 'demo', 'items', 'old.json'), `${JSON.stringify({ version: 2, record: { label: 'old' } })}\n`)

    expect(unit.getRecordSync('items', 'old')).toEqual({ label: 'old' })
    await backend.close()
  })

  it('reads an absent tree as empty and an absent global as never written', async () => {
    const root = await makeRoot()
    const { backend, unit } = await openUnit(join(root, 'not-created'))

    expect(unit.listKeysSync('items')).toEqual([])
    expect(unit.getRecordSync('items', 'a')).toBeUndefined()
    expect(unit.getGlobalSync()).toBeUndefined()
    expect(await unit.loadAll()).toEqual({ tables: { items: {} }, global: null })
    await backend.close()

    // Opening touched nothing on the medium: the tree materializes on the first write.
    const { backend: writer, unit: writerUnit } = await openUnit(join(root, 'not-created'))
    await writerUnit.putRecord('items', 'a', { label: 'a' })
    await writer.close()
  })

  it('treats an unsafe key as absent on read and rejects it on write', async () => {
    const root = await makeRoot()
    const { backend, unit } = await openUnit(root)
    await unit.putRecord('items', 'safe-key_1', { label: 'safe' })

    expect(unit.getRecordSync('items', '../escape')).toBeUndefined()
    await expect(unit.putRecord('items', '../escape', { label: 'bad' })).rejects.toThrow(/not path-safe/)
    await backend.close()
  })

  it('rejects a sync read after close', async () => {
    const root = await makeRoot()
    const { unit } = await openUnit(root)
    await unit.close()

    expect(() => unit.listKeysSync('items')).toThrow(/is closed/)
    expect(() => unit.getRecordSync('items', 'a')).toThrow(/is closed/)
    expect(() => unit.getGlobalSync()).toThrow(/is closed/)
  })

  it('declares no global and reads none for a unit that has no global slot', async () => {
    const root = await makeRoot()
    const { backend, unit } = await openUnit(root, { hasGlobal: false })

    expect(unit.getGlobalSync()).toBeUndefined()
    await backend.close()
  })
})
