import { assertObjectJsonSchema, validateJsonSchemaValue, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@dshfiles/dshx/json'
import { Schema } from 'effect'

// OpenCode MIT: packages/schema/src/tool.ts (`ValueSchema`, `InputValue`), commit 67139d6827af.
export type ToolInputSchema = Schema.Top | ObjectJsonSchema
export type ToolInputValue<S extends ToolInputSchema = ToolInputSchema> = S extends Schema.Top ? Schema.Schema.Type<S> : JsonValue

export const bindToolInput = <Context, Result>(input: {
  readonly schema: ToolInputSchema
  readonly execute: (value: ToolInputValue, context: Context) => Promise<Result>
}) => {
  if (Schema.isSchema(input.schema)) {
    const json = Schema.toJsonSchemaDocument(input.schema).schema
    assertObjectJsonSchema(json)
    // SAFETY: The schema check establishes a codec; this boundary supplies no decoding services.
    const decode = Schema.decodeUnknownPromise(input.schema as Schema.Codec<ToolInputValue, JsonValue>)
    return { json, run: async (args: JsonValue, context: Context) => input.execute(await decode(args), context) }
  }
  const json = input.schema
  assertObjectJsonSchema(json)
  return {
    json,
    run: async (args: JsonValue, context: Context) => {
      const errors = validateJsonSchemaValue(json, args)
      if (errors.length > 0) throw new Error(errors.join('; '))
      return input.execute(args, context)
    },
  }
}
