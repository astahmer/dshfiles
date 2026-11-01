import type { ApiMethodOptions, ApiToolExposure } from '@dshfiles/dshx/api'
import { method as defineMethod } from '@dshfiles/dshx/api'
import * as JsonSchema from 'effect/JsonSchema'
import * as Schema from 'effect/Schema'
import type * as SchemaTypes from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'

/** The decode rules this plugin's contracts share: stored rows, request bodies, tool arguments, Registry payloads. */
export class McpSchema {
  /** `z.string().url()`: an absolute URL that stays a string; the message is what the field shows. */
  static readonly absoluteUrl = (message: string) => Schema.String.check(Schema.makeFilter((value: string) => (URL.canParse(value) ? undefined : message)))

  /** `z.string().trim()`: the decoded value is trimmed, so a padded paste names the same thing. */
  static readonly trimmedString: SchemaTypes.Codec<string, string> = Schema.String.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transform((value: string) => value.trim()),
      encode: SchemaGetter.transform((value: string) => value),
    }),
  )

  /** Decodes once at a boundary, throwing a `SchemaError` a caller can report. */
  // oxlint-disable-next-line antislop/no-unknown-parameters -- this is the boundary: the schema parses the unknown input
  static readonly decode = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S, input: unknown): S['Type'] => Schema.decodeUnknownSync(schema)(input)

  /** Decodes once at a boundary with no unknown keys, the rule `z.object(...).strict()` carried. */
  // oxlint-disable-next-line antislop/no-unknown-parameters -- this is the boundary: the schema parses the unknown input
  static readonly decodeStrict = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S, input: unknown): S['Type'] =>
    Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(input)

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

  /** A required string bounded by a maximum length. */
  static readonly id = (maximum: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximum))

  /** A list bounded by a maximum length. */
  static readonly list = <S extends SchemaTypes.Constraint>(schema: S, maximum: number) => Schema.Array(schema).check(Schema.isMaxLength(maximum))

  /** An integer between two inclusive bounds, never NaN or Infinity. */
  static readonly intBetween = (minimum: number, maximum: number) =>
    Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(minimum), Schema.isLessThanOrEqualTo(maximum))
}

/** The issue shape a filter reports, so a form maps a failure back to the field that caused it. */
export type McpFilterIssue = Schema.FilterIssue

const closedDocument = (schema: SchemaTypes.ConstraintDecoder<unknown>) => Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' })

const publishedDocument = (document: ReturnType<typeof closedDocument>, options: { readonly target: string }) => {
  const built = options.target === 'draft-07' ? JsonSchema.toDocumentDraft07(document) : document
  if (Object.keys(built.definitions).length === 0) return { ...built.schema }
  return { ...built.schema, [options.target === 'draft-07' ? 'definitions' : '$defs']: built.definitions }
}

/**
 * How this plugin's Effect schemas reach the contracts that publish a JSON Schema: API methods and the Loader row config.
 */
export class McpContract {
  /**
   * The published view of a contract schema: decoding rejects unknown keys, and the JSON Schema says so too, so an agent
   * tool never advertises an input the Host would refuse. Keeps the `z.object(...).strict()` behaviour the contracts had.
   */
  static readonly strict = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S) => {
    const standard = Schema.toStandardSchemaV1(schema, { parseOptions: { onExcessProperty: 'error' } })
    const jsonSchema = Schema.toStandardJSONSchemaV1(schema)['~standard'].jsonSchema
    const document = closedDocument(schema)
    const published = (options: Parameters<typeof jsonSchema.input>[0]) => {
      const closed = publishedDocument(document, options)
      // An empty Struct publishes `not: null`, which the tool projector drops; publish the closed empty object instead.
      if (Object.keys(closed).length === 1 && 'not' in closed) return { type: 'object', properties: {}, additionalProperties: false }
      return closed
    }
    return {
      ast: schema.ast,
      '~standard': { ...standard['~standard'], jsonSchema: { ...jsonSchema, input: published, output: published } },
    }
  }

  /**
   * The published view of a row config: unknown keys are ignored (a Loader row may carry fields this version drops), and
   * the JSON Schema is Effect's own so the config editor can derive its form.
   */
  static readonly standard = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S) => Schema.toStandardSchemaV1(schema)

  /** One contract method from Effect schemas: input and output decode strictly and publish through the standard shape. */
  static readonly method = <const Input extends SchemaTypes.ConstraintDecoder<unknown>, const Output extends SchemaTypes.ConstraintDecoder<unknown>>(
    options: Omit<ApiMethodOptions<Input, Output>, 'input' | 'output' | 'tool'> & {
      readonly input: Input
      readonly output: Output
      readonly tool?: ApiToolExposure<Output['Type']>
    },
  ) => defineMethod({ ...options, input: McpContract.strict(options.input), output: McpContract.strict(options.output) })
}
