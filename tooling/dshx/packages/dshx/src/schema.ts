import * as Schema from 'effect/Schema'

export const withUnknownProperties = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)])
