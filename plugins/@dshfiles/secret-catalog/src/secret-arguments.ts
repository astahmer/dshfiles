import { z } from 'zod'

export const aliasSchema = z
  .string()
  .min(1, 'Enter an alias.')
  .max(128, 'An alias is at most 128 characters.')
  .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, 'Start with a letter or _, then use letters, digits, _ or -.')

export const environmentSchema = z
  .string()
  .min(1, 'Enter an environment.')
  .max(256, 'An environment is at most 256 characters.')
  .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, _ or -.')

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
