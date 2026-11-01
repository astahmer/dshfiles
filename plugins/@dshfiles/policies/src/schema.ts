import type * as SchemaTypes from 'effect/Schema'
import * as JsonSchema from 'effect/JsonSchema'
import * as Schema from 'effect/Schema'

const emptyObject = (document: Record<string, unknown>) =>
  (document['type'] === undefined && document['not'] !== undefined) ||
  (document['type'] === 'object' && document['properties'] === undefined && document['additionalProperties'] === false)

/**
 * Effect publishes `additionalProperties: true` for a Struct and dshx drops that keyword, while zod published
 * `additionalProperties: false`. Emitting the closed document, and decoding with `onExcessProperty: 'error'`, keeps
 * the published schema byte-identical and keeps rejecting unknown keys the way `z.object(...).strict()` did.
 */
export const strictStandardSchema = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S) => {
  const standardSchema = Schema.toStandardSchemaV1(schema, { parseOptions: { onExcessProperty: 'error' } })
  const standardJsonSchema = Schema.toStandardJSONSchemaV1(schema)['~standard'].jsonSchema
  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' })

  const current = (options: Parameters<typeof standardJsonSchema.input>[0]) => {
    const built = options.target === 'draft-07' ? JsonSchema.toDocumentDraft07(document) : document
    return {
      ...built.schema,
      ...(Object.keys(built.definitions).length > 0
        ? options.target === 'draft-07'
          ? { definitions: built.definitions }
          : { $defs: built.definitions }
        : {}),
    }
  }

  const merge = (standardDocument: Record<string, unknown>, options: Parameters<typeof standardJsonSchema.input>[0]) => {
    const closed = current(options)
    if (!emptyObject(closed)) return { ...standardDocument, ...closed }
    const { not: _not, $schema, type: _type, properties: _properties, additionalProperties: _additionalProperties, ...rest } = standardDocument
    const replaced = { ...rest, type: 'object', properties: {}, additionalProperties: false }
    return $schema === undefined ? replaced : { $schema, ...replaced }
  }

  return {
    ast: schema.ast,
    '~standard': {
      ...standardSchema['~standard'],
      jsonSchema: {
        ...standardJsonSchema,
        input: (options: Parameters<typeof standardJsonSchema.input>[0]) => merge(standardJsonSchema.input(options), options),
        output: (options: Parameters<typeof standardJsonSchema.output>[0]) => merge(standardJsonSchema.output(options), options),
      },
    },
  }
}
