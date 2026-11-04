import * as Schema from 'effect/Schema'

export const passthrough = <S extends Schema.StructWithRest.Objects>(schema: S) => Schema.StructWithRest(schema, [Schema.Record(Schema.String, Schema.Unknown)])

const utcDateTimePattern =
  /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$/u

export const dateTimeString = Schema.String.check(
  Schema.makeFilter(value => (utcDateTimePattern.test(value) ? true : 'Invalid datetime'), {
    toJsonSchema: () => ({ format: 'date-time', pattern: utcDateTimePattern.source }),
  }),
)

export const urlString = Schema.String.check(
  Schema.makeFilter(
    value => {
      try {
        new URL(value)
        return true
      } catch {
        return 'Invalid URL'
      }
    },
    { toJsonSchema: () => ({ format: 'uri' }) },
  ),
)

/** The two field shapes this plugin adds to Effect Schema; the dshx converter is strict on its own. */
export class SchemaFields {
  static readonly passthrough = passthrough
  static readonly dateTimeString = dateTimeString
  static readonly urlString = urlString
}
