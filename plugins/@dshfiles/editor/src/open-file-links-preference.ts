import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'

// `createStoredValue` (plugin-ui) is typed to `ZodType` and calls `.safeParse`, so this stays on zod.
export const openFileLinksPreference = createStoredValue({
  key: 'dshfiles-editor:open-file-links',
  schema: z.boolean(),
  fallback: true,
})
