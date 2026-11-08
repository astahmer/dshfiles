import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '../../storage-json/src/native/index.ts'
import { DomainFacility, defineDomain, domainTable } from '../src/native/index.ts'

const roots: string[] = []

const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dshfiles-domain-json-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const itemSchema = z.object({ label: z.string(), count: z.number().int() })

const spec = defineDomain({
  name: 'demo',
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: { items: domainTable<string, { label: string; count: number }>(itemSchema) },
})

/** Boot a domain facility over the fork's real JSON backend. */
async function harness(root: string) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('json', new JsonStorageBackend(root))
  const facility = new DomainFacility(ctx, { backend: 'json', routes: {} })
  ctx.storage.mount('domain', facility)
  return { ctx, facility }
}

describe('lazy hydration over the fork json backend', () => {
  it('migrates a legacy whole-unit document into per-record documents, then hydrates lazily', async () => {
    const root = await makeRoot()
    const legacy = {
      unit: { name: 'demo', version: 1 },
      global: null,
      tables: { items: { a: { label: 'a', count: 1 }, b: { label: 'b', count: 2 } } },
    }
    await writeFile(join(root, 'demo.json'), `${JSON.stringify(legacy, null, 2)}\n`)

    const { facility } = await harness(root)
    const domain = await facility.open(spec)
    const table = domain.table('items')

    // The empty per-record tree is the one shape that still calls loadAll: the
    // backend's legacy bootstrap writes one document per record first.
    expect(table.size).toBe(2)
    expect(table.get('a')).toEqual({ label: 'a', count: 1 })
    const migrated = JSON.parse(await readFile(join(root, 'demo', 'items', 'a.json'), 'utf8'))
    expect(migrated).toEqual({ version: 1, record: { label: 'a', count: 1 } })
    // The legacy document is never changed or deleted.
    expect(JSON.parse(await readFile(join(root, 'demo.json'), 'utf8'))).toEqual(legacy)
    await domain.close()
  })

  it('writes through the fork backend and reopens from the tree', async () => {
    const root = await makeRoot()
    const first = await harness(root)
    const domain = await first.facility.open(spec)
    await domain.table('items').put('a', { label: 'a', count: 1 })
    await domain.close()

    const second = await harness(root)
    const reopened = await second.facility.open(spec)
    expect(reopened.table('items').get('a')).toEqual({ label: 'a', count: 1 })
    expect(reopened.table('items').size).toBe(1)
    expect((await stat(join(root, 'demo', 'items', 'a.json'))).isFile()).toBe(true)
    await reopened.close()
  })
})
