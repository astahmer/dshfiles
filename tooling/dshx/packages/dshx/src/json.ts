import { z } from 'zod'

/**
 * The one place dshx turns JSON text into a value: every parse names its owning
 * schema and is validated here, so no call site parses text directly. Declared
 * as the JSON boundary in `scripts/lint-ratchet.ts`.
 */
export const decodeJson = <Schema extends z.ZodType>(schema: Schema, text: string): z.output<Schema> => schema.parse(JSON.parse(text))

export const decodeJsonSafe = <Schema extends z.ZodType>(schema: Schema, text: string): z.ZodSafeParseResult<z.output<Schema>> =>
  schema.safeParse(JSON.parse(text))
