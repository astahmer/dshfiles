import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'

type SafeDecodeResult<Value> = { readonly success: true; readonly data: Value } | { readonly success: false; readonly error: Schema.SchemaError }

export class SchemaHelpers {
  static readonly strictStruct = <const Fields extends Schema.Struct.Fields>(schema: Schema.Struct<Fields>) =>
    Schema.Unknown.check(
      Schema.makeFilter(value => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
        const allowedKeys = new Set(Object.keys(schema.fields))
        const unexpectedKeys = Object.keys(value).filter(key => !allowedKeys.has(key))
        if (unexpectedKeys.length === 0) return undefined
        return `Unrecognized key(s) in object: ${unexpectedKeys.map(key => `'${key}'`).join(', ')}`
      }),
    ).pipe(
      Schema.decodeTo(schema, {
        decode: SchemaGetter.transform(value => {
          // SAFETY: the strict-key check runs first and the target Struct validates every asserted encoded field.
          return value as Schema.Struct.Encoded<Fields>
        }),
        encode: SchemaGetter.transform(value => value),
      }),
    )

  static readonly withDecodedDefault = <S extends Schema.ConstraintDecoder<unknown>, const Default extends S['Type']>(
    schema: S,
    getDefault: () => Default,
  ): Schema.withDecodingDefaultType<S, never> => Schema.withDecodingDefaultType<S, never>(Effect.sync(getDefault))(schema)

  static readonly decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown): S['Type'] =>
    Schema.decodeUnknownSync(schema)(input)

  static readonly decodeSafe = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown): SafeDecodeResult<S['Type']> => {
    const result = Schema.decodeUnknownResult(schema)(input)
    return Result.isSuccess(result) ? { success: true, data: result.success } : { success: false, error: result.failure }
  }

  static readonly decodeOr = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown, fallback: S['Type']): S['Type'] => {
    const result = Schema.decodeUnknownResult(schema)(input)
    return Result.isSuccess(result) ? result.success : fallback
  }
}
