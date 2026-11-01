import * as Schema from 'effect/Schema'
import * as JsonSchema from 'effect/JsonSchema'

/**
 * Effect publishes `additionalProperties: true` for a Struct, and dshx drops that keyword, while zod published
 * `additionalProperties: false`. Emitting the closed document keeps the published contract byte-identical.
 */
export const strictStandardSchema = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => {
  const standardSchema = Schema.toStandardSchemaV1(schema, { parseOptions: { onExcessProperty: 'error' } })
  const standardJsonSchema = Schema.toStandardJSONSchemaV1(schema)['~standard'].jsonSchema
  const inputDocument = Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' })

  /** Effect renders an empty Struct as `not: { type: null }` and a closed Record without `properties`; zod published both as a closed empty object. */
  const emptyObject = (schema: Record<string, unknown>) =>
    (schema['type'] === undefined && schema['not'] !== undefined) ||
    (schema['type'] === 'object' && schema['properties'] === undefined && schema['additionalProperties'] === false)

  const document = (options: Parameters<typeof standardJsonSchema.input>[0]) => {
    const current = options.target === 'draft-07' ? JsonSchema.toDocumentDraft07(inputDocument) : inputDocument
    if (Object.keys(current.definitions).length === 0) return { ...current.schema }
    if (options.target === 'draft-07') return { ...current.schema, definitions: current.definitions }
    return { ...current.schema, $defs: current.definitions }
  }

  const merge = (standardDocument: Record<string, unknown>, options: Parameters<typeof standardJsonSchema.input>[0]) => {
    const current = document(options)
    if (emptyObject(current)) {
      const { not: _not, $schema, type: _type, properties: _properties, additionalProperties: _additionalProperties, ...rest } = standardDocument
      const closed = { ...rest, type: 'object', properties: {}, additionalProperties: false }
      return $schema === undefined ? closed : { $schema, ...closed }
    }
    return { ...standardDocument, ...current }
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
