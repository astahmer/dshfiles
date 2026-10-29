import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { PluginApiError } from '../api/common.js'
import { PluginStorageContract, type StorageListInput, type StoragePage, type StoredEntry } from '../api/storage.js'

/** The slice of `@deepseek-ai/dsh-storage-domain` this module uses; dshx does not depend on that package. */
interface KvTableLike {
  get(key: string): StoredRecord | undefined
  keys(): IterableIterator<string>
  put(key: string, value: StoredRecord): Promise<void>
  delete(key: string): Promise<boolean>
}

interface DomainLike {
  table(name: 'entries'): KvTableLike
}

interface StorageDomainLike {
  open(spec: typeof domainSpec): Promise<DomainLike>
}

const recordSchema = z.object({ namespace: z.string(), key: z.string(), value: z.json(), updatedAt: z.number() }).strict()
type StoredRecord = z.infer<typeof recordSchema>

const DOMAIN_NAME = 'dshx_plugin_kv'

/** A plain spec object is what `defineDomain` returns; building it here keeps dshx free of a storage-domain import. */
const domainSpec = {
  name: DOMAIN_NAME,
  version: 1,
  tables: { entries: { valueSchema: recordSchema } },
} as const

/** The namespace schema admits no NUL, so the first NUL splits a stored key back into namespace and key. */
const recordKey = (namespace: string, key: string): string => `${namespace}\u0000${key}`

const STORE_KEY = Symbol.for('@dshfiles/dshx.plugin-storage.v1')

/**
 * Every plugin bundles its own dshx copy and a storage domain opens once per process, so the open domain lives on
 * globalThis, keyed by the Cordis root.
 */
const openDomains = (): WeakMap<object, Promise<DomainLike>> => {
  // SAFETY: only this module writes the versioned symbol, and always this WeakMap shape.
  const holder = globalThis as { [STORE_KEY]?: WeakMap<object, Promise<DomainLike>> }
  holder[STORE_KEY] ??= new WeakMap()
  return holder[STORE_KEY]
}

const unavailable = (cause?: unknown): PluginApiError =>
  new PluginApiError(
    `Plugin storage is unavailable: ${cause instanceof Error ? cause.message : 'the Host has no @deepseek-ai/dsh-storage-domain row'}. Add the storage rows to the profile, then restart DSH.`,
    { code: 'storage-unavailable' },
  )

const domainOf = (ctx: Context): Promise<DomainLike> => {
  const root: object = ctx.root ?? ctx
  const domains = openDomains()
  const existing = domains.get(root)
  if (existing !== undefined) return existing
  const opening = (async () => {
    let facility: StorageDomainLike | undefined
    try {
      facility = ctx.get('storageDomain') as StorageDomainLike | undefined
    } catch {
      facility = undefined
    }
    if (facility === undefined) throw unavailable()
    return facility.open(domainSpec).catch((cause: unknown) => {
      throw unavailable(cause)
    })
  })()
  domains.set(root, opening)
  // A failed open is retried by the next call instead of failing every later one.
  opening.catch(() => {
    if (domains.get(root) === opening) domains.delete(root)
  })
  return opening
}

/** A domain the storage facility closed (its row unloaded) rejects with `closed`; open it again once. */
const withTable = async <T>(ctx: Context, run: (table: KvTableLike) => T | Promise<T>): Promise<T> => {
  try {
    return await run((await domainOf(ctx)).table('entries'))
  } catch (cause) {
    if (!(cause instanceof Error && 'code' in cause && cause.code === 'closed')) throw cause
    openDomains().delete(ctx.root ?? ctx)
    return run((await domainOf(ctx)).table('entries'))
  }
}

const entryOf = (record: StoredRecord): StoredEntry => ({ key: record.key, value: record.value, updatedAt: record.updatedAt })

const list = (table: KvTableLike, namespace: string, input: StorageListInput): StoragePage => {
  const prefix = recordKey(namespace, input.prefix ?? '')
  const after = input.cursor === undefined ? undefined : recordKey(namespace, input.cursor)
  const limit = input.limit ?? PluginStorageContract.defaultPage
  const keys = [...table.keys()].filter(key => key.startsWith(prefix) && (after === undefined || key > after)).sort()
  const page = keys.slice(0, limit).flatMap(key => {
    const record = table.get(key)
    return record === undefined ? [] : [entryOf(record)]
  })
  return { entries: page, cursor: keys.length > limit ? (page.at(-1)?.key ?? null) : null }
}

export interface PluginStorage {
  /** The entry under `key`, or undefined. */
  get(key: string): Promise<StoredEntry | undefined>
  /** Write a JSON value (at most 256 KiB); resolves once it is durable. */
  set(key: string, value: unknown): Promise<StoredEntry>
  /** True when the key existed. */
  delete(key: string): Promise<boolean>
  /** Keys in code-unit order, starting with `prefix`, after `cursor`; `cursor` of the result is null on the last page. */
  list(input?: StorageListInput): Promise<StoragePage>
}

/**
 * Key-value storage for one namespace (a plugin package name), kept by the Host's storage domain and shared with
 * that plugin's browser half through `hostStorage(api)`. Needs the profile's `@deepseek-ai/dsh-storage-domain` row.
 */
const pluginStorage = (ctx: Context, namespace: string): PluginStorage => {
  const checkedNamespace = PluginStorageContract.namespace.parse(namespace)
  return {
    get: async key =>
      withTable(ctx, table => {
        const record = table.get(recordKey(checkedNamespace, PluginStorageContract.key.parse(key)))
        return record === undefined ? undefined : entryOf(record)
      }),
    set: async (key, value) => {
      const record: StoredRecord = {
        namespace: checkedNamespace,
        key: PluginStorageContract.key.parse(key),
        value: PluginStorageContract.value.parse(value),
        updatedAt: Date.now(),
      }
      await withTable(ctx, table => table.put(recordKey(checkedNamespace, record.key), record))
      return entryOf(record)
    },
    delete: async key => withTable(ctx, table => table.delete(recordKey(checkedNamespace, PluginStorageContract.key.parse(key)))),
    list: async (input = {}) =>
      withTable(ctx, table => list(table, checkedNamespace, PluginStorageContract.listInput.parse({ ...input, namespace: checkedNamespace }))),
  }
}

/** What the leading Host serves to browsers; every caller names its namespace. */
const storageRegistration = (ctx: Context) =>
  PluginStorageContract.api.host({
    get: async ({ input }) => ({ entry: (await pluginStorage(ctx, input.namespace).get(input.key)) ?? null }),
    set: ({ input }) => pluginStorage(ctx, input.namespace).set(input.key, input.value),
    delete: async ({ input }) => ({ deleted: await pluginStorage(ctx, input.namespace).delete(input.key) }),
    list: ({ input }) => {
      const { namespace, ...page } = input
      return pluginStorage(ctx, namespace).list(page)
    },
  })

/** The `changed` event payload of one storage-domain change; undefined for other domains. */
const changeOf = (change: { readonly domain: string; readonly table: string; readonly key: string; readonly operation: string }) => {
  if (change.domain !== DOMAIN_NAME || change.table !== 'entries') return undefined
  const separator = change.key.indexOf('\u0000')
  if (separator < 0) return undefined
  return { namespace: change.key.slice(0, separator), key: change.key.slice(separator + 1), deleted: change.operation === 'deleted' }
}

export class PluginStorageModel {
  static readonly open = pluginStorage
  static readonly registration = storageRegistration
  static readonly domainName = DOMAIN_NAME
  static readonly changeOf = changeOf
}
