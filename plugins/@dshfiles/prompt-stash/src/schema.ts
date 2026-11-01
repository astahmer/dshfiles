import type * as SchemaTypes from 'effect/Schema'
import * as JsonSchema from 'effect/JsonSchema'
import * as Schema from 'effect/Schema'

const emptyObject = (document: Record<string, unknown>) =>
  (document['type'] === undefined && document['not'] !== undefined) ||
  (document['type'] === 'object' && document['properties'] === undefined && document['additionalProperties'] === false)

/**
 * Effect publishes `additionalProperties: true` for a Struct and dshx drops that keyword, while zod published
 * `additionalProperties: false`. Emitting the closed document, and decoding with `onExcessProperty: 'error'`, keeps
 * the published schema byte-identical and keeps rejecting unknown keys the way `z.object(...).strict()` did.
 */
export const strictStandardSchema = <S extends SchemaTypes.ConstraintDecoder<unknown>>(schema: S) => {
  const standardSchema = Schema.toStandardSchemaV1(schema, { parseOptions: { onExcessProperty: 'error' } })
  const standardJsonSchema = Schema.toStandardJSONSchemaV1(schema)['~standard'].jsonSchema
  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' })

  const current = (options: Parameters<typeof standardJsonSchema.input>[0]) => {
    const built = options.target === 'draft-07' ? JsonSchema.toDocumentDraft07(document) : document
    return {
      ...built.schema,
      ...(Object.keys(built.definitions).length > 0 ? (options.target === 'draft-07' ? { definitions: built.definitions } : { $defs: built.definitions }) : {}),
    }
  }

  const merge = (standardDocument: Record<string, unknown>, options: Parameters<typeof standardJsonSchema.input>[0]) => {
    const closed = current(options)
    if (!emptyObject(closed)) return { ...standardDocument, ...closed }
    const { not: _not, $schema, type: _type, properties: _properties, additionalProperties: _additionalProperties, ...rest } = standardDocument
    const replaced = { ...rest, type: 'object', properties: {}, additionalProperties: false }
    return $schema === undefined ? replaced : { $schema, ...replaced }
  }

  return {
    ast: schema.ast,
    '~standard': {
      ...standardSchema['~standard'],
      jsonSchema: {
        ...standardJsonSchema,
        input: (options: Parameters<typeof standardJsonSchema.input>[0]) => merge(standardJsonSchema.input(options), options),
        output: (options: Parameters<typeof standardJsonSchema.output>[0]) => merge(standardJsonSchema.output(options), options),
      },
    },
  }
}

/** The exact pattern zod publishes for `z.string().uuid()`, so the converted schema stays byte-identical. */
const uuidPattern =
  '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
const uuidRegExp = new RegExp(uuidPattern, 'u')

export const uuidSchema = Schema.String.check(
  Schema.makeFilter(value => (uuidRegExp.test(value) ? true : 'Expected a UUID'), { toJsonSchema: () => ({ format: 'uuid', pattern: uuidPattern }) }),
)

/** The UTC datetime pattern zod publishes for `z.string().datetime()`. */
const utcDateTimePattern =
  /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$/u

export const dateTimeString = Schema.String.check(
  Schema.makeFilter(value => (utcDateTimePattern.test(value) ? true : 'Invalid datetime'), {
    toJsonSchema: () => ({ format: 'date-time', pattern: utcDateTimePattern.source }),
  }),
)

/** The bounds of a trimmed string are measured on the trimmed value, matching `z.string().trim().min(...)`. */
export const trimmedString = <ValueSchema extends Schema.ConstraintDecoder<string>>(schema: ValueSchema) => {
  const constraints = { ...Schema.toJsonSchemaDocument(schema).schema }
  delete constraints.type

  return Schema.String.check(
    Schema.makeFilter(
      value => {
        const trimmed = Schema.decodeUnknownResult(schema)(value.trim())
        return trimmed._tag === 'Success' ? true : trimmed.failure.message
      },
      { toJsonSchema: () => constraints },
    ),
  ).pipe(Schema.decodeTo(Schema.Trim))
}
