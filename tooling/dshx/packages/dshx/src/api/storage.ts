import { z } from 'zod'
import { ApiDefinitionModel } from './define.js'

const MAX_VALUE_BYTES = 256 * 1024
const DEFAULT_PAGE = 100
const MAX_PAGE = 500

/**
 * Built on first use: the public client module re-exports `hostStorage`, so top-level schemas here would put zod and
 * this contract into every browser bundle that imports `@dshfiles/dshx/client`.
 */
const build = () => {
  const namespace = z
    .string()
    .min(1)
    .max(214)
    .regex(/^[A-Za-z0-9@._/-]+$/, 'Use the plugin package name or id as the namespace.')
  const key = z.string().min(1).max(512)
  const value = z.json().refine(json => new TextEncoder().encode(JSON.stringify(json)).byteLength <= MAX_VALUE_BYTES, {
    message: `A stored value must be at most ${MAX_VALUE_BYTES} bytes of JSON.`,
  })
  const entry = z.object({ key, value: z.json(), updatedAt: z.number().int().nonnegative() }).strict()
  const address = z.object({ namespace, key }).strict()
  const listInput = z
    .object({
      namespace,
      prefix: z.string().max(512).optional(),
      /** The `cursor` of the previous page: listing resumes after that key. */
      cursor: key.optional(),
      limit: z.number().int().min(1).max(MAX_PAGE).optional(),
    })
    .strict()
  const page = z.object({ entries: z.array(entry), cursor: key.nullable() }).strict()
  /**
   * Host-backed key-value storage for plugins: one durable table per DSH process, partitioned by namespace, listed in
   * key order with a prefix and a cursor. The first loaded dshx Host with an API serves it.
   */
  const api = ApiDefinitionModel.define({
    id: 'storage',
    version: 1,
    owner: ApiDefinitionModel.registryOwner,
    methods: {
      get: ApiDefinitionModel.method({ input: address, output: z.object({ entry: entry.nullable() }).strict(), readOnly: true }),
      set: ApiDefinitionModel.method({ input: address.extend({ value }).strict(), output: entry }),
      delete: ApiDefinitionModel.method({ input: address, output: z.object({ deleted: z.boolean() }).strict() }),
      list: ApiDefinitionModel.method({ input: listInput, output: page, readOnly: true }),
    },
    events: {
      changed: ApiDefinitionModel.event({
        schema: z.object({ namespace, key, deleted: z.boolean() }).strict(),
        description: 'A stored key was written or deleted.',
      }),
    },
  })
  return { api, namespace, key, value, entry, listInput, page }
}

type Built = ReturnType<typeof build>
let built: Built | undefined
const contract = (): Built => (built ??= build())

export type StoredEntry = z.infer<Built['entry']>
export type StoragePage = z.infer<Built['page']>
export type StorageListInput = Omit<z.input<Built['listInput']>, 'namespace'>

export class PluginStorageContract {
  static readonly defaultPage = DEFAULT_PAGE
  static get api(): Built['api'] {
    return contract().api
  }
  static get namespace(): Built['namespace'] {
    return contract().namespace
  }
  static get key(): Built['key'] {
    return contract().key
  }
  static get value(): Built['value'] {
    return contract().value
  }
  static get listInput(): Built['listInput'] {
    return contract().listInput
  }
}
