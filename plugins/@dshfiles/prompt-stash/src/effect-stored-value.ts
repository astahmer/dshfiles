import type * as Schema from 'effect/Schema'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'

/** `createStoredValue` keys from `@dshfiles/plugin-ui` still type their schema as `z.ZodType`; the Effect schema stays the source of truth. */
export const createEffectStoredValue = <ValueSchema extends Schema.ConstraintDecoder<unknown>, Fallback>(options: {
  readonly key: string
  readonly schema: ValueSchema
  readonly fallback: Fallback
  readonly storage?: (() => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null) | undefined
}) =>
  createStoredValue({
    ...options,
    schema: zodSchemaFromEffect(options.schema),
  })
