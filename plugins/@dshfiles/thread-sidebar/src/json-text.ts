import * as Schema from 'effect/Schema'
import * as Result from 'effect/Result'
import type { z } from 'zod'

/** JSON text parsed once, then validated by the schema that gives it a type. */
export class JsonText {
  static decode<Schema extends z.ZodType>(schema: Schema, text: string): z.ZodSafeParseResult<z.output<Schema>> | undefined {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return undefined
    }
    return schema.safeParse(value)
  }

  static decodeEffect<EffectSchema extends Schema.ConstraintDecoder<unknown>>(
    schema: EffectSchema,
    text: string,
  ): Result.Result<EffectSchema['Type'], Schema.SchemaError> | undefined {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return undefined
    }
    return Schema.decodeUnknownResult(schema)(value)
  }
}
