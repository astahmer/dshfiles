import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '../src/native/index.ts'

/** Durable publishes, counted at the rename every `writeAtomic` ends with. */
const fs = vi.hoisted(() => ({ renames: 0, failNextRename: false }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (fs.failNextRename) {
        fs.failNextRename = false
        throw new Error('injected rename failure')
      }
      fs.renames += 1
      return actual.rename(from, to)
    },
  }
})

const roots: string[] = []

const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dshfiles-storage-json-batch-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

beforeEach(() => {
  fs.renames = 0
  fs.failNextRename = false
})

/** The single-layout unit: one document at `<root>/<name>.json`. */
const descriptor: KvUnitDescriptor = { name: 'demo', version: 2, tables: ['items'], hasGlobal: false, layout: 'single' }

/** The fork's single-layout unit also answers `putRecords`; `KvUnit` keeps the upstream shape. */
type BatchKvUnit = KvUnit & { putRecords(table: string, entries: ReadonlyArray<readonly [string, unknown]>): Promise<void> }

const openUnit = async (root: string): Promise<{ backend: JsonStorageBackend; unit: BatchKvUnit }> => {
  const backend = new JsonStorageBackend(root)
  return { backend, unit: (await backend.kv.open(descriptor)) as BatchKvUnit }
}

/** The unit document as stored, so a test asserts the durable state and not only memory. */
const storedTables = async (root: string): Promise<Record<string, Record<string, unknown>>> => {
  const document = JSON.parse(await readFile(join(root, 'demo.json'), 'utf8')) as {
    tables: Record<string, Record<string, unknown>>
  }
  return document.tables
}

describe('single-layout batch writes', () => {
  it('publishes a whole batch as ONE document rewrite', async () => {
    const root = await makeRoot()
    const { backend, unit } = await openUnit(root)

    await unit.putRecord('items', 'single', { label: 'single' })
    // One single-record put is one document rewrite.
    expect(fs.renames).toBe(1)

    await unit.putRecords('items', [['a', { label: 'a' }], ['b', { label: 'b' }], ['c', { label: 'c' }]])
    // Three records, still one rewrite.
    expect(fs.renames).toBe(2)
    expect(await storedTables(root)).toEqual({
      items: {
        single: { label: 'single' },
        a: { label: 'a' },
        b: { label: 'b' },
        c: { label: 'c' },
      },
    })
    expect((await unit.loadAll()).tables.items).toEqual({
      single: { label: 'single' },
      a: { label: 'a' },
      b: { label: 'b' },
      c: { label: 'c' },
    })
    await backend.close()
  })

  it('writes nothing at all for an empty batch', async () => {
    const root = await makeRoot()
    const { backend, unit } = await openUnit(root)

    await unit.putRecords('items', [])
    expect(fs.renames).toBe(0)
    // The unit document materializes on the first real write, not on an empty batch.
    await expect(readFile(join(root, 'demo.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await unit.loadAll()).tables.items).toEqual({})
    await backend.close()
  })

  it('applies duplicate keys in order, the last value winning, in one publish', async () => {
    const root = await makeRoot()
    const { backend, unit } = await openUnit(root)

    await unit.putRecords('items', [['a', { value: 1 }], ['b', { value: 2 }], ['a', { value: 3 }]])
    expect(fs.renames).toBe(1)
    // First appearance keeps the key's position; the last entry owns its value.
    expect(await storedTables(root)).toEqual({ items: { a: { value: 3 }, b: { value: 2 } } })
    await backend.close()
  })

  it('keeps the previously persisted state and rolls memory back when the publish is rejected', async () => {
    const root = await makeRoot()
    const { backend, unit } = await openUnit(root)
    await unit.putRecord('items', 'a', { value: 1 })
    fs.renames = 0

    fs.failNextRename = true
    await expect(unit.putRecords('items', [['a', { value: 2 }], ['b', { value: 3 }]])).rejects.toThrow(/injected rename failure/)

    expect(fs.renames).toBe(0)
    // The file still holds the pre-batch document...
    expect(await storedTables(root)).toEqual({ items: { a: { value: 1 } } })
    // ...and so does the authoritative memory: the rejected keys are gone.
    expect((await unit.loadAll()).tables.items).toEqual({ a: { value: 1 } })
    // A later publish cannot carry the rejected batch along.
    await unit.putRecord('items', 'c', { value: 4 })
    expect(await storedTables(root)).toEqual({ items: { a: { value: 1 }, c: { value: 4 } } })
    // The rejected publish left no temp file behind.
    expect((await readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([])
    await backend.close()
  })

  it('shows a restart every record of a committed batch and none of a rejected one', async () => {
    const root = await makeRoot()
    const first = await openUnit(root)
    await first.unit.putRecords('items', [['a', { value: 1 }], ['b', { value: 2 }]])
    await first.backend.close()

    const second = await openUnit(root)
    expect((await second.unit.loadAll()).tables.items).toEqual({ a: { value: 1 }, b: { value: 2 } })

    fs.failNextRename = true
    await expect(second.unit.putRecords('items', [['c', { value: 3 }], ['d', { value: 4 }]])).rejects.toThrow(/injected rename failure/)
    await second.backend.close()

    const third = await openUnit(root)
    expect((await third.unit.loadAll()).tables.items).toEqual({ a: { value: 1 }, b: { value: 2 } })
    await third.backend.close()
  })
})
