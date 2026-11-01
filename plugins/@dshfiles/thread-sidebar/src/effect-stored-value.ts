import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'

export const toZodSchema = <ValueSchema extends Schema.ConstraintDecoder<unknown>>(schema: ValueSchema): z.ZodType<ValueSchema['Type']> =>
  z.unknown().transform((value, context): ValueSchema['Type'] => {
    const decoded = Schema.decodeUnknownResult(schema)(value)
    if (Result.isSuccess(decoded)) return decoded.success
    context.addIssue({ code: 'custom', message: 'Invalid stored value.' })
    return z.NEVER
  })

export const createEffectStoredValue = <ValueSchema extends Schema.ConstraintDecoder<unknown>, Fallback>(options: {
  readonly key: string
  readonly schema: ValueSchema
  readonly fallback: Fallback
  readonly storage?: (() => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null) | undefined
}) =>
  createStoredValue({
    ...options,
    schema: toZodSchema(options.schema),
  })
