import type { ApiMethodOptions, ApiToolExposure } from '@dshfiles/dshx/api'
import { method as defineMethod } from '@dshfiles/dshx/api'
import * as JsonSchema from 'effect/JsonSchema'
import * as Schema from 'effect/Schema'

/**
 * The published view of a contract schema: decoding rejects unknown keys, and the JSON Schema says so too, so an agent
 * tool never advertises an input the Host would refuse.
 */
export const strictStandardSchema = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => {
  const standard = Schema.toStandardSchemaV1(schema, { parseOptions: { onExcessProperty: 'error' } })
  const jsonSchema = Schema.toStandardJSONSchemaV1(schema)['~standard'].jsonSchema
  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' })

  const published = (options: Parameters<typeof jsonSchema.input>[0]) => {
    const built = options.target === 'draft-07' ? JsonSchema.toDocumentDraft07(document) : document
    const closed = { ...built.schema }
    // An empty input publishes no usable schema: `Void` is `type: null` and an empty Struct is `not: null`.
    if (schema.ast === Schema.Void.ast || (Object.keys(closed).length === 1 && 'not' in closed)) {
      return { type: 'object', properties: {}, additionalProperties: false }
    }
    if (Object.keys(built.definitions).length === 0) return closed
    if (options.target === 'draft-07') return { ...closed, definitions: built.definitions }
    return { ...closed, $defs: built.definitions }
  }

  return {
    ast: schema.ast,
    '~standard': {
      ...standard['~standard'],
      jsonSchema: { ...jsonSchema, input: published, output: published },
    },
  }
}

/** One contract method from Effect schemas: input and output are validated and published through the standard shape. */
export const method = <const Input extends Schema.ConstraintDecoder<unknown>, const Output extends Schema.ConstraintDecoder<unknown>>(
  options: Omit<ApiMethodOptions<Input, Output>, 'input' | 'output' | 'tool'> & {
    readonly input: Input
    readonly output: Output
    readonly tool?: ApiToolExposure<Output['Type']>
  },
) => defineMethod({ ...options, input: strictStandardSchema(options.input), output: strictStandardSchema(options.output) })
