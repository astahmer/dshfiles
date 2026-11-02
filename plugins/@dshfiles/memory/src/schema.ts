import type { ApiMethodOptions, ApiToolExposure } from '@dshfiles/dshx/api'
import { method as defineMethod } from '@dshfiles/dshx/api'
import * as JsonSchema from 'effect/JsonSchema'
import * as Schema from 'effect/Schema'
import type * as SchemaTypes from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'

/** The decode rules this module's contracts share: stored rows, request bodies and tool arguments. */
export class MemorySchema {
  /** `z.string().trim()`: the decoded value is trimmed, so a padded paste names the same note. */
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
}

const closedDocument = (schema: SchemaTypes.ConstraintDecoder<unknown>) => Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' })

const publishedDocument = (document: ReturnType<typeof closedDocument>, options: { readonly target: string }) => {
  const built = options.target === 'draft-07' ? JsonSchema.toDocumentDraft07(document) : document
  if (Object.keys(built.definitions).length === 0) return { ...built.schema }
  return { ...built.schema, [options.target === 'draft-07' ? 'definitions' : '$defs']: built.definitions }
}

/**
 * How memory's Effect schemas reach the API contract. Inputs are published closed and decode with no unknown keys, the
 * rule the old `z.object(...).strict()` carried. Outputs stay open: a Host older than the panel is decoded with the
 * schema it published, so a field this build added must not fail the whole reply.
 */
export class MemoryContract {
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
    return { ast: schema.ast, '~standard': { ...standard['~standard'], jsonSchema: { ...jsonSchema, input: published, output: published } } }
  }

  /** One contract method from Effect schemas: the input decodes strictly, the output decodes as its schema declares. */
  static readonly method = <const Input extends SchemaTypes.ConstraintDecoder<unknown>, const Output extends SchemaTypes.ConstraintDecoder<unknown>>(
    options: Omit<ApiMethodOptions<Input, Output>, 'input' | 'output' | 'tool'> & {
      readonly input: Input
      readonly output: Output
      readonly tool?: ApiToolExposure<Output['Type']>
    },
  ) => defineMethod({ ...options, input: MemoryContract.strict(options.input), output: Schema.toStandardSchemaV1(options.output) })
}
