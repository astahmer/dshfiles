import type * as SchemaTypes from 'effect/Schema'
import * as JsonSchema from 'effect/JsonSchema'
import * as Schema from 'effect/Schema'

type JsonSchemaOptions = { readonly target: 'draft-07' | 'draft-2020-12' | 'openapi-3.0' }

const emptyObject = (document: Record<string, unknown>) =>
  (document['type'] === undefined && document['not'] !== undefined) ||
  (document['type'] === 'object' && document['properties'] === undefined && document['additionalProperties'] === false)

/** The document Effect would publish if every Struct were closed, which is what zod published on the output side. */
const closedDocument = (schema: SchemaTypes.ConstraintDecoder<unknown>) => Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' })

const current = (document: ReturnType<typeof closedDocument>, options: JsonSchemaOptions) => {
  const built = options.target === 'draft-07' ? JsonSchema.toDocumentDraft07(document) : document
  return {
    ...built.schema,
    ...(Object.keys(built.definitions).length > 0 ? (options.target === 'draft-07' ? { definitions: built.definitions } : { $defs: built.definitions }) : {}),
  }
}

type JsonObject = Record<string, unknown>

const isJsonObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

/** dshx drops `additionalProperties: true` before publishing, so the wrapper publishes the same document zod did. */
const omitDefaultAdditionalProperties = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(entry => omitDefaultAdditionalProperties(entry))
  if (!isJsonObject(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, child]) => !(key === 'additionalProperties' && child === true))
      .map(([key, child]) => [key, omitDefaultAdditionalProperties(child)]),
  )
}

const ARRAY_KEY_ORDER = ['$schema', 'description', 'title', 'minItems', 'maxItems', 'type', 'items']

/** zod published an array's description and bounds before `type`; Effect publishes them after `items`. */
const reorderArrayKeywords = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(entry => reorderArrayKeywords(entry))
  if (!isJsonObject(value)) return value
  const node = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, reorderArrayKeywords(child)]))
  if (node['type'] !== 'array' && node['items'] === undefined) return node
  const ordered = ARRAY_KEY_ORDER.filter(key => key in node).map(key => [key, node[key]])
  const rest = Object.entries(node).filter(([key]) => !ARRAY_KEY_ORDER.includes(key))
  return Object.fromEntries([...ordered, ...rest])
}

const publishedDocument = (document: unknown): JsonObject => (isJsonObject(document) ? document : {})

/** `Schema.Struct({})` publishes `{ not: { type: 'null' } }` where `z.object({})` published an empty object. */
const replaceEmptyObject = (document: Record<string, unknown>, closed: boolean): Record<string, unknown> => {
  if (!emptyObject(document)) return document
  const { not: _not, $schema, ...rest } = document
  const replaced = closed ? { ...rest, type: 'object', properties: {}, additionalProperties: false } : { ...rest, type: 'object', properties: {} }
  return $schema === undefined ? replaced : { $schema, ...replaced }
}

const merge = (standardDocument: Record<string, unknown>, document: ReturnType<typeof closedDocument>, options: JsonSchemaOptions) => {
  const closed = current(document, options)
  if (!emptyObject(closed)) return { ...standardDocument, ...closed }
  return replaceEmptyObject({ ...standardDocument, ...closed }, true)
}

/**
 * Effect publishes `additionalProperties: true` for a Struct and dshx drops that keyword, while zod published
 * `additionalProperties: false` on an object's output side only. The closed document is merged into the output schema
 * and the input keeps Effect's open one, so decoding stays as permissive as `z.object(...)`, which strips unknown keys.
 */
export const standardSchema = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S) => {
  const standardSchema = Schema.toStandardSchemaV1(schema)
  const standardJsonSchema = Schema.toStandardJSONSchemaV1(schema)['~standard'].jsonSchema
  const document = closedDocument(schema)

  return {
    ast: schema.ast,
    '~standard': {
      ...standardSchema['~standard'],
      jsonSchema: {
        ...standardJsonSchema,
        input: (options: JsonSchemaOptions) =>
          publishedDocument(reorderArrayKeywords(omitDefaultAdditionalProperties(replaceEmptyObject(standardJsonSchema.input(options), false)))),
        output: (options: JsonSchemaOptions) =>
          publishedDocument(reorderArrayKeywords(omitDefaultAdditionalProperties(merge(standardJsonSchema.output(options), document, options)))),
      },
    },
  }
}

/**
 * `z.object(...).strict()` published `additionalProperties: false` on both sides and rejected unknown keys, so the
 * closed document is merged into both directions and decoding rejects excess properties.
 */
export const strictStandardSchema = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S) => {
  const standardSchema = Schema.toStandardSchemaV1(schema, { parseOptions: { onExcessProperty: 'error' } })
  const standardJsonSchema = Schema.toStandardJSONSchemaV1(schema)['~standard'].jsonSchema
  const document = closedDocument(schema)

  return {
    ast: schema.ast,
    '~standard': {
      ...standardSchema['~standard'],
      jsonSchema: {
        ...standardJsonSchema,
        input: (options: JsonSchemaOptions) => publishedDocument(reorderArrayKeywords(omitDefaultAdditionalProperties(merge(standardJsonSchema.input(options), document, options)))),
        output: (options: JsonSchemaOptions) => publishedDocument(reorderArrayKeywords(omitDefaultAdditionalProperties(merge(standardJsonSchema.output(options), document, options)))),
      },
    },
  }
}
