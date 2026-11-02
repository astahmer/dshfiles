import type * as Schema from 'effect/Schema'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'

/**
 * The two Host boundaries that still type their schema as `z.ZodType`: `defineDomain` record validators from
 * `@deepseek-ai/dsh-storage-domain` and `createStoredValue` keys from `@dshfiles/plugin-ui`. The Effect schema stays
 * the source of truth and decodes the value; the view only carries it across the boundary.
 */
export const boundaryZodSchema = zodSchemaFromEffect

export const createEffectStoredValue = <ValueSchema extends Schema.ConstraintDecoder<unknown>, Fallback>(options: {
  readonly key: string
  readonly schema: ValueSchema
  readonly fallback: Fallback
  readonly storage?: (() => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null) | undefined
}) =>
  createStoredValue({
    ...options,
    schema: boundaryZodSchema(options.schema),
  })
