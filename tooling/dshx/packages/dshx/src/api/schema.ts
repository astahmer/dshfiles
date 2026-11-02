import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import { JsonSchema, Schema } from 'effect'

type JsonSchemaTarget = StandardJSONSchemaV1.Options['target']

/** An empty Struct publishes `not: null`, which no tool can read; it means the closed empty object. */
const closedEmptyObject: JsonSchema.JsonSchema = { type: 'object', properties: {}, additionalProperties: false }

const isEmptyObjectDocument = (schema: JsonSchema.JsonSchema): boolean => Object.keys(schema).length === 1 && 'not' in schema

/**
 * The published JSON Schema of one side of an Effect schema: objects are closed (`additionalProperties: false`), as
 * strict decoding rejects unknown keys. `Void` keeps its `type: null`, which agent tools read as "no arguments".
 */
const publishedDocument = (schema: Schema.Top, target: JsonSchemaTarget): JsonSchema.JsonSchema => {
  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' })
  if (isEmptyObjectDocument(document.schema)) return closedEmptyObject
  if (target === 'draft-07') {
    const draft07 = JsonSchema.toDocumentDraft07(document)
    const published: JsonSchema.JsonSchema = { $schema: JsonSchema.META_SCHEMA_URI_DRAFT_07, ...draft07.schema }
    return Object.keys(draft07.definitions).length === 0 ? published : { ...published, definitions: draft07.definitions }
  }
  if (target !== 'draft-2020-12') throw new TypeError(`Unsupported JSON Schema target ${target}.`)
  const published: JsonSchema.JsonSchema = { $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12, ...document.schema }
  return Object.keys(document.definitions).length === 0 ? published : { ...published, $defs: document.definitions }
}

/** An Effect schema as a strict Standard Schema: decoding rejects unknown keys and the JSON Schema says so. */
const strictStandardSchema = (schema: Schema.Codec<unknown, unknown>): StandardSchemaV1 & StandardJSONSchemaV1 => {
  const standard = Schema.toStandardSchemaV1(schema, { parseOptions: { onExcessProperty: 'error' } })['~standard']
  const typeSide = Schema.toType(schema)
  return {
    '~standard': {
      version: 1,
      vendor: standard.vendor,
      validate: standard.validate,
      jsonSchema: {
        input: options => publishedDocument(schema, options.target),
        output: options => publishedDocument(typeSide, options.target),
      },
    },
  }
}

const isStandardSchema = (schema: unknown): schema is StandardSchemaV1 => {
  if ((typeof schema !== 'object' && typeof schema !== 'function') || schema === null || !('~standard' in schema)) return false
  const standard = schema['~standard']
  return typeof standard === 'object' && standard !== null && 'validate' in standard && typeof standard.validate === 'function'
}

/** Contract schemas are typed `ApiSchema`, whose decoding needs no services, so an Effect schema here is a plain codec. */
const isEffectSchema = (value: unknown): value is Schema.Codec<unknown, unknown> => Schema.isSchema(value)

const convertedSchemas = new WeakMap<object, StandardSchemaV1>()

/**
 * The Standard Schema behind a contract schema. A Standard Schema is used as is; an Effect Schema becomes a strict
 * one (`onExcessProperty: 'error'`, closed objects in its JSON Schema), with no import-order dependence.
 */
export const resolveApiSchema = <Input = unknown, Output = Input>(schema: unknown): StandardSchemaV1<Input, Output> => {
  // SAFETY: contract declarations type the schema as ApiSchema<Input, Output>; this resolver only changes its runtime adapter.
  if (isStandardSchema(schema)) return schema as StandardSchemaV1<Input, Output>
  if (!isEffectSchema(schema)) throw new TypeError('API schema must be a Standard Schema or an Effect Schema.')
  const cached = convertedSchemas.get(schema) ?? strictStandardSchema(schema)
  convertedSchemas.set(schema, cached)
  // SAFETY: the strict adapter validates with the same Effect schema whose Encoded/Type the declaration inferred.
  return cached as StandardSchemaV1<Input, Output>
}
