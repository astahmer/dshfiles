import { z } from 'zod'
import { ApiDefinitionModel } from './define.js'

const MAX_VALUE_BYTES = 256 * 1024
const DEFAULT_PAGE = 100
const MAX_PAGE = 500

const namespaceSchema = z
  .string()
  .min(1)
  .max(214)
  .regex(/^[A-Za-z0-9@._/-]+$/, 'Use the plugin package name or id as the namespace.')
const keySchema = z.string().min(1).max(512)
const valueSchema = z.json().refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_VALUE_BYTES, {
  message: `A stored value must be at most ${MAX_VALUE_BYTES} bytes of JSON.`,
})

const entrySchema = z.object({ key: keySchema, value: z.json(), updatedAt: z.number().int().nonnegative() }).strict()
const addressSchema = z.object({ namespace: namespaceSchema, key: keySchema }).strict()

const listInputSchema = z
  .object({
    namespace: namespaceSchema,
    prefix: z.string().max(512).optional(),
    /** The `cursor` of the previous page: listing resumes after that key. */
    cursor: keySchema.optional(),
    limit: z.number().int().min(1).max(MAX_PAGE).optional(),
  })
  .strict()

const pageSchema = z.object({ entries: z.array(entrySchema), cursor: keySchema.nullable() }).strict()

/**
 * Host-backed key-value storage for plugins: one durable table per DSH process, partitioned by namespace,
 * listed in key order with a prefix and a cursor. The first loaded dshx Host with an API serves it.
 */
const dshxStorageApi = ApiDefinitionModel.define({
  id: 'storage',
  version: 1,
  owner: ApiDefinitionModel.registryOwner,
  methods: {
    get: ApiDefinitionModel.method({ input: addressSchema, output: z.object({ entry: entrySchema.nullable() }).strict(), readOnly: true }),
    set: ApiDefinitionModel.method({ input: addressSchema.extend({ value: valueSchema }).strict(), output: entrySchema }),
    delete: ApiDefinitionModel.method({ input: addressSchema, output: z.object({ deleted: z.boolean() }).strict() }),
    list: ApiDefinitionModel.method({ input: listInputSchema, output: pageSchema, readOnly: true }),
  },
  events: {
    changed: ApiDefinitionModel.event({
      schema: z.object({ namespace: namespaceSchema, key: keySchema, deleted: z.boolean() }).strict(),
      description: 'A stored key was written or deleted.',
    }),
  },
})

export type StoredEntry = z.infer<typeof entrySchema>
export type StoragePage = z.infer<typeof pageSchema>
export type StorageListInput = Omit<z.input<typeof listInputSchema>, 'namespace'>

export class PluginStorageContract {
  static readonly api = dshxStorageApi
  static readonly defaultPage = DEFAULT_PAGE
  static readonly namespace = namespaceSchema
  static readonly key = keySchema
  static readonly value = valueSchema
  static readonly entry = entrySchema
  static readonly listInput = listInputSchema
}
