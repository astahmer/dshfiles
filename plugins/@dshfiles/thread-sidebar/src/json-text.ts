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
}
