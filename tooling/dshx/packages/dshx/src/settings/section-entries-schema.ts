import * as Schema from 'effect/Schema'

const strictStruct = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Json)]).check(
    Schema.makeFilter(value => Object.keys(value).every(key => Object.hasOwn(fields, key)) || 'Unexpected field.'),
  )

const trimmedNonemptyString = Schema.Trim.check(Schema.isMinLength(1)).check(Schema.isMaxLength(200))

/** Effect schemas consumed by Settings clients to validate the section metadata contract. */
export const settingsSearchEntryFields = {
  id: trimmedNonemptyString,
  title: trimmedNonemptyString,
  description: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
  keywords: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
}

export const settingsSearchEntrySchema = strictStruct(settingsSearchEntryFields)

/** One section's entries: ids are unique within the section, because the id comes back as its `target`. */
export const settingsSearchEntriesSchema = Schema.Array(settingsSearchEntrySchema)
  .check(Schema.isMaxLength(200))
  .check(
    Schema.makeFilter(entries => new Set(entries.map(entry => entry.id)).size === entries.length, {
      message: 'searchEntries ids must be unique within a section.',
    }),
  )

export const settingsSectionMetadataSchema = strictStruct({
  settingsTargets: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
  searchEntries: Schema.optionalKey(settingsSearchEntriesSchema),
})
