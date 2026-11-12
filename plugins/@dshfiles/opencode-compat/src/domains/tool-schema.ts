import { assertObjectJsonSchema, validateJsonSchemaValue, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { Schema } from 'effect'

export const convertToolSchema = (input: { readonly schema: unknown }) => {
  if (Schema.isSchema(input.schema)) {
    const schema = input.schema
    const json = Schema.toJsonSchemaDocument(schema).schema
    assertObjectJsonSchema(json)
    return { json, validate: Schema.decodeUnknownPromise(schema as Schema.Codec<unknown, unknown>) }
  }
  const json = input.schema
  assertObjectJsonSchema(json)
  return {
    json,
    validate: async (value: unknown) => {
      const errors = validateJsonSchemaValue(json, value)
      if (errors.length > 0) throw new Error(errors.join('; '))
      return value
    },
  } satisfies { json: ObjectJsonSchema; validate: (value: unknown) => Promise<unknown> }
}
