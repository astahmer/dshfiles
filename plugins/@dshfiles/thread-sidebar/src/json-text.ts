import * as Schema from 'effect/Schema'
import * as Result from 'effect/Result'

/** JSON text parsed once, then validated by the schema that gives it a type. */
export class JsonText {
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
