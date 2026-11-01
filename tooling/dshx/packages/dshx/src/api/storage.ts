import * as Schema from 'effect/Schema'
import { jsonValueSchema } from '../json.js'
import { ApiDefinitionModel } from './define.js'

const MAX_VALUE_BYTES = 256 * 1024
const DEFAULT_PAGE = 100
const MAX_PAGE = 500

/**
 * Built on first use: the public client module re-exports `hostStorage`, so constructing the Effect schemas here would
 * pull this contract into every browser bundle that imports `@dshfiles/dshx/client`.
 */
const build = () => {
  const apiSchema = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => Schema.toStandardSchemaV1(schema)
  const namespace = Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(214),
    Schema.makeFilter(value => /^[A-Za-z0-9@._/-]+$/.test(value) || 'Use the plugin package name or id as the namespace.'),
  )
  const key = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512))
  const value = jsonValueSchema.check(
    Schema.makeFilter(json => {
      const byteLength = new TextEncoder().encode(JSON.stringify(json)).byteLength
      return byteLength <= MAX_VALUE_BYTES ? true : `A stored value must be at most ${MAX_VALUE_BYTES} bytes of JSON.`
    }),
  )
  const entry = Schema.Struct({ key, value, updatedAt: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) })
  const address = Schema.Struct({ namespace, key })
  const listInput = Schema.Struct({
    namespace,
    prefix: Schema.optional(Schema.String.check(Schema.isMaxLength(512))),
    /** The `cursor` of the previous page: listing resumes after that key. */
    cursor: Schema.optional(key),
    limit: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(MAX_PAGE))),
  })
  const page = Schema.Struct({ entries: Schema.Array(entry), cursor: Schema.NullOr(key) })
  /**
   * Host-backed key-value storage for plugins: one durable table per DSH process, partitioned by namespace, listed in
   * key order with a prefix and a cursor. The first loaded dshx Host with an API serves it.
   */
  const api = ApiDefinitionModel.define({
    id: 'storage',
    version: 1,
    owner: ApiDefinitionModel.registryOwner,
    methods: {
      get: ApiDefinitionModel.method({ input: apiSchema(address), output: apiSchema(Schema.Struct({ entry: Schema.NullOr(entry) })), readOnly: true }),
      set: ApiDefinitionModel.method({ input: apiSchema(Schema.Struct({ namespace, key, value })), output: apiSchema(entry) }),
      delete: ApiDefinitionModel.method({ input: apiSchema(address), output: apiSchema(Schema.Struct({ deleted: Schema.Boolean })) }),
      list: ApiDefinitionModel.method({ input: apiSchema(listInput), output: apiSchema(page), readOnly: true }),
    },
    events: {
      changed: ApiDefinitionModel.event({
        schema: apiSchema(Schema.Struct({ namespace, key, deleted: Schema.Boolean })),
        description: 'A stored key was written or deleted.',
      }),
    },
  })
  return { api, namespace, key, value, entry, listInput, page }
}

type Built = ReturnType<typeof build>
let built: Built | undefined
const contract = (): Built => (built ??= build())

export type StoredEntry = Built['entry']['Type']
export type StoragePage = Built['page']['Type']
export type StorageListInput = Omit<Built['listInput']['Encoded'], 'namespace'>

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
