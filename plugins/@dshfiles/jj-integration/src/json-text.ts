import { Schema } from 'effect'
import type { z } from 'zod'

/** JSON text parsed once, then validated by the schema that gives it a type. */
export class JsonText {
  static decode<Schema extends z.ZodType>(schema: Schema, text: string): z.ZodSafeParseResult<z.output<Schema>> | undefined {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return undefined
    }
    return schema.safeParse(value)
  }

  static decodeEffect<EffectSchema extends Schema.ConstraintDecoder<unknown, never>>(
    schema: EffectSchema,
    text: string,
    options: { readonly onExcessProperty?: 'ignore' | 'error' } = {},
  ): { readonly success: true; readonly data: EffectSchema['Type'] } | { readonly success: false } | undefined {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return undefined
    }
    try {
      return { success: true, data: Schema.decodeUnknownSync(schema, { onExcessProperty: options.onExcessProperty ?? 'ignore' })(value) }
    } catch {
      return { success: false }
    }
  }
}
