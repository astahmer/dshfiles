import type * as SchemaTypes from 'effect/Schema'
import * as JsonSchema from 'effect/JsonSchema'
import * as Schema from 'effect/Schema'

type JsonSchemaOptions = { readonly target: 'draft-07' | 'draft-2020-12' | 'openapi-3.0' }

/** The document Effect publishes for a schema, in the requested JSON Schema dialect. */
const document = (schema: SchemaTypes.ConstraintDecoder<unknown>, options: JsonSchemaOptions) => {
  const published = Schema.toJsonSchemaDocument(schema)
  if (options.target === 'draft-07') {
    const draft07 = JsonSchema.toDocumentDraft07(published)
    return Object.keys(draft07.definitions).length === 0 ? { ...draft07.schema } : { ...draft07.schema, definitions: draft07.definitions }
  }
  return Object.keys(published.definitions).length === 0 ? { ...published.schema } : { ...published.schema, $defs: published.definitions }
}

/** A closed document: the Host rejects a property the contract does not declare. */
const closedDocument = (schema: SchemaTypes.ConstraintDecoder<unknown>, options: JsonSchemaOptions) => {
  const published = Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' })
  if (options.target === 'draft-07') {
    const draft07 = JsonSchema.toDocumentDraft07(published)
    return Object.keys(draft07.definitions).length === 0 ? { ...draft07.schema } : { ...draft07.schema, definitions: draft07.definitions }
  }
  return Object.keys(published.definitions).length === 0 ? { ...published.schema } : { ...published.schema, $defs: published.definitions }
}

const standard = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S, documentOf: typeof document) => {
  const standardSchema = Schema.toStandardSchemaV1(schema)
  return {
    ...standardSchema,
    '~standard': {
      ...standardSchema['~standard'],
      jsonSchema: {
        input: (options: JsonSchemaOptions) => documentOf(schema, options),
        output: (options: JsonSchemaOptions) => documentOf(schema, options),
      },
    },
  }
}

/**
 * Effect Structs strip unknown keys on decode; the wire contracts these replace rejected them. This publishes the
 * schema with excess-property rejection and a closed JSON Schema, so the agent tool and the Host boundary agree.
 */
export const exactSchema = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S) => {
  const standardSchema = Schema.toStandardSchemaV1(schema, { parseOptions: { onExcessProperty: 'error' } })
  return {
    ...standardSchema,
    '~standard': {
      ...standardSchema['~standard'],
      jsonSchema: {
        input: (options: JsonSchemaOptions) => closedDocument(schema, options),
        output: (options: JsonSchemaOptions) => closedDocument(schema, options),
      },
    },
  }
}

/** Outputs stay permissive so an older Client keeps decoding what a newer Host adds. */
export const openSchema = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S) => standard(schema, document)
