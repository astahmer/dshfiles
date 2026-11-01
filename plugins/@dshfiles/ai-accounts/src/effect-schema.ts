import * as Schema from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'
import type * as SchemaTypes from 'effect/Schema'

/**
 * The decode and string rules this plugin's contracts share.
 *
 * Every stored row and inbound payload is decoded once at its boundary; past it
 * the value is a named, validated type. Trimming matches the contracts this
 * package published before, so a padded paste still names the same account.
 */
export class AiAccountsSchema {
  /** Decodes once at a boundary, throwing a `SchemaError` a caller can report. */
  // oxlint-disable-next-line antislop/no-unknown-parameters -- this is the boundary: the schema parses the unknown input
  static readonly decode = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S, input: unknown): S['Type'] => Schema.decodeUnknownSync(schema)(input)

  /** Like `decode`, but returns a `Result` so a caller can branch without a throw. */
  // oxlint-disable-next-line antislop/no-unknown-parameters -- this is the boundary: the schema parses the unknown input
  static readonly decodeResult = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S, input: unknown) => Schema.decodeUnknownResult(schema)(input)

  /** Whether the input decodes, without throwing or keeping the decoded value. */
  // oxlint-disable-next-line antislop/no-unknown-parameters -- this is the boundary: the schema parses the unknown input
  static readonly accepts = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S, input: unknown): boolean =>
    Schema.decodeUnknownResult(schema)(input)._tag === 'Success'

  /** Whether the input decodes with no unknown keys, the rule `z.object(...).strict()` carried. */
  // oxlint-disable-next-line antislop/no-unknown-parameters -- this is the boundary: the schema parses the unknown input
  static readonly acceptsStrict = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S, input: unknown): boolean =>
    Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(input)._tag === 'Success'

  /** A string codec whose decoded value is trimmed, like the `z.string().trim()` rule it replaces. */
  static readonly trimmedString: SchemaTypes.Codec<string, string> = Schema.String.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transform((value: string) => value.trim()),
      encode: SchemaGetter.transform((value: string) => value),
    }),
  )

  /** A trimmed string bounded by a maximum length, `''` allowed. */
  static readonly trimmedText = (maximum: number) => AiAccountsSchema.trimmedString.check(Schema.isMaxLength(maximum))

  /** A trimmed string that must name something once trimmed. */
  static readonly trimmedName = (maximum: number) => AiAccountsSchema.trimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(maximum))

  /** A required identifier string: non-empty and bounded. */
  static readonly id = (maximum: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximum))

  /** A list bounded by a maximum length. */
  static readonly list = <S extends SchemaTypes.Constraint>(schema: S, maximum: number) => Schema.Array(schema).check(Schema.isMaxLength(maximum))

  /** An integer between two inclusive bounds, never NaN or Infinity. */
  static readonly intBetween = (minimum: number, maximum: number) =>
    Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(minimum), Schema.isLessThanOrEqualTo(maximum))
}
