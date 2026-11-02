import * as Schema from 'effect/Schema'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'

/**
 * `createStoredValue` still decodes through a zod-typed key, so an Effect schema reaches it through the published
 * `zodSchemaFromEffect` view: the stored JSON is decoded by Effect and only the wrapper is zod-typed, leaving the
 * shared hook untouched.
 */
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
