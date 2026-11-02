import * as Schema from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'
import type * as SchemaTypes from 'effect/Schema'
import type * as SchemaAST from 'effect/SchemaAST'

/** A caller-owned, writable copy of a decoded struct type: dshx input structs decode as readonly properties. */
export type Mutable<T> = { -readonly [Key in keyof T]: T[Key] }

/** The decode helpers this plugin uses at its boundaries: stored rows, request bodies, tool arguments. */
export class TracesSchema {
  /** Decodes once at a boundary; every value past it is a named, validated type. */
  // oxlint-disable-next-line antislop/no-unknown-parameters -- this is the boundary: the schema parses the unknown input
  static readonly decode = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S, input: unknown): S['Type'] => Schema.decodeUnknownSync(schema)(input)

  /** Like `decode`, but rejects unknown keys the way the contract used to (`z.object(...).strict()`). */
  // oxlint-disable-next-line antislop/no-unknown-parameters -- this is the boundary: the schema parses the unknown input
  static readonly decodeStrict = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S, input: unknown, options?: SchemaAST.ParseOptions): S['Type'] =>
    Schema.decodeUnknownSync(schema, { onExcessProperty: 'error', ...options })(input)

  // oxlint-disable-next-line antislop/no-unknown-parameters -- test boundary: the schema parses the unknown value
  static readonly acceptsStrict = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S, value: unknown): boolean =>
    Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(value)._tag === 'Success'

  /** `z.string().trim()`: the decoded value is trimmed, so a padded search box filters on its text. */
  static readonly trimmedString: SchemaTypes.Codec<string, string> = Schema.String.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transform((value: string) => value.trim()),
      encode: SchemaGetter.transform((value: string) => value),
    }),
  )
}
