import * as Schema from 'effect/Schema'
import { z } from 'zod'

/**
 * The two Host boundaries that still declare their schema as `z.ZodType` — a
 * storage domain's `valueSchema` and plugin-ui's stored-value hook — take an
 * Effect schema through this shim: Effect decodes the value, zod only carries
 * the failure. It is the same bridge the converted prompt-stash store uses.
 */
export const asZodSchema = <ValueSchema extends Schema.ConstraintDecoder<unknown>>(schema: ValueSchema): z.ZodType<ValueSchema['Type']> =>
  z.unknown().transform((value, context): ValueSchema['Type'] => {
    const decoded = Schema.decodeUnknownResult(schema)(value)
    if (decoded._tag === 'Success') return decoded.success
    context.addIssue({ code: 'custom', message: decoded.failure.message })
    return z.NEVER
  })
