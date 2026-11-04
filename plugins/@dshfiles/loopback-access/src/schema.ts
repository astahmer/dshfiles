import type { ApiMethodOptions, ApiToolExposure } from '@dshfiles/dshx/api'
import { method as defineMethod } from '@dshfiles/dshx/api'
import * as JsonSchema from 'effect/JsonSchema'
import * as Schema from 'effect/Schema'
import type * as SchemaTypes from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'

/** The decode rules this plugin's contracts share: settings rows, request bodies, API snapshots. */
export class LoopbackSchema {
  /** `z.string().trim()`: the decoded value is trimmed, so a padded paste names the same address. */
  static readonly trimmedString: SchemaTypes.Codec<string, string> = Schema.String.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transform((value: string) => value.trim()),
      encode: SchemaGetter.transform((value: string) => value),
    }),
  )
}

const closedDocument = (schema: SchemaTypes.ConstraintDecoder<unknown>) => Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' })

const publishedDocument = (document: ReturnType<typeof closedDocument>, options: { readonly target: string }) => {
  const built = options.target === 'draft-07' ? JsonSchema.toDocumentDraft07(document) : document
  if (Object.keys(built.definitions).length === 0) return { ...built.schema }
  return { ...built.schema, [options.target === 'draft-07' ? 'definitions' : '$defs']: built.definitions }
}

/**
 * How this plugin's Effect schemas reach the API contract: the published tree is closed on both sides, so an agent tool
 * never advertises an input the Host would refuse, and decoding rejects unknown keys the way the old zod tree did.
 */
export class LoopbackContract {
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

  /** One contract method from Effect schemas: input and output decode strictly and publish through the standard shape. */
  static readonly method = <const Input extends SchemaTypes.ConstraintDecoder<unknown>, const Output extends SchemaTypes.ConstraintDecoder<unknown>>(
    options: Omit<ApiMethodOptions<Input, Output>, 'input' | 'output' | 'tool'> & {
      readonly input: Input
      readonly output: Output
      readonly tool?: ApiToolExposure<Output['Type']>
    },
  ) => defineMethod({ ...options, input: LoopbackContract.strict(options.input), output: LoopbackContract.strict(options.output) })
}
