import { z } from 'zod'

export const aliasSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/)

export const environmentSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/)

/** Free text passed after a `secret` flag; a leading dash would be read as another flag. */
const optionValueSchema = (maxLength: number) =>
  z
    .string()
    .max(maxLength)
    .refine(value => !value.startsWith('-'), { message: 'A value cannot start with "-".' })

export const updateMetadataSchema = z.object({
  name: optionValueSchema(512).optional(),
  source: optionValueSchema(2048).optional(),
  tags: optionValueSchema(1024).optional(),
})

export const createMetadataSchema = updateMetadataSchema.extend({
  type: optionValueSchema(64).optional(),
  field: optionValueSchema(256).optional(),
})
