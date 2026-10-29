import { decodeJson, jsonValueSchema, type JsonValue } from '@dshfiles/dshx/json'
import { z } from 'zod'

/** JSON text parsed once; pipe the result into the schema that gives it a type. */
export const jsonTextSchema = (message: string): z.ZodPipe<z.ZodString, z.ZodTransform<JsonValue, string>> =>
  z.string().transform((text, context) => {
    try {
      return decodeJson(jsonValueSchema, text)
    } catch {
      context.addIssue({ code: 'custom', message })
      return z.NEVER
    }
  })
