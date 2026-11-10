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
export const zodSchemaFromEffect = <S extends Schema.ConstraintDecoder<unknown>>(schema: S): ZodType<S['Type']> => {
  const decode = Schema.decodeUnknownOption(schema)
  return z.custom<S['Type']>().transform((value, context) => {
    const decoded = decode(value)
    if (Option.isSome(decoded)) return decoded.value
    // The issue a failed `z.custom` check raised, keys in the same order, so `ZodError.message` stays byte-identical.
    context.addIssue({ code: 'custom', path: [], message: 'Invalid input' })
    return z.NEVER
  })
}
