import type * as SchemaTypes from 'effect/Schema'
import * as JsonSchema from 'effect/JsonSchema'
import * as Schema from 'effect/Schema'

type JsonSchemaOptions = { readonly target: 'draft-07' | 'draft-2020-12' | 'openapi-3.0' }
type JsonSchemaDocument = ReturnType<typeof Schema.toJsonSchemaDocument>

const toDialect = (published: JsonSchemaDocument, options: JsonSchemaOptions) => {
  if (options.target === 'draft-07') {
    const draft07 = JsonSchema.toDocumentDraft07(published)
    return Object.keys(draft07.definitions).length === 0 ? { ...draft07.schema } : { ...draft07.schema, definitions: draft07.definitions }
  }
  return Object.keys(published.definitions).length === 0 ? { ...published.schema } : { ...published.schema, $defs: published.definitions }
}

/**
 * Effect Structs strip unknown keys on decode; the wire contracts these replace rejected them. This publishes the
 * schema with excess-property rejection and a closed JSON Schema, so the agent tool and the Host boundary agree.
 */
export const exactSchema = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S) => {
  const standard = Schema.toStandardSchemaV1(schema, { parseOptions: { onExcessProperty: 'error' } })
  const publish = (options: JsonSchemaOptions) => toDialect(Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' }), options)
  return {
    ...standard,
    '~standard': {
      ...standard['~standard'],
      jsonSchema: { input: publish, output: publish },
    },
  }
}

/** Decoding stays as permissive as the object schemas it replaces; the published document stays open. */
export const openSchema = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S) => {
  const standard = Schema.toStandardSchemaV1(schema)
  const publish = (options: JsonSchemaOptions) => toDialect(Schema.toJsonSchemaDocument(schema), options)
  return {
    ...standard,
    '~standard': {
      ...standard['~standard'],
      jsonSchema: { input: publish, output: publish },
    },
  }
}
