import { z } from 'zod'

/** JSON text parsed once; pipe the result into the schema that gives it a type. */
export const jsonTextSchema = (message: string): z.ZodPipe<z.ZodString, z.ZodTransform<unknown, string>> =>
  z.string().transform((text, context) => {
    try {
      const parsed: unknown = JSON.parse(text)
      return parsed
    } catch {
      context.addIssue({ code: 'custom', message })
      return z.NEVER
    }
  })
