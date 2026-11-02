import { Option } from 'effect'
import * as Schema from 'effect/Schema'
import { z, type ZodType } from 'zod'

/**
 * A zod-typed view of an Effect schema, for the contracts that still type their schema parameter as `ZodType`:
 * `@deepseek-ai/dsh-storage-domain`'s `defineDomain` record validators and `@dshfiles/plugin-ui`'s `createStoredValue`
 * keys. The Effect schema stays the source of truth, so the view decodes with it: defaults a stored value omits are
 * filled the way `Schema.decodeUnknownSync` fills them, unknown properties are stripped, and an invalid value is
 * rejected through `parse` and `safeParse` alike.
 */
export const zodSchemaFromEffect = <S extends Schema.ConstraintDecoder<unknown>>(schema: S): ZodType<S['Type']> =>
  z.custom<S['Type']>(value => Option.isSome(Schema.decodeUnknownOption(schema)(value))).transform(value => Schema.decodeUnknownSync(schema)(value))
