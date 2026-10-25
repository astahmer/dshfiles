import { z } from 'zod'

/**
 * The one place repository scripts turn JSON text into a value: every parse goes
 * through here with the owning schema, so untrusted manifests, reports and log
 * lines are validated before use. Declared as the JSON boundary in
 * `scripts/lint-ratchet.ts`; nothing else under `scripts/` calls `JSON.parse`.
 */
export const decodeJson = <Schema extends z.ZodType>(schema: Schema, text: string): z.output<Schema> => schema.parse(JSON.parse(text))

export const decodeJsonSafe = <Schema extends z.ZodType>(schema: Schema, text: string): z.ZodSafeParseResult<z.output<Schema>> =>
  schema.safeParse(JSON.parse(text))
