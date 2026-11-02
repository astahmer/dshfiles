import * as Schema from 'effect/Schema'

/** The value a bound is measured on after trimming, matching `z.string().trim().min(...)`. */
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
