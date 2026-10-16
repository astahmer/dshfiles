import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const MAX_PATH_LENGTH = 8_192
const MAX_DIRECTORY_ENTRIES = 1_000
const MAX_BREADCRUMBS = 8_192
const MAX_ENTRY_NAME_LENGTH = 255

const directoryEntrySchema = z
  .object({
    name: z.string().max(MAX_ENTRY_NAME_LENGTH),
    path: z.string().max(MAX_PATH_LENGTH),
    hidden: z.boolean(),
  })
  .strict()

const directoryListingSchema = z
  .object({
    path: z.string().max(MAX_PATH_LENGTH),
    home: z.string().max(MAX_PATH_LENGTH),
    crumbs: z.array(directoryEntrySchema).max(MAX_BREADCRUMBS),
    entries: z.array(directoryEntrySchema).max(MAX_DIRECTORY_ENTRIES),
    truncated: z.boolean(),
  })
  .strict()

export const workspaceFolderBrowserApi = defineApi({
  id: 'workspace-folder-picker.browser',
  version: 1,
  methods: {
    list: method({
      input: z.object({ path: z.string().min(1).max(MAX_PATH_LENGTH).optional() }).strict(),
      output: directoryListingSchema,
    }),
    createDirectory: method({
      input: z
        .object({
          path: z.string().min(1).max(MAX_PATH_LENGTH),
          name: z.string().min(1).max(MAX_ENTRY_NAME_LENGTH),
        })
        .strict(),
      output: z.string().min(1).max(MAX_PATH_LENGTH),
    }),
  },
})
