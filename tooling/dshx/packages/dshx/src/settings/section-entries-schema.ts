import { z } from 'zod'

/** Public Zod contract: Settings consumers extend and safe-parse these schemas. */
export const settingsSearchEntrySchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(500).optional(),
    keywords: z.string().max(500).optional(),
  })
  .strict()

/** One section's entries: ids are unique within the section, because the id comes back as its `target`. */
export const settingsSearchEntriesSchema = z
  .array(settingsSearchEntrySchema)
  .max(200)
  .refine(entries => new Set(entries.map(entry => entry.id)).size === entries.length, 'searchEntries ids must be unique within a section.')

export const settingsSectionMetadataSchema = z
  .object({
    settingsTargets: z.array(z.string().min(1)).optional(),
    searchEntries: settingsSearchEntriesSchema.optional(),
  })
  .strict()
